import type { OverrideEvent, TransactionMaterializationScope } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { TransactionRepository } from '../repositories/transaction-repository.js';

import type { OverrideStore } from './override-store.js';

/**
 * Replay transaction note override events with latest-event-wins semantics.
 */
export function replayTransactionNoteOverrides(overrides: OverrideEvent[]): Result<Map<string, string>, Error> {
  const notesByFingerprint = new Map<string, string>();

  for (const override of overrides) {
    switch (override.scope) {
      case 'transaction-note': {
        if (override.payload.type !== 'transaction_note_override') {
          return err(
            new Error(
              `Transaction note replay expected payload type 'transaction_note_override' for scope 'transaction-note', got '${override.payload.type}'`
            )
          );
        }

        if (override.payload.action === 'set') {
          if (!override.payload.message) {
            return err(new Error("Transaction note replay expected message for action 'set'"));
          }

          notesByFingerprint.set(override.payload.tx_fingerprint, override.payload.message);
          break;
        }

        if (override.payload.action === 'clear') {
          notesByFingerprint.delete(override.payload.tx_fingerprint);
          break;
        }

        return err(
          new Error(`Transaction note replay received unsupported action '${String(override.payload.action)}'`)
        );
      }

      default:
        return err(
          new Error(
            `Transaction note replay received unsupported scope '${override.scope}'. Only 'transaction-note' is allowed.`
          )
        );
    }
  }

  return ok(notesByFingerprint);
}

/**
 * Read and replay transaction note overrides from the durable override store.
 */
export async function readTransactionNoteOverrides(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Map<string, string>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['transaction-note']);
  if (overridesResult.isErr()) {
    return err(new Error(`Failed to read transaction note override events: ${overridesResult.error.message}`));
  }

  return replayTransactionNoteOverrides(overridesResult.value);
}

type TransactionNoteMaterializationRepository = Pick<TransactionRepository, 'materializeTransactionNoteOverrides'>;
type TransactionNoteMaterializationStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;

/**
 * Read, replay, and materialize durable transaction-note overrides into transactions.notes_json.
 */
export async function materializeStoredTransactionNoteOverrides(
  transactions: TransactionNoteMaterializationRepository,
  overrideStore: TransactionNoteMaterializationStore,
  profileKey: string,
  scope: TransactionMaterializationScope = {}
): Promise<Result<number, Error>> {
  const noteOverridesResult = await readTransactionNoteOverrides(overrideStore, profileKey);
  if (noteOverridesResult.isErr()) {
    return err(noteOverridesResult.error);
  }

  return transactions.materializeTransactionNoteOverrides({
    ...scope,
    notesByFingerprint: noteOverridesResult.value,
  });
}
