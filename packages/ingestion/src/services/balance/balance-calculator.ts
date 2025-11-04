import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * Calculate balances for all currencies from a set of transactions.
 * Returns all currencies that have transactions, including zero balances.
 */
export function calculateBalances(transactions: UniversalTransaction[]): Record<string, Decimal> {
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
function processTransactionForBalance(transaction: UniversalTransaction, balances: Record<string, Decimal>): void {
  // Initialize balance for any assets we encounter
  const ensureBalance = (asset: string) => {
    if (!balances[asset]) {
      balances[asset] = parseDecimal('0');
    }
  };

  // Process inflows (what user gained)
  // Movements are already deserialized by the repository with Decimal amounts
  const inflows = transaction.movements.inflows;
  if (inflows && Array.isArray(inflows) && inflows.length > 0) {
    for (const inflow of inflows) {
      ensureBalance(inflow.asset);
      // Use netAmount as it represents what user actually received after fees
      const amount = inflow.netAmount ?? inflow.grossAmount;
      balances[inflow.asset] = balances[inflow.asset]!.plus(amount);
    }
  }

  // Process outflows (what user lost)
  // Movements are already deserialized by the repository with Decimal amounts
  const outflows = transaction.movements.outflows;
  if (outflows && Array.isArray(outflows) && outflows.length > 0) {
    for (const outflow of outflows) {
      ensureBalance(outflow.asset);
      // Use netAmount as it represents what user actually sent after fees
      const amount = outflow.netAmount ?? outflow.grossAmount;
      balances[outflow.asset] = balances[outflow.asset]!.minus(amount);
    }
  }

  // Process fees (always a cost)
  // Fees are now stored as an array
  if (transaction.fees && Array.isArray(transaction.fees) && transaction.fees.length > 0) {
    for (const fee of transaction.fees) {
      ensureBalance(fee.asset);
      balances[fee.asset] = balances[fee.asset]!.minus(fee.amount);
    }
  }
}
