import WebSocket from 'ws';
import type { PriceTick } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { exponentialBackoff } from '../utils/math.js';

const log = createChildLogger({ module: 'binance' });

export class BinanceFeed {
  private ws: WebSocket | null = null;
  private lastPrice = 0;
  private lastUpdate = 0;
  private reconnectAttempts = 0;
  private prices: number[] = [];
  private volumes: number[] = [];
  private running = false;

  constructor(private wsBaseUrl: string) {}

  start(): void {
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.ws?.close();
    this.ws = null;
  }

  getLatestPrice(): number {
    return this.lastPrice;
  }

  getAgeMs(): number {
    if (this.lastUpdate === 0) return Infinity;
    return Date.now() - this.lastUpdate;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isStale(maxAgeMs: number): boolean {
    return this.getAgeMs() > maxAgeMs;
  }

  getRecentPrices(max = 60): number[] {
    return this.prices.slice(-max);
  }

  getTradeIntensity(): number {
    return this.volumes.slice(-30).reduce((a, b) => a + b, 0);
  }

  getMomentumBps(lookback = 10): number {
    const recent = this.prices.slice(-lookback);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    return ((last - first) / first) * 10_000;
  }

  getReturnSince(openPrice: number): number {
    if (openPrice <= 0 || this.lastPrice <= 0) return 0;
    return ((this.lastPrice - openPrice) / openPrice) * 10_000;
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
    return { price: this.lastPrice, timestamp: this.lastUpdate, source: 'binance' };
  }

  private connect(): void {
    const url = `${this.wsBaseUrl}/btcusdt@trade`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      log.info('Binance WebSocket connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { p: string; q: string; T: number };
        const price = parseFloat(msg.p);
        const volume = parseFloat(msg.q);
        this.lastPrice = price;
        this.lastUpdate = msg.T || Date.now();
        this.prices.push(price);
        this.volumes.push(volume);
        if (this.prices.length > 500) this.prices.shift();
        if (this.volumes.length > 500) this.volumes.shift();
      } catch {
        /* ignore parse errors */
      }
    });

    this.ws.on('close', () => {
      if (!this.running) return;
      const delay = exponentialBackoff(this.reconnectAttempts++, 3000);
      log.warn({ delay }, 'Binance WS closed — reconnecting');
      setTimeout(() => this.connect(), delay);
    });

    this.ws.on('error', (err) => {
      log.error({ err }, 'Binance WS error');
    });
  }
}
