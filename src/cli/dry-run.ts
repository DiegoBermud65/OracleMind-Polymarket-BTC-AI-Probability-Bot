#!/usr/bin/env tsx
import { loadConfig } from '../config/index.js';
import { createFeedHub } from '../feeds/index.js';
import { GammaClient } from '../feeds/gamma.js';
import { RiskManager } from '../risk/limits.js';
import { evaluateStrategy, type FusionState } from '../strategy/fusion.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger({ module: 'dry-run' });

async function main(): Promise<void> {
  const config = loadConfig();
  const feeds = createFeedHub(
    config.BINANCE_WS_URL,
    config.CHAINLINK_BTC_USD_FEED,
    config.CLOB_HOST,
    config.FEED_STALE_MS,
    config.CHAINLINK_STREAM_URL,
  );
  const gamma = new GammaClient(config.GAMMA_HOST);
  const risk = new RiskManager(config);

  feeds.binance.start();
  feeds.chainlink.start();
  feeds.clob.start();

  log.info('Dry run — waiting for feeds (5s)...');
  await new Promise((r) => setTimeout(r, 5000));

  const fusion: FusionState = { bias1h: null, confirm15m: null };
  const enteredWindows = new Set<string>();

  for (const [key, profile] of Object.entries(config.profiles)) {
    if (profile.status === 'disabled') continue;
    const market = await gamma.discoverCurrentWindow(profile.slugPrefix, profile.windowSeconds, key);
    if (!market) {
      console.log(`\n[${key}] No market found`);
      continue;
    }

    feeds.clob.subscribe(market.upTokenId, market.downTokenId);
    await new Promise((r) => setTimeout(r, 1000));

    const decision = evaluateStrategy({
      profile,
      profileKey: key,
      market,
      feeds,
      risk,
      fusion,
      slippageBps: config.SLIPPAGE_BPS,
      minEdge: config.MIN_EDGE_AFTER_FEES,
      enteredWindows,
    });

    console.log(`\n=== ${key.toUpperCase()} (${profile.role}) ===`);
    console.log(`Market: ${market.slug}`);
    console.log(`Action: ${decision.action}${decision.direction ? ` ${decision.direction}` : ''}`);
    console.log(`Log: ${decision.logLine}`);
    for (const reason of decision.reasons) {
      console.log(`  • ${reason}`);
    }
  }

  feeds.binance.stop();
  feeds.chainlink.stop();
  feeds.clob.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
