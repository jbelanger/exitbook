import { isValidSS58Address } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

// Substrate SS58 addresses are case-sensitive — preserve original casing.
export function normalizeSubstrateAddress(address: string, chainName: string): Result<string, Error> {
  if (!isValidSS58Address(address)) {
    return err(new Error(`Invalid Substrate address format for ${chainName}: ${address}`));
  }
  return ok(address);
}
