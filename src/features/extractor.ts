import type { FeatureVector, MarketWindow } from '../types/index.js';
import { BinanceFeed } from '../feeds/binance.js';
import { ChainlinkFeed } from '../feeds/chainlink.js';
import { ClobFeed } from '../feeds/clob.js';
import { bpsChange, clamp, timeToWindowClose } from '../utils/math.js';

export interface FeatureContext {
  market: MarketWindow;
  binance: BinanceFeed;
  chainlink: ChainlinkFeed;
  clob: ClobFeed;
}

export function extractFeatures(ctx: FeatureContext): FeatureVector {
  const { market, binance, chainlink, clob } = ctx;
  const now = Date.now();
  const remainingMs = timeToWindowClose(market.windowEnd, now);
  const windowDurationMs = market.windowEnd - market.windowStart;
  const timeRemainingPct = windowDurationMs > 0 ? remainingMs / windowDurationMs : 0;

  const chainlinkPrice = chainlink.getLatestPrice();
  const binancePrice = binance.getLatestPrice();
  const ptb = market.priceToBeat;

  chainlink.setWindowOpen(market.windowStart, ptb);

  const returnSinceOpenChainlinkBps = chainlink.getReturnSinceOpenBps();
  const returnSinceOpenBinanceBps = binance.getReturnSince(ptb);
  const momentumBps = binance.getMomentumBps(12);
  const realizedVol = Math.max(binance.getRealizedVol(30), chainlink.getRealizedVol(30));
  const bookImbalance = clob.getBookImbalance(market.upTokenId, market.downTokenId);
  const ptbDistanceBps = ptb > 0 ? bpsChange(ptb, chainlinkPrice) : 0;
  const chainlinkBinanceDivergenceBps = chainlink.divergenceBps(binancePrice);

  return {
    returnSinceOpenChainlinkBps,
    returnSinceOpenBinanceBps,
    momentumBps,
    realizedVol,
    bookImbalance: clamp(bookImbalance, -1, 1),
    timeRemainingPct: clamp(timeRemainingPct, 0, 1),
    ptbDistanceBps,
    chainlinkBinanceDivergenceBps,
  };
}
