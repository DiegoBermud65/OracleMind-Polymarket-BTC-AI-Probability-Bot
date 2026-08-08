import { describe, it, expect } from 'vitest';
import { edgeAfterFees, polymarketTakerFee, sigmoid } from '../src/utils/math.js';
import { rawLogitFromFeatures } from '../src/model/probability.js';
import type { FeatureVector } from '../src/types/index.js';

describe('edge calculation', () => {
  it('computes positive edge when model exceeds market + fees', () => {
    const fairProb = 0.71;
    const ask = 0.62;
    const edge = edgeAfterFees(fairProb, ask, 15);
    expect(edge).toBeGreaterThan(0.04);
  });

  it('returns negative edge when market is fair', () => {
    const edge = edgeAfterFees(0.52, 0.55, 15);
    expect(edge).toBeLessThan(0);
  });

  it('maker edge exceeds taker edge at same price', () => {
    const taker = edgeAfterFees(0.65, 0.58, 15, false);
    const maker = edgeAfterFees(0.65, 0.58, 15, true);
    expect(maker).toBeGreaterThan(taker);
  });

  it('taker fee peaks near 0.50', () => {
    expect(polymarketTakerFee(0.5)).toBeGreaterThan(polymarketTakerFee(0.2));
  });
});

describe('probability model', () => {
  const bullishFeatures: FeatureVector = {
    returnSinceOpenChainlinkBps: 18,
    returnSinceOpenBinanceBps: 22,
    momentumBps: 15,
    realizedVol: 6,
    bookImbalance: 0.25,
    timeRemainingPct: 0.7,
    ptbDistanceBps: 12,
    chainlinkBinanceDivergenceBps: 3,
  };

  it('produces P(Up) > 0.5 on bullish features', () => {
    const logit = rawLogitFromFeatures(bullishFeatures);
    expect(sigmoid(logit)).toBeGreaterThan(0.55);
  });

  it('produces P(Up) < 0.5 on bearish features', () => {
    const bearish: FeatureVector = {
      ...bullishFeatures,
      returnSinceOpenChainlinkBps: -20,
      returnSinceOpenBinanceBps: -18,
      momentumBps: -14,
      ptbDistanceBps: -15,
      bookImbalance: -0.3,
    };
    expect(sigmoid(rawLogitFromFeatures(bearish))).toBeLessThan(0.45);
  });
});
