import WebSocket from 'ws';
import type { Quote } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { exponentialBackoff, sumDepthUsd } from '../utils/math.js';

const log = createChildLogger({ module: 'clob' });
const CLOB_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

interface BookLevel {
  price: string;
  size: string;
}

interface BookMessage {
  event_type?: string;
  asset_id?: string;
  bids?: BookLevel[];
  asks?: BookLevel[];
}

export class ClobFeed {
  private ws: WebSocket | null = null;
  private quotes = new Map<string, Quote>();
  private reconnectAttempts = 0;
  private running = false;
  private subscribedTokens: string[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private clobHost: string) {}

  start(): void {
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.ws?.close();
    this.ws = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  subscribe(upTokenId: string, downTokenId: string): void {
    this.subscribedTokens = [upTokenId, downTokenId];
    if (upTokenId.startsWith('sim-')) {
      this.setSimulatedBook(upTokenId, 0.52, 0.48);
      this.setSimulatedBook(downTokenId, 0.48, 0.52);
      return;
    }
    this.sendSubscribe();
    this.startPolling(upTokenId, downTokenId);
  }

  getQuote(tokenId: string): Quote | null {
    return this.quotes.get(tokenId) ?? null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN || this.subscribedTokens.some((t) => t.startsWith('sim-'));
  }

  getBookImbalance(upTokenId: string, downTokenId: string): number {
    const up = this.quotes.get(upTokenId);
    const down = this.quotes.get(downTokenId);
    if (!up || !down) return 0;
    const upDepth = up.depthUsd;
    const downDepth = down.depthUsd;
    const total = upDepth + downDepth;
    if (total === 0) return 0;
    return (upDepth - downDepth) / total;
  }

  setSimulatedBook(tokenId: string, bid: number, ask: number): void {
    const mid = (bid + ask) / 2;
    const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10_000 : 0;
    this.quotes.set(tokenId, {
      tokenId,
      bestBid: bid,
      bestAsk: ask,
      mid,
      spreadBps,
      depthUsd: 500 + Math.random() * 500,
      timestamp: Date.now(),
    });
  }

  private connect(): void {
    if (this.subscribedTokens.every((t) => t.startsWith('sim-'))) return;

    this.ws = new WebSocket(CLOB_WS);

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      log.info('CLOB WebSocket connected');
      this.sendSubscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as BookMessage | BookMessage[];
        const messages = Array.isArray(msg) ? msg : [msg];
        for (const m of messages) {
          if (m.asset_id && (m.bids || m.asks)) {
            this.updateQuote(m.asset_id, m.bids ?? [], m.asks ?? []);
          }
        }
      } catch {
        /* ignore */
      }
    });

    this.ws.on('close', () => {
      if (!this.running) return;
      const delay = exponentialBackoff(this.reconnectAttempts++, 3000);
      log.warn({ delay }, 'CLOB WS closed — reconnecting');
      setTimeout(() => this.connect(), delay);
    });

    this.ws.on('error', (err) => {
      log.error({ err }, 'CLOB WS error');
    });
  }

  private sendSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTokens.length === 0) return;
    this.ws.send(
      JSON.stringify({
        type: 'market',
        assets_ids: this.subscribedTokens,
      }),
    );
  }

  private startPolling(upTokenId: string, downTokenId: string): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.fetchBook(upTokenId);
      void this.fetchBook(downTokenId);
    }, 2000);
  }

  private async fetchBook(tokenId: string): Promise<void> {
    try {
      const url = `${this.clobHost}/book?token_id=${encodeURIComponent(tokenId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const book = (await res.json()) as { bids?: BookLevel[]; asks?: BookLevel[] };
      this.updateQuote(tokenId, book.bids ?? [], book.asks ?? []);
    } catch {
      /* ignore */
    }
  }

  private updateQuote(tokenId: string, bids: BookLevel[], asks: BookLevel[]): void {
    const bidLevels = bids.map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
    const askLevels = asks.map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));
    const bestBid = bidLevels[0]?.price ?? 0;
    const bestAsk = askLevels[0]?.price ?? 1;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestAsk || bestBid;
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 9999;
    const depthUsd = sumDepthUsd(bidLevels) + sumDepthUsd(askLevels);

    this.quotes.set(tokenId, {
      tokenId,
      bestBid,
      bestAsk,
      mid,
      spreadBps,
      depthUsd,
      timestamp: Date.now(),
    });
  }
}
