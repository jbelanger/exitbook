/**
 * Processed Transaction - Complete financial event with unclassified movements
 *
 * Output from transaction processors before purpose classification.
 * Contains structured movements ready for classifier service.
 */

import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';
import type { ZodError } from 'zod';

import { ValidationFailedError } from '../errors/index.js';
import { ProcessedTransactionSchema } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { MovementUnclassified } from './MovementUnclassified.js';
import type { IsoTimestamp, ExternalId } from './primitives.js';
import type { SourceDetails } from './SourceDetails.js';
import { getSourceExternalId } from './SourceDetails.js';

/**
 * Complete financial event with unclassified movements from processors
 *
 * Key properties:
 * - ID matches upstream transaction identifier (stable)
 * - Timestamp from original transaction (not processing time)
 * - Source tracks origin (exchange/blockchain)
 * - Movements are unclassified (purpose determined later)
 */
export interface ProcessedTransaction {
  readonly id: ExternalId; // Stable upstream identifier
  readonly movements: MovementUnclassified[]; // Processors emit UNCLASSIFIED only
  readonly source: SourceDetails; // Origin tracking
  readonly timestamp: IsoTimestamp; // Transaction occurrence time
}

/**
 * Get transaction summary for logging/debugging
 */
export function getTransactionSummary(transaction: ProcessedTransaction): Result<
  {
    externalId: string;
    id: string;
    movementCount: number;
    source: string;
    timestamp: string;
  },
  ValidationFailedError
> {
  const externalIdResult = getSourceExternalId(transaction.source);

  if (externalIdResult.isErr()) {
    return err(
      new ValidationFailedError([
        {
          message: 'Failed to get external ID from transaction source',
          rule: 'transaction-summary',
        },
      ])
    );
  }

  return ok({
    externalId: externalIdResult.value,
    id: transaction.id,
    movementCount: transaction.movements.length,
    source: `${transaction.source.kind}:${transaction.source.kind === 'exchange' ? transaction.source.venue : transaction.source.chain}`,
    timestamp: transaction.timestamp,
  });
}

/**
 * Filter movements by direction
 */
export function getInboundMovements(transaction: ProcessedTransaction): MovementUnclassified[] {
  return transaction.movements.filter((m) => m.direction === 'IN');
}

export function getOutboundMovements(transaction: ProcessedTransaction): MovementUnclassified[] {
  return transaction.movements.filter((m) => m.direction === 'OUT');
}

/**
 * Get movements with hints
 */
export function getMovementsWithHints(transaction: ProcessedTransaction): MovementUnclassified[] {
  return transaction.movements.filter((m) => m.hint !== undefined);
}

/**
 * Create processed transaction with validation using Zod schema
 */
export function createProcessedTransaction(
  id: ExternalId,
  timestamp: IsoTimestamp,
  source: SourceDetails,
  movements: MovementUnclassified[]
): Result<ProcessedTransaction, ZodError> {
  const transaction: ProcessedTransaction = {
    id: id.trim(),
    movements,
    source,
    timestamp: timestamp.trim(),
  };

  return fromZod(ProcessedTransactionSchema, transaction);
}

/**
 * Validate that transaction has movements
 */
export function validateTransactionHasMovements(
  transaction: ProcessedTransaction
): Result<void, ValidationFailedError> {
  if (!transaction.movements || transaction.movements.length === 0) {
    return err(
      new ValidationFailedError(
        [
          {
            message: 'Transaction must have at least one movement',
            rule: 'transaction-has-movements',
          },
        ],
        { transactionId: transaction.id }
      )
    );
  }
  return ok();
}

/**
 * Validate that all movement amounts are valid decimal strings
 */
export function validateMovementAmounts(transaction: ProcessedTransaction): Result<void, ValidationFailedError> {
  const invalidMovements: string[] = [];
  const decimalRegex = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

  for (const movement of transaction.movements) {
    const amount = movement.money.amount;
    if (!decimalRegex.test(amount) || amount === '0') {
      invalidMovements.push(movement.id);
    }
  }

  if (invalidMovements.length > 0) {
    return err(
      new ValidationFailedError(
        [
          {
            message: 'Invalid movement amounts. Must be positive DecimalString with max 18 decimal places',
            rule: 'valid-movement-amounts',
            violations: invalidMovements,
          },
        ],
        { transactionId: transaction.id }
      )
    );
  }

  return ok();
}

/**
 * Validate that transaction source is supported for MVP
 */
export function validateSupportedSource(source: SourceDetails): Result<void, ValidationFailedError> {
  if (source.kind === 'exchange' && source.venue !== 'kraken') {
    return err(
      new ValidationFailedError([
        {
          message: `Unsupported exchange venue: ${source.venue}. MVP only supports: kraken`,
          rule: 'supported-source',
        },
      ])
    );
  }

  if (source.kind === 'blockchain' && source.chain !== 'ethereum') {
    return err(
      new ValidationFailedError([
        {
          message: `Unsupported blockchain: ${source.chain}. MVP only supports: ethereum`,
          rule: 'supported-source',
        },
      ])
    );
  }

  return ok();
}
