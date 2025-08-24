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

    // First, group trade transactions that represent the same order
    const groupedTransactions = this.groupTradeTransactions(rawTransactions);
    
    const transactions: UniversalTransaction[] = [];

    // Process grouped transactions
    for (const group of groupedTransactions) {
      try {
        let transaction: UniversalTransaction | null = null;
        
        if (group.length === 1) {
          // Single transaction, process normally
          transaction = this.createTransactionFromTrackAPI(group[0]);
        } else {
          // Multiple transactions representing the same trade, combine them
          transaction = this.combineTradeTransactions(group);
        }
        
        if (transaction && requestedTypes.includes(transaction.type)) {
          transactions.push(transaction);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create transaction from Track API group - Error: ${error instanceof Error ? error.message : "Unknown error"}, GroupSize: ${group.length}`,
        );
      }
    }

    this.logger.info(
      `Transformed ${transactions.length} transactions from ${rawTransactions.length} raw transactions (${groupedTransactions.length} groups)`,
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
      // Request all accounts including those with zero balances
      this.accounts = await this.apiClient.getAccounts({ 
        limit: 300,
        include_zero_balance: true,
        include_all: true
      });

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
        case "fiat_deposit":
          type = "deposit";
          side = "buy";
          break;
        case "fiat_withdrawal":
          type = "withdrawal";
          side = "sell";
          break;
        case "transfer":
          type = "transfer";
          side = "buy"; // Neutral for transfers
          break;
        case "fee":
        case "subscription":
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

      // Extract the correct symbol from nested Coinbase structures
      const symbol = this.extractSymbolFromTransaction(tx);
      
      
      // For buy/sell trades, we need to determine which asset we're actually receiving
      const { targetAmount, targetCurrency } = this.extractTradeAmount(tx, type, side);
      
      // Extract price information for trades
      const price = this.extractPriceFromTransaction(tx, type);
      
      return {
        id: `coinbase-track-${tx.id}`,
        type,
        timestamp,
        datetime: new Date(timestamp).toISOString(),
        status: tx.status === "completed" ? "closed" : "pending",
        symbol: symbol || tx.amount.currency, // Fallback to original logic
        amount: { amount: targetAmount, currency: targetCurrency },
        side,
        price,
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

  /**
   * Group trade transactions that represent the same order
   * 
   * The Track API returns separate transactions for each side of a trade:
   * - One for the asset going out (negative amount)
   * - One for the asset coming in (positive amount)
   * 
   * These can be grouped by their shared buy.id, sell.id, or trade.id
   */
  private groupTradeTransactions(rawTransactions: RawCoinbaseTransaction[]): RawCoinbaseTransaction[][] {
    const tradeGroups = new Map<string, RawCoinbaseTransaction[]>();
    const ungroupedTransactions: RawCoinbaseTransaction[] = [];

    for (const tx of rawTransactions) {
      // Try to find a grouping ID for trade-related transactions
      const groupId = this.extractTradeGroupIdFromTrackAPI(tx);
      
      if (groupId && this.isTradeTransaction(tx)) {
        if (!tradeGroups.has(groupId)) {
          tradeGroups.set(groupId, []);
        }
        tradeGroups.get(groupId)!.push(tx);
      } else {
        // Non-trade or ungroupable transaction
        ungroupedTransactions.push(tx);
      }
    }

    // Convert grouped trades and add ungrouped transactions
    const result: RawCoinbaseTransaction[][] = [];
    
    // Add groups (multiple transactions per group)
    for (const group of tradeGroups.values()) {
      result.push(group);
    }
    
    // Add ungrouped transactions (one transaction per group)
    for (const tx of ungroupedTransactions) {
      result.push([tx]);
    }

    this.logger.debug(
      `Grouped transactions - TotalGroups: ${result.length}, TradeGroups: ${tradeGroups.size}, UngroupedTransactions: ${ungroupedTransactions.length}`
    );

    return result;
  }

  /**
   * Extract the trade group ID from a Track API transaction
   */
  private extractTradeGroupIdFromTrackAPI(tx: RawCoinbaseTransaction): string | null {
    // For buy transactions, use buy.id as group identifier
    if (tx.buy?.id) {
      return tx.buy.id;
    }
    
    // For sell transactions, use sell.id as group identifier  
    if (tx.sell?.id) {
      return tx.sell.id;
    }
    
    // For trade transactions, use trade.id as group identifier
    if (tx.trade?.id) {
      return tx.trade.id;
    }
    
    return null;
  }

  /**
   * Check if a transaction is trade-related
   */
  private isTradeTransaction(tx: RawCoinbaseTransaction): boolean {
    return tx.type === "buy" || tx.type === "sell" || tx.type === "trade" || tx.type === "advanced_trade_fill";
  }

  /**
   * Combine multiple Track API transactions into a single trade transaction
   */
  private combineTradeTransactions(transactions: RawCoinbaseTransaction[]): UniversalTransaction | null {
    if (transactions.length === 0) return null;
    
    this.logger.debug(
      `Combining ${transactions.length} Track API transactions into single trade`
    );

    // Use the first transaction as the base, but we'll calculate the correct amounts
    const baseTransaction = transactions[0];
    const timestamp = Math.min(...transactions.map(tx => new Date(tx.created_at).getTime()));
    
    // Find the transaction with the crypto asset (positive amount, not negative fiat)
    const cryptoTransaction = transactions.find(tx => 
      tx.amount.currency !== 'CAD' && tx.amount.currency !== 'USD' && tx.amount.currency !== 'EUR'
    ) || transactions.find(tx => 
      !new Decimal(tx.amount.amount).isNegative()
    ) || baseTransaction;
    
    // Find the transaction with the fiat currency (usually negative for buys)
    const fiatTransaction = transactions.find(tx => 
      (tx.amount.currency === 'CAD' || tx.amount.currency === 'USD' || tx.amount.currency === 'EUR') &&
      new Decimal(tx.amount.amount).isNegative()
    );

    // Extract the correct symbol from the crypto and fiat currencies
    const baseCurrency = cryptoTransaction.amount.currency;
    const quoteCurrency = fiatTransaction?.amount.currency || 
                         baseTransaction.buy?.total?.currency || 
                         baseTransaction.sell?.total?.currency ||
                         baseTransaction.native_amount?.currency;

    const symbol = quoteCurrency ? `${baseCurrency}-${quoteCurrency}` : baseCurrency;
    
    // Amount is always the crypto asset amount
    const amount = new Decimal(cryptoTransaction.amount.amount).abs();
    
    // Price is the fiat amount (what was paid/received)
    let price: { amount: Decimal; currency: string } | undefined;
    if (fiatTransaction) {
      price = {
        amount: new Decimal(fiatTransaction.amount.amount).abs(),
        currency: fiatTransaction.amount.currency
      };
    } else if (baseTransaction.buy?.total) {
      price = {
        amount: new Decimal(baseTransaction.buy.total.amount),
        currency: baseTransaction.buy.total.currency
      };
    } else if (baseTransaction.sell?.total) {
      price = {
        amount: new Decimal(baseTransaction.sell.total.amount),
        currency: baseTransaction.sell.total.currency
      };
    }

    // Determine side from the crypto transaction type or amount sign
    const side = baseTransaction.type === "sell" || 
                 new Decimal(cryptoTransaction.amount.amount).isNegative() ? "sell" : "buy";

    // Extract fee (avoid double counting from multiple transactions)
    let fee: { amount: Decimal; currency: string } | undefined;
    if (baseTransaction.buy?.fee) {
      fee = {
        amount: new Decimal(baseTransaction.buy.fee.amount),
        currency: baseTransaction.buy.fee.currency
      };
    } else if (baseTransaction.sell?.fee) {
      fee = {
        amount: new Decimal(baseTransaction.sell.fee.amount),
        currency: baseTransaction.sell.fee.currency
      };
    }

    return {
      id: `coinbase-track-${baseTransaction.id}`,
      type: "trade",
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: baseTransaction.status === "completed" ? "closed" : "pending",
      symbol,
      amount: { amount, currency: baseCurrency },
      side,
      price,
      fee: fee || { amount: new Decimal(0), currency: baseCurrency },
      source: "coinbase",
      metadata: {
        combinedTransactions: transactions,
        groupId: this.extractTradeGroupIdFromTrackAPI(baseTransaction),
        adapterType: "track-api-combined",
      },
    };
  }

  /**
   * Extract symbol from Coinbase Track API transaction
   * 
   * The symbol should represent the trading pair (e.g., "BTC-USD", "ETH-CAD")
   * For buy/sell trades, construct symbol from base and quote currencies
   * For non-trades, return the single currency involved
   */
  private extractSymbolFromTransaction(tx: RawCoinbaseTransaction): string | undefined {
    // For buy transactions, use buy object to get quote currency and amount currency for base
    if (tx.type === "buy" && tx.buy) {
      const baseCurrency = tx.amount.currency; // The asset being bought (HNT)
      const quoteCurrency = tx.buy.total?.currency || tx.buy.subtotal?.currency; // The currency paid (CAD)
      
      if (baseCurrency && quoteCurrency) {
        return `${baseCurrency}-${quoteCurrency}`;
      }
    }
    
    // For sell transactions, use sell object to get quote currency
    if (tx.type === "sell" && tx.sell) {
      const baseCurrency = tx.amount.currency; // The asset being sold
      const quoteCurrency = tx.sell.total?.currency || tx.sell.subtotal?.currency; // The currency received
      
      if (baseCurrency && quoteCurrency) {
        return `${baseCurrency}-${quoteCurrency}`;
      }
    }
    
    // For advanced_trade_fill, try to infer from native_amount currency as quote
    if (tx.type === "advanced_trade_fill" && tx.native_amount) {
      const baseCurrency = tx.amount.currency;
      const quoteCurrency = tx.native_amount.currency;
      
      if (baseCurrency && quoteCurrency && baseCurrency !== quoteCurrency) {
        return `${baseCurrency}-${quoteCurrency}`;
      }
    }
    
    // For non-trading transactions (deposits, withdrawals, transfers), 
    // return the single currency involved
    return tx.amount.currency;
  }

  /**
   * Extract the correct amount and currency for the target asset in a trade
   * 
   * For buy/sell transactions: Return the asset being bought/sold (base currency)
   * The key insight is that tx.amount always represents the base asset, while 
   * tx.buy/tx.sell contains the quote currency information.
   */
  private extractTradeAmount(tx: RawCoinbaseTransaction, type: string, _side: "buy" | "sell"): {
    targetAmount: Decimal;
    targetCurrency: string;
  } {
    // For buy/sell transactions, the tx.amount is always the base currency (the asset being traded)
    // This is different from the quote currency (the currency used to pay/receive)
    if (tx.type === "buy" || tx.type === "sell" || type === "trade") {
      return {
        targetAmount: new Decimal(tx.amount.amount).abs(),
        targetCurrency: tx.amount.currency // This is the base currency (HNT, BTC, etc.)
      };
    }
    
    // For non-trade transactions (deposits, withdrawals, transfers), use the transaction amount directly
    // This ensures symbol and amount.currency are the same for non-trading operations, which is correct
    return {
      targetAmount: new Decimal(tx.amount.amount).abs(),
      targetCurrency: tx.amount.currency
    };
  }

  /**
   * Extract price information from Coinbase Track API transaction
   * 
   * For buy transactions: Price is the total cost in quote currency (what was paid)
   * For sell transactions: Price is the total proceeds in quote currency (what was received)
   * For non-trades: No price should be set (undefined)
   */
  private extractPriceFromTransaction(
    tx: RawCoinbaseTransaction, 
    type: string
  ): { amount: Decimal; currency: string } | undefined {
    // Only extract price for trade transactions
    if (type !== "trade") {
      return undefined;
    }

    // For buy transactions, use the total cost from buy object
    if (tx.type === "buy" && tx.buy) {
      if (tx.buy.total) {
        return {
          amount: new Decimal(tx.buy.total.amount),
          currency: tx.buy.total.currency
        };
      }
      if (tx.buy.subtotal) {
        return {
          amount: new Decimal(tx.buy.subtotal.amount),
          currency: tx.buy.subtotal.currency
        };
      }
    }

    // For sell transactions, use the total proceeds from sell object
    if (tx.type === "sell" && tx.sell) {
      if (tx.sell.total) {
        return {
          amount: new Decimal(tx.sell.total.amount),
          currency: tx.sell.total.currency
        };
      }
      if (tx.sell.subtotal) {
        return {
          amount: new Decimal(tx.sell.subtotal.amount),
          currency: tx.sell.subtotal.currency
        };
      }
    }

    // For advanced_trade_fill, try to use native_amount as price
    if (tx.type === "advanced_trade_fill" && tx.native_amount) {
      return {
        amount: new Decimal(tx.native_amount.amount).abs(),
        currency: tx.native_amount.currency
      };
    }

    return undefined;
  }

}
