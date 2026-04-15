import type { MovementRole, OverrideEvent, TransactionMaterializationScope } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { TransactionRepository } from '../repositories/transaction-repository.js';

import type { OverrideStore } from './override-store.js';

/**
 * Replay transaction movement-role override events with latest-event-wins semantics.
 */
export function replayTransactionMovementRoleOverrides(
  overrides: OverrideEvent[]
): Result<Map<string, MovementRole>, Error> {
  const movementRoleByFingerprint = new Map<string, MovementRole>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'transaction-movement-role': {
        if (override.payload.type !== 'transaction_movement_role_override') {
          return err(
            new Error(
              "Transaction movement role replay expected payload type 'transaction_movement_role_override' " +
                `for scope 'transaction-movement-role', got '${override.payload.type}'`
            )
          );
        }

        if (override.payload.action === 'set') {
          if (override.payload.movement_role === undefined) {
            return err(new Error("Transaction movement role replay expected movement_role for action 'set'"));
          }

          movementRoleByFingerprint.set(override.payload.movement_fingerprint, override.payload.movement_role);
          break;
        }

        if (override.payload.action === 'clear') {
          movementRoleByFingerprint.delete(override.payload.movement_fingerprint);
          break;
        }

        return err(
          new Error(`Transaction movement role replay received unsupported action '${String(override.payload.action)}'`)
        );
      }

      default:
        return err(
          new Error(
            'Transaction movement role replay received unsupported scope ' +
              `'${override.scope}'. Only 'transaction-movement-role' is allowed.`
          )
        );
    }
  }

  return ok(movementRoleByFingerprint);
}

/**
 * Read and replay transaction movement-role overrides from the durable override store.
 */
export async function readTransactionMovementRoleOverrides(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Map<string, MovementRole>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['transaction-movement-role']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read transaction movement role override events: ${overridesResult.error.message}`));
  }

  return replayTransactionMovementRoleOverrides(overridesResult.value);
}

type TransactionMovementRoleMaterializationRepository = Pick<
  TransactionRepository,
  'materializeTransactionMovementRoleOverrides'
>;
type TransactionMovementRoleMaterializationStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;

/**
 * Read, replay, and materialize durable transaction movement-role overrides into
 * transaction_movements.movement_role_override.
 */
export async function materializeStoredTransactionMovementRoleOverrides(
  transactions: TransactionMovementRoleMaterializationRepository,
  overrideStore: TransactionMovementRoleMaterializationStore,
  profileKey: string,
  scope: TransactionMaterializationScope = {}
): Promise<Result<number, Error>> {
  const movementRoleOverridesResult = await readTransactionMovementRoleOverrides(overrideStore, profileKey);
  if (movementRoleOverridesResult.isErr()) {
    return err(movementRoleOverridesResult.error);
  }

  return transactions.materializeTransactionMovementRoleOverrides({
    ...scope,
    movementRoleOverrideByFingerprint: movementRoleOverridesResult.value,
  });
}
