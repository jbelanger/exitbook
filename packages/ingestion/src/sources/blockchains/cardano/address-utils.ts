import { isValidCardanoAddress, normalizeCardanoAddress as applyNormalization } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

export function normalizeCardanoAddress(address: string): Result<string, Error> {
  const normalized = applyNormalization(address);
  if (!isValidCardanoAddress(normalized)) {
    return err(new Error(`Invalid Cardano address format: ${address}`));
  }
  return ok(normalized);
}
