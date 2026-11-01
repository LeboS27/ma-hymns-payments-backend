// Mirrors app/src/constants/ministryInfo.ts's DONATION_TIERS — keep these two
// lists in sync by hand (the backend is intentionally dependency-free from
// the Expo app, so it can be deployed/hosted completely separately).
//
// Prices are trusted from THIS list, never from the client request, so a
// tampered request can't pay $0.99 and claim to be the $99.99 tier.
export const DONATION_TIERS = {
  starter: { label: 'Starter Support', amount: 0.99 },
  core: { label: 'Core Supporter', amount: 4.99 },
  super: { label: 'Super Supporter', amount: 9.99 },
  champion: { label: 'Champion Supporter', amount: 29.99 },
  visionary: { label: 'Visionary Supporter', amount: 99.99 },
};

export function isValidTier(tierId) {
  return Object.prototype.hasOwnProperty.call(DONATION_TIERS, tierId);
}

// Already-published app builds identify tiers by store product id (e.g.
// "com.christthroughhymns.app.donation_starter"); accept that as well as the
// short key. Returns the short key, or null if it matches no known tier.
export function resolveTier(input) {
  if (typeof input !== 'string') return null;
  if (isValidTier(input)) return input;
  const match = /^com\.christthroughhymns\.app\.donation_([a-z]+)$/.exec(input);
  return match && isValidTier(match[1]) ? match[1] : null;
}
