import type { OverrideEvent, TransactionMaterializationScope, UserNote } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { TransactionRepository } from '../repositories/transaction-repository.js';

import type { OverrideStore } from './override-store.js';

/**
 * Replay transaction user-note override events with latest-event-wins semantics.
 */
export function replayTransactionUserNoteOverrides(overrides: OverrideEvent[]): Result<Map<string, UserNote>, Error> {
  const userNoteByFingerprint = new Map<string, UserNote>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'transaction-user-note': {
        if (override.payload.type !== 'transaction_user_note_override') {
          return err(
            new Error(
              `Transaction user note replay expected payload type 'transaction_user_note_override' for scope 'transaction-user-note', got '${override.payload.type}'`
            )
          );
        }

        if (override.payload.action === 'set') {
          if (!override.payload.message) {
            return err(new Error("Transaction user note replay expected message for action 'set'"));
          }

          userNoteByFingerprint.set(override.payload.tx_fingerprint, {
            message: override.payload.message,
            createdAt: override.created_at,
            author: override.actor,
          });
          break;
        }

        if (override.payload.action === 'clear') {
          userNoteByFingerprint.delete(override.payload.tx_fingerprint);
          break;
        }

        return err(
          new Error(`Transaction user note replay received unsupported action '${String(override.payload.action)}'`)
        );
      }

      default:
        return err(
          new Error(
            `Transaction user note replay received unsupported scope '${override.scope}'. Only 'transaction-user-note' is allowed.`
          )
        );
    }
  }

  return ok(userNoteByFingerprint);
}

/**
 * Read and replay transaction user-note overrides from the durable override store.
 */
export async function readTransactionUserNoteOverrides(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Map<string, UserNote>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['transaction-user-note']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read transaction user note override events: ${overridesResult.error.message}`));
  }

  return replayTransactionUserNoteOverrides(overridesResult.value);
}

type TransactionUserNoteMaterializationRepository = Pick<
  TransactionRepository,
  'materializeTransactionUserNoteOverrides'
>;
type TransactionUserNoteMaterializationStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;

/**
 * Read, replay, and materialize durable transaction user-note overrides into transactions.user_notes_json.
 */
export async function materializeStoredTransactionUserNoteOverrides(
  transactions: TransactionUserNoteMaterializationRepository,
  overrideStore: TransactionUserNoteMaterializationStore,
  profileKey: string,
  scope: TransactionMaterializationScope = {}
): Promise<Result<number, Error>> {
  const userNoteOverridesResult = await readTransactionUserNoteOverrides(overrideStore, profileKey);
  if (userNoteOverridesResult.isErr()) {
    return err(userNoteOverridesResult.error);
  }

  return transactions.materializeTransactionUserNoteOverrides({
    ...scope,
    userNoteByFingerprint: userNoteOverridesResult.value,
  });
}
