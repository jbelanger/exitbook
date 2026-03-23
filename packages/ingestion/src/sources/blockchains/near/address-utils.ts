import { isValidNearAccountId } from '@exitbook/blockchain-providers/near';
import { err, ok, type Result } from '@exitbook/foundation';

// NEAR accounts are case-sensitive — preserve original casing.
export function normalizeNearAddress(address: string): Result<string, Error> {
  if (!isValidNearAccountId(address)) {
    return err(new Error(`Invalid NEAR account ID format: ${address}`));
  }
  return ok(address);
}
