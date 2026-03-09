import type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
} from '../matching/build-cost-basis-scoped-transactions.js';

export interface AccountingExclusionPolicy {
  excludedAssetIds: ReadonlySet<string>;
}

export interface AccountingExclusionApplyResult {
  fullyExcludedTransactionIds: Set<number>;
  partiallyExcludedTransactionIds: Set<number>;
  scopedBuildResult: AccountingScopedBuildResult;
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
 * Prune excluded assets from the accounting-scoped build result.
 *
 * This is intentionally accounting-local and runs after scoped build, so mixed
 * transactions can remain in scope when included activity survives.
 */
export function applyAccountingExclusionPolicy(
  scopedBuildResult: AccountingScopedBuildResult,
  policy: AccountingExclusionPolicy | undefined
): AccountingExclusionApplyResult {
  if (!hasAccountingExclusions(policy)) {
    return {
      scopedBuildResult,
      fullyExcludedTransactionIds: new Set<number>(),
      partiallyExcludedTransactionIds: new Set<number>(),
    };
  }

  const transactions: AccountingScopedTransaction[] = [];
  const fullyExcludedTransactionIds = new Set<number>();
  const partiallyExcludedTransactionIds = new Set<number>();

  for (const scopedTransaction of scopedBuildResult.transactions) {
    const originalMovementCount =
      scopedTransaction.movements.inflows.length +
      scopedTransaction.movements.outflows.length +
      scopedTransaction.fees.length;

    const inflows = scopedTransaction.movements.inflows.filter(
      (movement) => !isExcludedAsset(policy, movement.assetId)
    );
    const outflows = scopedTransaction.movements.outflows.filter(
      (movement) => !isExcludedAsset(policy, movement.assetId)
    );
    const fees = scopedTransaction.fees.filter((fee) => !isExcludedAsset(policy, fee.assetId));

    const remainingMovementCount = inflows.length + outflows.length + fees.length;
    if (remainingMovementCount === 0) {
      fullyExcludedTransactionIds.add(scopedTransaction.tx.id);
      continue;
    }

    if (remainingMovementCount < originalMovementCount) {
      partiallyExcludedTransactionIds.add(scopedTransaction.tx.id);
    }

    transactions.push({
      tx: scopedTransaction.tx,
      movements: {
        inflows,
        outflows,
      },
      fees,
    });
  }

  const feeOnlyInternalCarryovers = scopedBuildResult.feeOnlyInternalCarryovers.filter(
    (carryover) => !isExcludedAsset(policy, carryover.assetId)
  );

  return {
    scopedBuildResult: {
      transactions,
      feeOnlyInternalCarryovers,
    },
    fullyExcludedTransactionIds,
    partiallyExcludedTransactionIds,
  };
}
