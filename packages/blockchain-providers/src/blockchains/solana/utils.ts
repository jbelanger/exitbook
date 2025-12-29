import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import { generateUniqueTransactionEventId } from '../../core/index.js';

import type { SolanaTokenBalance, SolanaTokenChange } from './schemas.js';

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
  return parseDecimal(lamports.toString()).dividedBy(parseDecimal('10').pow(9));
}

/**
 * Convert SOL to lamports
 *
 * @public
 */
export function solToLamports(sol: number | string): Decimal {
  return parseDecimal(sol.toString()).mul(parseDecimal('10').pow(9));
}

/**
 * Deterministic event identity for Solana.
 *
 * Important: raw storage dedup is keyed by `(account_id, event_id)` and the raw layer
 * is append-only (no upserts). This means `eventId` MUST NOT depend on fields that
 * can change between imports or vary between providers (e.g., inferred from/to,
 * token parsing differences, or missing blockTime).
 *
 * For Solana, we currently treat one on-chain signature as the event granularity,
 * so the canonical discriminant is the signature itself.
 */
export function generateSolanaTransactionEventId(params: { signature: string }): string {
  return generateUniqueTransactionEventId({
    amount: '0',
    currency: 'SOL',
    from: '',
    id: params.signature,
    timestamp: 0,
    traceId: 'solana-tx',
    type: 'transfer',
  });
}

/**
 * Deduplicate transactions by signature
 * Returns a map of unique transactions keyed by signature
 */
export function deduplicateTransactionsBySignature<
  T extends { signature?: string | undefined; transaction?: { signatures?: string[] | undefined } | undefined },
>(transactions: T[]): Map<string, T> {
  const uniqueTransactions = new Map<string, T>();

  for (const tx of transactions) {
    const signature = tx.transaction?.signatures?.[0] ?? tx.signature;
    if (signature && !uniqueTransactions.has(signature)) {
      uniqueTransactions.set(signature, tx);
    }
  }

  return uniqueTransactions;
}

/**
 * Parse Solana transaction type from instructions
 *
 * @public
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

/**
 * Extract SOL balance changes for all accounts from Helius/RPC transaction data
 */
export function extractAccountChanges(
  preBalances: number[],
  postBalances: number[],
  accountKeys: string[]
): { account: string; postBalance: string; preBalance: string }[] {
  const changes: { account: string; postBalance: string; preBalance: string }[] = [];

  for (let i = 0; i < Math.min(accountKeys.length, preBalances.length, postBalances.length); i++) {
    const preBalance = preBalances[i];
    const postBalance = postBalances[i];

    // Only include accounts with balance changes
    if (preBalance !== postBalance) {
      const account = accountKeys[i];
      if (account && preBalance !== undefined && postBalance !== undefined) {
        changes.push({
          account,
          postBalance: postBalance.toString(),
          preBalance: preBalance.toString(),
        });
      }
    }
  }

  return changes;
}

/**
 * Extract SOL balance changes from Solscan inputAccount data structure
 */
export function extractAccountChangesFromSolscan(
  inputAccount: { account: string; postBalance: number; preBalance: number }[]
): { account: string; postBalance: string; preBalance: string }[] {
  const changes: { account: string; postBalance: string; preBalance: string }[] = [];

  for (const accountData of inputAccount) {
    // Only include accounts with balance changes
    if (accountData.preBalance !== accountData.postBalance) {
      changes.push({
        account: accountData.account,
        postBalance: accountData.postBalance.toString(),
        preBalance: accountData.preBalance.toString(),
      });
    }
  }

  return changes;
}

/**
 * Extract SPL token balance changes by comparing pre and post token balances
 * Returns only tokens that had balance changes
 */
export function extractTokenChanges(
  preTokenBalances: SolanaTokenBalance[] | undefined,
  postTokenBalances: SolanaTokenBalance[] | undefined,
  includeSymbol = true
): SolanaTokenChange[] {
  const changes: SolanaTokenChange[] = [];

  // Create maps for easier lookup
  const preTokenMap = new Map<string, SolanaTokenBalance>();
  const postTokenMap = new Map<string, SolanaTokenBalance>();

  // Build pre-token balance map
  if (preTokenBalances) {
    for (const balance of preTokenBalances) {
      const key = `${balance.accountIndex}-${balance.mint}`;
      preTokenMap.set(key, balance);
    }
  }

  // Build post-token balance map and detect changes
  if (postTokenBalances) {
    for (const balance of postTokenBalances) {
      const key = `${balance.accountIndex}-${balance.mint}`;
      postTokenMap.set(key, balance);

      const preBalance = preTokenMap.get(key);
      const preAmount = preBalance?.uiTokenAmount.amount || '0';
      const postAmount = balance.uiTokenAmount.amount;

      // Only include tokens with balance changes
      if (preAmount !== postAmount) {
        const change: SolanaTokenChange = {
          account: balance.owner || '',
          decimals: balance.uiTokenAmount.decimals,
          mint: balance.mint,
          postAmount,
          preAmount,
          ...(balance.owner !== undefined && { owner: balance.owner }),
          ...(includeSymbol && { symbol: balance.mint }),
        };

        changes.push(change);
      }
    }
  }

  // Check for tokens that existed in pre but not in post (fully spent)
  for (const [key, preBalance] of preTokenMap.entries()) {
    if (!postTokenMap.has(key)) {
      const change: SolanaTokenChange = {
        account: preBalance.owner || '',
        decimals: preBalance.uiTokenAmount.decimals,
        mint: preBalance.mint,
        postAmount: '0',
        preAmount: preBalance.uiTokenAmount.amount,
        ...(preBalance.owner !== undefined && { owner: preBalance.owner }),
        ...(includeSymbol && { symbol: preBalance.mint }),
      };

      changes.push(change);
    }
  }

  return changes;
}
