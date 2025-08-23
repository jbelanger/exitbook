import type {
  CryptoTransaction,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from "@crypto/core";
import type { Exchange } from "ccxt";
import { BaseAdapter } from "../shared/adapters/base-adapter.ts";
import { isObject, hasProperty } from "@crypto/shared-utils";
import type { CcxtBalanceInfo, CcxtBalances } from "./ccxt-types.ts";
import { TransactionTransformer } from "../shared/utils/transaction-transformer.ts";
import type { CCXTTransaction } from "../shared/utils/transaction-transformer.ts";
import { ServiceErrorHandler } from "./exchange-error-handler.ts";

// CCXT Balance structure

/**
 * Base class for all CCXT-based exchange adapters in the universal adapter system
 * Extends the universal BaseAdapter and provides CCXT-specific functionality
 */
export abstract class BaseCCXTAdapter extends BaseAdapter {
  protected exchange: Exchange;
  protected exchangeId: string;
  protected enableOnlineVerification: boolean;

  constructor(
    exchange: Exchange,
    config: UniversalExchangeAdapterConfig,
    enableOnlineVerification: boolean = false,
  ) {
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
      type: "exchange",
      subType: "ccxt",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: true,
        rateLimit: {
          requestsPerSecond: this.exchange.rateLimit
            ? 1000 / this.exchange.rateLimit
            : 10,
          burstLimit: 50,
        },
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.exchange.loadMarkets();
      await this.exchange.fetchBalance();
      this.logger.info(`Connection test successful for ${this.exchangeId}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Connection test failed for ${this.exchangeId} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  protected async fetchRawTransactions(
    params: UniversalFetchParams,
  ): Promise<CryptoTransaction[]> {
    const startTime = Date.now();
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit",
      "withdrawal",
      "order",
      "ledger",
    ];
    this.logger.info(
      `Starting fetchRawTransactions for ${this.exchangeId} with types: ${requestedTypes.join(", ")}`,
    );

    try {
      const allTransactions: CryptoTransaction[] = [];
      const fetchPromises: Array<{
        promise: Promise<CryptoTransaction[]>;
        label: string;
      }> = [];

      // Only call methods for requested transaction types
      if (requestedTypes.includes("trade")) {
        fetchPromises.push({
          promise: this.fetchTrades(params.since),
          label: "trades",
        });
      }

      if (requestedTypes.includes("deposit")) {
        fetchPromises.push({
          promise: this.fetchDeposits(params.since),
          label: "deposits",
        });
      }

      if (requestedTypes.includes("withdrawal")) {
        fetchPromises.push({
          promise: this.fetchWithdrawals(params.since),
          label: "withdrawals",
        });
      }

      if (requestedTypes.includes("order")) {
        fetchPromises.push({
          promise: this.fetchClosedOrders(params.since),
          label: "closed_orders",
        });
      }

      if (requestedTypes.includes("ledger")) {
        fetchPromises.push({
          promise: this.fetchLedger(params.since),
          label: "ledger",
        });
      }

      // Execute only the needed API calls
      const results = await Promise.allSettled(
        fetchPromises.map((fp) => fp.promise),
      );

      // Process all results
      results.forEach((result, index) => {
        const label = fetchPromises[index].label;
        if (result.status === "fulfilled") {
          allTransactions.push(...result.value);
          this.logger.info(
            `Fetched ${result.value.length} ${label} from ${this.exchangeId}`,
          );
        } else {
          this.logger.warn(
            `Failed to fetch ${label} from ${this.exchangeId} - Error: ${result.reason}`,
          );
        }
      });

      const duration = Date.now() - startTime;
      const skipCount = 5 - fetchPromises.length; // Total possible calls - actual calls
      this.logger.info(
        `Completed fetchRawTransactions for ${this.exchangeId} - Count: ${allTransactions.length}, Duration: ${duration}ms, Skipped ${skipCount} API calls`,
      );

      return allTransactions;
    } catch (error) {
      const message = `Failed to fetch transactions from ${this.exchangeId}`;
      this.logger.error(
        `${message} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new Error(message);
    }
  }

  protected async transformTransactions(
    rawTxs: CryptoTransaction[],
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    // Transform CryptoTransaction to universal Transaction format
    return rawTxs.map((tx) => ({
      id: tx.id,
      timestamp: tx.timestamp,
      datetime: tx.datetime || new Date(tx.timestamp).toISOString(),
      type: tx.type,
      status: tx.status || "closed",
      amount: tx.amount,
      fee: tx.fee,
      price: tx.price,
      side: tx.side, // Include the side field directly
      from:
        tx.info &&
        typeof tx.info === "object" &&
        "from" in tx.info &&
        typeof tx.info.from === "string"
          ? tx.info.from
          : undefined,
      to:
        tx.info &&
        typeof tx.info === "object" &&
        "to" in tx.info &&
        typeof tx.info.to === "string"
          ? tx.info.to
          : undefined,
      symbol: tx.symbol,
      source: this.exchangeId,
      network: "exchange",
      metadata: {
        ...(isObject(tx.info) ? tx.info : {}),
        originalTransactionType: tx.type,
      },
    }));
  }

  protected async fetchRawBalances(
    params: UniversalFetchParams,
  ): Promise<CcxtBalances> {
    if (!this.enableOnlineVerification) {
      throw new Error(
        `Balance fetching not supported for ${this.exchangeId} CCXT adapter - enable online verification to fetch live balances`,
      );
    }

    try {
      return await this.exchange.fetchBalance();
    } catch (error) {
      this.handleError(error, "fetchBalance");
      throw error;
    }
  }

  protected async transformBalances(
    rawBalances: CcxtBalances,
    params: UniversalFetchParams,
  ): Promise<UniversalBalance[]> {
    const balances: UniversalBalance[] = [];

    for (const [currency, balanceInfo] of Object.entries(rawBalances)) {
      if (
        currency === "info" ||
        currency === "free" ||
        currency === "used" ||
        currency === "total"
      ) {
        continue; // Skip CCXT metadata fields
      }

      const info = balanceInfo as CcxtBalanceInfo;
      if (isObject(info) && hasProperty(info, "total")) {
        const total = typeof info.total === "number" ? info.total : 0;
        const free = typeof info.free === "number" ? info.free : 0;
        const used = typeof info.used === "number" ? info.used : 0;

        balances.push({
          currency,
          total,
          free,
          used,
        });
      }
    }

    return balances;
  }

  // CCXT-specific transaction fetching methods

  async fetchTrades(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has["fetchMyTrades"]) {
        this.logger.debug(
          `Exchange ${this.exchangeId} does not support fetchMyTrades`,
        );
        return [];
      }

      const trades = await this.exchange.fetchMyTrades(undefined, since);
      return this.transformCCXTTransactions(
        trades as CCXTTransaction[],
        "trade",
      );
    } catch (error) {
      this.handleError(error, "fetchTrades");
      throw error;
    }
  }

  async fetchDeposits(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has["fetchDeposits"]) {
        this.logger.debug(
          `Exchange ${this.exchangeId} does not support fetchDeposits`,
        );
        return [];
      }

      const deposits = await this.exchange.fetchDeposits(undefined, since);
      return this.transformCCXTTransactions(
        deposits as CCXTTransaction[],
        "deposit",
      );
    } catch (error) {
      this.handleError(error, "fetchDeposits");
      throw error;
    }
  }

  async fetchWithdrawals(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has["fetchWithdrawals"]) {
        this.logger.debug(
          `Exchange ${this.exchangeId} does not support fetchWithdrawals`,
        );
        return [];
      }

      const withdrawals = await this.exchange.fetchWithdrawals(
        undefined,
        since,
      );
      return this.transformCCXTTransactions(
        withdrawals as CCXTTransaction[],
        "withdrawal",
      );
    } catch (error) {
      this.handleError(error, "fetchWithdrawals");
      throw error;
    }
  }

  async fetchClosedOrders(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has["fetchClosedOrders"]) {
        this.logger.debug(
          `Exchange ${this.exchangeId} does not support fetchClosedOrders`,
        );
        return [];
      }

      const orders = await this.exchange.fetchClosedOrders(undefined, since);
      return this.transformCCXTTransactions(
        orders as CCXTTransaction[],
        "order",
      );
    } catch (error) {
      this.handleError(error, "fetchClosedOrders");
      throw error;
    }
  }

  async fetchLedger(since?: number): Promise<CryptoTransaction[]> {
    try {
      if (!this.exchange.has["fetchLedger"]) {
        this.logger.debug(
          `Exchange ${this.exchangeId} does not support fetchLedger`,
        );
        return [];
      }

      const ledgerEntries = await this.exchange.fetchLedger(undefined, since);
      return this.transformCCXTTransactions(
        ledgerEntries as CCXTTransaction[],
        "ledger",
      );
    } catch (error) {
      this.handleError(error, "fetchLedger");
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
  protected transformCCXTTransactions(
    transactions: CCXTTransaction[],
    type: TransactionType,
  ): CryptoTransaction[] {
    return transactions
      .filter((tx) => !TransactionTransformer.shouldFilterOut(tx))
      .map((tx) => this.transformCCXTTransaction(tx, type));
  }

  /**
   * Transform a single CCXT transaction to our standard format
   * Can be overridden by subclasses for exchange-specific transformation
   */
  protected transformCCXTTransaction(
    transaction: CCXTTransaction,
    type: TransactionType,
  ): CryptoTransaction {
    return TransactionTransformer.fromCCXT(transaction, type, this.exchangeId);
  }

  /**
   * Handle errors using centralized error handler
   * Can be overridden by subclasses for exchange-specific error handling
   */
  protected handleError(error: unknown, operation: string): void {
    ServiceErrorHandler.handle(error, operation, this.exchangeId, this.logger);
  }

  /**
   * Create exchange instance - to be implemented by subclasses
   * This allows each subclass to configure their specific exchange instance
   */
  protected abstract createExchange(): Exchange;
}
