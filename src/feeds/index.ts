import type { FeedHealth } from '../types/index.js';
import { BinanceFeed } from './binance.js';
import { ChainlinkFeed } from './chainlink.js';
import { ClobFeed } from './clob.js';

export class FeedHub {
  constructor(
    public binance: BinanceFeed,
    public chainlink: ChainlinkFeed,
    public clob: ClobFeed,
    public staleMs: number,
  ) {}

  getHealth(): FeedHealth {
    return {
      binanceConnected: this.binance.isConnected(),
      chainlinkFresh: this.chainlink.isFresh(this.staleMs),
      clobConnected: this.clob.isConnected(),
      binanceAgeMs: this.binance.getAgeMs(),
      chainlinkAgeMs: this.chainlink.getAgeMs(),
    };
  }

  feedsReadyForEntry(): boolean {
    const health = this.getHealth();
    return health.chainlinkFresh && !this.binance.isStale(this.staleMs);
  }
}

export function createFeedHub(
  binanceWsUrl: string,
  chainlinkUrl: string,
  clobHost: string,
  staleMs: number,
  chainlinkStreamUrl?: string,
): FeedHub {
  return new FeedHub(
    new BinanceFeed(binanceWsUrl),
    new ChainlinkFeed(chainlinkUrl, chainlinkStreamUrl),
    new ClobFeed(clobHost),
    staleMs,
  );
}
