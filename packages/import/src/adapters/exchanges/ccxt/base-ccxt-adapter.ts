// @ts-ignore - CCXT types compatibility
import { CryptoTransaction, ExchangeBalance, ExchangeCapabilities, ExchangeConfig, ExchangeInfo, IExchangeAdapter, ServiceError, TransactionType } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { Exchange } from 'ccxt';
import { ServiceErrorHandler } from '../../../utils/exchange-error-handler.ts';
import { TransactionTransformer } from '../../../utils/transaction-transformer.ts';


/**
 * Base class for all CCXT-based exchange adapters
 * Provides common functionality and eliminates code duplication
 */
export abstract class BaseCCXTAdapter implements IExchangeAdapter {
  protected exchange: Exchange;
  protected logger: Logger;
  protected config: ExchangeConfig;
  protected enableOnlineVerification: boolean;

  constructor(exchange: Exchange, config: ExchangeConfig, enableOnlineVerification: boolean = false, loggerSuffix?: string) {
    this.exchange = exchange;
    this.config = config;
    this.enableOnlineVerification = enableOnlineVerification;
    this.logger = getLogger(`${loggerSuffix || 'CCXTAdapter'}:${config.id}`);

    // Enable rate limiting and other common settings
    this.exchange.enableRateLimit = true;
    this.exchange.rateLimit = config.options?.rateLimit || 1000;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.exchange.loadMarkets();
      await this.exchange.fetchBalance();
      this.logger.info(`Connection test successful for ${this.config.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Connection test failed for ${this.config.id} - Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const capabilities: ExchangeCapabilities = {
      fetchMyTrades: Boolean(this.exchange.has['fetchMyTrades']),
      fetchDeposits: Boolean(this.exchange.has['fetchDeposits']),
      fetchWithdrawals: Boolean(this.exchange.has['fetchWithdrawals']),
      fetchLedger: Boolean(this.exchange.has['fetchLedger']),
      fetchClosedOrders: Boolean(this.exchange.has['fetchClosedOrders']),
      fetchBalance: this.enableOnlineVerification && Boolean(this.exchange.has['fetchBalance']),
      fetchOrderBook: Boolean(this.exchange.has['fetchOrderBook']),
      fetchTicker: Boolean(this.exchange.has['fetchTicker']),
    };

    return {
      id: this.config.id,
      name: this.exchange.name || this.config.id,
      version: this.exchange.version,
      capabilities,
      rateLimit: this.exchange.rateLimit,
    };
  }

  async fetchAllTransactions(since?: number): Promise<CryptoTransaction[]> {
    const startTime = Date.now();
    this.logger.info(`Starting fetchAllTransactions for ${this.config.id}`);

    try {
      const allTransactions: CryptoTransaction[] = [];

      // Fetch different transaction types
      const fetchPromises = [
        this.fetchTrades(since),
        this.fetchDeposits(since),
        this.fetchWithdrawals(since),
        this.fetchClosedOrders(since),
        this.fetchLedger(since)
      ];

      const results = await Promise.allSettled(fetchPromises);
      const labels = ['trades', 'deposits', 'withdrawals', 'closed_orders', 'ledger'];

      // Process all results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allTransactions.push(...result.value);
          this.logger.info(`Fetched ${result.value.length} ${labels[index]} from ${this.config.id}`);
        } else {
          this.logger.warn(`Failed to fetch ${labels[index]} from ${this.config.id} - Error: ${result.reason}`);
        }
      });

      const duration = Date.now() - startTime;
      this.logger.info(`Completed fetchAllTransactions for ${this.config.id} - Count: ${allTransactions.length}, Duration: ${duration}ms`);

      return allTransactions;
    } catch (error) {
      throw new ServiceError(
        `Failed to fetch transactions from ${this.config.id}`,
        this.config.id,
        'fetchAllTransactions',
        error as Error
      );
    }
  }

  async fetchTrades(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchMyTrades']) {
        this.logger.debug(`Exchange ${this.config.id} does not support fetchMyTrades`);
        return [];
      }

      const trades = await this.exchange.fetchMyTrades(undefined, since);
      return this.transformTransactions(trades, 'trade');
    } catch (error) {
      this.handleError(error, 'fetchTrades');
      throw error;
    }
  }

  async fetchDeposits(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchDeposits']) {
        this.logger.debug(`Exchange ${this.config.id} does not support fetchDeposits`);
        return [];
      }

      const deposits = await this.exchange.fetchDeposits(undefined, since);
      return this.transformTransactions(deposits, 'deposit');
    } catch (error) {
      this.handleError(error, 'fetchDeposits');
      throw error;
    }
  }

  async fetchWithdrawals(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchWithdrawals']) {
        this.logger.debug(`Exchange ${this.config.id} does not support fetchWithdrawals`);
        return [];
      }

      const withdrawals = await this.exchange.fetchWithdrawals(undefined, since);
      return this.transformTransactions(withdrawals, 'withdrawal');
    } catch (error) {
      this.handleError(error, 'fetchWithdrawals');
      throw error;
    }
  }

  async fetchClosedOrders(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchClosedOrders']) {
        this.logger.debug(`Exchange ${this.config.id} does not support fetchClosedOrders`);
        return [];
      }

      const orders = await this.exchange.fetchClosedOrders(undefined, since);
      return this.transformTransactions(orders, 'order');
    } catch (error) {
      this.handleError(error, 'fetchClosedOrders');
      throw error;
    }
  }

  async fetchLedger(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has['fetchLedger']) {
        this.logger.debug(`Exchange ${this.config.id} does not support fetchLedger`);
        return [];
      }

      const ledgerEntries = await this.exchange.fetchLedger(undefined, since);
      return this.transformTransactions(ledgerEntries, 'ledger');
    } catch (error) {
      this.handleError(error, 'fetchLedger');
      throw error;
    }
  }

  async fetchBalance(): Promise<ExchangeBalance[]> {
    if (!this.enableOnlineVerification) {
      throw new Error(`Balance fetching not supported for ${this.config.id} CCXT adapter - enable online verification to fetch live balances`);
    }

    try {
      const balance = await this.exchange.fetchBalance();

      // Transform CCXT balance format to our standard format
      const balances: ExchangeBalance[] = [];

      for (const [currency, balanceInfo] of Object.entries(balance)) {
        if (currency === 'info' || currency === 'free' || currency === 'used' || currency === 'total') {
          continue; // Skip CCXT metadata fields
        }

        const info = balanceInfo as any;
        if (info && typeof info === 'object' && info.total !== undefined) {
          balances.push({
            currency,
            balance: info.free || 0,
            used: info.used || 0,
            total: info.total || 0,
          });
        }
      }

      return balances;
    } catch (error) {
      this.handleError(error, 'fetchBalance');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.exchange && this.exchange.close) {
      await this.exchange.close();
    }
    this.logger.info(`Closed connection to ${this.config.id}`);
  }

  /**
   * Transform array of CCXT transactions to our standard format
   * Can be overridden by subclasses for exchange-specific transformation
   */
  protected transformTransactions(transactions: any[], type: TransactionType): CryptoTransaction[] {
    return transactions
      .filter(tx => !TransactionTransformer.shouldFilter(tx))
      .map(tx => this.transformTransaction(tx, type));
  }

  /**
   * Transform a single CCXT transaction to our standard format
   * Can be overridden by subclasses for exchange-specific transformation
   */
  protected transformTransaction(transaction: any, type: TransactionType): CryptoTransaction {
    return TransactionTransformer.fromCCXT(transaction, type, this.config.id);
  }

  /**
   * Handle errors using centralized error handler
   * Can be overridden by subclasses for exchange-specific error handling
   */
  protected handleError(error: any, operation: string): void {
    ServiceErrorHandler.handle(error, operation, this.config.id, this.logger);
  }

  /**
   * Create exchange instance - to be implemented by subclasses
   * This allows each subclass to configure their specific exchange instance
   */
  protected abstract createExchange(): Exchange;

  /**
   * Get exchange-specific capabilities - can be overridden
   * Allows subclasses to modify capabilities based on exchange limitations
   */
  protected getExchangeCapabilities(): Partial<ExchangeCapabilities> {
    return {};
  }
}