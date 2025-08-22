import type {
  CryptoTransaction,
  Money,
  TransactionStatus,
  TransactionType
} from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import crypto from 'crypto';


/**
 * Transforms CCXT transactions to our standard CryptoTransaction format
 * Provides consistent data normalization across all exchange adapters
 */
export class TransactionTransformer {
  /**
   * Converts CCXT transaction data to standardized CryptoTransaction format
   */
  static fromCCXT(ccxtTransaction: any, type: TransactionType, exchangeId: string): CryptoTransaction {
    const { baseCurrency, quoteCurrency } = this.extractCurrencies(ccxtTransaction);
    const transactionId = this.extractTransactionId(ccxtTransaction, exchangeId);
    const timestamp = ccxtTransaction.timestamp || Date.now();
    const amount = Math.abs(ccxtTransaction.amount || 0);

    const amountMoney = createMoney(amount, baseCurrency);
    const priceMoney = this.extractPrice(ccxtTransaction, type, quoteCurrency);
    const fee = this.extractFee(ccxtTransaction);

    return {
      id: transactionId,
      type,
      timestamp,
      datetime: ccxtTransaction.datetime,
      symbol: ccxtTransaction.symbol,
      amount: amountMoney,
      side: ccxtTransaction.side,
      price: priceMoney,
      fee,
      status: this.normalizeStatus(ccxtTransaction.status),
      info: ccxtTransaction,
    };
  }

  /**
   * Extracts base and quote currencies from transaction data
   */
  static extractCurrencies(transaction: any): { baseCurrency: string; quoteCurrency: string } {
    let baseCurrency = 'unknown';
    let quoteCurrency = 'unknown';

    if (transaction.symbol && transaction.symbol.includes('/')) {
      [baseCurrency, quoteCurrency] = transaction.symbol.split('/');
    } else if (transaction.currency) {
      baseCurrency = transaction.currency;
      quoteCurrency = transaction.currency;
    } else if (transaction.info?.currency) {
      baseCurrency = transaction.info.currency;
      quoteCurrency = transaction.info.currency;
    }

    return { baseCurrency, quoteCurrency };
  }

  /**
   * Extracts transaction ID with fallback to generated hash
   */
  private static extractTransactionId(transaction: any, exchangeId: string): string {
    return transaction.id || transaction.txid || this.createTransactionHash(transaction, exchangeId);
  }

  /**
   * Extracts and normalizes price information
   */
  private static extractPrice(transaction: any, type: TransactionType, quoteCurrency: string): Money | undefined {
    if (transaction.price) {
      return createMoney(transaction.price, quoteCurrency);
    }
    
    if (type === 'trade' && transaction.cost && transaction.amount && transaction.amount !== 0) {
      const calculatedPrice = Math.abs(transaction.cost) / Math.abs(transaction.amount);
      return createMoney(calculatedPrice, quoteCurrency);
    }
    
    return undefined;
  }

  /**
   * Extracts fee information from transaction
   */
  private static extractFee(transaction: any): Money | undefined {
    if (transaction.fee?.cost) {
      return createMoney(transaction.fee.cost, transaction.fee.currency || 'unknown');
    }
    return undefined;
  }

  /**
   * Normalizes various exchange status formats to standard TransactionStatus
   */
  static normalizeStatus(status: any): TransactionStatus {
    if (!status) return 'pending';

    const statusMap: Record<string, TransactionStatus> = {
      'open': 'open',
      'closed': 'closed',
      'filled': 'closed',
      'completed': 'closed',
      'complete': 'closed',
      'canceled': 'canceled',
      'cancelled': 'canceled',
      'pending': 'pending',
      'rejected': 'failed',
      'expired': 'failed',
      'failed': 'failed',
      'ok': 'ok',
    };

    const normalizedStatus = statusMap[status.toLowerCase()];
    return normalizedStatus || 'pending';
  }

  /**
   * Generates unique transaction identifier from transaction data
   */
  static createTransactionHash(transaction: any, exchangeId: string): string {
    const hashData = JSON.stringify({
      id: transaction.id,
      timestamp: transaction.timestamp,
      symbol: transaction.symbol,
      amount: transaction.amount,
      side: transaction.side,
      type: transaction.type,
      exchange: exchangeId
    });

    return crypto.createHash('sha256').update(hashData).digest('hex').slice(0, 16);
  }

  /**
   * Determines if transaction should be excluded from import
   */
  static shouldFilterOut(transaction: any): boolean {
    // Check CCXT status
    if (transaction.status === 'canceled' || transaction.status === 'cancelled') {
      return true;
    }

    // Check exchange-specific status indicators
    const exchangeStatus = transaction.info?.status?.toLowerCase();
    if (exchangeStatus === 'canceled' || exchangeStatus === 'cancelled') {
      return true;
    }

    // Check for cancel_reason in exchange data
    if (transaction.info?.cancel_reason &&
      (transaction.info?.cancel_reason?.id || transaction.info?.cancel_reason?.message)) {
      return true;
    }

    return false;
  }
}