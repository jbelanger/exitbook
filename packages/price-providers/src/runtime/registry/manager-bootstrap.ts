import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ProviderManagerConfig } from '../../contracts/types.js';
import { PriceProviderManager } from '../../core/provider-manager.js';

import { createPriceProviders, type ProviderFactoryConfig } from './provider-bootstrap.js';

const logger = getLogger('PriceProviderManagerBootstrap');

/**
 * Combined configuration for provider manager creation.
 */
export interface PriceProviderManagerFactoryConfig {
  manager?: Partial<ProviderManagerConfig> | undefined;
  providers: ProviderFactoryConfig;
}

/**
 * Create a fully configured PriceProviderManager with providers registered.
 */
export async function createPriceProviderManager(
  config: PriceProviderManagerFactoryConfig
): Promise<Result<PriceProviderManager, Error>> {
  const providersResult = await createPriceProviders(config.providers);
  if (providersResult.isErr()) {
    return err(providersResult.error);
  }

  const manager = new PriceProviderManager({
    defaultCurrency: 'USD',
    maxConsecutiveFailures: 5,
    cacheTtlSeconds: 300,
    ...config.manager,
  });

  manager.registerProviders(providersResult.value);
  manager.startBackgroundTasks();

  logger.info('PriceProviderManager created and initialized successfully');

  return ok(manager);
}
