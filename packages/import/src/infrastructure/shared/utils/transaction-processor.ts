import crypto from 'node:crypto';

import type { Money, TransactionStatus, TransactionType, UniversalTransaction } from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

// CCXT Transaction interface based on commonly used properties
export interface CCXTTransaction {
  amount?: number | undefined;
  cost?: number | undefined;
  currency?: string | undefined;
  datetime?: string | undefined;
  fee?: {
    cost?: number | undefined;
    currency?: string | undefined;
  };
  id?: string | undefined;
  info?: Record<string, unknown> | undefined;
  price?: number | undefined;
  side?: string | undefined;
  status?: string | undefined;
  symbol?: string | undefined;
  timestamp?: number | undefined;
  txid?: string | undefined;
  type?: string | undefined;
}

/**
 * Processes CCXT transactions to our standard UniversalTransaction format
 * Provides consistent data normalization across all exchange adapters
 */
export class TransactionProcessor {
  /**
   * Converts CCXT transaction data to standardized UniversalTransaction format
   */
  static fromCCXT(ccxtTransaction: CCXTTransaction, type: TransactionType, exchangeId: string): UniversalTransaction {
    const { baseCurrency, quoteCurrency } = this.extractCurrencies(ccxtTransaction);
    const transactionId = this.extractTransactionId(ccxtTransaction, exchangeId);
    const timestamp = ccxtTransaction.timestamp || Date.now();
    const amount = Math.abs(ccxtTransaction.amount || 0);

    const fee = this.extractFee(ccxtTransaction);

    const result: UniversalTransaction = {
      amount: { amount: new Decimal(amount), currency: baseCurrency },
      datetime: ccxtTransaction.datetime || new Date(timestamp).toISOString(),
      fee,
      from: 'exchange',
      id: transactionId,
      metadata: {
        exchange: exchangeId,
        originalData: ccxtTransaction,
      },
      network: 'exchange',
      source: exchangeId,
      status: this.normalizeStatus(ccxtTransaction.status),
      symbol: ccxtTransaction.symbol,
      timestamp,
      to: 'exchange',
      type,
    };

    // Add price for trades
    if (type === 'trade') {
      const priceMoney = this.extractPrice(ccxtTransaction, type, quoteCurrency);
      if (priceMoney) {
        result.price = priceMoney;
      }
    }

    return result;
  }

  /**
   * Normalizes various exchange status formats to standard TransactionStatus
   */
  static normalizeStatus(status: unknown): TransactionStatus {
    if (!status || typeof status !== 'string') return 'pending';

    const statusMap: Record<string, TransactionStatus> = {
      canceled: 'canceled',
      cancelled: 'canceled',
      closed: 'closed',
      complete: 'closed',
      completed: 'closed',
      expired: 'failed',
      failed: 'failed',
      filled: 'closed',
      ok: 'ok',
      open: 'open',
      pending: 'pending',
      rejected: 'failed',
    };

    const normalizedStatus = statusMap[status.toLowerCase()];
    return normalizedStatus || 'pending';
  }

  /**
   * Determines if transaction should be excluded from import
   */
  static shouldFilterOut(transaction: CCXTTransaction): boolean {
    // Check CCXT status
    if (transaction.status === 'canceled' || transaction.status === 'cancelled') {
      return true;
    }

    // Check exchange-specific status indicators
    const exchangeStatus =
      transaction.info &&
      typeof transaction.info === 'object' &&
      'status' in transaction.info &&
      typeof transaction.info['status'] === 'string'
        ? transaction.info['status'].toLowerCase()
        : undefined;
    if (exchangeStatus === 'canceled' || exchangeStatus === 'cancelled') {
      return true;
    }

    // Check for cancel_reason in exchange data
    if (
      transaction.info &&
      typeof transaction.info === 'object' &&
      'cancel_reason' in transaction.info &&
      transaction.info['cancel_reason'] &&
      typeof transaction.info['cancel_reason'] === 'object' &&
      (('id' in transaction.info['cancel_reason'] && transaction.info['cancel_reason'].id) ||
        ('message' in transaction.info['cancel_reason'] && transaction.info['cancel_reason'].message))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Generates unique transaction identifier from transaction data
   */
  static createTransactionHash(transaction: CCXTTransaction, exchangeId: string): string {
    const hashData = JSON.stringify({
      amount: transaction.amount,
      exchange: exchangeId,
      id: transaction.id,
      side: transaction.side,
      symbol: transaction.symbol,
      timestamp: transaction.timestamp,
      type: transaction.type,
    });

    return crypto.createHash('sha256').update(hashData).digest('hex').slice(0, 16);
  }

  /**
   * Extracts base and quote currencies from transaction data
   */
  static extractCurrencies(transaction: CCXTTransaction): {
    baseCurrency: string;
    quoteCurrency: string;
  } {
    let baseCurrency = 'unknown';
    let quoteCurrency = 'unknown';

    if (transaction.symbol && transaction.symbol.includes('/')) {
      const [base, quote] = transaction.symbol.split('/');
      baseCurrency = base ?? 'unknown';
      quoteCurrency = quote ?? 'unknown';
    } else if (transaction.currency) {
      baseCurrency = transaction.currency;
      quoteCurrency = transaction.currency;
    } else if (
      transaction.info &&
      typeof transaction.info === 'object' &&
      'currency' in transaction.info &&
      typeof transaction.info['currency'] === 'string'
    ) {
      baseCurrency = transaction.info['currency'];
      quoteCurrency = transaction.info['currency'];
    }

    return { baseCurrency, quoteCurrency };
  }

  /**
   * Extracts fee information from transaction
   */
  private static extractFee(transaction: CCXTTransaction): Money | undefined {
    if (transaction.fee?.cost) {
      return createMoney(String(transaction.fee.cost), transaction.fee.currency || 'unknown');
    }
    return undefined;
  }

  /**
   * Extracts and normalizes price information
   */
  private static extractPrice(
    transaction: CCXTTransaction,
    type: TransactionType,
    quoteCurrency: string
  ): Money | undefined {
    if (transaction.price) {
      return createMoney(String(transaction.price), quoteCurrency);
    }

    if (type === 'trade' && transaction.cost && transaction.amount && transaction.amount !== 0) {
      const calculatedPrice = Math.abs(transaction.cost) / Math.abs(transaction.amount);
      return createMoney(String(calculatedPrice), quoteCurrency);
    }

    return undefined;
  }

  /**
   * Extracts transaction ID with fallback to generated hash
   */
  private static extractTransactionId(transaction: CCXTTransaction, exchangeId: string): string {
    return transaction.id || transaction.txid || this.createTransactionHash(transaction, exchangeId);
  }
}
