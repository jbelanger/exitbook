import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import { validateAccountingJournalDraft, type AccountingJournalDraft } from '@exitbook/ledger';
import type { z } from 'zod';

interface LedgerDraftWithJournals {
  journals: readonly AccountingJournalDraft[];
}

export function parseLedgerProcessorItems<T>(params: {
  inputLabel: string;
  normalizedData: readonly unknown[];
  schema: z.ZodType<T>;
}): Result<T[], Error> {
  const items: T[] = [];

  for (let index = 0; index < params.normalizedData.length; index++) {
    const result = params.schema.safeParse(params.normalizedData[index]);
    if (!result.success) {
      const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return err(new Error(`Input validation failed for ${params.inputLabel} item at index ${index}: ${errorDetail}`));
    }

    items.push(result.data);
  }

  return ok(items);
}

export function dedupeLedgerProcessorItemsById<T extends { id: string }>(params: {
  buildComparisonMaterial: (item: T) => string;
  conflictLabel: string;
  items: readonly T[];
}): Result<T[], Error> {
  const itemsById = new Map<string, { item: T; material: string }>();

  for (const item of params.items) {
    const material = params.buildComparisonMaterial(item);
    const existing = itemsById.get(item.id);
    if (!existing) {
      itemsById.set(item.id, { item, material });
      continue;
    }

    if (existing.material !== material) {
      return err(
        new Error(`${params.conflictLabel} received conflicting normalized payloads for transaction ${item.id}`)
      );
    }
  }

  return ok([...itemsById.values()].map((entry) => entry.item));
}

export function validateLedgerProcessorDraftJournals<TTransaction extends { id: string }>(params: {
  draft: LedgerDraftWithJournals;
  processorLabel: string;
  transaction: TTransaction;
}): Result<void, Error> {
  for (const journal of params.draft.journals) {
    const validationResult = validateAccountingJournalDraft(journal);
    if (validationResult.isErr()) {
      return err(
        new Error(
          `${params.processorLabel} journal validation failed for ${params.transaction.id} journal ${journal.journalStableKey}: ${validationResult.error.message}`
        )
      );
    }
  }

  return ok(undefined);
}

export function processLedgerProcessorItems<
  TTransaction extends { id: string },
  TDraft extends LedgerDraftWithJournals,
>(params: {
  assemble: (transaction: TTransaction) => Result<TDraft, Error>;
  buildComparisonMaterial: (transaction: TTransaction) => string;
  conflictLabel: string;
  inputLabel: string;
  normalizedData: readonly unknown[];
  processorLabel: string;
  schema: z.ZodType<TTransaction>;
}): Result<TDraft[], Error> {
  return resultDo(function* () {
    const parsedTransactions = yield* parseLedgerProcessorItems({
      inputLabel: params.inputLabel,
      normalizedData: params.normalizedData,
      schema: params.schema,
    });
    const uniqueTransactions = yield* dedupeLedgerProcessorItemsById({
      buildComparisonMaterial: params.buildComparisonMaterial,
      conflictLabel: params.conflictLabel,
      items: parsedTransactions,
    });
    const drafts: TDraft[] = [];

    for (const transaction of uniqueTransactions) {
      const draft = yield* params.assemble(transaction);
      yield* validateLedgerProcessorDraftJournals({
        draft,
        processorLabel: params.processorLabel,
        transaction,
      });
      drafts.push(draft);
    }

    return drafts;
  });
}
