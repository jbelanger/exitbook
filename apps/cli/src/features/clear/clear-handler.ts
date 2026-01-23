import type { ClearResult, ClearService, DeletionPreview } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';

import type { ClearHandlerParams } from './clear-utils.js';

/**
 * Clear handler - thin wrapper around ClearService.
 * Converts CLI params to service params and delegates all logic.
 */
export class ClearHandler {
  constructor(private clearService: ClearService) {}

  /**
   * Preview what will be deleted.
   */
  previewDeletion(params: ClearHandlerParams): Promise<Result<DeletionPreview, Error>> {
    return this.clearService.previewDeletion({
      accountId: params.accountId,
      source: params.source,
      includeRaw: params.includeRaw,
    });
  }

  /**
   * Execute the clear operation.
   */
  execute(params: ClearHandlerParams): Promise<Result<ClearResult, Error>> {
    return this.clearService.execute({
      accountId: params.accountId,
      source: params.source,
      includeRaw: params.includeRaw,
    });
  }
}
