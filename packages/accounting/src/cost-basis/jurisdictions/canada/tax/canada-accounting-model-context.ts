import { resultDo, type Result } from '@exitbook/foundation';

import {
  buildAccountingModelIndexes,
  resolveInternalTransferCarryovers,
  type AccountingModelIndexes,
  type AccountingModelBuildResult,
  type ResolvedInternalTransferCarryover,
} from '../../../../accounting-model.js';

export interface CanadaAccountingModelContext {
  accountingModel: AccountingModelBuildResult;
  indexes: AccountingModelIndexes;
  resolvedInternalTransferCarryovers: readonly ResolvedInternalTransferCarryover[];
}

export function buildCanadaAccountingModelContext(
  accountingModel: AccountingModelBuildResult
): Result<CanadaAccountingModelContext, Error> {
  return resultDo(function* () {
    const indexes = yield* buildAccountingModelIndexes(accountingModel);
    const resolvedInternalTransferCarryovers = yield* resolveInternalTransferCarryovers(accountingModel);

    return {
      accountingModel,
      indexes,
      resolvedInternalTransferCarryovers,
    };
  });
}
