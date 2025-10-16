// Pure utility functions for link command
// All functions are pure - no side effects

import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for building link parameters.
 */
export interface LinkCommandOptions {
  dryRun?: boolean | undefined;
  minConfidence?: number | undefined;
  autoConfirmThreshold?: number | undefined;
}

/**
 * Link handler parameters.
 */
export interface LinkHandlerParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: Decimal;
}

/**
 * Validate link parameters.
 * Returns Result<void, Error> to indicate validation success or failure.
 */
export function validateLinkParams(params: LinkHandlerParams): Result<void, Error> {
  // Validate min confidence score
  if (params.minConfidenceScore.lessThan(0) || params.minConfidenceScore.greaterThan(1)) {
    return err(new Error('minConfidenceScore must be between 0 and 1'));
  }

  // Validate auto-confirm threshold
  if (params.autoConfirmThreshold.lessThan(0) || params.autoConfirmThreshold.greaterThan(1)) {
    return err(new Error('autoConfirmThreshold must be between 0 and 1'));
  }

  // Auto-confirm threshold should be >= min confidence
  if (params.autoConfirmThreshold.lessThan(params.minConfidenceScore)) {
    return err(new Error('autoConfirmThreshold must be >= minConfidenceScore'));
  }

  return ok();
}

/**
 * Build link parameters from CLI flags.
 * Validates inputs and constructs LinkHandlerParams.
 */
export function buildLinkParamsFromFlags(options: LinkCommandOptions): Result<LinkHandlerParams, Error> {
  const minConfidenceScore = new Decimal(options.minConfidence ?? 0.7);
  const autoConfirmThreshold = new Decimal(options.autoConfirmThreshold ?? 0.95);

  const params: LinkHandlerParams = {
    dryRun: options.dryRun ?? false,
    minConfidenceScore,
    autoConfirmThreshold,
  };

  // Validate the constructed parameters
  const validation = validateLinkParams(params);
  if (validation.isErr()) {
    return err(validation.error);
  }

  return ok(params);
}
