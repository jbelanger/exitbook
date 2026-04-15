import type { TransactionMaterializationScope } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { TransactionRepository } from '../repositories/transaction-repository.js';

import type { OverrideStore } from './override-store.js';
import { materializeStoredTransactionMovementRoleOverrides } from './transaction-movement-role-replay.js';
import { materializeStoredTransactionUserNoteOverrides } from './transaction-user-note-replay.js';

type TransactionOverrideMaterializationRepository = Pick<
  TransactionRepository,
  'materializeTransactionMovementRoleOverrides' | 'materializeTransactionUserNoteOverrides'
>;
type TransactionOverrideMaterializationStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;

/**
 * Read, replay, and materialize all transaction-scoped durable overrides for one profile scope.
 */
export async function materializeStoredTransactionOverrides(
  transactions: TransactionOverrideMaterializationRepository,
  overrideStore: TransactionOverrideMaterializationStore,
  profileKey: string,
  scope: TransactionMaterializationScope = {}
): Promise<Result<number, Error>> {
  return resultDoAsync(async function* () {
    const userNoteCount = yield* await materializeStoredTransactionUserNoteOverrides(
      transactions,
      overrideStore,
      profileKey,
      scope
    );
    const movementRoleCount = yield* await materializeStoredTransactionMovementRoleOverrides(
      transactions,
      overrideStore,
      profileKey,
      scope
    );

    return userNoteCount + movementRoleCount;
  });
}
