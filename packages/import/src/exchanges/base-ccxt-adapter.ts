import type {
  CryptoTransaction, TransactionType, UniversalAdapterInfo, UniversalBalance,
  UniversalExchangeAdapterConfig, UniversalFetchParams,
  UniversalTransaction
} from '@crypto/core';
import type { Exchange } from 'ccxt';
import { BaseAdapter } from '../shared/adapters/base-adapter.ts';
import { TransactionTransformer } from '../shared/utils/transaction-transformer.ts';
import { ServiceErrorHandler } from './exchange-error-handler.ts';

/**
 * Base class for all CCXT-based exchange adapters in the universal adapter system
 * Extends the universal BaseAdapter and provides CCXT-specific functionality
 */
export abstract class BaseCCXTAdapter extends BaseAdapter {
  protected exchange: Exchange;
  protected exchangeId: string;
  protected enableOnlineVerification: boolean;

  constructor(exchange: Exchange, config: UniversalExchangeAdapterConfig, enableOnlineVerification: boolean = false) {
    super(config);
    this.exchange = exchange;
    this.exchangeId = config.id;
    this.enableOnlineVerification = enableOnlineVerification;

    // Enable rate limiting and other common settings
    this.exchange.enableRateLimit = true;
    this.exchange.rateLimit = 1000;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: this.exchangeId,
      name: this.exchange.name || this.exchangeId,
      type: 'exchange',
      subType: 'ccxt',
      capabilities: {
        supportedOperations: ['fetchTransactions', 'fetchBalances'],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: true,
        rateLimit: {
          requestsPerSecond: this.exchange.rateLimit ? 1000 / this.exchange.rateLimit : 10,
          burstLimit: 50
        }
      }
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.exchange.loadMarkets();
      await this.exchange.fetchBalance();
      this.logger.info(`Connection test successful for ${this.exchangeId}`);
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed for ${this.exchangeId} - Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<CryptoTransaction[]> {
    const startTime = Date.now();
    this.logger.info(`Starting fetchRawTransactions for ${this.exchangeId}`);

    try {
      const allTransactions: CryptoTransaction[] = [];

      // Fetch different transaction types
      const fetchPromises = [
        this.fetchTrades(params.since),
        this.fetchDeposits(params.since),
        this.fetchWithdrawals(params.since),
        this.fetchClosedOrders(params.since),
        this.fetchLedger(params.since)
      ];

      const results = await Promise.allSettled(fetchPromises);
      const labels = ['trades', 'deposits', 'withdrawals', 'closed_orders', 'ledger'];

      // Process all results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allTransactions.push(...result.value);
          this.logger.info(`Fetched ${result.value.length} ${labels[index]} from ${this.exchangeId}`);
        } else {
          this.logger.warn(`Failed to fetch ${labels[index]} from ${this.exchangeId} - Error: ${result.reason}`);
        }
      });

      const duration = Date.now() - startTime;
      this.logger.info(`Completed fetchRawTransactions for ${this.exchangeId} - Count: ${allTransactions.length}, Duration: ${duration}ms`);

