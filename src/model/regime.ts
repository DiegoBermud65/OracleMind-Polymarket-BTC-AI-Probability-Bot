import type { FeatureVector, MarketDirection, Regime, RegimeSnapshot } from '../types/index.js';
import { BinanceFeed } from '../feeds/binance.js';
import { clamp } from '../utils/math.js';

export function detectRegime(
  features: FeatureVector,
  binance: BinanceFeed,
  higherTfBias: MarketDirection | null = null,
): RegimeSnapshot {
  const shortReturnBps = features.returnSinceOpenChainlinkBps;
  const realizedVol = features.realizedVol;
  const tradeIntensity = binance.getTradeIntensity();

  let regime: Regime = 'UNKNOWN';

  const trendStrength = Math.abs(shortReturnBps);
  const chopScore = realizedVol > 0 ? trendStrength / realizedVol : 0;

  if (chopScore < 0.35 && realizedVol > 8) {
    regime = 'CHOP';
  } else if (trendStrength >= 6) {
    regime = 'TREND';
  } else if (realizedVol < 4 && trendStrength < 3) {
    regime = 'CHOP';
  } else {
    regime = 'UNKNOWN';
  }

  return {
    regime,
    shortReturnBps,
    realizedVol,
    tradeIntensity,
    higherTfBias,
  };
}

export function regimeSizeMultiplier(regime: Regime): number {
  switch (regime) {
    case 'TREND':
      return 1.0;
    case 'CHOP':
      return 0.35;
    case 'UNKNOWN':
      return 0.5;
    default:
      return 0.5;
  }
}

export function regimeBlocksEntry(regime: Regime, strict = false): boolean {
  if (strict) return regime === 'CHOP' || regime === 'UNKNOWN';
  return regime === 'CHOP';
}

export interface CalibrationPoint {
  rawProb: number;
  outcome: 0 | 1;
}

/** Platt scaling: maps raw logit to calibrated probability */
export class PlattCalibrator {
  private a = 1.0;
  private b = 0.0;
  private fitted = false;

  fit(samples: CalibrationPoint[]): void {
    if (samples.length < 10) return;
    let sumA = 0;
    let sumB = 0;
    for (const s of samples) {
      const raw = clamp(s.rawProb, 0.01, 0.99);
      sumA += s.outcome === 1 ? raw : 1 - raw;
      sumB += raw;
    }
    this.a = sumA / samples.length;
    this.b = sumB / samples.length;
    this.fitted = true;
  }

  calibrate(rawProb: number): number {
    if (!this.fitted) return rawProb;
    const p = clamp(rawProb, 0.001, 0.999);
    const adjusted = clamp(this.a * p + (1 - this.a) * this.b, 0.05, 0.95);
    return adjusted;
  }
}
