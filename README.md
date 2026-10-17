# MA Hymns — payments backend (EcoCash/OneMoney via Paynow)

A tiny Express server that holds the Paynow `PAYNOW_INTEGRATION_KEY` secret and
proxies donation payments. It exists **only** for the direct-distribution
build of the app (shared outside the Play Store) — the Play Store build never
calls this and stays on Google Play Billing.

Ported from the Mfundo project's `src/lib/paynow.ts` (see that file's
comments for why this goes through Paynow instead of EcoCash's own API
directly). Same hash algorithm, same field order, same endpoints.

## Why this has to be a separate server

`PAYNOW_INTEGRATION_KEY` signs every request to Paynow. If it shipped inside
the mobile app bundle, anyone could decompile the APK, pull it out, and charge
transactions against your merchant account. It must only ever live on a
server you control.

## Running it

```bash
cd payments-backend
npm install
cp .env.example .env   # fill in real values, never commit this file
npm start
```

Health check: `GET /health` → `{ ok: true }`

## Deploying it

This is a plain Express app with no host-specific code, so it runs on
whatever you already have or want to use:

- **Render / Railway / Fly.io** — point them at this folder, `npm start`,
  set the env vars from `.env.example` in their dashboard. Probably the
  least fuss for a small church app.
- **A VPS you already have** — `npm install --production && npm start`
  behind a reverse proxy (nginx/Caddy), or under `pm2`/`systemd` so it
  survives reboots.
- **Vercel** — needs a thin adapter (Vercel wants individual serverless
  functions, not a long-running Express `listen()`); ask and I'll add
  `api/*.js` wrapper files using `@vercel/node` if you go this route. Also
  worth noting: Vercel's serverless functions are stateless per-invocation
  and may run on different instances, so `src/pendingStore.js`'s in-memory
  Map would need to become Vercel KV / Upstash Redis instead — noted in that
  file's comment.

Whichever you pick, you need a **public HTTPS URL** for it before the mobile
app can use it — put that URL in `PAYMENTS_RESULT_URL`/`PAYMENTS_RETURN_URL`
in `.env`, and separately in the mobile app's config (see below).

## Wiring up the mobile app

The mobile side (`app/src/components/EcoCashDonateModal.tsx`) calls:

- `POST {PAYMENTS_API_BASE_URL}/api/payments/initiate` — body `{ phone, tier }`
- `GET {PAYMENTS_API_BASE_URL}/api/payments/status?ref=...` — polled every 5s

`PAYMENTS_API_BASE_URL` isn't wired into the Expo app yet — that's the next
step once you've deployed this somewhere and have a real URL to point at.

## Routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/payments/initiate` | Starts a push-and-approve; body `{ phone, tier }` where `tier` is one of `starter/core/super/champion/visionary` (see `src/donationTiers.js` — amounts are trusted server-side, never taken from the client) |
| GET | `/api/payments/status?ref=` | Poll for the outcome of a reference returned by `initiate` |
| POST | `/api/payments/result` | Paynow's own webhook — register this URL with Paynow as your `resulturl` |

## Known MVP limitations

- No database — successful/failed payments aren't recorded anywhere once the
  mobile app stops polling. Fine for "does the gift go through," not fine if
  you'll ever want a donations ledger — add a database + write on `/result`
  when that matters.
- In-memory pending-transaction store — see the comment in
  `src/pendingStore.js`. Fine for a single always-on instance; needs Redis or
  similar if you deploy somewhere that runs multiple instances.
