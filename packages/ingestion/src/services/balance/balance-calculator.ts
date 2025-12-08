import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * Calculate balances for all currencies from a set of transactions.
 * Returns all currencies that have transactions, including zero balances.
 */
export function calculateBalances(transactions: UniversalTransactionData[]): Record<string, Decimal> {
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
function processTransactionForBalance(transaction: UniversalTransactionData, balances: Record<string, Decimal>): void {
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
      // Use grossAmount - it represents what the user's balance increased by
      // (netAmount is for transfer matching, not balance calculation)
      const amount = inflow.grossAmount;
      balances[inflow.asset] = balances[inflow.asset]!.plus(amount);
    }
  }

  // Process outflows (what user lost)
  // Movements are already deserialized by the repository with Decimal amounts
  const outflows = transaction.movements.outflows;
  if (outflows && Array.isArray(outflows) && outflows.length > 0) {
    for (const outflow of outflows) {
      ensureBalance(outflow.asset);
      // Use grossAmount - it represents what the user's balance decreased by
      // For UTXO chains (Bitcoin): grossAmount includes the fee (inputs - change)
      // For account-based chains (Ethereum, Solana, etc.): grossAmount = netAmount, fee deducted separately below
      const amount = outflow.grossAmount;
      balances[outflow.asset] = balances[outflow.asset]!.minus(amount);
    }
  }

  // Process fees (always a cost)
  // Fees are now stored as an array
  // IMPORTANT: Only subtract fees with settlement='balance' separately.
  // Fees with settlement='on-chain' are already included in grossAmount for UTXO chains (Bitcoin).
  // Account-based chains (Ethereum, Solana, etc.) use settlement='balance' for gas fees.
  if (transaction.fees && Array.isArray(transaction.fees) && transaction.fees.length > 0) {
    for (const fee of transaction.fees) {
      // Skip on-chain fees - they're already included in grossAmount (UTXO chains only)
      if (fee.settlement === 'on-chain') {
        continue;
      }

      // Subtract balance-settled and external fees separately
      ensureBalance(fee.asset);
      balances[fee.asset] = balances[fee.asset]!.minus(fee.amount);
    }
  }
}
