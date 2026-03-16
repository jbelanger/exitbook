import {
  computeTxFingerprint,
  err,
  ok,
  type Result,
  type TransactionNote,
  type UniversalTransactionData,
} from '@exitbook/core';
import { OverrideStore, readTransactionNoteOverrides } from '@exitbook/data';

import type { CommandDatabase } from '../../shared/command-runtime.js';

import { applyTransactionFilters, type ViewTransactionsParams } from './transactions-view-utils.js';

interface ReadTransactionsForCommandParams {
  assetSymbol?: string | undefined;
  dataDir: string;
  db: CommandDatabase;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  since?: number | undefined;
  sourceName?: string | undefined;
  until?: string | undefined;
}

const PROJECTED_USER_NOTE_TYPE = 'user_note';
const PROJECTED_USER_NOTE_SOURCE = 'override-store';

/**
 * Load transactions for CLI command surfaces, then project user note overrides and apply in-memory filters.
 */
export async function readTransactionsForCommand(
  params: ReadTransactionsForCommandParams
): Promise<Result<UniversalTransactionData[], Error>> {
  const transactionsResult = await params.db.transactions.findAll({
    ...(params.sourceName ? { sourceName: params.sourceName } : {}),
    ...(params.since !== undefined ? { since: params.since } : {}),
    includeExcluded: true,
  });
  if (transactionsResult.isErr()) {
    return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
  }

  const overrideStore = new OverrideStore(params.dataDir);
  const noteOverridesResult = await readTransactionNoteOverrides(overrideStore);
  if (noteOverridesResult.isErr()) {
    return err(noteOverridesResult.error);
  }

  const projectedResult = applyTransactionNoteOverrides(transactionsResult.value, noteOverridesResult.value);
  if (projectedResult.isErr()) {
    return err(projectedResult.error);
  }

  return applyTransactionFilters(projectedResult.value, {
    assetSymbol: params.assetSymbol,
    noPrice: params.noPrice,
    operationType: params.operationType,
    until: params.until,
  } satisfies ViewTransactionsParams);
}

export function applyTransactionNoteOverrides(
  transactions: UniversalTransactionData[],
  notesByFingerprint: ReadonlyMap<string, string>
): Result<UniversalTransactionData[], Error> {
  const projectedTransactions: UniversalTransactionData[] = [];

  for (const transaction of transactions) {
    const txFingerprintResult = computeTxFingerprint({
      source: transaction.source,
      accountId: transaction.accountId,
      externalId: transaction.externalId,
    });
    if (txFingerprintResult.isErr()) {
      return err(
        new Error(
          `Failed to compute transaction fingerprint for transaction ${transaction.id}: ${txFingerprintResult.error.message}`
        )
      );
    }

    const projectedNotes = stripProjectedUserNotes(transaction.notes);
    const overrideNote = notesByFingerprint.get(txFingerprintResult.value);
    if (!overrideNote) {
      projectedTransactions.push(
        projectedNotes.length > 0
          ? {
              ...transaction,
              notes: projectedNotes,
            }
          : omitNotes(transaction)
      );
      continue;
    }

    projectedTransactions.push({
      ...transaction,
      notes: [
        ...projectedNotes,
        {
          type: PROJECTED_USER_NOTE_TYPE,
          message: overrideNote,
          metadata: {
            actor: 'user',
            source: PROJECTED_USER_NOTE_SOURCE,
          },
        } satisfies TransactionNote,
      ],
    });
  }

  return ok(projectedTransactions);
}

function stripProjectedUserNotes(notes: TransactionNote[] | undefined): TransactionNote[] {
  return (notes ?? []).filter((note) => !isProjectedUserNote(note));
}

function isProjectedUserNote(note: TransactionNote): boolean {
  return note.type === PROJECTED_USER_NOTE_TYPE && note.metadata?.['source'] === PROJECTED_USER_NOTE_SOURCE;
}

function omitNotes(transaction: UniversalTransactionData): UniversalTransactionData {
  const { notes: _notes, ...transactionWithoutNotes } = transaction;
  return transactionWithoutNotes;
}
