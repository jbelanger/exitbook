import { type CardanoTransaction, CardanoTransactionSchema } from '@exitbook/blockchain-providers/cardano';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import { validateAccountingJournalDraft } from '@exitbook/ledger';

import {
  assembleCardanoLedgerDraft,
  type CardanoLedgerDraft,
  type CardanoProcessorV2Context,
} from './journal-assembler.js';

function parseCardanoTransactions(normalizedData: unknown[]): Result<CardanoTransaction[], Error> {
  const transactions: CardanoTransaction[] = [];

  for (let i = 0; i < normalizedData.length; i++) {
    const result = CardanoTransactionSchema.safeParse(normalizedData[i]);
    if (!result.success) {
      const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return err(new Error(`Input validation failed for cardano v2 item at index ${i}: ${errorDetail}`));
    }

    transactions.push(result.data);
  }

  return ok(transactions);
}

function assembleCardanoLedgerDraftWithContext(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  const draftResult = assembleCardanoLedgerDraft(transaction, context);
  if (draftResult.isErr()) {
    return err(new Error(`Cardano v2 assembly failed for ${transaction.id}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

function validateCardanoLedgerDraftJournals(
  transaction: CardanoTransaction,
  draft: CardanoLedgerDraft
): Result<void, Error> {
  for (const journal of draft.journals) {
    const validationResult = validateAccountingJournalDraft(journal);
    if (validationResult.isErr()) {
      return err(
        new Error(
          `Cardano v2 journal validation failed for ${transaction.id} journal ${journal.journalStableKey}: ${validationResult.error.message}`
        )
      );
    }
  }

  return ok(undefined);
}

export class CardanoProcessorV2 {
  async process(
    normalizedData: unknown[],
    context: CardanoProcessorV2Context
  ): Promise<Result<CardanoLedgerDraft[], Error>> {
    return resultDo(function* () {
      const transactions = yield* parseCardanoTransactions(normalizedData);
      const drafts: CardanoLedgerDraft[] = [];

      for (const transaction of transactions) {
        const draft = yield* assembleCardanoLedgerDraftWithContext(transaction, context);
        yield* validateCardanoLedgerDraftJournals(transaction, draft);
        drafts.push(draft);
      }

      return drafts;
    });
  }
}
