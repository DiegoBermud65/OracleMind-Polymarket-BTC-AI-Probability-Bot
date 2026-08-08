import type {
  Decision,
  MarketDirection,
  MarketWindow,
  ProfileConfig,
  ProbabilitySnapshot,
  Signal,
  SkipReasonCode,
} from '../types/index.js';
import { FeedHub } from '../feeds/index.js';
import { extractFeatures } from '../features/extractor.js';
import { detectRegime, regimeBlocksEntry, regimeSizeMultiplier } from '../model/regime.js';
import { estimateProbability, explainProbability } from '../model/probability.js';
import { RiskManager } from '../risk/limits.js';
import { formatPct, formatUsd, idempotencyKey, timeSinceWindowOpen, timeToWindowClose } from '../utils/math.js';

export interface FusionState {
  bias1h: MarketDirection | null;
  confirm15m: MarketDirection | null;
}

export interface StrategyInput {
  profile: ProfileConfig;
  profileKey: string;
  market: MarketWindow;
  feeds: FeedHub;
  risk: RiskManager;
  fusion: FusionState;
  slippageBps: number;
  minEdge: number;
  enteredWindows: Set<string>;
}

export function evaluateStrategy(input: StrategyInput): Decision {
  const { profile, profileKey, market, feeds, risk, fusion, slippageBps, minEdge, enteredWindows } = input;
  const reasons: string[] = [];
  const reasonCodes: SkipReasonCode[] = [];

  const upQuote = feeds.clob.getQuote(market.upTokenId);
  const downQuote = feeds.clob.getQuote(market.downTokenId);

  if (!upQuote || !downQuote) {
    return skipDecision(profileKey, market, 'no_active_market', ['No orderbook quotes available']);
  }

  if (risk.isKillSwitchActive()) {
    return skipDecision(profileKey, market, 'kill_switch', ['KILL_SWITCH=true']);
  }

  if (feeds.chainlink.isStale(feeds.staleMs)) {
    reasonCodes.push('feed_stale_chainlink');
    reasons.push('Chainlink feed stale/missing — entries blocked');
    return buildSkip(profileKey, market, reasonCodes, reasons, null);
  }

  if (feeds.binance.isStale(5000)) {
    reasonCodes.push('feed_stale_binance');
    reasons.push('Binance feed stale');
    return buildSkip(profileKey, market, reasonCodes, reasons, null);
  }

  const remainingMs = timeToWindowClose(market.windowEnd);
  if (remainingMs <= profile.entryBlackoutBeforeCloseMs) {
    reasonCodes.push('blackout_window');
    reasons.push(`Blackout: ${Math.floor(remainingMs / 1000)}s to resolution`);
    return buildSkip(profileKey, market, reasonCodes, reasons, null);
  }

  if (upQuote.spreadBps > 350 || downQuote.spreadBps > 350) {
    reasonCodes.push('spread_too_wide');
    reasons.push(`Spread too wide: Up=${upQuote.spreadBps.toFixed(0)}bps`);
    return buildSkip(profileKey, market, reasonCodes, reasons, null);
  }

  if (upQuote.depthUsd < 100 || downQuote.depthUsd < 100) {
    reasonCodes.push('insufficient_depth');
    reasons.push('Orderbook too thin');
    return buildSkip(profileKey, market, reasonCodes, reasons, null);
  }

  const features = extractFeatures({ market, binance: feeds.binance, chainlink: feeds.chainlink, clob: feeds.clob });
  const higherBias = profile.role === 'trend_filter' ? null : fusion.bias1h;
  const regime = detectRegime(features, feeds.binance, higherBias);
  const probability = estimateProbability(features, regime, upQuote, downQuote, slippageBps);

  explainProbability(probability).forEach((line) => reasons.push(line));

  if (regimeBlocksEntry(regime.regime, profile.role !== 'execution')) {
    reasonCodes.push(regime.regime === 'CHOP' ? 'regime_chop' : 'regime_unknown');
    reasons.push(`${regime.regime} regime — size reduced or blocked`);
    if (profile.role !== 'execution') {
      return buildSkip(profileKey, market, reasonCodes, reasons, probability);
    }
  }

  const alignment = checkMultiTfAlignment(profile, fusion, probability);
  if (!alignment.ok) {
    reasonCodes.push('multi_tf_misaligned');
    reasons.push(alignment.reason);
    if (profile.role === 'execution' && !alignment.allowExecutionAnyway) {
      return buildSkip(profileKey, market, reasonCodes, reasons, probability);
    }
  }

  const upEdge = probability.edgeUpAfterFees;
  const downEdge = probability.edgeDownAfterFees;
  const makerUp = probability.makerEdgeUp;
  const makerDown = probability.makerEdgeDown;

  let direction: MarketDirection | null = null;
  let edge = 0;
  let useMaker = false;
  let tokenId: string | null = null;
  let limitPrice: number | null = null;

  const profileMinEdge = Math.max(minEdge, profile.minEdgeAfterFees);

  if (upEdge >= profileMinEdge && upEdge >= downEdge) {
    direction = 'UP';
    edge = upEdge;
    tokenId = market.upTokenId;
    if (makerUp >= profileMinEdge - 0.008) {
      useMaker = true;
      limitPrice = upQuote.bestBid;
    } else {
      limitPrice = upQuote.bestAsk;
    }
  } else if (downEdge >= profileMinEdge) {
    direction = 'DOWN';
    edge = downEdge;
    tokenId = market.downTokenId;
    if (makerDown >= profileMinEdge - 0.008) {
      useMaker = true;
      limitPrice = downQuote.bestBid;
    } else {
      limitPrice = downQuote.bestAsk;
    }
  }

  if (!direction || edge < profileMinEdge) {
    reasonCodes.push('insufficient_edge');
    reasons.push(`SKIP: edge ${formatPct(Math.max(upEdge, downEdge))} < min ${formatPct(profileMinEdge)} | ${regime.regime} regime`);
    return buildSkip(profileKey, market, reasonCodes, reasons, probability);
  }

  const windowKey = idempotencyKey(profileKey, market.windowStart, direction);
  if (enteredWindows.has(windowKey)) {
    reasonCodes.push('duplicate_entry');
    reasons.push('Already entered this window');
    return buildSkip(profileKey, market, reasonCodes, reasons, probability);
  }

  const riskCheck = risk.canTrade(profile, market.slug, profile.maxUsdPerTrade);
  if (!riskCheck.ok) {
    reasonCodes.push(riskCheck.code!);
    reasons.push(riskCheck.reason!);
    return buildSkip(profileKey, market, reasonCodes, reasons, probability);
  }

  let sizeUsd = Math.min(profile.maxUsdPerTrade, riskCheck.allowedSizeUsd);
  sizeUsd *= regimeSizeMultiplier(regime.regime);
  if (alignment.fullAlignment) sizeUsd *= 1.25;
  sizeUsd = Math.min(sizeUsd, profile.maxUsdPerTrade);

  const sinceOpen = timeSinceWindowOpen(market.windowStart);
  if (profile.role === 'execution' && sinceOpen > profile.earlyWindowPreferMs && edge < profileMinEdge + 0.01) {
    reasonCodes.push('insufficient_edge');
    reasons.push('Mid-window edge insufficient without early-window boost');
    return buildSkip(profileKey, market, reasonCodes, reasons, probability);
  }

  const modelProb = direction === 'UP' ? probability.modelProbUp : probability.modelProbDown;
  const marketProb = direction === 'UP' ? probability.marketProbUp : probability.marketProbDown;
  const logLine = `${direction === 'UP' ? 'BUY UP' : 'BUY DOWN'}: model ${modelProb.toFixed(2)} vs market ${marketProb.toFixed(2)} | edge ${formatPct(edge)} after fees | size ${formatUsd(sizeUsd)}`;

  const signal: Signal = {
    profile: profileKey,
    timestamp: Date.now(),
    direction,
    probability,
    market,
  };

  return {
    action: 'TRADE',
    direction,
    reasonCodes,
    reasons,
    signal,
    sizeUsd,
    tokenId,
    limitPrice,
    orderType: useMaker ? 'LIMIT' : 'FOK',
    logLine,
  };
}

