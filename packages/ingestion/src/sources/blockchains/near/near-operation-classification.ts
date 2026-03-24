import type { NearActionType } from '@exitbook/blockchain-providers/near';
import type { OperationClassification } from '@exitbook/core';

import type { Movement } from './near-fund-flow-extraction.js';
import type { NearCorrelatedTransaction, NearReceipt } from './types.js';

function getActionTypes(receipts: NearReceipt[]): NearActionType[] {
  return receipts.flatMap((receipt) => (receipt.actions ?? []).map((action) => action.actionType));
}

function hasActionType(actionTypes: NearActionType[], type: NearActionType): boolean {
  return actionTypes.includes(type);
}

function analyzeBalanceChangeCauses(receipts: NearReceipt[]): {
  hasRefunds: boolean;
  hasRewards: boolean;
} {
  const allCauses = receipts.flatMap((receipt) =>
    (receipt.balanceChanges ?? []).map((balanceChange) => balanceChange.cause)
  );
  return {
    hasRewards: allCauses.includes('CONTRACT_REWARD'),
    hasRefunds: allCauses.includes('GAS_REFUND'),
  };
}

export function classifyOperation(
  correlated: NearCorrelatedTransaction,
  allInflows: Movement[],
  allOutflows: Movement[]
): OperationClassification {
  const hasInflows = allInflows.length > 0;
  const hasOutflows = allOutflows.length > 0;
  const hasTokenTransfers =
    allInflows.some((movement) => movement.flowType === 'token_transfer') ||
    allOutflows.some((movement) => movement.flowType === 'token_transfer');

  const actionTypes = getActionTypes(correlated.receipts);
  const { hasRewards, hasRefunds } = analyzeBalanceChangeCauses(correlated.receipts);

  if (hasActionType(actionTypes, 'stake')) {
    return {
      operation: {
        category: 'staking',
        type: 'stake',
      },
    };
  }

  if (hasInflows && !hasOutflows && hasRewards) {
    return {
      operation: {
        category: 'staking',
        type: 'reward',
      },
    };
  }

  if (hasInflows && !hasOutflows && hasRefunds) {
    return {
      operation: {
        category: 'transfer',
        type: 'refund',
      },
    };
  }

  if (hasActionType(actionTypes, 'create_account')) {
    return {
      operation: {
        category: 'defi',
        type: 'batch',
      },
    };
  }

  if (hasInflows && !hasOutflows) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  if (hasOutflows && !hasInflows) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  if (hasInflows && hasOutflows && hasTokenTransfers) {
    return {
      operation: {
        category: 'trade',
        type: 'swap',
      },
    };
  }

  if (hasInflows && hasOutflows) {
    return {
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  return {
    operation: {
      category: 'defi',
      type: 'batch',
    },
  };
}
