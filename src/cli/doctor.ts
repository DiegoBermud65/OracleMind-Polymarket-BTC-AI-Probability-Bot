#!/usr/bin/env tsx
import { loadConfig } from '../config/index.js';
import { createFeedHub } from '../feeds/index.js';
import { GammaClient } from '../feeds/gamma.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger({ module: 'doctor' });

async function main(): Promise<void> {
  const config = loadConfig();
  log.info('OracleMind Doctor — environment check');

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: 'Node version', ok: Number(process.version.slice(1).split('.')[0]) >= 20, detail: process.version },
    { name: 'Config loaded', ok: true, detail: `mode=${config.mode}` },
    { name: 'Profiles', ok: Object.keys(config.profiles).length === 3, detail: Object.keys(config.profiles).join(', ') },
    {
      name: 'Live credentials',
      ok: !config.LIVE || (Boolean(config.PRIVATE_KEY) && Boolean(config.FUNDER_ADDRESS) && config.LIVE_CONFIRM),
      detail: config.LIVE ? 'LIVE mode — credentials checked' : 'Paper mode OK',
    },
  ];

  const feeds = createFeedHub(
    config.BINANCE_WS_URL,
    config.CHAINLINK_BTC_USD_FEED,
    config.CLOB_HOST,
    config.FEED_STALE_MS,
    config.CHAINLINK_STREAM_URL,
  );

  feeds.binance.start();
  feeds.chainlink.start();
  await new Promise((r) => setTimeout(r, 3000));

  const health = feeds.getHealth();
  checks.push({
    name: 'Binance feed',
    ok: health.binanceConnected || health.binanceAgeMs < 10000,
    detail: `age=${health.binanceAgeMs}ms`,
  });
  checks.push({
    name: 'Chainlink feed',
    ok: health.chainlinkFresh,
    detail: `age=${health.chainlinkAgeMs}ms`,
  });

  const gamma = new GammaClient(config.GAMMA_HOST);
  const market = await gamma.discoverCurrentWindow('btc-updown-5m', 300, 'btc-5m');
  checks.push({
    name: 'Gamma discovery',
    ok: Boolean(market),
    detail: market?.slug ?? 'failed',
  });

  feeds.binance.stop();
  feeds.chainlink.stop();

  console.log('\nOracleMind Doctor Report\n');
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  }
  console.log('');
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
