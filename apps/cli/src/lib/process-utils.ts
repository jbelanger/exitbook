// Pure utility functions for process command
// All functions are pure - no side effects

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for building process parameters.
 */
export interface ProcessCommandOptions {
  all?: boolean | undefined;
  blockchain?: string | undefined;
  exchange?: string | undefined;
  session?: string | undefined;
  since?: string | undefined;
}

/**
 * Process handler parameters.
 */
export interface ProcessHandlerParams {
  /** Source name (exchange or blockchain) */
  sourceName: string;

  /** Source type */
  sourceType: 'exchange' | 'blockchain';

  /** Filters for processing */
  filters: {
    createdAfter?: number | undefined;
    importSessionId?: number | undefined;
  };
}

/**
 * Validate process parameters .
 * Returns Result<void, Error> to indicate validation success or failure.
 */
export function validateProcessParams(params: ProcessHandlerParams): Result<void, Error> {
  // Source name is required
  if (!params.sourceName) {
    return err(new Error('Source name is required'));
  }

  // Source type must be valid
  if (params.sourceType !== 'exchange' && params.sourceType !== 'blockchain') {
    return err(new Error('Source type must be either "exchange" or "blockchain"'));
  }

  return ok();
}

/**
 * Parse timestamp from string .
 * Supports both ISO date strings and Unix timestamps.
 */
export function parseTimestamp(value: string): Result<number, Error> {
  // Empty string check
  if (!value || value.trim() === '') {
    return err(new Error(`Invalid date format: ${value}. Use YYYY-MM-DD or Unix timestamp`));
  }

  // Try parsing as number first (Unix timestamp)
  const asNumber = Number(value);
  if (!isNaN(asNumber)) {
    return ok(Math.floor(asNumber / 1000)); // Convert to seconds
  }

  // Try parsing as date string
  const timestamp = new Date(value).getTime();
  if (isNaN(timestamp)) {
    return err(new Error(`Invalid date format: ${value}. Use YYYY-MM-DD or Unix timestamp`));
  }

  return ok(Math.floor(timestamp / 1000)); // Convert to seconds
}

/**
 * Build process parameters from CLI flags .
 * Validates inputs and constructs ProcessHandlerParams.
 */
export function buildProcessParamsFromFlags(options: ProcessCommandOptions): Result<ProcessHandlerParams, Error> {
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

  const sourceType: 'exchange' | 'blockchain' = options.exchange ? 'exchange' : 'blockchain';

  // Build filters
  const filters: { createdAfter?: number; importSessionId?: number } = {};

  // Parse session ID if provided
  if (options.session) {
    const sessionId = parseInt(options.session, 10);
    if (isNaN(sessionId) || sessionId <= 0) {
      return err(new Error('Invalid session ID. Must be a positive integer.'));
    }
    filters.importSessionId = sessionId;
  }

  // Parse since timestamp if provided
  if (options.since) {
    const timestampResult = parseTimestamp(options.since);
    if (timestampResult.isErr()) {
      return err(timestampResult.error);
    }
    filters.createdAfter = timestampResult.value;
  }

  return ok({
    sourceName,
    sourceType,
    filters,
  });
}
