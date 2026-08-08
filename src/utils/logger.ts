import pino from 'pino';
import { loadConfig } from '../config/index.js';

let rootLogger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (rootLogger) return rootLogger;
  const config = loadConfig();
  rootLogger = pino({
    level: config.LOG_LEVEL,
    transport: config.LOG_PRETTY
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  });
  return rootLogger;
}

export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return getLogger().child(bindings);
}
