import express from 'express';
import { loadConfig } from '../config/index.js';
import { OracleMindStore } from '../storage/sqlite.js';

const config = loadConfig();
const store = new OracleMindStore(config.SQLITE_PATH);
const app = express();

app.get('/api/summary', (_req, res) => {
  res.json(store.getSummary());
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'OracleMind Dashboard' });
});

app.get('/', (_req, res) => {
  const summary = store.getSummary();
  res.send(`<!DOCTYPE html>
<html><head><title>OracleMind Dashboard</title>
<style>
  body { font-family: system-ui; background: #0b0f17; color: #e8edf5; padding: 2rem; }
  .card { background: #141b2d; border-radius: 12px; padding: 1.5rem; max-width: 640px; }
  h1 { color: #6ee7b7; }
  .metric { font-size: 2rem; font-weight: 700; }
</style></head><body>
  <div class="card">
    <h1>OracleMind Dashboard</h1>
    <p>Paper/live analytics from SQLite</p>
    <p>Trades: <span class="metric">${summary.trades ?? 0}</span></p>
    <p>Wins: <span class="metric">${summary.wins ?? 0}</span></p>
    <p>Total PnL: <span class="metric">$${(summary.total_pnl ?? 0).toFixed(2)}</span></p>
  </div>
</body></html>`);
});

app.listen(config.DASHBOARD_PORT, () => {
  console.log(`OracleMind dashboard http://localhost:${config.DASHBOARD_PORT}`);
});
