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

/**
 * Parse Solana transaction type from instructions
 */
export function parseSolanaTransactionType(
  instructions: unknown[],
  userAddress: string,
  preBalances: number[],
  postBalances: number[],
  accountKeys: string[]
): 'transfer_in' | 'transfer_out' | 'swap' | 'stake' | 'unstake' | 'other' {
  // Find user's account index
  const userIndex = accountKeys.findIndex((key) => key === userAddress);
  if (userIndex === -1) return 'other';

  const preBalance = preBalances[userIndex] || 0;
  const postBalance = postBalances[userIndex] || 0;
  const balanceChange = postBalance - preBalance;

  // Check for system program transfers (most common)
  const hasSystemTransfer = instructions.some((ix) => {
    const instruction = ix as { program?: string; programId?: string };
    return instruction.program === 'system' || instruction.programId === '11111111111111111111111111111112';
  });

  if (hasSystemTransfer) {
    // Positive balance change = receiving SOL
    // Negative balance change = sending SOL
    return balanceChange > 0 ? 'transfer_in' : 'transfer_out';
  }

  // Check for token program instructions
  const hasTokenProgram = instructions.some((ix) => {
    const instruction = ix as { program?: string; programId?: string };
    return (
      instruction.program === 'spl-token' || instruction.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    );
  });

  if (hasTokenProgram) {
    return 'swap'; // Most token operations are swaps/trades
  }

  // Check for staking programs
  const hasStakeProgram = instructions.some((ix) => {
    const instruction = ix as { program?: string; programId?: string };
    return instruction.program === 'stake' || instruction.programId === 'Stake11111111111111111111111111111111111111';
  });

  if (hasStakeProgram) {
    return balanceChange < 0 ? 'stake' : 'unstake';
  }

  return 'other';
}
