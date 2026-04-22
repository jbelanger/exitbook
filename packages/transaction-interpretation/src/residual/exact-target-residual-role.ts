import {
  getExplainedTargetResidual,
  type NonPrincipalMovementRole,
  type Transaction,
  type TransactionLink,
} from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { TransactionAnnotation } from '../annotations/annotation-types.js';
import { sumUniqueStakingRewardComponents } from '../annotations/staking-reward-components.js';

function hasSingleAssetInflow(transaction: Pick<Transaction, 'movements'>, assetSymbol: Currency): boolean {
  return (transaction.movements.inflows ?? []).filter((movement) => movement.assetSymbol === assetSymbol).length === 1;
}

export function resolveExactTargetResidualRole(params: {
  assetSymbol: Currency;
  residualQuantity: Decimal;
  targetTransaction: Pick<Transaction, 'movements'>;
  targetTransactionAnnotations?: readonly TransactionAnnotation[] | undefined;
  transferLinks: readonly Pick<TransactionLink, 'metadata'>[];
}): NonPrincipalMovementRole | undefined {
  const explainedResidual = getExplainedTargetResidual(params.transferLinks);
  if (explainedResidual && explainedResidual.amount.eq(params.residualQuantity)) {
    return explainedResidual.role;
  }

  if (!hasSingleAssetInflow(params.targetTransaction, params.assetSymbol)) {
    return undefined;
  }

  const stakingRewardResidualQuantity = sumUniqueStakingRewardComponents(
    [params.targetTransactionAnnotations],
    params.assetSymbol
  );
  if (stakingRewardResidualQuantity.gt(0) && stakingRewardResidualQuantity.eq(params.residualQuantity)) {
    return 'staking_reward';
  }

  return undefined;
}
