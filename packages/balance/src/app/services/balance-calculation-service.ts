import type { StoredTransaction } from '@exitbook/data';
import { stringToDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';

export class BalanceCalculationService {
  /**
   * Calculate exchange balances including zero balances (for verification purposes)
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

  private processTransactionForBalance(transaction: StoredTransaction, balances: Record<string, Decimal>): void {
    const type = transaction.transaction_type;
    const amount = stringToDecimal(String(transaction.amount));
    const amountCurrency = transaction.amount_currency;
    const price = stringToDecimal(String(transaction.price));
    const priceCurrency = transaction.price_currency;
    const feeCost = stringToDecimal(String(transaction.fee_cost));
    const feeCurrency = transaction.fee_currency;

    if (amountCurrency && !balances[amountCurrency]) balances[amountCurrency] = new Decimal(0);
    if (priceCurrency && !balances[priceCurrency]) balances[priceCurrency] = new Decimal(0);

    switch (type) {
      case 'deposit':
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].plus(amount);
        } else {
          throw new Error(`Amount is zero for deposit transaction ID: ${transaction.id}`);
        }
        break;

      case 'withdrawal':
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
          if (!feeCost.isZero() && feeCurrency) {
            if (!balances[feeCurrency]) balances[feeCurrency] = new Decimal(0);
            balances[feeCurrency] = balances[feeCurrency].minus(feeCost);
          }
        } else {
          throw new Error(`Amount is zero for withdrawal transaction ID: ${transaction.id}`);
        }
        break;

      case 'fee':
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
        } else {
          throw new Error(`Amount is zero for fee transaction ID: ${transaction.id}`);
        }
        break;

      case 'trade':
        // Symbol indicates what asset is being received (bought)
        // Amount currency is what we're receiving, price currency is what we're spending
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].plus(amount);
        } else {
          throw new Error(`Amount is zero for trade transaction ID: ${transaction.id}`);
        }

        if (priceCurrency && !price.isZero()) {
          if (!balances[priceCurrency]) balances[priceCurrency] = new Decimal(0);
          balances[priceCurrency] = balances[priceCurrency].minus(price);
        } else {
          throw new Error(`Price is zero for trade transaction ID: ${transaction.id}`);
        }

        break;
    }

    // Only subtract fees separately for exchange transactions, not blockchain transactions
    // if (!feeCost.isZero() && feeCurrency && !this.isBlockchainTransaction(exchange)) {
    //   if (!balances[feeCurrency]) balances[feeCurrency] = new Decimal(0);
    //   balances[feeCurrency] = balances[feeCurrency].minus(feeCost);
    // }
  }
}
