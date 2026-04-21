import type { Result } from '@exitbook/foundation';

import type { DerivedFromTxIds, TransactionAnnotation } from '../annotations/annotation-types.js';

import type { TransactionAnnotationQuery } from './transaction-annotation-query.js';

export interface ReplaceByTransactionInput {
  transactionId: number;
  annotations: readonly TransactionAnnotation[];
}

export interface ReplaceByDetectorInput {
  detectorId: string;
  derivedFromTxIds: DerivedFromTxIds;
  annotations: readonly TransactionAnnotation[];
}

export interface ReplaceByDetectorGroupInput {
  detectorId: string;
  accountId: number;
  groupKey: string;
  annotations: readonly TransactionAnnotation[];
}

/**
 * Store port for persisted transaction annotations. Implementations live in
 * `packages/data`. The contract intentionally exposes three replace-by
 * surfaces because each corresponds to a different invalidation rule in the
 * architecture:
 *
 * - processor-embedded detectors replace by transaction
 * - post-processing detectors replace by (detector_id, derived_from_tx_ids)
 * - group-scoped detectors additionally replace by (detector_id, group_key)
 */
export interface ITransactionAnnotationStore {
  readAnnotations(query: TransactionAnnotationQuery): Promise<Result<readonly TransactionAnnotation[], Error>>;

  replaceForTransaction(input: ReplaceByTransactionInput): Promise<Result<void, Error>>;

  replaceForDetectorInputs(input: ReplaceByDetectorInput): Promise<Result<void, Error>>;

  replaceForDetectorGroup(input: ReplaceByDetectorGroupInput): Promise<Result<void, Error>>;
}
