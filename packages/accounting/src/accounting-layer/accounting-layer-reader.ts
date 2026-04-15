import { resultDoAsync } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import type { IAccountingLayerReader, IAccountingLayerSourceReader } from '../ports/accounting-layer-reader.js';

import { buildAccountingLayerFromTransactions } from './build-accounting-layer-from-transactions.js';

interface BuildAccountingLayerReaderInput {
  logger: Logger;
  sourceReader: IAccountingLayerSourceReader;
}

export function buildAccountingLayerReader(input: BuildAccountingLayerReaderInput): IAccountingLayerReader {
  return {
    loadAccountingLayer: () =>
      resultDoAsync(async function* () {
        const source = yield* await input.sourceReader.loadAccountingLayerSource();
        const buildResult = buildAccountingLayerFromTransactions(source.transactions, input.logger);
        if (buildResult.isErr()) {
          return yield* buildResult;
        }

        return buildResult.value;
      }),
  };
}
