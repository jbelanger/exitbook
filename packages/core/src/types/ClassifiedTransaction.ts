/**
 * Classified Transaction - Result of running classifier on ProcessedTransaction
 *
 * Contains all movements with purpose assignments (PRINCIPAL/FEE/GAS).
 * Ready for validation and storage.
 */

import type { Result } from 'neverthrow';
import { err } from 'neverthrow';
import type { ZodError } from 'zod';

import { ValidationFailedError } from '../errors/index.js';
import { ClassifiedTransactionSchema } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { MovementClassified } from './MovementClassified.js';
import { groupMovementsByPurpose } from './MovementClassified.js';
import type { RulesetVersion } from './primitives.js';
import type { ProcessedTransaction } from './ProcessedTransaction.js';

/**
 * Result of running classifier on ProcessedTransaction
 *
 * Contains:
 * - All original transaction metadata
 * - Movements with purpose classification
 * - Ruleset version for historical tracking
 */
export interface ClassifiedTransaction extends Omit<ProcessedTransaction, 'movements'> {
  readonly movements: MovementClassified[];
  readonly purposeRulesetVersion: RulesetVersion;
}

/**
 * Get classification summary for debugging/logging
 */
export function getClassificationSummary(transaction: ClassifiedTransaction): {
  averageConfidence: number;
  feeCount: number;
  gasCount: number;
  id: string;
  principalCount: number;
  rulesetVersion: string;
  totalMovements: number;
} {
  const { fees, gas, principals } = groupMovementsByPurpose(transaction.movements);

  const totalConfidence = transaction.movements.reduce((sum, m) => sum + m.classification.confidence, 0);
  const averageConfidence = transaction.movements.length > 0 ? totalConfidence / transaction.movements.length : 0;

  return {
    averageConfidence: Math.round(averageConfidence * 1000) / 1000, // 3 decimal places
    feeCount: fees.length,
    gasCount: gas.length,
    id: transaction.id,
    principalCount: principals.length,
    rulesetVersion: transaction.purposeRulesetVersion,
    totalMovements: transaction.movements.length,
  };
}

/**
 * Check if transaction is a trade (multiple principal currencies)
 */
export function isTradeTransaction(transaction: ClassifiedTransaction): boolean {
  const { principals } = groupMovementsByPurpose(transaction.movements);
  const currencies = new Set(principals.map((m) => m.money.currency));
  return currencies.size >= 2;
}

/**
 * Check if transaction is a transfer (single principal currency)
 */
export function isTransferTransaction(transaction: ClassifiedTransaction): boolean {
  const { principals } = groupMovementsByPurpose(transaction.movements);
  const currencies = new Set(principals.map((m) => m.money.currency));
  return currencies.size === 1;
}

/**
 * Get movements by classification rule
 */
export function getMovementsByRule(transaction: ClassifiedTransaction, ruleId: string): MovementClassified[] {
  return transaction.movements.filter((m) => m.classification.ruleId === ruleId);
}

/**
 * Create classified transaction from processed transaction using Zod schema
 */
export function createClassifiedTransaction(
  processedTransaction: ProcessedTransaction,
  classifiedMovements: MovementClassified[],
  purposeRulesetVersion: RulesetVersion
): Result<ClassifiedTransaction, ValidationFailedError | ZodError> {
  if (processedTransaction.movements.length !== classifiedMovements.length) {
    return err(
      new ValidationFailedError([
        {
          message: `Movement count mismatch: processed=${processedTransaction.movements.length}, classified=${classifiedMovements.length}`,
          rule: 'movement-count-match',
        },
      ])
    );
  }

  const transaction: ClassifiedTransaction = {
    id: processedTransaction.id,
    movements: classifiedMovements,
    purposeRulesetVersion: purposeRulesetVersion.trim(),
    source: processedTransaction.source,
    timestamp: processedTransaction.timestamp,
  };

  return fromZod(ClassifiedTransactionSchema, transaction);
}
