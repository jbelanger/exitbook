import {
  isValidCardanoAddress,
  normalizeCardanoAddress as applyNormalization,
} from '@exitbook/blockchain-providers/cardano';
import { err, ok, type Result } from '@exitbook/foundation';

export function normalizeCardanoAddress(address: string): Result<string, Error> {
  const normalized = applyNormalization(address);
  if (!isValidCardanoAddress(normalized)) {
    return err(new Error(`Invalid Cardano address format: ${address}`));
  }
  return ok(normalized);
}
