import { isValidEvmAddress, normalizeEvmAddress as applyNormalization } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

export function normalizeEvmAddress(address: string, chainName: string): Result<string, Error> {
  const normalized = applyNormalization(address);
  if (!normalized || !isValidEvmAddress(normalized)) {
    return err(new Error(`Invalid EVM address format for ${chainName}: ${address}`));
  }
  return ok(normalized);
}
