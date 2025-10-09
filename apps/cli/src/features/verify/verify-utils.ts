// Pure utility functions for verify command
// All functions are pure - no side effects

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for building verify parameters.
 */
export interface VerifyCommandOptions {
  blockchain?: string | undefined;
  exchange?: string | undefined;
  report?: boolean | undefined;
}

/**
 * Verify handler parameters.
 */
export interface VerifyHandlerParams {
  /** Source name (exchange or blockchain) */
  sourceName: string;

  /** Whether to generate a detailed report */
  generateReport: boolean;
}

/**
 * Validate verify parameters .
 * Returns Result<void, Error> to indicate validation success or failure.
 */
export function validateVerifyParams(params: VerifyHandlerParams): Result<void, Error> {
  // Source name is required
  if (!params.sourceName) {
    return err(new Error('Source name is required'));
  }

  return ok();
}

/**
 * Build verify parameters from CLI flags .
 * Validates inputs and constructs VerifyHandlerParams.
 */
export function buildVerifyParamsFromFlags(options: VerifyCommandOptions): Result<VerifyHandlerParams, Error> {
  // Validate source selection
  const sourceName = options.exchange || options.blockchain;
  if (!sourceName) {
    return err(
      new Error('Either --exchange or --blockchain is required. Examples: --exchange kraken, --blockchain bitcoin')
    );
  }

  if (options.exchange && options.blockchain) {
    return err(new Error('Cannot specify both --exchange and --blockchain. Choose one.'));
  }

  return ok({
    sourceName,
    generateReport: options.report || false,
  });
}
