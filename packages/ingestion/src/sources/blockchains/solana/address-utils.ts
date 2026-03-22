import { isValidSolanaAddress } from '@exitbook/blockchain-providers/solana';
import { err, ok, type Result } from '@exitbook/core';

// Solana addresses are case-sensitive base58 — preserve original casing.
export function normalizeSolanaAddress(address: string): Result<string, Error> {
  if (!isValidSolanaAddress(address)) {
    return err(new Error(`Invalid Solana address format: ${address}`));
  }
  return ok(address);
}
