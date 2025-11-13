import type { CursorState, DataSource } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BlockchainConfig } from '../infrastructure/blockchains/shared/blockchain-config.js';
import type { ImportParams } from '../types/importers.js';

/**
 * Configuration for an import session after preparation
 */
export interface ImportSessionConfig {
  params: ImportParams;
  shouldResume: boolean;
  existingDataSourceId?: number;
}

/**
 * Normalized parameters after address validation
 */
export interface NormalizedBlockchainParams extends ImportParams {
  address: string;
}

/**
 * Check if an existing completed import can be reused.
 * Returns true if there's a completed data source with matching parameters.
 *
 * @param existingSource - Previously completed data source with matching params, or null
 * @param params - Current import parameters (unused in current logic, kept for future extensions)
 * @returns true if the existing import should be reused
 */
export function shouldReuseExistingImport(existingSource: DataSource | undefined, _params: ImportParams): boolean {
  // Currently, we reuse any existing completed import with matching params
  // The repository has already verified the params match
  return existingSource !== undefined;
}

/**
 * Normalize and validate blockchain import parameters.
 * Validates that address is provided and normalizes it using blockchain-specific logic.
 *
 * @param sourceId - Blockchain identifier (e.g., 'bitcoin', 'ethereum')
 * @param params - Import parameters containing the address
 * @param config - Blockchain configuration with normalization logic
 * @returns Normalized parameters with validated address, or error
 */
export function normalizeBlockchainImportParams(
  sourceId: string,
  params: ImportParams,
  config: BlockchainConfig
): Result<NormalizedBlockchainParams, Error> {
  // Validate address is provided
  if (!params.address) {
    return err(new Error(`Address required for blockchain ${sourceId}`));
  }

  // Normalize address using blockchain-specific logic
  const normalizedResult = config.normalizeAddress(params.address);
  if (normalizedResult.isErr()) {
    return err(normalizedResult.error);
  }

  // Return params with normalized address
  return ok({
    ...params,
    address: normalizedResult.value,
  });
}

/**
 * Prepare import session configuration based on existing source and parameters.
 * Determines whether to create a new session or resume an existing one,
 * and what parameters to use (e.g., including cursor for resumption).
 *
 * @param sourceId - Source identifier (blockchain or exchange name)
 * @param params - Import parameters
 * @param existingSource - Previously created data source, or null
 * @param latestCursor - Latest cursor map from existing source, or null
 * @returns Configuration for the import session
 */
export function prepareImportSession(
  sourceId: string,
  params: ImportParams,
  existingSource: DataSource | undefined,
  latestCursor: Record<string, CursorState> | undefined
): ImportSessionConfig {
  // If we have an existing source, resume it
  if (existingSource) {
    const resumeParams = { ...params };

    // Add cursor if available
    if (latestCursor) {
      resumeParams.cursor = latestCursor;
    }

    return {
      params: resumeParams,
      shouldResume: true,
      existingDataSourceId: existingSource.id,
    };
  }

  // No existing source - create new session with original params
  return {
    params,
    shouldResume: false,
  };
}
