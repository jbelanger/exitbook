import type {
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from "@crypto/core";
import { Decimal } from "decimal.js";
import { BaseAdapter } from "../../shared/adapters/base-adapter.ts";
import { CoinbaseAPIClient } from "./coinbase-api-client.ts";
import type {
  CoinbaseCredentials,
  RawCoinbaseAccount,
  RawCoinbaseTransaction,
  CoinbaseTransactionsParams,
} from "./types.ts";

/**
 * Direct Coinbase Track API adapter
 *
 * Uses Coinbase's Track API to fetch transaction and account data.
 * This adapter provides:
 *
 * 1. Clean data access through Track API endpoints
 * 2. CDP API key authentication with ES256 JWTs
 * 3. Direct transaction data without complex grouping logic
 * 4. Better error handling and debugging capabilities
 * 5. Type-safe API responses with comprehensive TypeScript interfaces
 *
 * Architecture: Raw Coinbase Track API → UniversalTransaction
 *
 * API Documentation: https://docs.cdp.coinbase.com/coinbase-app/track-apis/
 */
export class CoinbaseAdapter extends BaseAdapter {
  private apiClient: CoinbaseAPIClient;
  private accounts: RawCoinbaseAccount[] | null = null;

  constructor(
    config: UniversalExchangeAdapterConfig,
    credentials: CoinbaseCredentials,
  ) {
    super(config);

    this.apiClient = new CoinbaseAPIClient(credentials);

    this.logger.info(
      `Initialized Coinbase Track API adapter - Exchange: ${config.id}, Sandbox: ${credentials.sandbox || false}`,
    );
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "coinbase",
      name: "Coinbase Track API",
      type: "exchange",
      subType: "native",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: true,
        rateLimit: {
          requestsPerSecond: 3,
          burstLimit: 5,
        },
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      return await this.apiClient.testConnection();
    } catch (error) {
      this.logger.error(
        `Connection test failed - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  protected async fetchRawTransactions(
    params: UniversalFetchParams,
  ): Promise<RawCoinbaseTransaction[]> {
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit", 
      "withdrawal",
    ];
    this.logger.info(
      `Starting transactions fetch from Coinbase Track API for types: ${requestedTypes.join(", ")} - Since: ${params.since}`,
    );

    // First, get all accounts
    await this.loadAccounts();
    if (!this.accounts || this.accounts.length === 0) {
      this.logger.warn("No accounts available for transaction fetching");
      return [];
    }

    const allTransactions: RawCoinbaseTransaction[] = [];
    
    // Fetch transactions from each account
    for (const account of this.accounts) {
      this.logger.debug(`Fetching transactions for account: ${account.name} (${account.currency.code})`);
      
      try {
        const accountTransactions = await this.fetchAccountTransactions(
          account.id,
          params,
        );
        
        allTransactions.push(...accountTransactions);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch transactions from account ${account.id} (${account.name}): ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        // Continue processing other accounts
      }
    }

    this.logger.info(
      `Completed transactions fetch - Retrieved ${allTransactions.length} total transactions from ${this.accounts.length} accounts`,
    );
    return allTransactions;
  }

  /**
   * Fetch transactions for a specific account with pagination
   */
  private async fetchAccountTransactions(
    accountId: string,
    params: UniversalFetchParams,
  ): Promise<RawCoinbaseTransaction[]> {
    const transactionsParams: CoinbaseTransactionsParams = {
      limit: 100,
      order: 'desc',
    };

    const allTransactions: RawCoinbaseTransaction[] = [];
    let hasNextPage = true;
    let pageCount = 0;
    const maxPages = 100; // Safety limit
    let startingAfter: string | undefined;

    while (hasNextPage && pageCount < maxPages) {
      pageCount++;
      
      const response = await this.apiClient.getAccountTransactions(accountId, {
        ...transactionsParams,
        ...(startingAfter && { starting_after: startingAfter }),
      });

      if (response.data && response.data.length > 0) {
        // Filter by date if specified
        let filteredTransactions = response.data;
        if (params.since) {
          const sinceDate = new Date(params.since);
          filteredTransactions = response.data.filter(
            tx => new Date(tx.created_at) >= sinceDate
          );
        }
        if (params.until) {
          const untilDate = new Date(params.until);
          filteredTransactions = filteredTransactions.filter(
            tx => new Date(tx.created_at) <= untilDate
          );
        }

        allTransactions.push(...filteredTransactions);
        
        // Check if there's a next page
        hasNextPage = !!response.pagination?.next_uri;
        if (hasNextPage) {
          // Get the last transaction ID for pagination
          startingAfter = response.data[response.data.length - 1]?.id;
        }

        this.logger.debug(
          `Page ${pageCount}: Retrieved ${response.data.length} transactions (${filteredTransactions.length} after filtering) - Total: ${allTransactions.length}, HasNext: ${hasNextPage}`,
        );
      } else {
        this.logger.debug(
          `Page ${pageCount}: No transactions returned, ending pagination`,
        );
        break;
      }
    }

    return allTransactions;
  }

  protected async fetchRawBalances(): Promise<RawCoinbaseAccount[]> {
    this.logger.info("Fetching account balances from Coinbase");

    await this.loadAccounts();

    if (!this.accounts || this.accounts.length === 0) {
      this.logger.warn("No accounts available for balance fetching");
      return [];
    }

    this.logger.info(`Retrieved balances for ${this.accounts.length} accounts`);
    return this.accounts;
  }

  protected async transformTransactions(
    rawTransactions: RawCoinbaseTransaction[],
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit",
      "withdrawal",
    ];
    this.logger.info(
      `Transforming ${rawTransactions.length} raw Coinbase transactions for types: ${requestedTypes.join(", ")}`,
    );

    const transactions: UniversalTransaction[] = [];

    // Process each transaction from Track API
    for (const rawTransaction of rawTransactions) {
      try {
        const transaction = this.createTransactionFromTrackAPI(rawTransaction);
        if (transaction && requestedTypes.includes(transaction.type)) {
          transactions.push(transaction);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create transaction from Track API transaction ${rawTransaction.id} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    this.logger.info(
      `Transformed ${transactions.length} transactions from ${rawTransactions.length} raw transactions`,
    );
    return transactions;
  }

  protected async transformBalances(
    rawAccounts: RawCoinbaseAccount[],
  ): Promise<UniversalBalance[]> {
    this.logger.info(
      `Transforming ${rawAccounts.length} raw Coinbase accounts to universal balances`,
    );

    const balances: UniversalBalance[] = [];

    for (const account of rawAccounts) {
      try {
        const totalAmount = new Decimal(account.balance.amount);

        // Only include accounts with non-zero balances
        if (totalAmount.greaterThan(0)) {
          balances.push({
            currency: account.currency.code,
            free: totalAmount.toNumber(), // Track API doesn't distinguish free/used
            used: 0,
            total: totalAmount.toNumber(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to transform balance for account ${account.id} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    this.logger.info(
      `Transformed ${rawAccounts.length} accounts into ${balances.length} non-zero balances`,
    );
    return balances;
  }

  /**
   * Load accounts from Coinbase API with caching
   */
  private async loadAccounts(): Promise<void> {
    if (this.accounts !== null) {
      return; // Already loaded
    }

    try {
      this.logger.info("Loading Coinbase accounts...");
      this.accounts = await this.apiClient.getAccounts();

      // No need to filter active accounts for Track API - all returned accounts are usable

      this.logger.info(
        `Loaded ${this.accounts.length} Coinbase accounts`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load Coinbase accounts - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      this.accounts = [];
      throw error;
    }
  }

  /**
   * Create transaction from Track API transaction data
   */
  private createTransactionFromTrackAPI(
    tx: RawCoinbaseTransaction,
  ): UniversalTransaction | null {
    try {
      const timestamp = new Date(tx.created_at).getTime();
      const amount = new Decimal(tx.amount.amount).abs();
      
      // Map Coinbase transaction types to universal transaction types
      let type: "trade" | "deposit" | "withdrawal" | "transfer" | "fee" | "order" | "ledger";
      let side: "buy" | "sell" = "buy"; // Default side
      
      switch (tx.type) {
        case "buy":
          type = "trade";
          side = "buy";
          break;
        case "sell":
          type = "trade";
          side = "sell";
          break;
        case "trade":
        case "advanced_trade_fill":
          type = "trade";
          // Determine side from amount sign or other indicators
          side = new Decimal(tx.amount.amount).isNegative() ? "sell" : "buy";
          break;
        case "send":
          type = "withdrawal";
          side = "sell";
          break;
        case "deposit":
        case "receive":
          type = "deposit";
          side = "buy";
          break;
        case "transfer":
          type = "transfer";
          side = "buy"; // Neutral for transfers
          break;
        case "fee":
          type = "fee";
          side = "sell";
          break;
        case "retail_simple_dust":
          type = "trade"; // Dust collection is a conversion/trading operation
          side = new Decimal(tx.amount.amount).isNegative() ? "sell" : "buy";
          break;
        default:
          this.logger.debug(
            `Unknown transaction type: ${tx.type}, treating as transfer`,
          );
          type = "transfer";
          side = "buy";
      }

      // Extract fee information if available
      let fee: { amount: Decimal; currency: string } | undefined;
      if (tx.network?.transaction_fee) {
        fee = {
          amount: new Decimal(tx.network.transaction_fee.amount),
          currency: tx.network.transaction_fee.currency,
        };
      }

      return {
        id: `coinbase-track-${tx.id}`,
        type,
        timestamp,
        datetime: new Date(timestamp).toISOString(),
        status: tx.status === "completed" ? "closed" : "pending",
        symbol: tx.amount.currency,
        amount: { amount, currency: tx.amount.currency },
        side,
        fee: fee ? fee : { amount: new Decimal(0), currency: tx.amount.currency },
        source: "coinbase",
        metadata: {
          trackTransaction: tx, // Store original Track API transaction for debugging
          transactionType: tx.type,
          status: tx.status,
          nativeAmount: tx.native_amount,
          adapterType: "track-api",
        },
      };
    } catch (error) {
      this.logger.error(
        `Error creating transaction from Track API transaction ${tx.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return null;
    }
  }

}
