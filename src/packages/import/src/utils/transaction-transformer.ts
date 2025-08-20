import type {
  CryptoTransaction,
  Money,
  TransactionStatus,
  TransactionType
} from '@crypto/core';
import crypto from 'crypto';
import { createMoney } from './decimal-utils.ts';

/**
 * Utility for transforming CCXT transactions to our standard format
 * Eliminates code duplication across CCXT adapters
 */
export class TransactionTransformer {
  /**
   * Transform a CCXT transaction to our standard format
   */
  static fromCCXT(ccxtTx: any, type: TransactionType, exchangeId: string): CryptoTransaction {
    const { base, quote } = this.extractCurrency(ccxtTx);
    const id = ccxtTx.id || ccxtTx.txid || this.createTransactionHash(ccxtTx, exchangeId);
    const timestamp = ccxtTx.timestamp || Date.now();
    const amount = Math.abs(ccxtTx.amount || 0);

    // Transform amount structure
    const amountMoney: Money = createMoney(amount, base);

    // Transform price structure
    let priceMoney: Money | undefined;
    if (ccxtTx.price) {
      priceMoney = createMoney(ccxtTx.price, quote);
    } else if (type === 'trade' && ccxtTx.cost && ccxtTx.amount && ccxtTx.amount !== 0) {
      // Calculate actual price from cost and amount for trades
      const actualPrice = Math.abs(ccxtTx.cost) / Math.abs(ccxtTx.amount);
      priceMoney = createMoney(actualPrice, quote);
    }

    // Transform fee structure
    let fee: Money | undefined;
    if (ccxtTx.fee && ccxtTx.fee.cost) {
      fee = createMoney(ccxtTx.fee.cost, ccxtTx.fee.currency || 'unknown');
    }

    return {
      id,
      type,
      timestamp,
      datetime: ccxtTx.datetime,
      symbol: ccxtTx.symbol,
      amount: amountMoney,
      side: ccxtTx.side,
      price: priceMoney,
      fee,
      status: this.normalizeStatus(ccxtTx.status),
      info: ccxtTx,
    };
  }

  /**
   * Extract base and quote currencies from a CCXT transaction
   */
  static extractCurrency(transaction: any): { base: string; quote: string } {
    let base = 'unknown';
    let quote = 'unknown';

    if (transaction.symbol && transaction.symbol.includes('/')) {
      [base, quote] = transaction.symbol.split('/');
    } else if (transaction.currency) {
      base = transaction.currency;
      quote = transaction.currency;
    } else if (transaction.info?.currency) {
      base = transaction.info.currency;
      quote = transaction.info.currency;
    }

    return { base, quote };
  }

  /**
   * Normalize various status formats to our standard status
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
   * Create a deterministic hash for transaction deduplication
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
   * Check if a transaction should be filtered out (cancelled, etc.)
   */
  static shouldFilter(transaction: any): boolean {
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

  /**
   * Infer transaction status when not explicitly provided
   * Useful for exchanges with incomplete status information
   */
  static inferStatus(ccxtTx: any, type: TransactionType): TransactionStatus {
    // For trades without explicit status, infer from trade data
    if (type === 'trade') {
      // If it has actual trade data (price, cost, etc.), it's completed
      if (ccxtTx.price && ccxtTx.cost && ccxtTx.amount) {
        return 'closed';
      }

      // Check for exchange-specific trade completion indicators
      const tradeType = ccxtTx.info?.trade_type || ccxtTx.info?.originalCCXT?.info?.trade_type;
      if (tradeType === 'FILL') {
        return 'closed'; // FILL means the trade was executed
      }
    }

    // For deposits/withdrawals, check exchange status indicators
    if (type === 'deposit' || type === 'withdrawal') {
      const exchangeStatus = ccxtTx.info?.status?.toLowerCase();
      if (exchangeStatus === 'completed' || exchangeStatus === 'complete') {
        return 'closed';
      }
    }

    // Fallback to standard mapping
    return this.normalizeStatus(ccxtTx.status);
  }
}