/**
 * Classification Info for Movement Purpose Classification
 *
 * Metadata about how a movement's purpose was determined by the classifier.
 * Used for audit trails, debugging, and future rule improvements.
 */

import type { Result } from 'neverthrow';
import type { ZodError } from 'zod';

import { ClassificationInfoSchema } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { IsoTimestamp, MovementPurpose, RuleId, RuleVersion, Confidence } from './primitives.js';

/**
 * Classification metadata attached to classified movements
 *
 * Contains diagnostic information about how the purpose was determined:
 * - Purpose: The assigned business purpose (PRINCIPAL/FEE/GAS)
 * - Rule tracking: Which rule determined classification
 * - Diagnostics: Confidence and reasoning for human review
 * - Versioning: Rule version for historical consistency
 */
export interface ClassificationInfo {
  readonly classifiedAt: IsoTimestamp; // When classification occurred
  readonly confidence: Confidence; // 0..1 confidence score (diagnostic only in MVP)
  readonly purpose: MovementPurpose;
  readonly reason: string; // Brief human-readable explanation
  readonly ruleId: RuleId; // e.g., "exchange.kraken.trade.v1", "chain.eth.transfer.gas.v1"
  readonly version: RuleVersion; // Classifier ruleset version (semver)
}

/**
 * Create classification info with validation using Zod schema
 */
export function createClassificationInfo(
  purpose: MovementPurpose,
  ruleId: RuleId,
  reason: string,
  version: RuleVersion,
  confidence: Confidence,
  now: () => string = () => new Date().toISOString()
): Result<ClassificationInfo, ZodError> {
  const classificationInfo: ClassificationInfo = {
    classifiedAt: now(),
    confidence,
    purpose,
    reason: reason.trim(),
    ruleId: ruleId.trim(),
    version: version.trim(),
  };

  return fromZod(ClassificationInfoSchema, classificationInfo);
}
