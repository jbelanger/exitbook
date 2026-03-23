import { isValidEvmAddress, normalizeEvmAddress as applyNormalization } from '@exitbook/blockchain-providers/evm';
import { err, ok, type Result } from '@exitbook/foundation';

export function normalizeThetaAddress(address: string): Result<string, Error> {
  const normalized = applyNormalization(address);
  if (!normalized || !isValidEvmAddress(normalized)) {
    return err(new Error(`Invalid Theta address format: ${address}`));
  }

  return ok(normalized);
}
