import type { FeatureVector, ProbabilitySnapshot, RegimeSnapshot } from '../types/index.js';
import type { Quote } from '../types/index.js';
import { PlattCalibrator } from './regime.js';
import { clamp, edgeAfterFees, sigmoid } from '../utils/math.js';

/** Transparent logistic ensemble — weights tuned for interpretability */
const WEIGHTS = {
  intercept: 0.0,
  returnChainlink: 0.085,
  returnBinance: 0.035,
  momentum: 0.055,
  ptbDistance: 0.12,
  bookImbalance: 0.08,
  timeRemaining: -0.04,
  volPenalty: -0.025,
  divergencePenalty: -0.06,
};

export const defaultCalibrator = new PlattCalibrator();

export function rawLogitFromFeatures(features: FeatureVector): number {
  const w = WEIGHTS;
  return (
    w.intercept +
    w.returnChainlink * (features.returnSinceOpenChainlinkBps / 10) +
    w.returnBinance * (features.returnSinceOpenBinanceBps / 15) +
    w.momentum * (features.momentumBps / 12) +
    w.ptbDistance * (features.ptbDistanceBps / 8) +
    w.bookImbalance * features.bookImbalance * 2 +
    w.timeRemaining * (1 - features.timeRemainingPct) +
    w.volPenalty * (features.realizedVol / 20) +
    w.divergencePenalty * (features.chainlinkBinanceDivergenceBps / 15)
  );
}

export function estimateProbability(
  features: FeatureVector,
  regime: RegimeSnapshot,
  upQuote: Quote,
  downQuote: Quote,
  slippageBps: number,
  calibrator: PlattCalibrator = defaultCalibrator,
): ProbabilitySnapshot {
  let logit = rawLogitFromFeatures(features);

  if (regime.regime === 'TREND') {
    logit += regime.shortReturnBps > 0 ? 0.15 : -0.15;
  } else if (regime.regime === 'CHOP') {
    logit *= 0.6;
  }

  const rawProbUp = sigmoid(logit);
  const modelProbUp = calibrator.calibrate(rawProbUp);
  const modelProbDown = 1 - modelProbUp;

  const marketProbUp = upQuote.mid;
  const marketProbDown = downQuote.mid;

  const edgeUpAfterFees = edgeAfterFees(modelProbUp, upQuote.bestAsk, slippageBps, false);
  const edgeDownAfterFees = edgeAfterFees(modelProbDown, downQuote.bestAsk, slippageBps, false);
  const makerEdgeUp = edgeAfterFees(modelProbUp, upQuote.bestBid, 0, true);
  const makerEdgeDown = edgeAfterFees(modelProbDown, downQuote.bestBid, 0, true);

  return {
    modelProbUp: clamp(modelProbUp, 0.05, 0.95),
    modelProbDown: clamp(modelProbDown, 0.05, 0.95),
    marketProbUp: clamp(marketProbUp, 0.01, 0.99),
    marketProbDown: clamp(marketProbDown, 0.01, 0.99),
    edgeUpAfterFees,
    edgeDownAfterFees,
    makerEdgeUp,
    makerEdgeDown,
    features,
    regime,
  };
}

export function explainProbability(prob: ProbabilitySnapshot): string[] {
  const f = prob.features;
  return [
    `model P(Up)=${(prob.modelProbUp * 100).toFixed(1)}% vs market=${(prob.marketProbUp * 100).toFixed(1)}%`,
    `edge Up=${(prob.edgeUpAfterFees * 100).toFixed(2)}% Down=${(prob.edgeDownAfterFees * 100).toFixed(2)}%`,
    `CL return=${f.returnSinceOpenChainlinkBps.toFixed(1)}bps BN return=${f.returnSinceOpenBinanceBps.toFixed(1)}bps`,
    `PTB dist=${f.ptbDistanceBps.toFixed(1)}bps bookImb=${f.bookImbalance.toFixed(2)} regime=${prob.regime.regime}`,
  ];
}
