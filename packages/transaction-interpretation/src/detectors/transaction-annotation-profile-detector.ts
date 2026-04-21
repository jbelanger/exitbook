import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { TransactionAnnotation } from '../annotations/annotation-types.js';
import type { InterpretationAccountContext } from '../runtime/transaction-interpretation-source-reader.js';

import type { DetectorOutput } from './transaction-annotation-detector.js';

export interface ProfileDetectorInput {
  accounts: readonly InterpretationAccountContext[];
  profileId: number;
  transactions: readonly Transaction[];
}

export interface ITransactionAnnotationProfileDetector {
  readonly id: string;
  readonly kinds: readonly TransactionAnnotation['kind'][];
  run(input: ProfileDetectorInput): Promise<Result<DetectorOutput, Error>>;
}
