/**
 * Maps our own `reference` to the Paynow `pollUrl` returned at initiation, so
 * the mobile app's status-poll requests (which only know the reference) can
 * be resolved back to the right Paynow poll endpoint.
 *
 * In-memory Map — fine for a single instance. If you deploy this to
 * anything that runs more than one instance (most serverless platforms
 * autoscale horizontally), swap this for Redis/Upstash/a database table:
 * whichever instance handles the poll request needs to see what the
 * initiate request wrote. Kept dependency-free here so hosting choice
 * doesn't have to be decided up front.
 */
const store = new Map();
const TTL_MS = 30 * 60 * 1000; // 30 minutes — well past the mobile client's own 90s give-up window

export function putPending(reference, pollUrl) {
  store.set(reference, { pollUrl, expiresAt: Date.now() + TTL_MS });
}

export function getPollUrl(reference) {
  const entry = store.get(reference);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(reference);
    return null;
  }
  return entry.pollUrl;
}

export function deletePending(reference) {
  store.delete(reference);
}

// Sweep expired entries periodically so long-running instances don't leak memory.
setInterval(() => {
  const now = Date.now();
  for (const [ref, entry] of store) {
    if (now > entry.expiresAt) store.delete(ref);
  }
}, 5 * 60 * 1000).unref?.();
