export type TradingMode = 'paper' | 'live';
export type ProfileStatus = 'live' | 'paper' | 'monitor' | 'disabled';
export type ProfileRole = 'execution' | 'confirmation' | 'trend_filter';
export type MarketDirection = 'UP' | 'DOWN';
export type Regime = 'TREND' | 'CHOP' | 'UNKNOWN';
export type DecisionAction = 'TRADE' | 'SKIP';
export type OrderType = 'LIMIT' | 'FOK' | 'FAK';

export type SkipReasonCode =
  | 'insufficient_edge'
  | 'regime_chop'
  | 'regime_unknown'
  | 'spread_too_wide'
  | 'insufficient_depth'
  | 'blackout_window'
  | 'feed_stale_binance'
  | 'feed_stale_chainlink'
  | 'chainlink_missing'
  | 'multi_tf_misaligned'
  | 'risk_limit_hour'
  | 'risk_limit_day'
  | 'risk_limit_market'
  | 'risk_limit_trades'
  | 'risk_limit_inventory'
  | 'consecutive_losses'
  | 'cooldown_active'
  | 'kill_switch'
  | 'duplicate_entry'
  | 'no_active_market'
  | 'live_not_confirmed'
  | 'inventory_imbalance';

export interface PriceTick {
  price: number;
  timestamp: number;
  source: 'binance' | 'chainlink';
  volume?: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface Quote {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadBps: number;
  depthUsd: number;
  timestamp: number;
}

export interface MarketWindow {
  slug: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  windowStart: number;
  windowEnd: number;
  priceToBeat: number;
  question: string;
  profile: string;
}

export interface FeatureVector {
  returnSinceOpenChainlinkBps: number;
  returnSinceOpenBinanceBps: number;
  momentumBps: number;
  realizedVol: number;
  bookImbalance: number;
  timeRemainingPct: number;
  ptbDistanceBps: number;
  chainlinkBinanceDivergenceBps: number;
}

export interface RegimeSnapshot {
  regime: Regime;
  shortReturnBps: number;
  realizedVol: number;
  tradeIntensity: number;
  higherTfBias: MarketDirection | null;
}

export interface ProbabilitySnapshot {
  modelProbUp: number;
  modelProbDown: number;
  marketProbUp: number;
  marketProbDown: number;
  edgeUpAfterFees: number;
  edgeDownAfterFees: number;
  makerEdgeUp: number;
  makerEdgeDown: number;
  features: FeatureVector;
  regime: RegimeSnapshot;
}

export interface Signal {
  profile: string;
  timestamp: number;
  direction: MarketDirection | null;
  probability: ProbabilitySnapshot;
  market: MarketWindow;
}

export interface Decision {
  action: DecisionAction;
  direction: MarketDirection | null;
  reasonCodes: SkipReasonCode[];
  reasons: string[];
  signal: Signal;
  sizeUsd: number;
  tokenId: string | null;
  limitPrice: number | null;
  orderType: OrderType;
  logLine: string;
}

export interface ProfileConfig {
  slugPrefix: string;
  windowSeconds: number;
  status: ProfileStatus;
  role: ProfileRole;
  minEdgeAfterFees: number;
  maxUsdPerTrade: number;
  entryBlackoutBeforeCloseMs: number;
  earlyWindowPreferMs: number;
  description: string;
}

export interface PaperFill {
  id: string;
  profile: string;
  direction: MarketDirection;
  tokenId: string;
  price: number;
  sizeUsd: number;
  shares: number;
  timestamp: number;
  decision: Decision;
  marketSlug: string;
}

export interface Position {
  tokenId: string;
  direction: MarketDirection;
  shares: number;
  avgPrice: number;
  costUsd: number;
  marketSlug: string;
}

export interface PnLRecord {
  marketSlug: string;
  profile: string;
  direction: MarketDirection;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  won: boolean;
  timestamp: number;
  modelProb: number;
  marketProb: number;
  edge: number;
}

export interface RiskState {
  hourlySpendUsd: number;
  dailySpendUsd: number;
  marketSpendUsd: Record<string, number>;
  tradesThisHour: number;
  hourlyLossUsd: number;
  dailyLossUsd: number;
  consecutiveLosses: number;
  inventoryUsd: number;
  lastLossTimestamp: number;
}

export interface BotStatus {
  mode: TradingMode;
  uptimeMs: number;
  activeProfiles: string[];
  feedsHealthy: boolean;
  lastDecision: Decision | null;
  risk: RiskState;
  pnl: {
    totalUsd: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
  };
}

export interface FeedHealth {
  binanceConnected: boolean;
  chainlinkFresh: boolean;
  clobConnected: boolean;
  binanceAgeMs: number;
  chainlinkAgeMs: number;
}