function checkMultiTfAlignment(
  profile: ProfileConfig,
  fusion: FusionState,
  prob: ProbabilitySnapshot,
): { ok: boolean; fullAlignment: boolean; allowExecutionAnyway: boolean; reason: string } {
  const impliedDirection: MarketDirection = prob.modelProbUp >= 0.5 ? 'UP' : 'DOWN';

  if (profile.role === 'trend_filter') {
    return { ok: true, fullAlignment: true, allowExecutionAnyway: true, reason: '1h sets bias' };
  }

  if (profile.role === 'confirmation') {
    const aligned5m = !fusion.confirm15m || fusion.confirm15m === impliedDirection;
    const aligned1h = !fusion.bias1h || fusion.bias1h === impliedDirection;
    return {
      ok: aligned5m || aligned1h,
      fullAlignment: aligned5m && aligned1h,
      allowExecutionAnyway: false,
      reason: aligned5m ? '15m confirms' : '15m lacks 5m/1h alignment',
    };
  }

  const aligned15m = !fusion.confirm15m || fusion.confirm15m === impliedDirection;
  const aligned1h = !fusion.bias1h || fusion.bias1h === impliedDirection;
  const full = aligned15m && aligned1h;
  return {
    ok: full || prob.edgeUpAfterFees > 0.035 || prob.edgeDownAfterFees > 0.035,
    fullAlignment: full,
    allowExecutionAnyway: prob.edgeUpAfterFees > 0.035 || prob.edgeDownAfterFees > 0.035,
    reason: full ? 'Full TF alignment' : 'Partial alignment — large edge required',
  };
}

