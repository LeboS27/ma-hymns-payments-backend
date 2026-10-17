import express from 'express';
import { paymentsRouter } from './src/routes/payments.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Paynow posts form-encoded, not JSON

// CORS — mobile app calls this backend cross-origin. Permissive by design:
// the backend holds no user data and every write is gated by Paynow's own
// hash-verified protocol. Tighten with an allowlist later if desired.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/payments', paymentsRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`payments-backend listening on :${port}`);
});
