import { buildTransactionBalanceImpact, type Transaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

/**
 * Result from balance calculation including balances and asset metadata.
 */
export interface BalanceCalculationResult {
  balances: Record<string, Decimal>;
  assetMetadata: Record<string, string>;
}

/**
 * Calculate local balances from processed transactions.
 */
export function calculateBalances(transactions: Transaction[]): BalanceCalculationResult {
  const balances: Record<string, Decimal> = {};
  const assetMetadata: Record<string, string> = {};

  for (const transaction of transactions) {
    const balanceImpact = buildTransactionBalanceImpact(transaction);

    for (const assetImpact of balanceImpact.assets) {
      if (!balances[assetImpact.assetId]) {
        balances[assetImpact.assetId] = parseDecimal('0');
      }

      assetMetadata[assetImpact.assetId] = assetImpact.assetSymbol;
      balances[assetImpact.assetId] = balances[assetImpact.assetId]!.plus(assetImpact.netBalanceDelta);
    }
  }

  return { balances, assetMetadata };
}