function skipDecision(
  profileKey: string,
  market: MarketWindow,
  code: SkipReasonCode,
  reasons: string[],
): Decision {
  return buildSkip(profileKey, market, [code], reasons, null);
}

function buildSkip(
  profileKey: string,
  market: MarketWindow,
  reasonCodes: SkipReasonCode[],
  reasons: string[],
  probability: ProbabilitySnapshot | null,
): Decision {
  const prob = probability ?? emptyProbability();
  const edge = Math.max(prob.edgeUpAfterFees, prob.edgeDownAfterFees);
  const logLine = reasons.find((r) => r.startsWith('SKIP:')) ??
    `SKIP: edge ${formatPct(edge)} | ${prob.regime.regime} regime`;

  return {
    action: 'SKIP',
    direction: null,
    reasonCodes,
    reasons,
    signal: {
      profile: profileKey,
      timestamp: Date.now(),
      direction: null,
      probability: prob,
      market,
    },
    sizeUsd: 0,
    tokenId: null,
    limitPrice: null,
    orderType: 'LIMIT',
    logLine,
  };
}

function emptyProbability(): ProbabilitySnapshot {
  return {
    modelProbUp: 0.5,
    modelProbDown: 0.5,
    marketProbUp: 0.5,
    marketProbDown: 0.5,
    edgeUpAfterFees: 0,
    edgeDownAfterFees: 0,
    makerEdgeUp: 0,
    makerEdgeDown: 0,
    features: {
      returnSinceOpenChainlinkBps: 0,
      returnSinceOpenBinanceBps: 0,
      momentumBps: 0,
      realizedVol: 0,
      bookImbalance: 0,
      timeRemainingPct: 0.5,
      ptbDistanceBps: 0,
      chainlinkBinanceDivergenceBps: 0,
    },
    regime: { regime: 'UNKNOWN', shortReturnBps: 0, realizedVol: 0, tradeIntensity: 0, higherTfBias: null },
  };
}

export function updateFusionFromDecision(fusion: FusionState, profileKey: string, decision: Decision): FusionState {
  if (decision.action !== 'TRADE' || !decision.direction) return fusion;
  if (profileKey === 'btc-1h') return { ...fusion, bias1h: decision.direction };
  if (profileKey === 'btc-15m') return { ...fusion, confirm15m: decision.direction };
  return fusion;
}
