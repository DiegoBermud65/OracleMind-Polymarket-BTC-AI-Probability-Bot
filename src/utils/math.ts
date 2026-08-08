export function bpsChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 10_000;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowMs(): number {
  return Date.now();
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function sumDepthUsd(levels: { price: number; size: number }[], maxLevels = 5): number {
  return levels.slice(0, maxLevels).reduce((acc, l) => acc + l.price * l.size, 0);
}

export function exponentialBackoff(attempt: number, baseMs: number, maxMs = 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

export function slugForWindow(prefix: string, windowStartSec: number): string {
  return `${prefix}-${windowStartSec}`;
}

export function currentWindowStart(windowSeconds: number, nowSec = Math.floor(Date.now() / 1000)): number {
  return Math.floor(nowSec / windowSeconds) * windowSeconds;
}

export function timeToWindowClose(windowEndMs: number, nowMs = Date.now()): number {
  return Math.max(0, windowEndMs - nowMs);
}

export function timeSinceWindowOpen(windowStartMs: number, nowMs = Date.now()): number {
  return Math.max(0, nowMs - windowStartMs);
}

/** Polymarket dynamic taker fee: f(p) ≈ 0.072 * p * (1-p) */
export function polymarketTakerFee(price: number): number {
  const p = clamp(price, 0.01, 0.99);
  return 0.072 * p * (1 - p);
}

export function polymarketMakerFee(price: number): number {
  const p = clamp(price, 0.01, 0.99);
  return 0.036 * p * (1 - p);
}

export function edgeAfterFees(
  fairProb: number,
  askPrice: number,
  slippageBps: number,
  maker = false,
): number {
  const fee = maker ? polymarketMakerFee(askPrice) : polymarketTakerFee(askPrice);
  const slippage = maker ? 0 : askPrice * (slippageBps / 10_000);
  return fairProb - askPrice - fee - slippage;
}

export function idempotencyKey(profile: string, windowStart: number, direction: string): string {
  return `oraclemind-${profile}-${windowStart}-${direction}`;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(p: number): number {
  const clamped = clamp(p, 0.001, 0.999);
  return Math.log(clamped / (1 - clamped));
}
