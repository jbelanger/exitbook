import { stringToDecimal } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import { Decimal } from 'decimal.js';

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
      balances[asset] = new Decimal(0);
    }
  };

  // Helper to parse JSON strings from database
  const parseJSON = <T>(jsonString: unknown): T | undefined => {
    if (!jsonString || typeof jsonString !== 'string') return undefined;
    try {
      return JSON.parse(jsonString) as T;
    } catch {
      return undefined;
    }
  };

  // Process inflows (what user gained)
  const inflows = parseJSON<{ amount: { amount: string; currency: string }; asset: string }[]>(
    transaction.movements_inflows
  );
  if (inflows) {
    for (const inflow of inflows) {
      ensureBalance(inflow.asset);
      const amount = stringToDecimal(inflow.amount.amount);
      balances[inflow.asset] = balances[inflow.asset]!.plus(amount);
    }
  }

  // Process outflows (what user lost)
  const outflows = parseJSON<{ amount: { amount: string; currency: string }; asset: string }[]>(
    transaction.movements_outflows
  );
  if (outflows) {
    for (const outflow of outflows) {
      ensureBalance(outflow.asset);
      const amount = stringToDecimal(outflow.amount.amount);
      balances[outflow.asset] = balances[outflow.asset]!.minus(amount);
    }
  }

  // Process fees (always a cost)
  const networkFee = parseJSON<{ amount: string; currency: string }>(transaction.fees_network);
  if (networkFee) {
    ensureBalance(networkFee.currency);
    const amount = stringToDecimal(networkFee.amount);
    balances[networkFee.currency] = balances[networkFee.currency]!.minus(amount);
  }

  const platformFee = parseJSON<{ amount: string; currency: string }>(transaction.fees_platform);
  if (platformFee) {
    ensureBalance(platformFee.currency);
    const amount = stringToDecimal(platformFee.amount);
    balances[platformFee.currency] = balances[platformFee.currency]!.minus(amount);
  }
}
