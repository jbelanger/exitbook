import { err, ok, type Result } from '@exitbook/foundation';

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
  const indexesResult = buildAccountingLayerIndexes(accountingLayer);
  if (indexesResult.isErr()) {
    return err(indexesResult.error);
  }

  const resolvedCarryoversResult = resolveInternalTransferCarryovers(accountingLayer);
  if (resolvedCarryoversResult.isErr()) {
    return err(resolvedCarryoversResult.error);
  }

  return ok({
    accountingLayer,
    indexes: indexesResult.value,
    resolvedInternalTransferCarryovers: resolvedCarryoversResult.value,
  });
}
