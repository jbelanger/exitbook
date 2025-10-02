import type { StoredTransaction } from '@exitbook/data';
import { stringToDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';

export class BalanceCalculationService {
  /**
   * Calculate balances including zero balances (for verification purposes)
   * Returns all currencies that have transactions, even if current balance is zero
   */
  calculateBalancesForVerification(transactions: StoredTransaction[]): Record<string, Decimal> {
    const balances: Record<string, Decimal> = {};

    for (const transaction of transactions) {
      this.processTransactionForBalance(transaction, balances);
    }

    // Don't cleanup dust balances - return all currencies that had transactions
    return balances;
  }

  /**
   * Process transaction using structured movements and fees.
   * Clean, simple logic - no switch statements or special cases.
   */
  private processTransactionForBalance(transaction: StoredTransaction, balances: Record<string, Decimal>): void {
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
    const inflows = parseJSON<{ amount: { currency: string; value: string }; asset: string }[]>(
      transaction.movements_inflows
    );
    if (inflows) {
      for (const inflow of inflows) {
        ensureBalance(inflow.asset);
        const amount = stringToDecimal(inflow.amount.value);
        balances[inflow.asset] = balances[inflow.asset]!.plus(amount);
      }
    }

    // Process outflows (what user lost)
    const outflows = parseJSON<{ amount: { currency: string; value: string }; asset: string }[]>(
      transaction.movements_outflows
    );
    if (outflows) {
      for (const outflow of outflows) {
        ensureBalance(outflow.asset);
        const amount = stringToDecimal(outflow.amount.value);
        balances[outflow.asset] = balances[outflow.asset]!.minus(amount);
      }
    }

    // Process fees (always a cost)
    const networkFee = parseJSON<{ currency: string; value: string }>(transaction.fees_network);
    if (networkFee) {
      ensureBalance(networkFee.currency);
      const amount = stringToDecimal(networkFee.value);
      balances[networkFee.currency] = balances[networkFee.currency]!.minus(amount);
    }

    const platformFee = parseJSON<{ currency: string; value: string }>(transaction.fees_platform);
    if (platformFee) {
      ensureBalance(platformFee.currency);
      const amount = stringToDecimal(platformFee.value);
      balances[platformFee.currency] = balances[platformFee.currency]!.minus(amount);
    }
  }
}
