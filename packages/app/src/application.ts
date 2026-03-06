import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

import type { ProviderConfig } from './providers/provider-registry.js';

export interface ApplicationConfig {
  dataDir: string;
  providers: ProviderConfig;
}

/**
 * Session lifecycle — bootstrap and teardown.
 *
 * Initializes DataContext, ensures default user, creates provider managers.
 * Hosts use this to get a live session, then call operations/queries directly.
 */
export class Application {
  private db: DataContext | undefined;

  constructor(private readonly config: ApplicationConfig) {}

  async initialize(): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }

  async close(): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }
}
