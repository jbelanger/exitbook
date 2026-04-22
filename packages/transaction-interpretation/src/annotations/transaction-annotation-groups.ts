import type { TransactionAnnotation } from './annotation-types.js';

export function groupTransactionAnnotationsByTransactionId(
  annotations: readonly TransactionAnnotation[] | undefined
): ReadonlyMap<number, readonly TransactionAnnotation[]> {
  const annotationsByTransactionId = new Map<number, TransactionAnnotation[]>();

  for (const annotation of annotations ?? []) {
    const existing = annotationsByTransactionId.get(annotation.transactionId);
    if (existing !== undefined) {
      existing.push(annotation);
      continue;
    }

    annotationsByTransactionId.set(annotation.transactionId, [annotation]);
  }

  return annotationsByTransactionId;
}
