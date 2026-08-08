import { randomUUID } from 'node:crypto';
import type { Decision, MarketWindow, PaperFill, PnLRecord } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger({ module: 'paper' });

export class PaperExecutor {
  private fills: PaperFill[] = [];
  private pnlRecords: PnLRecord[] = [];
  private totalPnl = 0;
  private wins = 0;
  private losses = 0;

  execute(decision: Decision, market: MarketWindow): PaperFill | null {
    if (decision.action !== 'TRADE' || !decision.direction || !decision.tokenId || !decision.limitPrice) {
      return null;
    }

    const shares = decision.sizeUsd / decision.limitPrice;
    const fill: PaperFill = {
      id: randomUUID(),
      profile: decision.signal.profile,
      direction: decision.direction,
      tokenId: decision.tokenId,
      price: decision.limitPrice,
      sizeUsd: decision.sizeUsd,
      shares,
      timestamp: Date.now(),
      decision,
      marketSlug: market.slug,
    };

    this.fills.push(fill);
    log.info(
      {
        profile: fill.profile,
        direction: fill.direction,
        price: fill.price,
        sizeUsd: fill.sizeUsd,
        orderType: decision.orderType,
      },
      decision.logLine,
    );
    return fill;
  }

  settleWindow(market: MarketWindow, chainlinkPrice: number): PnLRecord[] {
    const openFills = this.fills.filter((f) => f.marketSlug === market.slug && !this.isSettled(f.id));
    const settled: PnLRecord[] = [];
    const upWins = chainlinkPrice >= market.priceToBeat;

    for (const fill of openFills) {
      const won =
        (fill.direction === 'UP' && upWins) || (fill.direction === 'DOWN' && !upWins);
      const exitPrice = won ? 1.0 : 0.0;
      const pnlUsd = fill.shares * exitPrice - fill.sizeUsd;

      const prob = fill.decision.signal.probability;
      const modelProb = fill.direction === 'UP' ? prob.modelProbUp : prob.modelProbDown;
      const marketProb = fill.direction === 'UP' ? prob.marketProbUp : prob.marketProbDown;
      const edge = fill.direction === 'UP' ? prob.edgeUpAfterFees : prob.edgeDownAfterFees;

      const record: PnLRecord = {
        marketSlug: market.slug,
        profile: fill.profile,
        direction: fill.direction,
        entryPrice: fill.price,
        exitPrice,
        pnlUsd,
        won,
        timestamp: Date.now(),
        modelProb,
        marketProb,
        edge,
      };

      settled.push(record);
      this.pnlRecords.push(record);
      this.totalPnl += pnlUsd;
      if (won) this.wins += 1;
      else this.losses += 1;
      (fill as PaperFill & { settled?: boolean }).settled = true;

      log.info({ pnlUsd, won, slug: market.slug }, 'Window settled');
    }

    return settled;
  }

  getStats() {
    const total = this.wins + this.losses;
    const grossWin = this.pnlRecords.filter((r) => r.pnlUsd > 0).reduce((a, r) => a + r.pnlUsd, 0);
    const grossLoss = Math.abs(this.pnlRecords.filter((r) => r.pnlUsd < 0).reduce((a, r) => a + r.pnlUsd, 0));
    return {
      totalUsd: this.totalPnl,
      wins: this.wins,
      losses: this.losses,
      winRate: total > 0 ? this.wins / total : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      fills: this.fills.length,
      records: this.pnlRecords,
    };
  }

  getFills(): PaperFill[] {
    return [...this.fills];
  }

  private isSettled(fillId: string): boolean {
    const fill = this.fills.find((f) => f.id === fillId);
    return Boolean((fill as PaperFill & { settled?: boolean })?.settled);
  }
}
