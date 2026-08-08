import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import dotenv from 'dotenv';
import type { ProfileConfig, ProfileStatus, TradingMode } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

dotenv.config({ path: resolve(ROOT, '.env') });

const envSchema = z.object({
  LIVE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  LIVE_CONFIRM: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  ENABLED_PROFILES: z.string().default('BTC_5M,BTC_15M,BTC_1H'),
  BTC_5M_STATUS: z.enum(['live', 'paper', 'monitor', 'disabled']).default('paper'),
  BTC_15M_STATUS: z.enum(['live', 'paper', 'monitor', 'disabled']).default('monitor'),
  BTC_1H_STATUS: z.enum(['live', 'paper', 'monitor', 'disabled']).default('monitor'),
  PRIVATE_KEY: z.string().optional(),
  FUNDER_ADDRESS: z.string().optional(),
  SIGNATURE_TYPE: z.coerce.number().default(0),
  RPC_URL: z.string().default('https://polygon-rpc.com'),
  CLOB_HOST: z.string().default('https://clob.polymarket.com'),
  GAMMA_HOST: z.string().default('https://gamma-api.polymarket.com'),
  BINANCE_WS_URL: z.string().default('wss://stream.binance.com:9443/ws'),
  CHAINLINK_BTC_USD_FEED: z
    .string()
    .default('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
  CHAINLINK_STREAM_URL: z.string().optional(),
  MIN_EDGE: z.coerce.number().default(0.02),
  MIN_EDGE_AFTER_FEES: z.coerce.number().default(0.02),
  MAKER_EDGE_DISCOUNT: z.coerce.number().default(0.008),
  TAKER_EDGE_PREMIUM: z.coerce.number().default(0.012),
  SLIPPAGE_BPS: z.coerce.number().default(15),
  STOP_BUYING_BEFORE_CLOSE_SECONDS: z.coerce.number().default(90),
  MAX_USD_PER_TRADE: z.coerce.number().default(25),
  MAX_SPEND_PER_MARKET: z.coerce.number().default(50),
  MAX_SPEND_PER_HOUR: z.coerce.number().default(200),
  MAX_SPEND_PER_DAY: z.coerce.number().default(500),
  MAX_TRADES_PER_HOUR: z.coerce.number().default(12),
  MAX_LOSS_PER_HOUR: z.coerce.number().default(75),
  MAX_LOSS_PER_DAY: z.coerce.number().default(250),
  MAX_DRAWDOWN_PCT: z.coerce.number().default(15),
  MAX_INVENTORY_USD: z.coerce.number().default(150),
  MAX_CONSECUTIVE_LOSSES: z.coerce.number().default(5),
  COOLDOWN_AFTER_LOSS_MS: z.coerce.number().default(60_000),
  MIN_ORDERBOOK_DEPTH_USD: z.coerce.number().default(100),
  MAX_SPREAD_BPS: z.coerce.number().default(350),
  KILL_SWITCH: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  FEED_STALE_MS: z.coerce.number().default(5000),
  LOOP_INTERVAL_MS: z.coerce.number().default(2000),
  RECONNECT_DELAY_MS: z.coerce.number().default(3000),
  MAX_RECONNECT_ATTEMPTS: z.coerce.number().default(50),
  SQLITE_PATH: z.string().default('./data/oraclemind.db'),
  DASHBOARD_PORT: z.coerce.number().default(3848),
  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  profiles: Record<string, ProfileConfig>;
  rootDir: string;
  mode: TradingMode;
};

interface YamlProfile {
  slug_prefix: string;
  window_seconds: number;
  status_env: string;
  role: ProfileConfig['role'];
  min_edge_after_fees: number;
  max_usd_per_trade: number;
  entry_blackout_before_close_ms: number;
  early_window_prefer_ms: number;
  description: string;
}

function loadProfiles(): Record<string, ProfileConfig> {
  const yamlPath = resolve(ROOT, 'config/profiles.yaml');
  if (!existsSync(yamlPath)) {
    throw new Error(`Missing config/profiles.yaml at ${yamlPath}`);
  }
  const raw = parseYaml(readFileSync(yamlPath, 'utf8')) as {
    profiles: Record<string, YamlProfile>;
  };
  const env = process.env;

  const statusMap: Record<string, ProfileStatus> = {
    BTC_5M_STATUS: (env.BTC_5M_STATUS as ProfileStatus) ?? 'paper',
    BTC_15M_STATUS: (env.BTC_15M_STATUS as ProfileStatus) ?? 'monitor',
    BTC_1H_STATUS: (env.BTC_1H_STATUS as ProfileStatus) ?? 'monitor',
  };

  const profiles: Record<string, ProfileConfig> = {};
  for (const [key, p] of Object.entries(raw.profiles)) {
    profiles[key] = {
      slugPrefix: p.slug_prefix,
      windowSeconds: p.window_seconds,
      status: statusMap[p.status_env] ?? 'disabled',
      role: p.role,
      minEdgeAfterFees: p.min_edge_after_fees,
      maxUsdPerTrade: p.max_usd_per_trade,
      entryBlackoutBeforeCloseMs: p.entry_blackout_before_close_ms,
      earlyWindowPreferMs: p.early_window_prefer_ms,
      description: p.description,
    };
  }
  return profiles;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.parse(process.env);
  cached = {
    ...parsed,
    mode: parsed.LIVE ? 'live' : 'paper',
    profiles: loadProfiles(),
    rootDir: ROOT,
  };
  return cached;
}

export function getProfile(name: string): ProfileConfig {
  const config = loadConfig();
  const profile = config.profiles[name];
  if (!profile) {
    throw new Error(`Unknown profile: ${name}. Available: ${Object.keys(config.profiles).join(', ')}`);
  }
  return profile;
}

export function getActiveProfiles(): ProfileConfig[] {
  const config = loadConfig();
  return Object.entries(config.profiles)
    .filter(([, p]) => p.status !== 'disabled')
    .map(([, p]) => p);
}

export function resetConfigCache(): void {
  cached = null;
}
