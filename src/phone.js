// Ported from Mfundo's src/lib/ecocash.ts — same normalisation/validation,
// used here just to reject obviously-bad numbers before we spend a Paynow
// API call on them.

/** Normalise any local format to 2637XXXXXXXX. */
export function toMsisdn(input) {
  const n = input.replace(/[^\d]/g, '');
  if (n.startsWith('263')) return n;
  if (n.startsWith('0')) return '263' + n.slice(1);
  if (n.length === 9) return '263' + n; // 77XXXXXXX
  return n;
}

/** True for a plausible Zimbabwean mobile number after normalisation. */
export function isValidMsisdn(input) {
  const n = toMsisdn(input);
  return /^263(7[0-9]|86)\d{7}$/.test(n);
}
