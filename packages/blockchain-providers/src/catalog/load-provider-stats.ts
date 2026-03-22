import type { Result } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { ProviderStatsSnapshot } from '../provider-stats/index.js';
import { initProviderStatsPersistence } from '../provider-stats/persistence/runtime.js';
import { toProviderStatsSnapshot } from '../provider-stats/snapshot.js';

const logger = getLogger('BlockchainProviderStats');

export async function loadBlockchainProviderStats(dataDir: string): Promise<Result<ProviderStatsSnapshot[], Error>> {
  const persistenceResult = await initProviderStatsPersistence(dataDir);
  if (persistenceResult.isErr()) {
    logger.warn(
      { error: persistenceResult.error },
      'Failed to open provider stats database. Continuing without stats.'
    );
    return ok([]);
  }

  const persistence = persistenceResult.value;

  try {
    const statsResult = await persistence.queries.getAll();
    if (statsResult.isErr()) {
      logger.warn({ error: statsResult.error }, 'Failed to load provider stats. Continuing without stats.');
      return ok([]);
    }

    return ok(statsResult.value.map(toProviderStatsSnapshot));
  } finally {
    await persistence.cleanup().catch((error: unknown) => {
      logger.warn({ error }, 'Failed to close provider stats persistence after stats load');
    });
  }
}
