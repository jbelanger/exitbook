import { parseDecimal } from '@exitbook/core';

import type { RawBalanceData } from '../../core/types/index.js';

/**
 * Convert lamports to SOL decimal string
 */
export function convertLamportsToSol(lamports: number | string): string {
  return parseDecimal(lamports.toString()).div(parseDecimal('10').pow(9)).toFixed();
}

/**
 * Transform SOL balance from lamports to RawBalanceData format
 */
export function transformSolBalance(lamports: number | string): RawBalanceData {
  const lamportsStr = lamports.toString();
  const balanceSOL = convertLamportsToSol(lamportsStr);

  return {
    rawAmount: lamportsStr,
    decimals: 9,
    decimalAmount: balanceSOL,
    symbol: 'SOL',
  };
}

/**
 * Transform token account data to RawBalanceData format
 */
export function transformTokenBalance(
  mintAddress: string,
  decimals: number,
  amount: string,
  uiAmountString: string,
  symbol?: string
): RawBalanceData {
  return {
    contractAddress: mintAddress,
    decimals,
    decimalAmount: uiAmountString,
    symbol,
    rawAmount: amount,
  };
}

/**
 * Transform array of token accounts to array of RawBalanceData
 */
export function transformTokenAccounts(
  tokenAccounts: {
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            tokenAmount: {
              amount: string;
              decimals: number;
              uiAmountString: string;
            };
          };
        };
      };
    };
  }[]
): RawBalanceData[] {
  const balances: RawBalanceData[] = [];

  for (const account of tokenAccounts) {
    const tokenInfo = account.account.data.parsed.info;
    const mintAddress = tokenInfo.mint;

    balances.push(
      transformTokenBalance(
        mintAddress,
        tokenInfo.tokenAmount.decimals,
        tokenInfo.tokenAmount.amount,
        tokenInfo.tokenAmount.uiAmountString // Symbol will be resolved by processor
      )
    );
  }

  return balances;
}
