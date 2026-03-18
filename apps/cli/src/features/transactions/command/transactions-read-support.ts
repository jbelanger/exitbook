import { err, ok, type Result, type TransactionNote, type Transaction } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

const PROJECTED_USER_NOTE_TYPE = 'user_note';
const PROJECTED_USER_NOTE_SOURCE = 'override-store';

import { applyTransactionFilters, type ViewTransactionsParams } from './transactions-view-utils.js';

interface ReadTransactionsForCommandParams {
  assetSymbol?: string | undefined;
  db: DataContext;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  since?: number | undefined;
  sourceName?: string | undefined;
  until?: string | undefined;
}

/**
 * Load transactions for CLI command surfaces, then apply shared in-memory filters.
 */
export async function readTransactionsForCommand(
  params: ReadTransactionsForCommandParams
): Promise<Result<Transaction[], Error>> {
  const transactionsResult = await params.db.transactions.findAll({
    ...(params.sourceName ? { sourceName: params.sourceName } : {}),
    ...(params.since !== undefined ? { since: params.since } : {}),
    includeExcluded: true,
  });
  if (transactionsResult.isErr()) {
    return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
  }

  return applyTransactionFilters(transactionsResult.value, {
    assetSymbol: params.assetSymbol,
    noPrice: params.noPrice,
    operationType: params.operationType,
    until: params.until,
  } satisfies ViewTransactionsParams);
}

export function applyTransactionNoteOverrides(
  transactions: Transaction[],
  notesByFingerprint: ReadonlyMap<string, string>
): Result<Transaction[], Error> {
  const projectedTransactions: Transaction[] = [];

  for (const transaction of transactions) {
    const projectedNotes = stripProjectedUserNotes(transaction.notes);
    const overrideNote = notesByFingerprint.get(transaction.txFingerprint);
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

function omitNotes(transaction: Transaction): Transaction {
  const { notes: _notes, ...transactionWithoutNotes } = transaction;
  return transactionWithoutNotes;
}
