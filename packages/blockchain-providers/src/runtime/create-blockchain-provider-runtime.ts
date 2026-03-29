import type { EventBus } from '@exitbook/events';
import type { Result } from '@exitbook/foundation';
import { err, ok, wrapError } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { BlockchainExplorersConfig } from '../catalog/load-explorer-config.js';
import type { IBlockchainProviderRuntime } from '../contracts/provider-runtime.js';
import { type ProviderEvent } from '../events.js';
import { createProviderRegistry } from '../initialize.js';
import { initProviderStatsPersistence, type ProviderStatsPersistence } from '../provider-stats/persistence/runtime.js';
import { initTokenMetadataPersistence, type TokenMetadataPersistence } from '../token-metadata/persistence/runtime.js';

import { BlockchainProviderManager } from './manager/provider-manager.js';

const logger = getLogger('BlockchainProviderRuntime');

export interface BlockchainProviderRuntimeOptions {
  dataDir: string;
  eventBus?: EventBus<ProviderEvent> | undefined;
  explorerConfig?: BlockchainExplorersConfig | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}

export async function createBlockchainProviderRuntime(
  options: BlockchainProviderRuntimeOptions
): Promise<Result<IBlockchainProviderRuntime, Error>> {
  let providerStatsPersistence: ProviderStatsPersistence | undefined;
  const providerStatsResult = await initProviderStatsPersistence(options.dataDir);
  if (providerStatsResult.isOk()) {
    providerStatsPersistence = providerStatsResult.value;
  } else {
    logger.warn(
      { error: providerStatsResult.error },
      'Failed to create provider stats database. Running without persistence.'
    );
  }

  let tokenMetadataPersistence: TokenMetadataPersistence | undefined;
  const tokenMetadataResult = await initTokenMetadataPersistence(options.dataDir);
  if (tokenMetadataResult.isOk()) {
    tokenMetadataPersistence = tokenMetadataResult.value;
  } else {
    logger.warn(
      { error: tokenMetadataResult.error },
      'Failed to initialize token metadata persistence. Running without token metadata cache.'
    );
  }

  let providerManager: BlockchainProviderManager | undefined;

  try {
    providerManager = new BlockchainProviderManager(createProviderRegistry(), {
      explorerConfig: options.explorerConfig,
      statsQueries: providerStatsPersistence?.queries,
      tokenMetadataQueries: tokenMetadataPersistence?.queries,
      instrumentation: options.instrumentation,
      eventBus: options.eventBus,
    });
    const readyProviderManager = providerManager;
    readyProviderManager.startBackgroundTasks();

    if (providerStatsPersistence?.queries) {
      await readyProviderManager.loadPersistedStats();
    }

    return ok({
      getAddressBalances: (...args) => readyProviderManager.getAddressBalances(...args),
      getAddressInfo: (...args) => readyProviderManager.getAddressInfo(...args),
      getAddressTokenBalances: (...args) => readyProviderManager.getAddressTokenBalances(...args),
      getProviders: (...args) => readyProviderManager.getProviders(...args),
      getTokenMetadata: (...args) => readyProviderManager.getTokenMetadata(...args),
      hasAddressTransactions: (...args) => readyProviderManager.hasAddressTransactions(...args),
      hasRegisteredOperationSupport: (...args) => readyProviderManager.hasRegisteredOperationSupport(...args),
      streamAddressTransactions: (...args) => readyProviderManager.streamAddressTransactions(...args),
      async cleanup(this: void) {
        const cleanupErrors: Error[] = [];

        try {
          await readyProviderManager.destroy();
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }

        if (tokenMetadataPersistence) {
          await tokenMetadataPersistence.cleanup().catch((error: unknown) => {
            const cleanupError = error instanceof Error ? error : new Error(String(error));
            cleanupErrors.push(cleanupError);
            logger.warn({ error: cleanupError }, 'Failed to close token metadata persistence during cleanup');
          });
        }

        if (providerStatsPersistence) {
          await providerStatsPersistence.cleanup().catch((error: unknown) => {
            const cleanupError = error instanceof Error ? error : new Error(String(error));
            cleanupErrors.push(cleanupError);
            logger.warn({ error: cleanupError }, 'Failed to close provider stats persistence during cleanup');
          });
        }

        if (cleanupErrors.length > 0) {
          return err(new AggregateError(cleanupErrors, 'Failed to cleanup blockchain provider runtime'));
        }

        return ok(undefined);
      },
    });
  } catch (error) {
    const cleanupErrors: Error[] = [];

    if (providerManager) {
      await providerManager.destroy().catch((destroyError: unknown) => {
        const cleanupError =
          destroyError instanceof Error ? destroyError : new Error(`Unknown cleanup failure: ${String(destroyError)}`);
        cleanupErrors.push(cleanupError);
        logger.warn({ error: cleanupError }, 'Failed to destroy provider manager after initialization failure');
      });
    }

    if (tokenMetadataPersistence) {
      await tokenMetadataPersistence.cleanup().catch((cleanupError: unknown) => {
        const normalizedError =
          cleanupError instanceof Error ? cleanupError : new Error(`Unknown cleanup failure: ${String(cleanupError)}`);
        cleanupErrors.push(normalizedError);
        logger.warn(
          { error: normalizedError },
          'Failed to cleanup token metadata persistence after initialization failure'
        );
      });
    }

    if (providerStatsPersistence) {
      await providerStatsPersistence.cleanup().catch((cleanupError: unknown) => {
        const normalizedError =
          cleanupError instanceof Error ? cleanupError : new Error(`Unknown cleanup failure: ${String(cleanupError)}`);
        cleanupErrors.push(normalizedError);
        logger.warn(
          { error: normalizedError },
          'Failed to cleanup provider stats persistence after initialization failure'
        );
      });
    }

    const wrappedError = wrapError(error, 'Failed to create blockchain provider runtime');
    if (cleanupErrors.length === 0) {
      return wrappedError;
    }

    if (wrappedError.isOk()) {
      return wrappedError;
    }

    return err(
      new AggregateError([wrappedError.error, ...cleanupErrors], 'Failed to create blockchain provider runtime')
    );
  }
}
