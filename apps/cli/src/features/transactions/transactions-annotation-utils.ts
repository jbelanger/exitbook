import type { AnnotationKind, AnnotationTier, TransactionAnnotation } from '@exitbook/transaction-interpretation';

export interface TransactionsAnnotationFilters {
  annotationKind?: AnnotationKind | undefined;
  annotationTier?: AnnotationTier | undefined;
}

export function hasTransactionAnnotationFilters(filters: TransactionsAnnotationFilters): boolean {
  return filters.annotationKind !== undefined || filters.annotationTier !== undefined;
}

export function buildAnnotationsByTransactionId(
  annotations: readonly TransactionAnnotation[]
): ReadonlyMap<number, readonly TransactionAnnotation[]> {
  const annotationsByTransactionId = new Map<number, TransactionAnnotation[]>();

  for (const annotation of annotations) {
    const existing = annotationsByTransactionId.get(annotation.transactionId);
    if (existing !== undefined) {
      existing.push(annotation);
      continue;
    }

    annotationsByTransactionId.set(annotation.transactionId, [annotation]);
  }

  return annotationsByTransactionId;
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

export function filterTransactionViewItemsByAnnotationFilters<
  T extends { annotations: readonly TransactionAnnotation[] },
>(items: readonly T[], filters: TransactionsAnnotationFilters): T[] {
  if (!hasTransactionAnnotationFilters(filters)) {
    return [...items];
  }

  return items.filter((item) => matchesTransactionAnnotationFilters(item.annotations, filters));
}

export function filterTransactionsByAnnotationFilters<T extends { id: number }>(
  items: readonly T[],
  annotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  filters: TransactionsAnnotationFilters
): T[] {
  if (!hasTransactionAnnotationFilters(filters)) {
    return [...items];
  }

  return items.filter((item) =>
    matchesTransactionAnnotationFilters(annotationsByTransactionId.get(item.id) ?? [], filters)
  );
}
