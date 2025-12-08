// Pure utility functions for links run command
// All functions are pure - no side effects

import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { z } from 'zod';

import type { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

/**
 * CLI options validated by Zod at CLI boundary
 */
export type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

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
 * Build links run parameters from validated CLI options.
 * No validation needed - options are already validated by Zod schema.
 */
export function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): Result<LinksRunHandlerParams, Error> {
  const minConfidenceScore = parseDecimal(options.minConfidence?.toString() ?? '0.7');
  const autoConfirmThreshold = parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95');

  const params: LinksRunHandlerParams = {
    dryRun: options.dryRun ?? false,
    minConfidenceScore,
    autoConfirmThreshold,
  };

  return ok(params);
}
