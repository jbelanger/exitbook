import type { StoredTransaction } from "../types/data-types.js";
import { stringToDecimal } from "@crypto/shared-utils";
import { Decimal } from "decimal.js";

export class BalanceCalculationService {

  /**
   * Calculate exchange balances with full precision (recommended)
   * Returns Decimal values to prevent precision loss in cryptocurrency amounts
   */
  async calculateExchangeBalancesWithPrecision(
    transactions: StoredTransaction[],
  ): Promise<Record<string, Decimal>> {
    const balances: Record<string, Decimal> = {};

    for (const transaction of transactions) {
      this.processTransactionForBalance(transaction, balances);
    }

    return this.cleanupDustBalancesWithPrecision(balances);
  }

  private processTransactionForBalance(
    transaction: StoredTransaction,
    balances: Record<string, Decimal>,
  ): void {
    const type = transaction.type;
    const amount = stringToDecimal(String(transaction.amount));
    const amountCurrency = transaction.amount_currency;
    const side = transaction.side;
    const price = stringToDecimal(String(transaction.price));
    const priceCurrency = transaction.price_currency;
    const feeCost = stringToDecimal(String(transaction.fee_cost));
    const feeCurrency = transaction.fee_currency;

    if (amountCurrency && !balances[amountCurrency])
      balances[amountCurrency] = new Decimal(0);
    if (priceCurrency && !balances[priceCurrency])
      balances[priceCurrency] = new Decimal(0);

    switch (type) {
      case "deposit":
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].plus(amount);
        }
        break;

      case "withdrawal":
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
        }
        break;

      case "fee":
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
        }
        break;

      case "trade":
      case "limit":
      case "market":
        if (side === "buy") {
          if (amountCurrency && balances[amountCurrency]) {
            balances[amountCurrency] = balances[amountCurrency].plus(amount);
          }
          if (priceCurrency && !price.isZero()) {
            if (!balances[priceCurrency])
              balances[priceCurrency] = new Decimal(0);
            balances[priceCurrency] = balances[priceCurrency].minus(price);
          }
        } else if (side === "sell") {
          if (amountCurrency && balances[amountCurrency]) {
            balances[amountCurrency] = balances[amountCurrency].minus(amount);
          }
          if (priceCurrency && !price.isZero()) {
            if (!balances[priceCurrency])
              balances[priceCurrency] = new Decimal(0);
            balances[priceCurrency] = balances[priceCurrency].plus(price);
          }
        }
        break;
    }

    if (!feeCost.isZero() && feeCurrency) {
      if (!balances[feeCurrency]) balances[feeCurrency] = new Decimal(0);
      balances[feeCurrency] = balances[feeCurrency].minus(feeCost);
    }
  }


  /**
   * Clean up dust balances while preserving precision (recommended)
   */
  private cleanupDustBalancesWithPrecision(
    balances: Record<string, Decimal>,
  ): Record<string, Decimal> {
    const cleanedBalances: Record<string, Decimal> = {};
    for (const [currency, balance] of Object.entries(balances)) {
      if (balance.abs().greaterThan(0.00000001)) {
        cleanedBalances[currency] = balance;
      }
    }
    return cleanedBalances;
  }
}
