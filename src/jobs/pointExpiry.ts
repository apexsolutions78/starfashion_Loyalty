import { logger } from '../utils/logger';
import { PointsEngineService } from '../services/PointsEngineService';

const INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const count = await PointsEngineService.expireDuePoints('point-expiry-job');
    if (count > 0) {
      logger.info('Point expiry job completed', { expiredEntries: count });
    }
  } catch (error) {
    logger.error('Point expiry job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

export function startPointExpiryJob(): void {
  if (timer) return;
  void runOnce();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
  logger.info('Point expiry job started', { intervalMs: INTERVAL_MS });
}

export function stopPointExpiryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