      return allTransactions;
    } catch (error) {
      const message = `Failed to fetch transactions from ${this.exchangeId}`;
      this.logger.error(`${message} - Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new Error(message);
    }
  }

  protected async transformTransactions(rawTxs: CryptoTransaction[], params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    // Transform CryptoTransaction to universal Transaction format
    return rawTxs.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      datetime: tx.datetime || new Date(tx.timestamp).toISOString(),
      type: tx.type,
      status: tx.status || 'closed',
      amount: tx.amount,
      fee: tx.fee,
      price: tx.price,
      from: tx.info?.from,
      to: tx.info?.to,
      symbol: tx.symbol,
      source: this.exchangeId,
      network: 'exchange',
      metadata: {
        ...tx.info,
        originalTransactionType: tx.type
      }
    }));
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<any> {
    if (!this.enableOnlineVerification) {
      throw new Error(`Balance fetching not supported for ${this.exchangeId} CCXT adapter - enable online verification to fetch live balances`);
    }

    try {
      return await this.exchange.fetchBalance();
    } catch (error) {
      this.handleError(error, 'fetchBalance');
      throw error;
    }
  }

  protected async transformBalances(rawBalances: any, params: UniversalFetchParams): Promise<UniversalBalance[]> {
    const balances: UniversalBalance[] = [];

    for (const [currency, balanceInfo] of Object.entries(rawBalances)) {
      if (currency === 'info' || currency === 'free' || currency === 'used' || currency === 'total') {
        continue; // Skip CCXT metadata fields
      }

      const info = balanceInfo as any;
      if (info && typeof info === 'object' && info.total !== undefined) {
        balances.push({
          currency,
          total: info.total || 0,
          free: info.free || 0,
          used: info.used || 0,
        });
      }
    }

    return balances;
  }

  // CCXT-specific transaction fetching methods

  async fetchTrades(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchMyTrades']) {
        this.logger.debug(`Exchange ${this.exchangeId} does not support fetchMyTrades`);
        return [];
      }

      const trades = await this.exchange.fetchMyTrades(undefined, since);
      return this.transformCCXTTransactions(trades, 'trade');
    } catch (error) {
      this.handleError(error, 'fetchTrades');
      throw error;
    }
  }

  async fetchDeposits(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchDeposits']) {
        this.logger.debug(`Exchange ${this.exchangeId} does not support fetchDeposits`);
        return [];
      }

      const deposits = await this.exchange.fetchDeposits(undefined, since);
      return this.transformCCXTTransactions(deposits, 'deposit');
    } catch (error) {
      this.handleError(error, 'fetchDeposits');
      throw error;
    }
  }

  async fetchWithdrawals(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchWithdrawals']) {
        this.logger.debug(`Exchange ${this.exchangeId} does not support fetchWithdrawals`);
        return [];
      }

      const withdrawals = await this.exchange.fetchWithdrawals(undefined, since);
      return this.transformCCXTTransactions(withdrawals, 'withdrawal');
    } catch (error) {
      this.handleError(error, 'fetchWithdrawals');
      throw error;
    }
  }

  async fetchClosedOrders(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchClosedOrders']) {
        this.logger.debug(`Exchange ${this.exchangeId} does not support fetchClosedOrders`);
        return [];
      }

      const orders = await this.exchange.fetchClosedOrders(undefined, since);
      return this.transformCCXTTransactions(orders, 'order');
    } catch (error) {
      this.handleError(error, 'fetchClosedOrders');
      throw error;
    }
  }

  async fetchLedger(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchLedger']) {
        this.logger.debug(`Exchange ${this.exchangeId} does not support fetchLedger`);
        return [];
      }

      const ledgerEntries = await this.exchange.fetchLedger(undefined, since);
      return this.transformCCXTTransactions(ledgerEntries, 'ledger');
    } catch (error) {
      this.handleError(error, 'fetchLedger');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.exchange && this.exchange.close) {
      await this.exchange.close();
    }
    this.logger.info(`Closed connection to ${this.exchangeId}`);
  }

  /**
   * Transform array of CCXT transactions to our standard format
   * Can be overridden by subclasses for exchange-specific transformation
   */
  protected transformCCXTTransactions(transactions: any[], type: TransactionType): CryptoTransaction[] {
    return transactions
      .filter(tx => !TransactionTransformer.shouldFilterOut(tx))
      .map(tx => this.transformCCXTTransaction(tx, type));
  }

  /**
   * Transform a single CCXT transaction to our standard format
   * Can be overridden by subclasses for exchange-specific transformation
   */
  protected transformCCXTTransaction(transaction: any, type: TransactionType): CryptoTransaction {
    return TransactionTransformer.fromCCXT(transaction, type, this.exchangeId);
  }

  /**
   * Handle errors using centralized error handler
   * Can be overridden by subclasses for exchange-specific error handling
   */
  protected handleError(error: any, operation: string): void {
    ServiceErrorHandler.handle(error, operation, this.exchangeId, this.logger);
  }

  /**
   * Create exchange instance - to be implemented by subclasses
   * This allows each subclass to configure their specific exchange instance
   */
  protected abstract createExchange(): Exchange;
}