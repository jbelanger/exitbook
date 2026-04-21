import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { TransactionAnnotation } from '../annotations/annotation-types.js';

export interface DetectorInput {
  accountId: number;
  transactionId: number;
  txFingerprint: string;
  transaction: Transaction;
}

/**
 * Detector output is the set of annotations a detector would like to persist
 * for the current input. The runtime, not the detector, handles replacement
 * semantics (per architecture § Invalidation and replacement).
 */
export interface DetectorOutput {
  annotations: readonly TransactionAnnotation[];
}

export interface ITransactionAnnotationDetector {
  readonly id: string;
  readonly kinds: readonly TransactionAnnotation['kind'][];
  run(input: DetectorInput): Promise<Result<DetectorOutput, Error>>;
}
