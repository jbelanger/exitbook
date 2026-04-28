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
  return dedupeLedgerProcessorItemsByKey({
    buildComparisonMaterial: params.buildComparisonMaterial,
    conflictItemLabel: 'transaction',
    conflictLabel: params.conflictLabel,
    getItemKey: (item) => item.id,
    items: params.items,
  });
}

export function dedupeLedgerProcessorItemsByKey<T>(params: {
  buildComparisonMaterial: (item: T) => string;
  conflictItemLabel: string;
  conflictLabel: string;
  getItemKey: (item: T) => string;
  items: readonly T[];
}): Result<T[], Error> {
  const itemsByKey = new Map<string, { item: T; material: string }>();

  for (const item of params.items) {
    const itemKey = params.getItemKey(item);
    const material = params.buildComparisonMaterial(item);
    const existing = itemsByKey.get(itemKey);
    if (!existing) {
      itemsByKey.set(itemKey, { item, material });
      continue;
    }

    if (existing.material !== material) {
      return err(
        new Error(
          `${params.conflictLabel} received conflicting normalized payloads for ${params.conflictItemLabel} ${itemKey}`
        )
      );
    }
  }

  return ok([...itemsByKey.values()].map((entry) => entry.item));
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

export async function processGroupedLedgerProcessorItems<TItem, TDraft extends LedgerDraftWithJournals>(params: {
  assemble: (items: readonly TItem[], groupKey: string) => Result<TDraft, Error>;
  buildComparisonMaterial: (item: TItem) => string;
  conflictItemLabel: string;
  conflictLabel: string;
  getDeduplicationKey: (item: TItem) => string;
  groupItems: (items: readonly TItem[]) => ReadonlyMap<string, readonly TItem[]>;
  inputLabel: string;
  normalizedData: readonly unknown[];
  prepareItems?: ((items: TItem[]) => Promise<Result<TItem[], Error>>) | undefined;
  processorLabel: string;
  schema: z.ZodType<TItem>;
}): Promise<Result<TDraft[], Error>> {
  const parsedItems = parseLedgerProcessorItems({
    inputLabel: params.inputLabel,
    normalizedData: params.normalizedData,
    schema: params.schema,
  });
  if (parsedItems.isErr()) {
    return err(parsedItems.error);
  }

  const preparedItems = params.prepareItems ? await params.prepareItems(parsedItems.value) : ok(parsedItems.value);
  if (preparedItems.isErr()) {
    return err(preparedItems.error);
  }

  const uniqueItems = dedupeLedgerProcessorItemsByKey({
    buildComparisonMaterial: params.buildComparisonMaterial,
    conflictItemLabel: params.conflictItemLabel,
    conflictLabel: params.conflictLabel,
    getItemKey: params.getDeduplicationKey,
    items: preparedItems.value,
  });
  if (uniqueItems.isErr()) {
    return err(uniqueItems.error);
  }

  const drafts: TDraft[] = [];
  for (const [groupKey, items] of params.groupItems(uniqueItems.value)) {
    const draft = params.assemble(items, groupKey);
    if (draft.isErr()) {
      return err(draft.error);
    }
    if (draft.value.journals.length === 0) {
      continue;
    }

    const validationResult = validateLedgerProcessorDraftJournals({
      draft: draft.value,
      processorLabel: params.processorLabel,
      transaction: { id: groupKey },
    });
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
    drafts.push(draft.value);
  }

  return ok(drafts);
}
