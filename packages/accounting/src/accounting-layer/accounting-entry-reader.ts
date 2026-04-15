import { resultDoAsync } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import type { IAccountingEntryReader, IAccountingEntrySourceReader } from '../ports/accounting-entry-reader.js';

import { buildAccountingEntriesFromTransactions } from './build-accounting-entries-from-transactions.js';

interface BuildAccountingEntryReaderInput {
  logger: Logger;
  sourceReader: IAccountingEntrySourceReader;
}

export function buildAccountingEntryReader(input: BuildAccountingEntryReaderInput): IAccountingEntryReader {
  return {
    loadAccountingEntries: () =>
      resultDoAsync(async function* () {
        const source = yield* await input.sourceReader.loadAccountingEntrySource();
        const entriesResult = buildAccountingEntriesFromTransactions(source.transactions, input.logger);
        if (entriesResult.isErr()) {
          return yield* entriesResult;
        }

        return entriesResult.value;
      }),
  };
}
