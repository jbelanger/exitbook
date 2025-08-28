import type { Database } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import type { BlockchainExplorersConfig } from '@crypto/shared-utils';

import type { BlockchainProviderManager } from '../../blockchains/shared/blockchain-provider-manager.ts';
import type { IExternalDataStore } from '../storage/interfaces.ts';

/**
 * Dependency injection container for ETL components.
 * Provides all necessary dependencies for importers, processors, and ingestion services.
 */
export interface IDependencyContainer {
  database: Database;
  explorerConfig?: BlockchainExplorersConfig | null;
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
  providerId?: string | undefined;
  sessionMetadata?: unknown;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
}
