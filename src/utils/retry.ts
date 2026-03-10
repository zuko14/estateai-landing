import { logger } from './logger';

/**
 * Retry a function once on failure, then log and continue
 * Per spec: "On failure, retry once then log error and continue"
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (firstError) {
    logger.warn(`${context} failed, retrying once...`, { error: firstError });
    try {
      return await fn();
    } catch (retryError) {
      logger.error(`${context} failed after retry`, { error: retryError });
      return undefined;
    }
  }
}
