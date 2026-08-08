import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Decision, PnLRecord } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger({ module: 'storage' });

export class OracleMindStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        profile TEXT NOT NULL,
        market_slug TEXT NOT NULL,
        model_prob_up REAL,
        market_prob_up REAL,
        edge_up REAL,
        edge_down REAL,
        regime TEXT,
        action TEXT,
        log_line TEXT
      );
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        profile TEXT NOT NULL,
        market_slug TEXT NOT NULL,
        direction TEXT,
        price REAL,
        size_usd REAL,
        order_type TEXT
      );
      CREATE TABLE IF NOT EXISTS settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        profile TEXT NOT NULL,
        market_slug TEXT NOT NULL,
        pnl_usd REAL,
        won INTEGER,
        model_prob REAL,
        market_prob REAL,
        edge REAL
      );
    `);
  }

  logPrediction(decision: Decision): void {
    const prob = decision.signal.probability;
    this.db
      .prepare(
        `INSERT INTO predictions (ts, profile, market_slug, model_prob_up, market_prob_up, edge_up, edge_down, regime, action, log_line)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        decision.signal.profile,
        decision.signal.market.slug,
        prob.modelProbUp,
        prob.marketProbUp,
        prob.edgeUpAfterFees,
        prob.edgeDownAfterFees,
        prob.regime.regime,
        decision.action,
        decision.logLine,
      );
  }

  logTrade(decision: Decision): void {
    if (decision.action !== 'TRADE') return;
    this.db
      .prepare(
        `INSERT INTO trades (ts, profile, market_slug, direction, price, size_usd, order_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        decision.signal.profile,
        decision.signal.market.slug,
        decision.direction,
        decision.limitPrice,
        decision.sizeUsd,
        decision.orderType,
      );
  }

  logSettlement(record: PnLRecord): void {
    this.db
      .prepare(
        `INSERT INTO settlements (ts, profile, market_slug, pnl_usd, won, model_prob, market_prob, edge)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.timestamp,
        record.profile,
        record.marketSlug,
        record.pnlUsd,
        record.won ? 1 : 0,
        record.modelProb,
        record.marketProb,
        record.edge,
      );
  }

  getSummary() {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) as trades,
          SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
          SUM(pnl_usd) as total_pnl
         FROM settlements`,
      )
      .get() as { trades: number; wins: number; total_pnl: number | null };
    return row;
  }

  close(): void {
    this.db.close();
    log.info('SQLite store closed');
  }
}
