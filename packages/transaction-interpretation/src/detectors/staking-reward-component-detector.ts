import { getUnattributedStakingRewardComponents, type UnattributedStakingRewardComponent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import { computeAnnotationFingerprint, type TransactionAnnotation } from '../annotations/index.js';

import type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './transaction-annotation-detector.js';

const DETECTOR_ID = 'staking-reward-component';

function buildStakingRewardComponentAnnotation(
  input: DetectorInput,
  component: UnattributedStakingRewardComponent
): Result<TransactionAnnotation, Error> {
  const metadata = {
    amount: component.amount.toFixed(),
    assetSymbol: component.assetSymbol,
    componentKey: component.componentKey,
  };
  const annotationFingerprintResult = computeAnnotationFingerprint({
    kind: 'staking_reward_component',
    tier: 'asserted',
    txFingerprint: input.txFingerprint,
    target: {
      scope: 'transaction',
    },
    metadata,
  });
  if (annotationFingerprintResult.isErr()) {
    return err(annotationFingerprintResult.error);
  }

  return ok({
    annotationFingerprint: annotationFingerprintResult.value,
    accountId: input.accountId,
    transactionId: input.transactionId,
    txFingerprint: input.txFingerprint,
    kind: 'staking_reward_component',
    tier: 'asserted',
    target: {
      scope: 'transaction',
    },
    detectorId: DETECTOR_ID,
    derivedFromTxIds: [input.transactionId],
    provenanceInputs: ['diagnostic'],
    metadata,
  });
}

function buildStakingRewardComponentAnnotations(input: DetectorInput): Result<readonly TransactionAnnotation[], Error> {
  const uniqueComponents = new Map<string, UnattributedStakingRewardComponent>();

  for (const component of getUnattributedStakingRewardComponents(input.transaction.diagnostics)) {
    if (!uniqueComponents.has(component.componentKey)) {
      uniqueComponents.set(component.componentKey, component);
    }
  }

  const annotations: TransactionAnnotation[] = [];
  for (const component of uniqueComponents.values()) {
    const annotationResult = buildStakingRewardComponentAnnotation(input, component);
    if (annotationResult.isErr()) {
      return err(annotationResult.error);
    }

    annotations.push(annotationResult.value);
  }

  return ok(annotations);
}

export class StakingRewardComponentDetector implements ITransactionAnnotationDetector {
  readonly id = DETECTOR_ID;
  readonly kinds = ['staking_reward_component'] as const;

  async run(input: DetectorInput): Promise<Result<DetectorOutput, Error>> {
    const annotationsResult = buildStakingRewardComponentAnnotations(input);
    if (annotationsResult.isErr()) {
      return err(annotationsResult.error);
    }

    return ok({
      annotations: annotationsResult.value,
    });
  }
}
