import { stringToDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import type { StoredTransaction } from '../types/data-types.js';

export class BalanceCalculationService {
  /**
   * Clean up dust balances while preserving precision (recommended)
   */
  private cleanupDustBalancesWithPrecision(balances: Record<string, Decimal>): Record<string, Decimal> {
    const cleanedBalances: Record<string, Decimal> = {};
    for (const [currency, balance] of Object.entries(balances)) {
      if (balance.abs().greaterThan(0.00000001)) {
        cleanedBalances[currency] = balance;
      }
    }
    return cleanedBalances;
  }

  /**
   * Check if a transaction is from a blockchain source (vs exchange)
   */
  private isBlockchainTransaction(exchange: string | null | undefined): boolean {
    if (!exchange) return false;
    // Known blockchain identifiers - add more as needed
    const blockchainIdentifiers = ['bitcoin', 'ethereum', 'solana', 'injective', 'avalanche', 'polkadot'];
    return blockchainIdentifiers.includes(exchange.toLowerCase());
  }

  private processTransactionForBalance(transaction: StoredTransaction, balances: Record<string, Decimal>): void {
    const type = transaction.type;
    const amount = stringToDecimal(String(transaction.amount));
    const amountCurrency = transaction.amount_currency;
    const price = stringToDecimal(String(transaction.price));
    const priceCurrency = transaction.price_currency;
    const feeCost = stringToDecimal(String(transaction.fee_cost));
    const feeCurrency = transaction.fee_currency;
    const exchange = transaction.source_id;

    if (amountCurrency && !balances[amountCurrency]) balances[amountCurrency] = new Decimal(0);
    if (priceCurrency && !balances[priceCurrency]) balances[priceCurrency] = new Decimal(0);

    switch (type) {
      case 'deposit':
        if (amountCurrency && balances[amountCurrency]) {
          // For blockchain transactions, the full amount is received (sender paid the fee)
          // For exchange transactions, the full amount is credited (fees handled separately if any)
          balances[amountCurrency] = balances[amountCurrency].plus(amount);
        }
        else {
          throw new Error(`Amount is zero for deposit transaction ID: ${transaction.id}`);
        }
        break;

      case 'withdrawal':
        if (amountCurrency && balances[amountCurrency]) {
          // For blockchain transactions, amount already represents the net withdrawal (fees included)
          // For exchange transactions, amount is the withdrawal and fees are handled separately
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
          if (!feeCost.isZero() && feeCurrency && !this.isBlockchainTransaction(exchange)) {
            if (!balances[feeCurrency]) balances[feeCurrency] = new Decimal(0);
            balances[feeCurrency] = balances[feeCurrency].minus(feeCost);
          }
        }
        else {
          throw new Error(`Amount is zero for withdrawal transaction ID: ${transaction.id}`);
        }
        break;

      case 'fee':
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].minus(amount);
        }
        else {
          throw new Error(`Amount is zero for fee transaction ID: ${transaction.id}`);
        }
        break;

      case 'trade':
      case 'limit':
      case 'market':
        // Symbol indicates what asset is being received (bought)
        // Amount currency is what we're receiving, price currency is what we're spending
        if (amountCurrency && balances[amountCurrency]) {
          balances[amountCurrency] = balances[amountCurrency].plus(amount);
        }
        else {
          throw new Error(`Amount is zero for trade transaction ID: ${transaction.id}`);
        }

        if (priceCurrency && !price.isZero()) {
          if (!balances[priceCurrency]) balances[priceCurrency] = new Decimal(0);
          balances[priceCurrency] = balances[priceCurrency].minus(price);
        }
        else{
          console.log(transaction)
          throw new Error(`Price is zero for trade transaction ID: ${transaction}`);
        }
        
        break;
    }

    // Only subtract fees separately for exchange transactions, not blockchain transactions
    // if (!feeCost.isZero() && feeCurrency && !this.isBlockchainTransaction(exchange)) {
    //   if (!balances[feeCurrency]) balances[feeCurrency] = new Decimal(0);
    //   balances[feeCurrency] = balances[feeCurrency].minus(feeCost);
    // }
  }

  /**
   * Calculate exchange balances including zero balances (for verification purposes)
   * Returns all currencies that have transactions, even if current balance is zero
   */
  async calculateExchangeBalancesForVerification(transactions: StoredTransaction[]): Promise<Record<string, Decimal>> {
    const balances: Record<string, Decimal> = {};

    for (const transaction of transactions) {
      this.processTransactionForBalance(transaction, balances);
    }

    // Don't cleanup dust balances - return all currencies that had transactions
    return balances;
  }

  /**
   * Calculate exchange balances with full precision (recommended)
   * Returns Decimal values to prevent precision loss in cryptocurrency amounts
   */
  async calculateExchangeBalancesWithPrecision(transactions: StoredTransaction[]): Promise<Record<string, Decimal>> {
    const balances: Record<string, Decimal> = {};

    for (const transaction of transactions) {
      this.processTransactionForBalance(transaction, balances);
    }

    return this.cleanupDustBalancesWithPrecision(balances);
  }
}
