import type { Transaction, TransactionDraft } from '@exitbook/core';
import { computeMovementFingerprint } from '@exitbook/core';

export function materializeMovementFingerprint(
  txFingerprint: string,
  movementType: 'inflow' | 'outflow' | 'fee',
  position: number
): string {
  const result = computeMovementFingerprint({ txFingerprint, movementType, position });
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

export function createPersistedTransaction(
  params: Omit<Transaction, 'movements' | 'fees'> & {
    fees?: TransactionDraft['fees'] | undefined;
    movements?: TransactionDraft['movements'] | undefined;
  }
): Transaction {
  const movements = params.movements ?? {};
  const fees = params.fees ?? [];

  return {
    ...params,
    movements: {
      inflows: (movements.inflows ?? []).map((movement, index) => ({
        ...movement,
        movementFingerprint:
          'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
            ? movement.movementFingerprint
            : materializeMovementFingerprint(params.txFingerprint, 'inflow', index),
      })),
      outflows: (movements.outflows ?? []).map((movement, index) => ({
        ...movement,
        movementFingerprint:
          'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
            ? movement.movementFingerprint
            : materializeMovementFingerprint(params.txFingerprint, 'outflow', index),
      })),
    },
    fees: fees.map((fee, index) => ({
      ...fee,
      movementFingerprint:
        'movementFingerprint' in fee && typeof fee.movementFingerprint === 'string'
          ? fee.movementFingerprint
          : materializeMovementFingerprint(params.txFingerprint, 'fee', index),
    })),
  };
}
