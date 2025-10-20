import { parseDecimal } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import type { Decimal } from 'decimal.js';

/**
 * Calculate balances for all currencies from a set of transactions.
 * Returns all currencies that have transactions, including zero balances.
 */
export function calculateBalances(transactions: StoredTransaction[]): Record<string, Decimal> {
  const balances: Record<string, Decimal> = {};

  for (const transaction of transactions) {
    processTransactionForBalance(transaction, balances);
  }

  return balances;
}

/**
 * Process a single transaction's movements and fees to update balances.
 * Handles inflows, outflows, and fees from the transaction's structured data.
 */
function processTransactionForBalance(transaction: StoredTransaction, balances: Record<string, Decimal>): void {
  // Initialize balance for any assets we encounter
  const ensureBalance = (asset: string) => {
    if (!balances[asset]) {
      balances[asset] = parseDecimal('0');
    }
  };

  // Process inflows (what user gained)
  // Movements are already deserialized by the repository with Decimal amounts
  const inflows = transaction.movements_inflows;
  if (inflows && Array.isArray(inflows) && inflows.length > 0) {
    for (const inflow of inflows) {
      ensureBalance(inflow.asset);
      balances[inflow.asset] = balances[inflow.asset]!.plus(inflow.amount);
    }
  }

  // Process outflows (what user lost)
  // Movements are already deserialized by the repository with Decimal amounts
  const outflows = transaction.movements_outflows;
  if (outflows && Array.isArray(outflows) && outflows.length > 0) {
    for (const outflow of outflows) {
      ensureBalance(outflow.asset);
      balances[outflow.asset] = balances[outflow.asset]!.minus(outflow.amount);
    }
  }

  // Process fees (always a cost)
  // Fees are now deserialized by the repository as Money objects with Decimal amounts
  if (transaction.fees_network) {
    const currency = transaction.fees_network.currency.toString();
    ensureBalance(currency);
    balances[currency] = balances[currency]!.minus(transaction.fees_network.amount);
  }

  if (transaction.fees_platform) {
    const currency = transaction.fees_platform.currency.toString();
    ensureBalance(currency);
    balances[currency] = balances[currency]!.minus(transaction.fees_platform.amount);
  }
}
