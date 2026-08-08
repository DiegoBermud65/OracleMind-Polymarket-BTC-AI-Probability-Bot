import type { PriceTick } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { bpsChange } from '../utils/math.js';

const log = createChildLogger({ module: 'chainlink' });

export class ChainlinkFeed {
  private lastPrice = 0;
  private lastUpdate = 0;
  private windowOpenPrice = 0;
  private windowOpenTs = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private prices: number[] = [];

  constructor(
    private feedUrl: string,
    private streamUrl?: string,
  ) {}

  start(pollMs = 2000): void {
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), pollMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getLatestPrice(): number {
    return this.lastPrice;
  }

  getAgeMs(): number {
    if (this.lastUpdate === 0) return Infinity;
    return Date.now() - this.lastUpdate;
  }

  isFresh(maxAgeMs: number): boolean {
    return this.lastPrice > 0 && this.getAgeMs() <= maxAgeMs;
  }

  isStale(maxAgeMs: number): boolean {
    return !this.isFresh(maxAgeMs);
  }

  getWindowOpenPrice(): number {
    return this.windowOpenPrice;
  }

  setWindowOpen(windowStartMs: number, openPrice?: number): void {
    if (this.windowOpenTs !== windowStartMs) {
      this.windowOpenTs = windowStartMs;
      this.windowOpenPrice = openPrice ?? this.lastPrice;
      log.info({ openPrice: this.windowOpenPrice, windowStartMs }, 'Chainlink window open set');
    }
  }

  getReturnSinceOpenBps(): number {
    if (this.windowOpenPrice <= 0 || this.lastPrice <= 0) return 0;
    return bpsChange(this.windowOpenPrice, this.lastPrice);
  }

  divergenceBps(cexPrice: number): number {
    if (this.lastPrice <= 0 || cexPrice <= 0) return 0;
    return Math.abs(bpsChange(this.lastPrice, cexPrice));
  }

  getRealizedVol(lookback = 30): number {
    const recent = this.prices.slice(-lookback);
    if (recent.length < 3) return 0;
    const returns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      returns.push((recent[i] - recent[i - 1]) / recent[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance) * 10_000;
  }

  toTick(): PriceTick | null {
    if (this.lastPrice <= 0) return null;
    return { price: this.lastPrice, timestamp: this.lastUpdate, source: 'chainlink' };
  }

  private async poll(): Promise<void> {
    const url = this.streamUrl ?? this.feedUrl;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      let price = 0;

      if (typeof data === 'object' && data !== null) {
        const btc = data as { bitcoin?: { usd?: number }; price?: number; answer?: number };
        price = btc.bitcoin?.usd ?? btc.price ?? btc.answer ?? 0;
      }

      if (price > 0) {
        this.lastPrice = price;
        this.lastUpdate = Date.now();
        this.prices.push(price);
        if (this.prices.length > 500) this.prices.shift();
        if (this.windowOpenPrice <= 0) {
          this.windowOpenPrice = price;
        }
      }
    } catch (err) {
      log.debug({ err }, 'Chainlink poll failed');
    }
  }
}
