/**
 * Movement Classified - Individual money flow with purpose classification
 *
 * Result of running classifier on MovementUnclassified.
 * Contains original movement data plus classification metadata.
 */

import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';
import type { ZodError } from 'zod';

import { ValidationFailedError } from '../errors/index.js';
import { MovementClassifiedSchema } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { ClassificationInfo } from './ClassificationInfo.js';
import type { MovementUnclassified } from './MovementUnclassified.js';

/**
 * Movement after purpose classification by classifier service
 *
 * Extends unclassified movement with:
 * - Classification metadata (purpose, rule, confidence)
 * - Removes hint (no longer needed after classification)
 * - Preserves all original movement properties
 */
export interface MovementClassified extends Omit<MovementUnclassified, 'hint'> {
  readonly classification: ClassificationInfo;
}

/**
 * Type guards for classified movements by purpose
 */
export function isPrincipalMovement(movement: MovementClassified): boolean {
  return movement.classification.purpose === 'PRINCIPAL';
}

export function isFeeMovement(movement: MovementClassified): boolean {
  return movement.classification.purpose === 'FEE';
}

export function isGasMovement(movement: MovementClassified): boolean {
  return movement.classification.purpose === 'GAS';
}

/**
 * Group classified movements by purpose
 */
export function groupMovementsByPurpose(movements: MovementClassified[]): {
  fees: MovementClassified[];
  gas: MovementClassified[];
  principals: MovementClassified[];
} {
  return {
    fees: movements.filter(isFeeMovement),
    gas: movements.filter(isGasMovement),
    principals: movements.filter(isPrincipalMovement),
  };
}

/**
 * Get movements with specific confidence threshold
 */
export function getHighConfidenceMovements(movements: MovementClassified[], threshold = 0.8): MovementClassified[] {
  return movements.filter((m) => m.classification.confidence >= threshold);
}

/**
 * Create classified movement from unclassified movement and classification
 */
export function createMovementClassified(
  unclassified: MovementUnclassified,
  classification: ClassificationInfo
): MovementClassified {
  const { hint, ...movementWithoutHint } = unclassified;

  return {
    ...movementWithoutHint,
    classification,
  };
}

/**
 * Validate that classified movement follows business rules with Zod schema validation first
 */
export function validateClassifiedMovement(
  movement: MovementClassified
): Result<MovementClassified, ValidationFailedError | ZodError> {
  // First validate structure with Zod schema
  const structuralValidation = fromZod(MovementClassifiedSchema, movement);
  if (structuralValidation.isErr()) {
    return structuralValidation;
  }

  // Then validate business rules
  const violationMessages: string[] = [];

  // Rule: FEE and GAS movements must be OUT direction
  if (movement.classification.purpose === 'FEE' || movement.classification.purpose === 'GAS') {
    if (movement.direction !== 'OUT') {
      violationMessages.push(
        `Movement ${movement.id} has purpose ${movement.classification.purpose} but direction ${movement.direction}. Must be OUT.`
      );
    }
  }

  if (violationMessages.length > 0) {
    const violations = [
      { message: 'Movement validation failed', rule: 'classified-movement-rules', violations: violationMessages },
    ];
    return err(new ValidationFailedError(violations, { additionalContext: { movementId: movement.id } }));
  }

  return ok(movement);
}

/**
 * Validate all movements in a classified transaction
 */
export function validateAllClassifiedMovements(
  movements: MovementClassified[]
): Result<MovementClassified[], ValidationFailedError> {
  const invalidMovements: string[] = [];
  const violationMessages: string[] = [];

  for (const movement of movements) {
    const validationResult = validateClassifiedMovement(movement);
    if (validationResult.isErr()) {
      invalidMovements.push(movement.id);
      if (validationResult.error instanceof ValidationFailedError) {
        violationMessages.push(`Movement ${movement.id}: ${validationResult.error.message}`);
      } else {
        violationMessages.push(`Movement ${movement.id}: Schema validation failed`);
      }
    }
  }

  if (invalidMovements.length > 0) {
    const violations = [
      {
        message: `Movement validation failed: ${violationMessages.join('; ')}`,
        rule: 'all-classified-movements',
        violations: invalidMovements,
      },
    ];
    return err(new ValidationFailedError(violations));
  }

  return ok(movements);
}
