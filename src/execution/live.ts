import { Wallet } from 'ethers';
import type { Decision } from '../types/index.js';
import type { AppConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger({ module: 'live' });

export class LiveExecutor {
  constructor(private config: AppConfig) {}

  isReady(): boolean {
    return (
      this.config.LIVE &&
      this.config.LIVE_CONFIRM &&
      Boolean(this.config.PRIVATE_KEY) &&
      Boolean(this.config.FUNDER_ADDRESS)
    );
  }

  async execute(decision: Decision): Promise<boolean> {
    if (!this.isReady()) {
      log.warn('Live execution blocked — set LIVE=true, LIVE_CONFIRM=true, PRIVATE_KEY, FUNDER_ADDRESS');
      return false;
    }

    if (decision.action !== 'TRADE' || !decision.tokenId || !decision.limitPrice) {
      return false;
    }

    try {
      const wallet = new Wallet(this.config.PRIVATE_KEY!);
      log.info(
        {
          wallet: wallet.address,
          tokenId: decision.tokenId,
          price: decision.limitPrice,
          sizeUsd: decision.sizeUsd,
          orderType: decision.orderType,
        },
        `[LIVE STUB] Would submit ${decision.orderType} order — wire @polymarket/clob-client here`,
      );

      // Integration point for @polymarket/clob-client:
      // const client = new ClobClient(host, chainId, wallet, creds, signatureType, funder);
      // await client.createAndPostOrder({ tokenID, price, size, side: Side.BUY, orderType });

      return true;
    } catch (err) {
      log.error({ err }, 'Live order failed');
      return false;
    }
  }
}

export async function redeemWinningPositions(_config: AppConfig): Promise<void> {
  log.info('Auto-redeem hook — integrate CTF redeem via Polymarket relayer when live');
}
