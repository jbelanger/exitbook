import type { ClassifiedTransaction, ClassificationError } from '@crypto/core';

import type {
  MovementsClassifiedEvent,
  ClassificationFailedEvent,
} from '../../../domain/events/classification-events.ts';

import type { ClassifyMovementsCommand } from './classify-movements-command.ts';

/**
 * Create MovementsClassifiedEvent
 */
export function createMovementsClassifiedEvent(
  command: ClassifyMovementsCommand,
  transaction: ClassifiedTransaction
): MovementsClassifiedEvent {
  return {
    classificationResults: transaction.movements.map((movement) => ({
      diagnostics: {
        confidence: movement.classification.confidence,
      },
      movementId: movement.id,
      purpose: movement.classification.purpose,
      ruleId: movement.classification.ruleId,
    })),
    requestId: command.requestId,
    rulesetVersion: transaction.purposeRulesetVersion,
    timestamp: new Date().toISOString(),
    transactionId: transaction.id,
    type: 'MovementsClassified',
  };
}

/**
 * Create ClassificationFailedEvent
 */
export function createClassificationFailedEvent(
  command: ClassifyMovementsCommand,
  error: ClassificationError
): ClassificationFailedEvent {
  return {
    failedMovements: error.failedMovements,
    reason: error.message,
    requestId: command.requestId,
    timestamp: new Date().toISOString(),
    transactionId: command.transaction.id,
    type: 'ClassificationFailed',
  };
}
