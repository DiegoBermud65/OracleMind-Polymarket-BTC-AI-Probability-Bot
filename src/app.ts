import { loadConfig } from './config/index.js';
import { createFeedHub } from './feeds/index.js';
import { GammaClient, WindowScheduler } from './feeds/gamma.js';
import { PaperExecutor } from './execution/paper.js';
import { LiveExecutor, redeemWinningPositions } from './execution/live.js';
import { RiskManager } from './risk/limits.js';
import { OracleMindStore } from './storage/sqlite.js';
import {
  evaluateStrategy,
  updateFusionFromDecision,
  type FusionState,
} from './strategy/fusion.js';
import type { BotStatus, Decision, MarketWindow, ProfileConfig } from './types/index.js';
import { createChildLogger } from './utils/logger.js';
import { idempotencyKey, sleep } from './utils/math.js';
import { onShutdown } from './utils/shutdown.js';

const log = createChildLogger({ module: 'app' });

interface ProfileRuntime {
  key: string;
  profile: ProfileConfig;
  scheduler: WindowScheduler;
  market: MarketWindow | null;
}

export class OracleMindBot {
  private config = loadConfig();
  private feeds = createFeedHub(
    this.config.BINANCE_WS_URL,
    this.config.CHAINLINK_BTC_USD_FEED,
    this.config.CLOB_HOST,
    this.config.FEED_STALE_MS,
    this.config.CHAINLINK_STREAM_URL,
  );
  private gamma = new GammaClient(this.config.GAMMA_HOST);
  private risk = new RiskManager(this.config);
  private paper = new PaperExecutor();
  private live = new LiveExecutor(this.config);
  private store = new OracleMindStore(this.config.SQLITE_PATH);
  private fusion: FusionState = { bias1h: null, confirm15m: null };
  private enteredWindows = new Set<string>();
  private lastDecision: Decision | null = null;
  private runtimes: ProfileRuntime[] = [];
  private startedAt = Date.now();
  private running = false;

  async start(profileFilter?: string): Promise<void> {
    log.info({ mode: this.config.mode }, 'OracleMind starting');

    this.feeds.binance.start();
    this.feeds.chainlink.start();
    this.feeds.clob.start();

    const profiles = Object.entries(this.config.profiles)
      .filter(([, p]) => p.status !== 'disabled')
      .filter(([key]) => !profileFilter || key === profileFilter) as Array<[string, ProfileConfig]>;

    for (const [key, profile] of profiles) {
      const runtime: ProfileRuntime = {
        key,
        profile,
        scheduler: new WindowScheduler(
          this.gamma,
          profile.slugPrefix,
          profile.windowSeconds,
          key,
          (market) => this.onMarketSwitch(runtime, market),
        ),
        market: null,
      };
      this.runtimes.push(runtime);
      await runtime.scheduler.start();
    }

    this.running = true;
    onShutdown(async () => {
      await this.stop();
    });

    while (this.running) {
      await this.tick();
      await sleep(this.config.LOOP_INTERVAL_MS);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const rt of this.runtimes) rt.scheduler.stop();
    this.feeds.binance.stop();
    this.feeds.chainlink.stop();
    this.feeds.clob.stop();
    this.store.close();
    log.info('OracleMind stopped');
  }

  getStatus(): BotStatus {
    const stats = this.paper.getStats();
    return {
      mode: this.config.mode,
      uptimeMs: Date.now() - this.startedAt,
      activeProfiles: this.runtimes.map((r) => r.key),
      feedsHealthy: this.feeds.feedsReadyForEntry(),
      lastDecision: this.lastDecision,
      risk: this.risk.getState(),
      pnl: stats,
    };
  }

  private onMarketSwitch(runtime: ProfileRuntime, market: MarketWindow): void {
    if (runtime.market) {
      const settled = this.paper.settleWindow(runtime.market, this.feeds.chainlink.getLatestPrice());
      for (const record of settled) {
        this.risk.recordSettlement(record.pnlUsd);
        this.store.logSettlement(record);
      }
    }

    runtime.market = market;
    this.feeds.chainlink.setWindowOpen(market.windowStart, market.priceToBeat);
    this.feeds.clob.subscribe(market.upTokenId, market.downTokenId);
  }

  private async tick(): Promise<void> {
    for (const runtime of this.runtimes) {
      const market = runtime.scheduler.activeMarket;
      if (!market) continue;

      if (runtime.profile.status === 'monitor') {
        const decision = evaluateStrategy({
          profile: runtime.profile,
          profileKey: runtime.key,
          market,
          feeds: this.feeds,
          risk: this.risk,
          fusion: this.fusion,
          slippageBps: this.config.SLIPPAGE_BPS,
          minEdge: this.config.MIN_EDGE_AFTER_FEES,
          enteredWindows: this.enteredWindows,
        });
        this.lastDecision = decision;
        this.store.logPrediction(decision);
        log.info({ profile: runtime.key, line: decision.logLine });
        continue;
      }

      const decision = evaluateStrategy({
        profile: runtime.profile,
        profileKey: runtime.key,
        market,
        feeds: this.feeds,
        risk: this.risk,
        fusion: this.fusion,
        slippageBps: this.config.SLIPPAGE_BPS,
        minEdge: this.config.MIN_EDGE_AFTER_FEES,
        enteredWindows: this.enteredWindows,
      });

      this.lastDecision = decision;
      this.store.logPrediction(decision);
      log.info({ profile: runtime.key, line: decision.logLine });

      if (decision.action === 'TRADE') {
        const windowKey = idempotencyKey(runtime.key, market.windowStart, decision.direction!);
        if (runtime.profile.status === 'live' && this.config.mode === 'live') {
          const ok = await this.live.execute(decision);
          if (ok) {
            this.enteredWindows.add(windowKey);
            this.risk.recordFill(market.slug, decision.sizeUsd);
            this.store.logTrade(decision);
            this.fusion = updateFusionFromDecision(this.fusion, runtime.key, decision);
          }
        } else {
          const fill = this.paper.execute(decision, market);
          if (fill) {
            this.enteredWindows.add(windowKey);
            this.risk.recordFill(market.slug, decision.sizeUsd);
            this.store.logTrade(decision);
            this.fusion = updateFusionFromDecision(this.fusion, runtime.key, decision);
          }
        }
      }
    }

    if (this.config.mode === 'live') {
      await redeemWinningPositions(this.config);
    }
  }
}

import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const profileIdx = process.argv.indexOf('--profile');
  const profile = profileIdx >= 0 ? process.argv[profileIdx + 1] : undefined;
  const bot = new OracleMindBot();
  await bot.start(profile);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    log.error({ err }, 'Fatal error');
    process.exit(1);
  });
}
