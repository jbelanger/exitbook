import type { Transaction } from '@exitbook/core';
import {
  deriveOperationLabel,
  groupTransactionAnnotationsByTransactionId,
  type AnnotationKind,
  type AnnotationTier,
  type TransactionAnnotation,
} from '@exitbook/transaction-interpretation';

export interface TransactionsAnnotationFilters {
  annotationKind?: AnnotationKind | undefined;
  annotationTier?: AnnotationTier | undefined;
}

export interface TransactionsInterpretationFilters extends TransactionsAnnotationFilters {
  operationFilter?: string | undefined;
}

export function hasTransactionAnnotationFilters(filters: TransactionsAnnotationFilters): boolean {
  return filters.annotationKind !== undefined || filters.annotationTier !== undefined;
}

function hasTransactionOperationFilter(filters: TransactionsInterpretationFilters): boolean {
  return filters.operationFilter !== undefined;
}

function normalizeOperationFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesDerivedOperationFilter(
  operation: {
    group: string;
    label: string;
  },
  operationFilter: string | undefined
): boolean {
  if (operationFilter === undefined) {
    return true;
  }

  const normalizedFilter = normalizeOperationFilterValue(operationFilter);
  if (normalizedFilter.length === 0) {
    return true;
  }

  const normalizedGroup = normalizeOperationFilterValue(operation.group);
  const normalizedLabel = normalizeOperationFilterValue(operation.label);
  const labelSuffix = normalizedLabel.includes('/') ? normalizedLabel.split('/').at(-1) : normalizedLabel;

  if (normalizedFilter.includes('/')) {
    return normalizedLabel === normalizedFilter;
  }

  return normalizedGroup === normalizedFilter || labelSuffix === normalizedFilter;
}

export function matchesTransactionOperationFilter(
  transaction: Pick<Transaction, 'operation'>,
  annotations: readonly TransactionAnnotation[],
  operationFilter: string | undefined
): boolean {
  return matchesDerivedOperationFilter(deriveOperationLabel(transaction, annotations), operationFilter);
}

export function buildAnnotationsByTransactionId(
  annotations: readonly TransactionAnnotation[]
): ReadonlyMap<number, readonly TransactionAnnotation[]> {
  return groupTransactionAnnotationsByTransactionId(annotations);
}

export function matchesTransactionAnnotationFilters(
  annotations: readonly TransactionAnnotation[],
  filters: TransactionsAnnotationFilters
): boolean {
  if (!hasTransactionAnnotationFilters(filters)) {
    return true;
  }

  return annotations.some(
    (annotation) =>
      (filters.annotationKind === undefined || annotation.kind === filters.annotationKind) &&
      (filters.annotationTier === undefined || annotation.tier === filters.annotationTier)
  );
}

export function filterTransactionViewItemsByInterpretationFilters<
  T extends {
    annotations: readonly TransactionAnnotation[];
    operationGroup: string;
    operationLabel: string;
  },
>(items: readonly T[], filters: TransactionsInterpretationFilters): T[] {
  if (!hasTransactionAnnotationFilters(filters) && !hasTransactionOperationFilter(filters)) {
    return [...items];
  }

  return items.filter(
    (item) =>
      matchesTransactionAnnotationFilters(item.annotations, filters) &&
      matchesDerivedOperationFilter(
        {
          group: item.operationGroup,
          label: item.operationLabel,
        },
        filters.operationFilter
      )
  );
}

export function filterTransactionsByInterpretationFilters<
  T extends { id: number; operation?: Transaction['operation'] | undefined },
>(
  items: readonly T[],
  annotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  filters: TransactionsInterpretationFilters
): T[] {
  if (!hasTransactionAnnotationFilters(filters) && !hasTransactionOperationFilter(filters)) {
    return [...items];
  }

  return items.filter((item) => {
    const annotations = annotationsByTransactionId.get(item.id) ?? [];
    const matchesOperation =
      filters.operationFilter === undefined
        ? true
        : item.operation !== undefined &&
          matchesTransactionOperationFilter({ operation: item.operation }, annotations, filters.operationFilter);
    return matchesTransactionAnnotationFilters(annotations, filters) && matchesOperation;
  });
}

export function filterTransactionViewItemsByAnnotationFilters<
  T extends {
    annotations: readonly TransactionAnnotation[];
    operationGroup: string;
    operationLabel: string;
  },
>(items: readonly T[], filters: TransactionsAnnotationFilters): T[] {
  return filterTransactionViewItemsByInterpretationFilters(items, filters);
}

export function filterTransactionsByAnnotationFilters<
  T extends { id: number; operation?: Transaction['operation'] | undefined },
>(
  items: readonly T[],
  annotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  filters: TransactionsAnnotationFilters
): T[] {
  return filterTransactionsByInterpretationFilters(items, annotationsByTransactionId, filters);
}
