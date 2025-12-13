import type { CursorState, RawTransactionInput } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams } from '../../types/importers.js';

export interface ImportRunResult {
  rawTransactions: RawTransactionInput[];
  cursorUpdates: Record<string, CursorState>;
}

export async function consumeImportStream(
  importer: IImporter,
  params: ImportParams
): Promise<Result<ImportRunResult, Error>> {
  const allTransactions: RawTransactionInput[] = [];
  const cursorUpdates: Record<string, CursorState> = {};

  for await (const batchResult of importer.importStreaming(params)) {
    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const batch = batchResult.value;
    allTransactions.push(...batch.rawTransactions);
    cursorUpdates[batch.operationType] = batch.cursor;
  }

  return ok({
    rawTransactions: allTransactions,
    cursorUpdates,
  });
}
