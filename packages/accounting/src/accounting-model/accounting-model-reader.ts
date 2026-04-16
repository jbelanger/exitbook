import { resultDoAsync } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import type { IAccountingModelReader, IAccountingModelSourceReader } from '../ports/accounting-model-reader.js';

import { buildAccountingModelFromTransactions } from './build-accounting-model-from-transactions.js';

interface BuildAccountingModelReaderInput {
  logger: Logger;
  sourceReader: IAccountingModelSourceReader;
}

export function buildAccountingModelReader(input: BuildAccountingModelReaderInput): IAccountingModelReader {
  return {
    loadAccountingModel: () =>
      resultDoAsync(async function* () {
        const source = yield* await input.sourceReader.loadAccountingModelSource();
        return yield* buildAccountingModelFromTransactions(source.transactions, input.logger);
      }),
  };
}
