import { resultDo, type Result } from '@exitbook/foundation';

import {
  buildAccountingLayerIndexes,
  resolveInternalTransferCarryovers,
  type AccountingLayerIndexes,
  type AccountingLayerBuildResult,
  type ResolvedInternalTransferCarryover,
} from '../../../../accounting-layer.js';

export interface CanadaAccountingLayerContext {
  accountingLayer: AccountingLayerBuildResult;
  indexes: AccountingLayerIndexes;
  resolvedInternalTransferCarryovers: readonly ResolvedInternalTransferCarryover[];
}

export function buildCanadaAccountingLayerContext(
  accountingLayer: AccountingLayerBuildResult
): Result<CanadaAccountingLayerContext, Error> {
  return resultDo(function* () {
    const indexes = yield* buildAccountingLayerIndexes(accountingLayer);
    const resolvedInternalTransferCarryovers = yield* resolveInternalTransferCarryovers(accountingLayer);

    return {
      accountingLayer,
      indexes,
      resolvedInternalTransferCarryovers,
    };
  });
}
