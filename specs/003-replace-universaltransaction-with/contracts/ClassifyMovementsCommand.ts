import { Result } from 'neverthrow';
import { ProcessedTransaction } from '../types/ProcessedTransaction';
import { ClassifiedTransaction } from '../types/ClassifiedTransaction';
import { ClassificationError } from './DomainError';
import { BaseEventMetadata, createEventMetadata } from './EventMetadata';

/**
 * Command: Classify Transaction Movements by Purpose
 *
 * Purpose: Apply purpose classification rules to unclassified movements in a
 * ProcessedTransaction, producing ClassifiedTransaction with PRINCIPAL/FEE/GAS assignments.
 */
export interface ClassifyMovementsCommand {
  readonly transaction: ProcessedTransaction;
  readonly rulesetVersion?: string; // Optional: specify classifier version
  readonly requestId: string; // For idempotency (enforced by infra layer)
}

/**
 * Command Handler Interface
 *
 * Note: Idempotency is enforced by infrastructure layer, not individual handlers.
 * Handlers can assume requestId uniqueness is already validated.
 */
export interface ClassifyMovementsCommandHandler {
  /**
   * Execute movement classification
   *
   * Input Parameters:
   * - command: ClassifyMovementsCommand with ProcessedTransaction
   *
   * Validation Rules:
   * - Transaction must have at least one unclassified movement
   * - All movements must have valid Money amounts (positive DecimalStrings)
   * - Transaction source must be supported ('kraken' exchange or 'ethereum' blockchain)
   * - RequestId uniqueness enforced by infrastructure layer
   *
   * Business Rules:
   * - Classification must be deterministic (same input = same output)
   * - All movements must match at least one classification rule
   * - Only three purposes allowed: PRINCIPAL, FEE, GAS
   * - Classified movements must pass balance validation rules
   * - FEE and GAS movements must have direction 'OUT'
   * - PRINCIPAL movements must balance correctly for trades/transfers
   *
   * Events Produced:
   * - MovementsClassifiedEvent: On successful classification
   * - ClassificationFailedEvent: On rule matching failure or validation error
   */
  execute(command: ClassifyMovementsCommand): Promise<Result<ClassifiedTransaction, ClassificationError>>;
}

/**
 * Events produced by command execution
 */
export interface MovementsClassifiedEvent extends BaseEventMetadata {
  readonly type: 'MovementsClassified';
  readonly classificationResults: Array<{
    readonly movementId: string;
    readonly purpose: 'PRINCIPAL' | 'FEE' | 'GAS';
    readonly ruleId: string;
    readonly diagnostics: {
      readonly confidence: number; // DIAGNOSTIC ONLY - no business logic branching in MVP
    };
  }>;
  readonly rulesetVersion: string;
}

export interface ClassificationFailedEvent extends BaseEventMetadata {
  readonly type: 'ClassificationFailed';
  readonly failedMovements: string[];
  readonly reason: string;
}

/**
 * Helper to create classification events with consistent metadata
 */
export function createClassificationEvents(
  command: ClassifyMovementsCommand,
  result: Result<ClassifiedTransaction, ClassificationError>
): MovementsClassifiedEvent | ClassificationFailedEvent {
  const baseMetadata = createEventMetadata({
    requestId: command.requestId,
    transactionId: command.transaction.id,
  });

  if (result.isOk()) {
    const classified = result.value;
    return {
      ...baseMetadata,
      type: 'MovementsClassified',
      classificationResults: classified.movements.map((movement: any) => ({
        movementId: movement.id,
        purpose: movement.classification.purpose,
        ruleId: movement.classification.ruleId,
        diagnostics: {
          confidence: movement.classification.confidence,
        },
      })),
      rulesetVersion: classified.purposeRulesetVersion,
    };
  } else {
    return {
      ...baseMetadata,
      type: 'ClassificationFailed',
      failedMovements: result.error.failedMovements,
      reason: result.error.message,
    };
  }
}
