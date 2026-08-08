#!/usr/bin/env tsx
import { loadConfig } from '../config/index.js';
import { OracleMindStore } from '../storage/sqlite.js';

const config = loadConfig();
const store = new OracleMindStore(config.SQLITE_PATH);
const summary = store.getSummary();

console.log(JSON.stringify({
  mode: config.mode,
  profiles: Object.entries(config.profiles).map(([k, p]) => ({ key: k, status: p.status, role: p.role })),
  sqlite: summary,
}, null, 2));

store.close();
