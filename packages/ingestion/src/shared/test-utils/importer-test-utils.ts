import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { CursorState, RawTransactionInput } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { type Mocked } from 'vitest';

import type { IImporter, ImportParams } from '../../shared/types/importers.js';

export { createMockProviderManager } from './mock-factories.js';

export type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

/**
 * Alias for expectOk - for backwards compatibility
 */
export function assertOk<T, E extends Error>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(`Expected Ok, got Err: ${result.error.message}`);
  }
  return result.value;
}

export interface ImportRunResult {
  rawTransactions: RawTransactionInput[];
  cursorUpdates: Record<string, CursorState>;
  warnings?: string[] | undefined;
}

export async function consumeImportStream(
  importer: IImporter,
  params: ImportParams
): Promise<Result<ImportRunResult, Error>> {
  const allTransactions: RawTransactionInput[] = [];
  const cursorUpdates: Record<string, CursorState> = {};
  const allWarnings: string[] = [];

  for await (const batchResult of importer.importStreaming(params)) {
    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const batch = batchResult.value;
    allTransactions.push(...batch.rawTransactions);
    cursorUpdates[batch.streamType] = batch.cursor;

    if (batch.warnings && batch.warnings.length > 0) {
      allWarnings.push(...batch.warnings);
    }
  }

  return ok({
    rawTransactions: allTransactions,
    cursorUpdates,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  });
}
