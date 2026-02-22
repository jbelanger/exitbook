import { isValidSolanaAddress } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

// Solana addresses are case-sensitive base58 — preserve original casing.
export function normalizeSolanaAddress(address: string): Result<string, Error> {
  if (!isValidSolanaAddress(address)) {
    return err(new Error(`Invalid Solana address format: ${address}`));
  }
  return ok(address);
}
