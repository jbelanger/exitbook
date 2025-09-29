/**
 * Movement Unclassified - Individual money flow without purpose classification
 *
 * Emitted by transaction processors before purpose classification.
 * Represents raw money movement with optional hints for the classifier.
 */

import type { Result } from 'neverthrow';
import type { ZodError } from 'zod';

import { MovementUnclassifiedSchema } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { Money2 } from './Money.js';
import type { MovementId, MovementDirection, MovementHint, MovementSequence } from './primitives.js';

/**
 * Individual money movement before purpose classification
 *
 * Key properties:
 * - Money amount is always positive (direction handles flow)
 * - Direction indicates flow relative to user (IN = received, OUT = sent)
 * - Hint provides optional guidance to classifier (FEE, GAS)
 * - Sequence maintains ordering within transaction
 * - Metadata allows processor-specific additional context
 */
export interface MovementUnclassified {
  readonly direction: MovementDirection; // IN to user, OUT from user
  readonly hint?: MovementHint | undefined; // Optional hint for classifier (FEE, GAS)
  readonly id: MovementId;
  readonly metadata?: Record<string, unknown> | undefined; // Additional context
  readonly money: Money2; // Amount is always positive
  readonly sequence?: MovementSequence | undefined; // Order within transaction
}

/**
 * Type guards for movement direction and hints
 */
export function isInboundMovement(movement: MovementUnclassified): boolean {
  return movement.direction === 'IN';
}

export function isOutboundMovement(movement: MovementUnclassified): boolean {
  return movement.direction === 'OUT';
}

export function hasFeeHint(movement: MovementUnclassified): boolean {
  return movement.hint === 'FEE';
}

export function hasGasHint(movement: MovementUnclassified): boolean {
  return movement.hint === 'GAS';
}

/**
 * Create movement with validation using Zod schema
 */
export function createMovementUnclassified(
  id: MovementId,
  money: Money2,
  direction: MovementDirection,
  options: {
    hint?: MovementHint;
    metadata?: Record<string, unknown>;
    sequence?: MovementSequence;
  } = {}
): Result<MovementUnclassified, ZodError> {
  const movement: MovementUnclassified = {
    direction,
    hint: options.hint,
    id: id.trim(),
    metadata: options.metadata,
    money,
    sequence: options.sequence,
  };

  return fromZod(MovementUnclassifiedSchema, movement);
}
