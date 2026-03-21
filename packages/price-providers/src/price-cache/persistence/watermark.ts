import type { Result } from '@exitbook/core';
import { err } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import { initPriceCachePersistence } from './runtime.js';

const logger = getLogger('PriceCacheWatermark');

export async function readLatestPriceMutationAt(databasePath: string): Promise<Result<Date | undefined, Error>> {
  const persistenceResult = await initPriceCachePersistence(databasePath);
  if (persistenceResult.isErr()) {
    return err(persistenceResult.error);
  }

  const persistence = persistenceResult.value;
  const latestMutationResult = await persistence.queries.getLatestMutationAt();

  try {
    await persistence.cleanup();
  } catch (error) {
    if (latestMutationResult.isErr()) {
      logger.warn({ error }, 'Failed to clean up price cache persistence after mutation watermark read failure');
      return latestMutationResult;
    }

    return err(error instanceof Error ? error : new Error(String(error)));
  }

  return latestMutationResult;
}
