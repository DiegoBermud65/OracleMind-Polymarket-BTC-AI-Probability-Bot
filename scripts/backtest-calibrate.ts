#!/usr/bin/env tsx
/**
 * Backtest / calibration script on settled rounds.
 * Uses synthetic settled outcomes to fit Platt calibration — no historical download required.
 */
import { PlattCalibrator, type CalibrationPoint } from '../src/model/regime.js';
import { rawLogitFromFeatures, defaultCalibrator } from '../src/model/probability.js';
import { sigmoid } from '../src/utils/math.js';
import type { FeatureVector } from '../src/types/index.js';

function syntheticRound(seed: number): { features: FeatureVector; outcome: 0 | 1 } {
  const drift = (seed % 20) - 10;
  const features: FeatureVector = {
    returnSinceOpenChainlinkBps: drift * 1.5,
    returnSinceOpenBinanceBps: drift * 1.8,
    momentumBps: drift,
    realizedVol: 5 + (seed % 5),
    bookImbalance: drift / 30,
    timeRemainingPct: 0.5,
    ptbDistanceBps: drift * 1.2,
    chainlinkBinanceDivergenceBps: seed % 8,
  };
  const raw = sigmoid(rawLogitFromFeatures(features));
  const outcome: 0 | 1 = raw >= 0.5 ? 1 : 0;
  return { features, outcome };
}

function main(): void {
  console.log('OracleMind Backtest / Calibration\n');

  const samples: CalibrationPoint[] = [];
  for (let i = 0; i < 200; i++) {
    const { features, outcome } = syntheticRound(i);
    samples.push({ rawProb: sigmoid(rawLogitFromFeatures(features)), outcome });
  }

  const calibrator = new PlattCalibrator();
  calibrator.fit(samples);

  let correct = 0;
  for (const s of samples) {
    const calibrated = calibrator.calibrate(s.rawProb);
    const pred = calibrated >= 0.5 ? 1 : 0;
    if (pred === s.outcome) correct += 1;
  }

  defaultCalibrator.fit(samples);

  console.log(`Synthetic rounds: ${samples.length}`);
  console.log(`Directional accuracy (in-sample): ${((correct / samples.length) * 100).toFixed(1)}%`);
  console.log('Platt calibrator fitted — export weights to model/probability.ts for production');
  console.log('\nTo calibrate on real settled rounds, pipe SQLite settlements into CalibrationPoint[]');
}

main();
