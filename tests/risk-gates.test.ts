import { describe, it, expect } from 'vitest';
import { RiskManager } from '../src/risk/limits.js';
import { loadConfig, resetConfigCache } from '../src/config/index.js';

describe('risk gates', () => {
  it('blocks when kill switch active', () => {
    resetConfigCache();
    process.env.KILL_SWITCH = 'true';
    resetConfigCache();
    const config = loadConfig();
    const risk = new RiskManager(config);
    const profile = config.profiles['btc-5m'];

    const result = risk.canTrade(profile, 'btc-updown-5m-1', 25);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('kill_switch');

    delete process.env.KILL_SWITCH;
    resetConfigCache();
  });

  it('allows trade within limits', () => {
    resetConfigCache();
    delete process.env.KILL_SWITCH;
    resetConfigCache();
    const config = loadConfig();
    const risk = new RiskManager(config);
    const profile = config.profiles['btc-5m'];

    const result = risk.canTrade(profile, 'btc-updown-5m-2', 20);
    expect(result.ok).toBe(true);
    expect(result.allowedSizeUsd).toBeGreaterThan(0);
  });

  it('tracks consecutive losses', () => {
    resetConfigCache();
    const config = loadConfig();
    const risk = new RiskManager(config);
    const profile = config.profiles['btc-5m'];

    for (let i = 0; i < config.MAX_CONSECUTIVE_LOSSES; i++) {
      risk.recordSettlement(-10);
    }

    const result = risk.canTrade(profile, 'btc-updown-5m-3', 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('consecutive_losses');
  });
});
