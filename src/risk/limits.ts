import type { ProfileConfig, RiskState, SkipReasonCode } from '../types/index.js';
import type { AppConfig } from '../config/index.js';

export interface RiskCheckResult {
  ok: boolean;
  allowedSizeUsd: number;
  code?: SkipReasonCode;
  reason?: string;
}

export class RiskManager {
  private state: RiskState = {
    hourlySpendUsd: 0,
    dailySpendUsd: 0,
    marketSpendUsd: {},
    tradesThisHour: 0,
    hourlyLossUsd: 0,
    dailyLossUsd: 0,
    consecutiveLosses: 0,
    inventoryUsd: 0,
    lastLossTimestamp: 0,
  };

  private hourStart = Date.now();
  private dayStart = Date.now();

  constructor(private config: AppConfig) {}

  getState(): RiskState {
    this.rollWindows();
    return { ...this.state, marketSpendUsd: { ...this.state.marketSpendUsd } };
  }

  isKillSwitchActive(): boolean {
    return this.config.KILL_SWITCH;
  }

  canTrade(profile: ProfileConfig, marketSlug: string, requestedUsd: number): RiskCheckResult {
    this.rollWindows();

    if (this.config.KILL_SWITCH) {
      return { ok: false, allowedSizeUsd: 0, code: 'kill_switch', reason: 'Kill switch active' };
    }

    if (this.state.consecutiveLosses >= this.config.MAX_CONSECUTIVE_LOSSES) {
      return {
        ok: false,
        allowedSizeUsd: 0,
        code: 'consecutive_losses',
        reason: `${this.state.consecutiveLosses} consecutive losses`,
      };
    }

    const cooldown = this.config.COOLDOWN_AFTER_LOSS_MS;
    if (this.state.lastLossTimestamp > 0 && Date.now() - this.state.lastLossTimestamp < cooldown) {
      return { ok: false, allowedSizeUsd: 0, code: 'cooldown_active', reason: 'Post-loss cooldown' };
    }

    if (this.state.tradesThisHour >= this.config.MAX_TRADES_PER_HOUR) {
      return { ok: false, allowedSizeUsd: 0, code: 'risk_limit_trades', reason: 'Hourly trade limit' };
    }

    if (this.state.hourlySpendUsd + requestedUsd > this.config.MAX_SPEND_PER_HOUR) {
      return { ok: false, allowedSizeUsd: 0, code: 'risk_limit_hour', reason: 'Hourly spend limit' };
    }

    if (this.state.dailySpendUsd + requestedUsd > this.config.MAX_SPEND_PER_DAY) {
      return { ok: false, allowedSizeUsd: 0, code: 'risk_limit_day', reason: 'Daily spend limit' };
    }

    const marketSpend = this.state.marketSpendUsd[marketSlug] ?? 0;
    if (marketSpend + requestedUsd > this.config.MAX_SPEND_PER_MARKET) {
      return { ok: false, allowedSizeUsd: 0, code: 'risk_limit_market', reason: 'Per-market spend limit' };
    }

    if (this.state.inventoryUsd + requestedUsd > this.config.MAX_INVENTORY_USD) {
      return { ok: false, allowedSizeUsd: 0, code: 'risk_limit_inventory', reason: 'Inventory limit' };
    }

    const allowed = Math.min(requestedUsd, profile.maxUsdPerTrade, this.config.MAX_USD_PER_TRADE);
    return { ok: true, allowedSizeUsd: allowed };
  }

  recordFill(marketSlug: string, sizeUsd: number): void {
    this.rollWindows();
    this.state.hourlySpendUsd += sizeUsd;
    this.state.dailySpendUsd += sizeUsd;
    this.state.marketSpendUsd[marketSlug] = (this.state.marketSpendUsd[marketSlug] ?? 0) + sizeUsd;
    this.state.tradesThisHour += 1;
    this.state.inventoryUsd += sizeUsd;
  }

  recordSettlement(pnlUsd: number): void {
    this.rollWindows();
    this.state.inventoryUsd = Math.max(0, this.state.inventoryUsd - Math.abs(pnlUsd));
    if (pnlUsd < 0) {
      this.state.hourlyLossUsd += Math.abs(pnlUsd);
      this.state.dailyLossUsd += Math.abs(pnlUsd);
      this.state.consecutiveLosses += 1;
      this.state.lastLossTimestamp = Date.now();
    } else {
      this.state.consecutiveLosses = 0;
    }
  }

  private rollWindows(): void {
    const now = Date.now();
    if (now - this.hourStart > 3_600_000) {
      this.hourStart = now;
      this.state.hourlySpendUsd = 0;
      this.state.tradesThisHour = 0;
      this.state.hourlyLossUsd = 0;
    }
    if (now - this.dayStart > 86_400_000) {
      this.dayStart = now;
      this.state.dailySpendUsd = 0;
      this.state.dailyLossUsd = 0;
    }
  }
}
