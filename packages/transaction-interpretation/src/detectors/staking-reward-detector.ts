import { err, ok, type Result } from '@exitbook/foundation';

import { computeAnnotationFingerprint, type TransactionAnnotation } from '../annotations/index.js';

import type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './transaction-annotation-detector.js';

const DETECTOR_ID = 'staking-reward';

function buildStakingRewardAnnotation(
  input: DetectorInput,
  movementFingerprint: string
): Result<TransactionAnnotation, Error> {
  const annotationFingerprintResult = computeAnnotationFingerprint({
    kind: 'staking_reward',
    tier: 'asserted',
    txFingerprint: input.txFingerprint,
    target: {
      scope: 'movement',
      movementFingerprint,
    },
  });
  if (annotationFingerprintResult.isErr()) {
    return err(annotationFingerprintResult.error);
  }

  return ok({
    annotationFingerprint: annotationFingerprintResult.value,
    accountId: input.accountId,
    transactionId: input.transactionId,
    txFingerprint: input.txFingerprint,
    kind: 'staking_reward',
    tier: 'asserted',
    target: {
      scope: 'movement',
      movementFingerprint,
    },
    detectorId: DETECTOR_ID,
    derivedFromTxIds: [input.transactionId],
    provenanceInputs: ['movement_role'],
  });
}

function buildStakingRewardAnnotations(input: DetectorInput): Result<readonly TransactionAnnotation[], Error> {
  const inflows = input.transaction.movements.inflows ?? [];
  const annotations: TransactionAnnotation[] = [];

  for (const inflow of inflows) {
    if (inflow.movementRole !== 'staking_reward') {
      continue;
    }

    const annotationResult = buildStakingRewardAnnotation(input, inflow.movementFingerprint);
    if (annotationResult.isErr()) {
      return err(annotationResult.error);
    }

    annotations.push(annotationResult.value);
  }

  return ok(annotations);
}

export class StakingRewardDetector implements ITransactionAnnotationDetector {
  readonly id = DETECTOR_ID;
  readonly kinds = ['staking_reward'] as const;

  async run(input: DetectorInput): Promise<Result<DetectorOutput, Error>> {
    const annotationsResult = buildStakingRewardAnnotations(input);
    if (annotationsResult.isErr()) {
      return err(annotationsResult.error);
    }

    return ok({
      annotations: annotationsResult.value,
    });
  }
}
