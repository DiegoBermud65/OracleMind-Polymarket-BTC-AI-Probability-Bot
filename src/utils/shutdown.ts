import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'shutdown' });

const handlers: Array<() => void | Promise<void>> = [];
let registered = false;

export function onShutdown(fn: () => void | Promise<void>): void {
  handlers.push(fn);
  if (!registered) {
    registered = true;
    const run = async (signal: string) => {
      log.info({ signal }, 'Graceful shutdown initiated');
      for (const handler of handlers) {
        try {
          await handler();
        } catch (err) {
          log.error({ err }, 'Shutdown handler error');
        }
      }
      process.exit(0);
    };
    process.on('SIGINT', () => void run('SIGINT'));
    process.on('SIGTERM', () => void run('SIGTERM'));
  }
}
