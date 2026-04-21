import type { AnnotationKind, AnnotationTier } from '../annotations/annotation-types.js';

/**
 * Annotation read API forces explicit `kinds` and `tiers`. Per the
 * architecture doc § Tier selection is explicit, consumers must never
 * silently include heuristic annotations in tax or readiness paths, so
 * the type system enforces the tier choice here.
 */
export interface TransactionAnnotationQuery {
  accountId?: number | undefined;
  accountIds?: readonly number[] | undefined;
  transactionId?: number | undefined;
  transactionIds?: readonly number[] | undefined;
  kinds: readonly AnnotationKind[];
  tiers: readonly AnnotationTier[];
  protocolRefId?: string | undefined;
  groupKey?: string | undefined;
}
