import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { initiateMobileTransaction, pollTransaction, parseResultCallback, paynowConfigured } from '../paynow.js';
import { DONATION_TIERS, isValidTier } from '../donationTiers.js';
import { isValidMsisdn, toMsisdn } from '../phone.js';
import { putPending, getPollUrl, deletePending } from '../pendingStore.js';

const APP_NAME = 'MA Hymns';
const CONTACT_EMAIL = process.env.DONATION_AUTH_EMAIL || 'donations@example.org';

const RESULT_URL = process.env.PAYMENTS_RESULT_URL || '';
const RETURN_URL = process.env.PAYMENTS_RETURN_URL || '';

export const paymentsRouter = Router();

/**
 * POST /api/payments/initiate
 * body: { phone: string, tier: 'starter'|'core'|'super'|'champion'|'visionary' }
 *
 * Starts an EcoCash/OneMoney push-and-approve. The mobile app should show a
 * "check your phone" state and start polling GET /status?ref=... immediately.
 */
paymentsRouter.post('/initiate', async (req, res) => {
  if (!paynowConfigured) {
    return res.status(503).json({ error: 'demo', message: 'Payments are not configured on this server yet.' });
  }

  const { phone, tier, method } = req.body ?? {};

  if (!isValidTier(tier)) {
    return res.status(400).json({ error: 'Unknown donation tier.' });
  }
  if (typeof phone !== 'string' || !isValidMsisdn(phone)) {
    return res.status(400).json({ error: 'Enter a valid Zimbabwean mobile number (EcoCash or OneMoney).' });
  }

  const payMethod = method === 'onemoney' ? 'onemoney' : 'ecocash';

  const { label, amount } = DONATION_TIERS[tier];
  const reference = `mahymns-${tier}-${randomUUID()}`;

  try {
    const result = await initiateMobileTransaction({
      reference,
      amount,
      authEmail: CONTACT_EMAIL,
      phone: toMsisdn(phone),
      method: payMethod,
      itemName: `${APP_NAME} — ${label}`,
      resultUrl: RESULT_URL,
      returnUrl: RETURN_URL,
    });

    if (!result.success) {
      return res.status(402).json({ error: result.error || 'Paynow declined the request.' });
    }

    putPending(reference, result.pollUrl);
    return res.json({ sourceReference: reference, instructions: result.instructions });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not reach Paynow. Please try again.' });
  }
});

/**
 * GET /api/payments/status?ref=...
 * The mobile app polls this every few seconds after initiate().
 */
paymentsRouter.get('/status', async (req, res) => {
  const reference = String(req.query.ref || '');
  const pollUrl = getPollUrl(reference);
  if (!pollUrl) {
    return res.status(404).json({ status: 'failed', error: 'Unknown or expired payment reference.' });
  }

  try {
    const result = await pollTransaction(pollUrl);
    if (result.status === 'success' || result.status === 'failed') deletePending(reference);
    return res.json({ status: result.status, paynowReference: result.paynowReference });
  } catch (e) {
    // Transient — let the client keep polling rather than surface every hiccup.
    return res.status(200).json({ status: 'pending' });
  }
});

/**
 * POST /api/payments/result — Paynow's own server-to-server webhook.
 * Register RESULT_URL (this endpoint's public URL) with your Paynow config.
 * Treated as a hint that a poll would now succeed, not sole source of truth
 * (matches the caution in Mfundo's paynow.ts).
 */
paymentsRouter.post('/result', (req, res) => {
  const parsed = parseResultCallback(new URLSearchParams(req.body).toString());
  if (!parsed.valid) return res.status(400).send('invalid');
  // Nothing to persist server-side yet (no database in this MVP) — the
  // mobile client's own poll loop will pick up the new status within
  // POLL_MS. Add order fulfillment / receipt logic here once this app
  // needs to record completed gifts anywhere.
  return res.status(200).send('ok');
});
