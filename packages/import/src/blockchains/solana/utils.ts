import { Decimal } from 'decimal.js';

/**
 * Solana address validation
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and typically 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number | string): Decimal {
  return new Decimal(lamports).dividedBy(new Decimal(10).pow(9));
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number | string): Decimal {
  return new Decimal(sol).mul(new Decimal(10).pow(9));
}