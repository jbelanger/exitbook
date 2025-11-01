// Pure utility functions for links run command
// All functions are pure - no side effects

import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for building links run parameters.
 */
export interface LinksRunCommandOptions {
  dryRun?: boolean | undefined;
  minConfidence?: number | undefined;
  autoConfirmThreshold?: number | undefined;
}

/**
 * Links run handler parameters.
 */
export interface LinksRunHandlerParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: Decimal;
}

/**
 * Validate links run parameters.
 * Returns Result<void, Error> to indicate validation success or failure.
 */
export function validateLinksRunParams(params: LinksRunHandlerParams): Result<void, Error> {
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
 * Build links run parameters from CLI flags.
 * Validates inputs and constructs LinksRunHandlerParams.
 */
export function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): Result<LinksRunHandlerParams, Error> {
  const minConfidenceScore = parseDecimal(options.minConfidence?.toString() ?? '0.7');
  const autoConfirmThreshold = parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95');

  const params: LinksRunHandlerParams = {
    dryRun: options.dryRun ?? false,
    minConfidenceScore,
    autoConfirmThreshold,
  };

  // Validate the constructed parameters
  const validation = validateLinksRunParams(params);
  if (validation.isErr()) {
    return err(validation.error);
  }

  return ok(params);
}
