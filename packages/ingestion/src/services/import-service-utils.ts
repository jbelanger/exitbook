import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BlockchainAdapter } from '../infrastructure/blockchains/shared/blockchain-adapter.ts';
import type { ImportParams } from '../types/importers.js';

/**
 * Normalized parameters after address validation
 */
export interface NormalizedBlockchainParams extends ImportParams {
  address: string;
}

/**
 * Normalize and validate blockchain import parameters.
 * Validates that address is provided and normalizes it using blockchain-specific logic.
 *
 * @param sourceName - Blockchain identifier (e.g., 'bitcoin', 'ethereum')
 * @param params - Import parameters containing the address
 * @param adapter - Blockchain adapter with normalization logic
 * @returns Normalized parameters with validated address, or error
 */
export function normalizeBlockchainImportParams(
  sourceName: string,
  params: ImportParams,
  adapter: BlockchainAdapter
): Result<NormalizedBlockchainParams, Error> {
  // Validate address is provided
  if (!params.address) {
    return err(new Error(`Address required for blockchain ${sourceName}`));
  }

  // Normalize address using blockchain-specific logic
  const normalizedResult = adapter.normalizeAddress(params.address);
  if (normalizedResult.isErr()) {
    return err(normalizedResult.error);
  }

  // Return params with normalized address
  return ok({
    ...params,
    address: normalizedResult.value,
  });
}
