import { logger } from '../utils/logger';
import { RedemptionService } from '../services/RedemptionService';

const INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const count = await RedemptionService.expireDueVouchers('voucher-expiry-job');
    if (count > 0) {
      logger.info('Voucher expiry job completed', { expiredCount: count });
    }
  } catch (error) {
    logger.error('Voucher expiry job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

export function startVoucherExpiryJob(): void {
  if (timer) return;
  void runOnce();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
  logger.info('Voucher expiry job started', { intervalMs: INTERVAL_MS });
}

export function stopVoucherExpiryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
