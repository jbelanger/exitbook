import { validateBech32Address } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

// Cosmos bech32 addresses are case-insensitive; canonical form is lowercase.
export function normalizeCosmosAddress(address: string, chainName: string): Result<string, Error> {
  const normalized = address.toLowerCase();
  if (!validateBech32Address(normalized)) {
    return err(new Error(`Invalid Cosmos address format for ${chainName}: ${address}`));
  }
  return ok(normalized);
}
