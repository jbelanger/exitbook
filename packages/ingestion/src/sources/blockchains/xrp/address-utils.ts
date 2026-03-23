import { isValidXrpAddress, normalizeXrpAddress as applyNormalization } from '@exitbook/blockchain-providers/xrp';
import { err, ok, type Result } from '@exitbook/foundation';

export function normalizeXrpAddress(address: string): Result<string, Error> {
  const normalized = applyNormalization(address);
  if (!isValidXrpAddress(normalized)) {
    return err(new Error(`Invalid XRP address format: ${address}`));
  }
  return ok(normalized);
}
