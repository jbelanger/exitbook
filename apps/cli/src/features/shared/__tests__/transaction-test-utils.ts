import type { Transaction, TransactionDraft } from '@exitbook/core';
import { buildAssetMovementCanonicalMaterial, buildFeeMovementCanonicalMaterial } from '@exitbook/core';
import { seedAssetMovementFingerprint, seedFeeMovementFingerprint } from '@exitbook/core/test-utils';

export function createPersistedTransaction(
  params: Omit<Transaction, 'movements' | 'fees'> & {
    fees?: TransactionDraft['fees'] | undefined;
    movements?: TransactionDraft['movements'] | undefined;
  }
): Transaction {
  const movements = params.movements ?? {};
  const fees = params.fees ?? [];
  const inflowDuplicateCounts = new Map<string, number>();
  const outflowDuplicateCounts = new Map<string, number>();
  const feeDuplicateCounts = new Map<string, number>();

  return {
    ...params,
    movements: {
      inflows: (movements.inflows ?? []).map((movement) => {
        const canonicalMaterial = buildAssetMovementCanonicalMaterial({
          movementType: 'inflow',
          assetId: movement.assetId,
          grossAmount: movement.grossAmount,
          netAmount: movement.netAmount,
        });
        const duplicateOccurrence = (inflowDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
        inflowDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

        return {
          ...movement,
          movementFingerprint:
            'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
              ? movement.movementFingerprint
              : seedAssetMovementFingerprint(params.txFingerprint, 'inflow', movement, duplicateOccurrence),
        };
      }),
      outflows: (movements.outflows ?? []).map((movement) => {
        const canonicalMaterial = buildAssetMovementCanonicalMaterial({
          movementType: 'outflow',
          assetId: movement.assetId,
          grossAmount: movement.grossAmount,
          netAmount: movement.netAmount,
        });
        const duplicateOccurrence = (outflowDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
        outflowDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

        return {
          ...movement,
          movementFingerprint:
            'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
              ? movement.movementFingerprint
              : seedAssetMovementFingerprint(params.txFingerprint, 'outflow', movement, duplicateOccurrence),
        };
      }),
    },
    fees: fees.map((fee) => {
      const canonicalMaterial = buildFeeMovementCanonicalMaterial({
        assetId: fee.assetId,
        amount: fee.amount,
        scope: fee.scope,
        settlement: fee.settlement,
      });
      const duplicateOccurrence = (feeDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
      feeDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

      return {
        ...fee,
        movementFingerprint:
          'movementFingerprint' in fee && typeof fee.movementFingerprint === 'string'
            ? fee.movementFingerprint
            : seedFeeMovementFingerprint(params.txFingerprint, fee, duplicateOccurrence),
      };
    }),
  };
}
