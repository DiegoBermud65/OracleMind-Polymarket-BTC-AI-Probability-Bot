import { describe, it, expect } from 'vitest';
import { extractFeatures } from '../src/features/extractor.js';
import { BinanceFeed } from '../src/feeds/binance.js';
import { ChainlinkFeed } from '../src/feeds/chainlink.js';
import { ClobFeed } from '../src/feeds/clob.js';
import type { MarketWindow } from '../src/types/index.js';

describe('feature extraction', () => {
  const market: MarketWindow = {
    slug: 'btc-updown-5m-test',
    conditionId: 'sim',
    upTokenId: 'sim-up',
    downTokenId: 'sim-down',
    windowStart: Date.now() - 60_000,
    windowEnd: Date.now() + 240_000,
    priceToBeat: 95000,
    question: 'test',
    profile: 'btc-5m',
  };

  it('extracts bounded feature vector from feeds', () => {
    const binance = new BinanceFeed('wss://stream.binance.com:9443/ws');
    const chainlink = new ChainlinkFeed('https://example.com');
    const clob = new ClobFeed('https://clob.polymarket.com');

    (binance as unknown as { lastPrice: number }).lastPrice = 95100;
    (binance as unknown as { lastUpdate: number }).lastUpdate = Date.now();
    (chainlink as unknown as { lastPrice: number }).lastPrice = 95080;
    (chainlink as unknown as { lastUpdate: number }).lastUpdate = Date.now();

    clob.setSimulatedBook('sim-up', 0.58, 0.62);
    clob.setSimulatedBook('sim-down', 0.38, 0.42);

    const features = extractFeatures({ market, binance, chainlink, clob });

    expect(features.timeRemainingPct).toBeGreaterThan(0);
    expect(features.timeRemainingPct).toBeLessThanOrEqual(1);
    expect(features.bookImbalance).toBeGreaterThanOrEqual(-1);
    expect(features.bookImbalance).toBeLessThanOrEqual(1);
    expect(features.returnSinceOpenChainlinkBps).not.toBeNaN();
  });
});
