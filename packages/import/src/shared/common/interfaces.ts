import type { Database } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';

import type { BlockchainProviderManager } from '../../blockchains/shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../../blockchains/shared/explorer-config.ts';
import type { IExternalDataStore } from '../storage/interfaces.ts';

/**
 * Dependency injection container for ETL components.
 * Provides all necessary dependencies for importers, processors, and ingestion services.
 */
export interface IDependencyContainer {
  database: Database;
  explorerConfig?: BlockchainExplorersConfig;
  externalDataStore: IExternalDataStore;

  logger: Logger;
  // Optional dependencies for specific adapter types
  providerManager?: BlockchainProviderManager;
}

/**
 * Factory configuration for creating ETL components.
 */
export interface ETLComponentConfig {
  dependencies: IDependencyContainer;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
}
