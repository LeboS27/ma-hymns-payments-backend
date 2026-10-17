import { createHash } from 'node:crypto';

/**
 * Paynow Zimbabwe integration (mobile money — EcoCash/OneMoney push-and-approve).
 *
 * Ported 1:1 from the Mfundo project's `src/lib/paynow.ts` (same field order,
 * same hash algorithm, same endpoints) — see that project's file for the full
 * background on why this goes through Paynow rather than EcoCash's own API
 * directly (EcoCash's `developers.ecocash.co.zw` sits behind Cloudflare
 * bot-fight mode and rejects server-to-server calls without a formal
 * merchant-API relationship; Paynow already has that relationship and
 * exposes a plain REST API).
 *
 * Server-only. PAYNOW_INTEGRATION_KEY must never reach the mobile app —
 * that's the entire reason this lives in a separate backend instead of the
 * Expo app bundle.
 */

const INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID || '';
const INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY || '';

export const paynowConfigured = Boolean(INTEGRATION_ID && INTEGRATION_KEY);

const URL_INITIATE_MOBILE = 'https://www.paynow.co.zw/interface/remotetransaction';

export class PaynowError extends Error {
  constructor(message, payload) {
    super(message);
    this.name = 'PaynowError';
    this.payload = payload;
  }
}

/**
 * Paynow's hash: concatenate every field's value (URL-encoded, in object
 * insertion order, excluding "hash" itself), append the integration key
 * lowercased, SHA512, uppercase the hex digest.
 */
function generateHash(values, integrationKey) {
  let s = '';
  for (const [k, v] of Object.entries(values)) {
    if (k === 'hash') continue;
    s += v;
  }
  s += integrationKey.toLowerCase();
  return createHash('sha512').update(s, 'utf8').digest('hex').toUpperCase();
}

function verifyHash(values, integrationKey) {
  const hash = values.hash;
  if (!hash) return false;
  return hash === generateHash(values, integrationKey);
}

/** application/x-www-form-urlencoded body -> plain object (Paynow's response format). */
function parseFormBody(body) {
  const out = {};
  const pairs = (body[0] === '?' ? body.slice(1) : body).split('&');
  for (const pair of pairs) {
    const [k, v] = pair.split('=');
    if (!k) continue;
    out[decodeURIComponent(k.replace(/\+/g, '%20'))] = decodeURIComponent((v ?? '').replace(/\+/g, '%20'));
  }
  return out;
}

/**
 * Initiate a EcoCash/OneMoney USSD push via Paynow. The subscriber gets a
 * USSD prompt on their handset to approve with their mobile-money PIN.
 *
 * @param {{reference: string, amount: number, authEmail: string, phone: string,
 *   method?: 'ecocash'|'onemoney', itemName: string, resultUrl: string, returnUrl: string}} args
 * @returns {Promise<{success: boolean, status: string, pollUrl?: string, instructions?: string, error?: string}>}
 */
export async function initiateMobileTransaction(args) {
  if (!paynowConfigured) {
    throw new PaynowError('Paynow is not configured (PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY missing).');
  }

  const raw = {
    resulturl: args.resultUrl,
    returnurl: args.returnUrl,
    reference: args.reference,
    amount: args.amount.toFixed(2),
    id: INTEGRATION_ID,
    additionalinfo: args.itemName,
    authemail: args.authEmail,
    phone: args.phone,
    method: args.method ?? 'ecocash',
    status: 'Message',
  };
  const encoded = {};
  for (const [k, v] of Object.entries(raw)) encoded[k] = encodeURI(v);
  encoded.hash = generateHash(encoded, INTEGRATION_KEY);

  const body = new URLSearchParams(encoded).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let text;
  try {
    const res = await fetch(URL_INITIATE_MOBILE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    text = await res.text();
    if (!res.ok) throw new PaynowError(`Paynow request failed (HTTP ${res.status}).`, { status: res.status, body: text });
  } catch (e) {
    if (e instanceof PaynowError) throw e;
    if (e.name === 'AbortError') throw new PaynowError('Paynow request timed out.');
    throw new PaynowError(e.message || 'Paynow network error.');
  } finally {
    clearTimeout(timeout);
  }

  const parsed = parseFormBody(text);
  const status = (parsed.status ?? '').toLowerCase();

  if (status === 'error') {
    return { success: false, status, error: parsed.error || 'Paynow declined the request.' };
  }

  if (!verifyHash(parsed, INTEGRATION_KEY)) {
    throw new PaynowError('Paynow response hash did not verify — possible tampering, refusing to trust it.', parsed);
  }

  return {
    success: true,
    status,
    pollUrl: parsed.pollurl,
    instructions: parsed.instructions,
  };
}

/**
 * Poll the exact pollUrl Paynow gave us at initiation for the current
 * transaction status.
 * @param {string} pollUrl
 * @returns {Promise<{status: 'pending'|'success'|'failed', paynowReference?: string, amount?: string, raw: object}>}
 */
export async function pollTransaction(pollUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let text;
  try {
    const res = await fetch(pollUrl, { method: 'POST', signal: controller.signal });
    text = await res.text();
    if (!res.ok) throw new PaynowError(`Paynow poll failed (HTTP ${res.status}).`, { status: res.status });
  } catch (e) {
    if (e instanceof PaynowError) throw e;
    if (e.name === 'AbortError') throw new PaynowError('Paynow poll timed out.');
    throw new PaynowError(e.message || 'Paynow network error.');
  } finally {
    clearTimeout(timeout);
  }

  const parsed = parseFormBody(text);
  if (!verifyHash(parsed, INTEGRATION_KEY)) {
    throw new PaynowError('Paynow poll response hash did not verify.', parsed);
  }

  const s = String(parsed.status ?? '').toLowerCase();
  const status =
    s === 'paid' || s === 'awaiting delivery' || s === 'delivered'
      ? 'success'
      : ['cancelled', 'disputed', 'refunded', 'failed'].includes(s)
        ? 'failed'
        : 'pending'; // "created", "sent", "awaiting redirect" etc.

  return { status, paynowReference: parsed.paynowreference, amount: parsed.amount, raw: parsed };
}

/** Verify + parse Paynow's resulturl webhook callback. */
export function parseResultCallback(body) {
  const parsed = parseFormBody(body);
  if (!verifyHash(parsed, INTEGRATION_KEY)) return { valid: false };
  return { valid: true, reference: parsed.reference, status: (parsed.status ?? '').toLowerCase() };
}
