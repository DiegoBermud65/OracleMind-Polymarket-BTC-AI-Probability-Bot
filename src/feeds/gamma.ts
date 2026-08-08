import type { MarketWindow } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { currentWindowStart, slugForWindow } from '../utils/math.js';

const log = createChildLogger({ module: 'gamma' });

export interface GammaMarket {
  id: string;
  slug: string;
  question: string;
  conditionId: string;
  clobTokenIds: string[] | string;
  endDate: string;
  active: boolean;
  closed: boolean;
  description?: string;
}

export class GammaClient {
  constructor(private gammaHost: string) {}

  async discoverCurrentWindow(
    slugPrefix: string,
    windowSeconds: number,
    profile: string,
  ): Promise<MarketWindow | null> {
    const windowStart = currentWindowStart(windowSeconds);
    const slug = slugForWindow(slugPrefix, windowStart);
    return this.fetchBySlug(slug, windowStart, windowStart + windowSeconds, profile);
  }

  async fetchBySlug(
    slug: string,
    windowStart: number,
    windowEnd: number,
    profile: string,
  ): Promise<MarketWindow | null> {
    try {
      const url = `${this.gammaHost}/markets?slug=${encodeURIComponent(slug)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        log.debug({ slug, status: res.status }, 'Gamma slug lookup failed');
        return this.createSimulatedWindow(slug, windowStart, windowEnd, profile);
      }
      const markets = (await res.json()) as GammaMarket[];
      const market = markets[0];
      if (!market || market.closed) {
        return this.createSimulatedWindow(slug, windowStart, windowEnd, profile);
      }

      let tokenIds = market.clobTokenIds;
      if (typeof tokenIds === 'string') {
        tokenIds = JSON.parse(tokenIds) as string[];
      }
      if (!tokenIds || tokenIds.length < 2) {
        log.warn({ slug }, 'Market missing token IDs — using simulated window');
        return this.createSimulatedWindow(slug, windowStart, windowEnd, profile);
      }

      const ptb = await this.extractPriceToBeat(market, windowStart);

      return {
        slug: market.slug,
        conditionId: market.conditionId,
        upTokenId: tokenIds[0],
        downTokenId: tokenIds[1],
        windowStart: windowStart * 1000,
        windowEnd: windowEnd * 1000,
        priceToBeat: ptb,
        question: market.question,
        profile,
      };
    } catch (err) {
      log.debug({ err, slug }, 'Market discovery error — simulated fallback');
      return this.createSimulatedWindow(slug, windowStart, windowEnd, profile);
    }
  }

  async searchActiveBtcMarkets(slugPrefix: string): Promise<GammaMarket[]> {
    try {
      const url = `${this.gammaHost}/markets?slug_contains=${encodeURIComponent(slugPrefix)}&active=true&closed=false&limit=10`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      return (await res.json()) as GammaMarket[];
    } catch {
      return [];
    }
  }

  private async extractPriceToBeat(market: GammaMarket, windowStart: number): Promise<number> {
    const desc = market.description ?? market.question ?? '';
    const match = desc.match(/\$[\d,]+(?:\.\d+)?/);
    if (match) {
      return parseFloat(match[0].replace(/[$,]/g, ''));
    }
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = (await res.json()) as { bitcoin?: { usd?: number } };
        if (data.bitcoin?.usd) return data.bitcoin.usd;
      }
    } catch {
      /* synthetic PTB */
    }
    return 95000 + (windowStart % 1000);
  }

  createSimulatedWindow(
    slug: string,
    windowStart: number,
    windowEnd: number,
    profile: string,
    livePrice = 95000,
  ): MarketWindow {
    return {
      slug,
      conditionId: `sim-${slug}`,
      upTokenId: `sim-up-${windowStart}`,
      downTokenId: `sim-down-${windowStart}`,
      windowStart: windowStart * 1000,
      windowEnd: windowEnd * 1000,
      priceToBeat: livePrice,
      question: `Simulated BTC Up/Down — ${slug}`,
      profile,
    };
  }
}

export class WindowScheduler {
  private currentMarket: MarketWindow | null = null;
  private switchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private gamma: GammaClient,
    private slugPrefix: string,
    private windowSeconds: number,
    private profile: string,
    private onSwitch: (market: MarketWindow) => void,
  ) {}

  get activeMarket(): MarketWindow | null {
    return this.currentMarket;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.scheduleNextSwitch();
  }

  stop(): void {
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
      this.switchTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    let market = await this.gamma.discoverCurrentWindow(
      this.slugPrefix,
      this.windowSeconds,
      this.profile,
    );
    if (!market) {
      const markets = await this.gamma.searchActiveBtcMarkets(this.slugPrefix);
      if (markets.length > 0) {
        const m = markets[0];
        let tokenIds = m.clobTokenIds;
        if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds) as string[];
        const windowStart = currentWindowStart(this.windowSeconds);
        market = {
          slug: m.slug,
          conditionId: m.conditionId,
          upTokenId: tokenIds[0],
          downTokenId: tokenIds[1],
          windowStart: windowStart * 1000,
          windowEnd: (windowStart + this.windowSeconds) * 1000,
          priceToBeat: 95000,
          question: m.question,
          profile: this.profile,
        };
      }
    }
    if (market) {
      this.currentMarket = market;
      this.onSwitch(market);
      log.info({ slug: market.slug, ptb: market.priceToBeat }, 'Active market window');
    } else {
      log.warn({ slugPrefix: this.slugPrefix }, 'No active market found');
    }
  }

  private scheduleNextSwitch(): void {
    const now = Date.now();
    const windowStartSec = currentWindowStart(this.windowSeconds);
    const nextSwitchMs = (windowStartSec + this.windowSeconds) * 1000 - now + 500;
    this.switchTimer = setTimeout(() => {
      void this.refresh().then(() => this.scheduleNextSwitch());
    }, Math.max(1000, nextSwitchMs));
  }
}
