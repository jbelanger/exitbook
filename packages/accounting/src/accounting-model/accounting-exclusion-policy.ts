import type { PreparedAccountingBuildResult, PreparedAccountingTransaction } from './prepared-accounting-types.js';

export interface AccountingExclusionPolicy {
  excludedAssetIds: ReadonlySet<string>;
}

export interface AccountingExclusionApplyResult {
  fullyExcludedTransactionIds: Set<number>;
  partiallyExcludedTransactionIds: Set<number>;
  preparedBuildResult: PreparedAccountingBuildResult;
}

export function createAccountingExclusionPolicy(excludedAssetIds: Iterable<string> = []): AccountingExclusionPolicy {
  return {
    excludedAssetIds: new Set(excludedAssetIds),
  };
}

export function hasAccountingExclusions(policy: AccountingExclusionPolicy | undefined): boolean {
  return (policy?.excludedAssetIds.size ?? 0) > 0;
}

export function isExcludedAsset(policy: AccountingExclusionPolicy | undefined, assetId: string): boolean {
  return policy?.excludedAssetIds.has(assetId) ?? false;
}

/**
 * Prune excluded assets from the prepared accounting result.
 *
 * This is intentionally accounting-local and runs after prepared build, so mixed
 * transactions can remain in scope when included activity survives.
 */
export function applyAccountingExclusionPolicy(
  preparedBuildResult: PreparedAccountingBuildResult,
  policy: AccountingExclusionPolicy | undefined
): AccountingExclusionApplyResult {
  if (!hasAccountingExclusions(policy)) {
    return {
      preparedBuildResult,
      fullyExcludedTransactionIds: new Set<number>(),
      partiallyExcludedTransactionIds: new Set<number>(),
    };
  }

  const transactions: PreparedAccountingTransaction[] = [];
  const fullyExcludedTransactionIds = new Set<number>();
  const partiallyExcludedTransactionIds = new Set<number>();

  for (const preparedTransaction of preparedBuildResult.transactions) {
    const originalMovementCount =
      preparedTransaction.movements.inflows.length +
      preparedTransaction.movements.outflows.length +
      preparedTransaction.fees.length;

    const inflows = preparedTransaction.movements.inflows.filter(
      (movement) => !isExcludedAsset(policy, movement.assetId)
    );
    const outflows = preparedTransaction.movements.outflows.filter(
      (movement) => !isExcludedAsset(policy, movement.assetId)
    );
    const fees = preparedTransaction.fees.filter((fee) => !isExcludedAsset(policy, fee.assetId));

    const remainingMovementCount = inflows.length + outflows.length + fees.length;
    if (remainingMovementCount === 0) {
      fullyExcludedTransactionIds.add(preparedTransaction.tx.id);
      continue;
    }

    if (remainingMovementCount < originalMovementCount) {
      partiallyExcludedTransactionIds.add(preparedTransaction.tx.id);
    }

    transactions.push({
      tx: preparedTransaction.tx,
      rebuildDependencyTransactionIds: [...preparedTransaction.rebuildDependencyTransactionIds],
      movements: {
        inflows,
        outflows,
      },
      fees,
    });
  }

  const internalTransferCarryoverDrafts = preparedBuildResult.internalTransferCarryoverDrafts.filter(
    (carryover) => !isExcludedAsset(policy, carryover.assetId)
  );

  return {
    preparedBuildResult: {
      inputTransactions: preparedBuildResult.inputTransactions,
      transactions,
      internalTransferCarryoverDrafts,
    },
    fullyExcludedTransactionIds,
    partiallyExcludedTransactionIds,
  };
}
