import { parseDecimal } from '@exitbook/core';

import type { SolanaAccountChange, SolanaTokenBalance, SolanaTokenChange } from './types.js';

/**
 * Extract SOL balance changes for all accounts from Helius/RPC transaction data
 */
export function extractAccountChanges(
  preBalances: number[],
  postBalances: number[],
  accountKeys: string[]
): SolanaAccountChange[] {
  const changes: SolanaAccountChange[] = [];

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
): SolanaAccountChange[] {
  const changes: SolanaAccountChange[] = [];

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
          account: balance.owner || '', // Token account owner
          decimals: balance.uiTokenAmount.decimals,
          mint: balance.mint,
          owner: balance.owner,
          postAmount,
          preAmount,
        };

        // Add symbol if requested (Helius uses mint as symbol, RPC doesn't)
        if (includeSymbol) {
          change.symbol = balance.mint; // Use mint address - processor will resolve to symbol
        }

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
        owner: preBalance.owner,
        postAmount: '0',
        preAmount: preBalance.uiTokenAmount.amount,
      };

      if (includeSymbol) {
        change.symbol = preBalance.mint; // Use mint address - processor will resolve to symbol
      }

      changes.push(change);
    }
  }

  return changes;
}

/**
 * Determine the primary transfer amount and currency from balance changes
 * Prioritizes token changes over SOL changes
 */
export function determinePrimaryTransfer(
  accountChanges: SolanaAccountChange[],
  tokenChanges: SolanaTokenChange[]
): { primaryAmount: string; primaryCurrency: string } {
  // If there are token changes, prioritize the largest token transfer
  if (tokenChanges.length > 0) {
    const largestTokenChange = tokenChanges.reduce((largest, change) => {
      const changeAmount = parseDecimal(change.postAmount).minus(change.preAmount).abs();
      const largestAmount = parseDecimal(largest.postAmount).minus(largest.preAmount).abs();
      return changeAmount.greaterThan(largestAmount) ? change : largest;
    });

    const tokenAmount = parseDecimal(largestTokenChange.postAmount).minus(largestTokenChange.preAmount).abs();
    return {
      primaryAmount: tokenAmount.toFixed(),
      primaryCurrency: largestTokenChange.symbol || largestTokenChange.mint,
    };
  }

  // Otherwise, find the largest SOL change (excluding fee payer)
  if (accountChanges.length > 1) {
    // Skip first account (fee payer) and find largest balance change
    const remainingChanges = accountChanges.slice(1);
    if (remainingChanges.length > 0) {
      const largestSolChange = remainingChanges.reduce((largest, change) => {
        const changeAmount = parseDecimal(change.postBalance).minus(change.preBalance).abs();
        const largestAmount = parseDecimal(largest.postBalance).minus(largest.preBalance).abs();
        return changeAmount.greaterThan(largestAmount) ? change : largest;
      });

      if (largestSolChange) {
        const solAmount = parseDecimal(largestSolChange.postBalance).minus(largestSolChange.preBalance).abs();
        return {
          primaryAmount: solAmount.toFixed(),
          primaryCurrency: 'SOL',
        };
      }
    }
  } else if (accountChanges.length === 1 && accountChanges[0]) {
    // Only one account change (probably fee-only transaction)
    const solAmount = parseDecimal(accountChanges[0].postBalance).minus(accountChanges[0].preBalance).abs();
    return {
      primaryAmount: solAmount.toFixed(),
      primaryCurrency: 'SOL',
    };
  }

  // Default fallback
  return {
    primaryAmount: '0',
    primaryCurrency: 'SOL',
  };
}

/**
 * Determine recipient address from account changes
 * Finds the account that received funds (positive balance change, not the fee payer)
 */
export function determineRecipient(
  inputAccount: { account: string; postBalance: number; preBalance: number }[],
  feePayerAccount: string
): string {
  const recipient = inputAccount.find((account) => {
    const balanceChange = account.postBalance - account.preBalance;
    return balanceChange > 0 && account.account !== feePayerAccount;
  });

  return recipient?.account || '';
}
