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
  CoinbaseTransactionsParams,
  RawCoinbaseAccount,
  RawCoinbaseTransaction,
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
          this.logger.debug(`PROCESSING_SINGLE - TX: ${group[0].id}, Type: ${group[0].type}`);
          transaction = this.createTransactionFromTrackAPI(group[0]);
        } else {
          // Multiple transactions representing the same trade, combine them
          this.logger.debug(`PROCESSING_COMBINED - Group size: ${group.length}, TXs: ${group.map(tx => tx.id).join(', ')}`);
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
      
      // DEBUG: Log raw transaction data to compare with CSV
      this.logger.debug(`RAW TX: ${tx.id}, Type: ${tx.type}, Amount: ${tx.amount.amount} ${tx.amount.currency}, Status: ${tx.status}`);
      if (tx.buy) this.logger.debug(`  BUY: total=${tx.buy.total?.amount} ${tx.buy.total?.currency}, subtotal=${tx.buy.subtotal?.amount}`);
      if (tx.sell) this.logger.debug(`  SELL: total=${tx.sell.total?.amount} ${tx.sell.total?.currency}, subtotal=${tx.sell.subtotal?.amount}`);
      if (tx.native_amount) this.logger.debug(`  NATIVE: ${tx.native_amount.amount} ${tx.native_amount.currency}`);
      
      // Map Coinbase transaction types to universal transaction types
      let type: "trade" | "deposit" | "withdrawal" | "transfer" | "fee" | "order" | "ledger";
      let side: "buy" | "sell" | undefined = undefined; // No default side
      
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
          // Determine side from buy/sell objects, not amount sign (amount sign indicates money flow, not trade semantics)
          if (tx.buy) {
            side = "buy";
            this.logger.debug(`TRADE_SIDE - TX: ${tx.id}, Has buy object -> BUY side`);
          } else if (tx.sell) {
            side = "sell"; 
            this.logger.debug(`TRADE_SIDE - TX: ${tx.id}, Has sell object -> SELL side`);
          } else {
            // Fallback to amount sign for advanced_trade_fill without buy/sell objects
            side = new Decimal(tx.amount.amount).isNegative() ? "sell" : "buy";
            this.logger.debug(`TRADE_SIDE - TX: ${tx.id}, No buy/sell objects, using amount sign -> ${side}`);
          }
          break;
        case "send":
          // "send" transactions can be either deposits OR withdrawals
          // Check amount sign: positive = deposit (external receive), negative = withdrawal  
          if (new Decimal(tx.amount.amount).isPositive()) {
            type = "deposit";
            this.logger.debug(`SEND_CLASSIFICATION - TX: ${tx.id}, Amount: ${tx.amount.amount} ${tx.amount.currency} -> DEPOSIT (positive amount)`);
          } else {
            type = "withdrawal";
            this.logger.debug(`SEND_CLASSIFICATION - TX: ${tx.id}, Amount: ${tx.amount.amount} ${tx.amount.currency} -> WITHDRAWAL (negative amount)`);
          }
          break;
        case "deposit":
        case "receive":
        case "fiat_deposit":
          type = "deposit";
          // Don't set side for deposits - side is only relevant for trades
          break;
        case "fiat_withdrawal":
          type = "withdrawal";
          // Don't set side for withdrawals - side is only relevant for trades
          break;
        case "transfer":
          type = "transfer";
          // Don't set side for transfers
          break;
        case "fee":
        case "subscription":
          type = "fee";
          // Don't set side for fees
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
          // Don't set side for transfers - side is only relevant for trades
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
      const { targetAmount, targetCurrency } = this.extractTradeAmount(tx, type, side || undefined);
      
      // Extract price information for trades
      const price = this.extractPriceFromTransaction(tx, type);
      
      const baseTransaction = {
        id: `coinbase-track-${tx.id}`,
        type,
        timestamp,
        datetime: new Date(timestamp).toISOString(),
        status: (tx.status === "completed" ? "closed" : "pending") as "closed" | "pending",
        symbol: symbol || tx.amount.currency, // Fallback to original logic
        amount: { amount: targetAmount, currency: targetCurrency },
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

      // DEBUG: Log final transaction structure
      this.logger.debug(`FINAL_TX - TX: ${tx.id}, Type: ${type}, Side: ${side}, Amount: ${baseTransaction.amount.amount} ${baseTransaction.amount.currency}, Price: ${baseTransaction.price?.amount} ${baseTransaction.price?.currency}`);

      // Only include side for trade transactions
      if (type === "trade" && side) {
        const tradeTransaction = { ...baseTransaction, side };
        this.logger.debug(`Creating trade transaction with side: ${side} for type: ${type}, tx: ${tx.id}`);
        return tradeTransaction;
      }
      
      // Explicitly set side to undefined for non-trade transactions to satisfy exactOptionalPropertyTypes
      const nonTradeTransaction = { ...baseTransaction, side: undefined };
      this.logger.debug(`Creating non-trade transaction with explicit undefined side for type: ${type}, tx: ${tx.id}`);
      return nonTradeTransaction;
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
   * For advanced_trade_fill without IDs, group by timestamp + similar amounts
   */
  private groupTradeTransactions(rawTransactions: RawCoinbaseTransaction[]): RawCoinbaseTransaction[][] {
    const tradeGroups = new Map<string, RawCoinbaseTransaction[]>();
    const ungroupedTransactions: RawCoinbaseTransaction[] = [];
    const advancedTradeFills: RawCoinbaseTransaction[] = [];

    for (const tx of rawTransactions) {
      // Try to find a grouping ID for trade-related transactions
      const groupId = this.extractTradeGroupIdFromTrackAPI(tx);
      
      if (groupId && this.isTradeTransaction(tx)) {
        if (!tradeGroups.has(groupId)) {
          tradeGroups.set(groupId, []);
        }
        tradeGroups.get(groupId)!.push(tx);
      } else if (tx.type === "advanced_trade_fill") {
        // Special handling for advanced_trade_fill without group IDs
        advancedTradeFills.push(tx);
      } else {
        // Non-trade or ungroupable transaction
        ungroupedTransactions.push(tx);
      }
    }
    
    // Group advanced_trade_fill transactions by timestamp proximity (within 1 second)
    // and currency pair relationships
    this.groupAdvancedTradeFills(advancedTradeFills, tradeGroups);

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
   * Group advanced_trade_fill transactions that don't have explicit group IDs
   * by looking for pairs with opposite amounts and matching timestamps
   */
  private groupAdvancedTradeFills(
    advancedTradeFills: RawCoinbaseTransaction[],
    tradeGroups: Map<string, RawCoinbaseTransaction[]>
  ): void {
    // Sort by timestamp to process chronologically
    const sortedFills = advancedTradeFills.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const processed = new Set<string>();
    
    for (let i = 0; i < sortedFills.length; i++) {
      const tx1 = sortedFills[i];
      if (processed.has(tx1.id)) continue;
      
      const tx1Timestamp = new Date(tx1.created_at).getTime();
      const tx1Amount = new Decimal(tx1.amount.amount);
      
      // Look for a matching transaction within 5 seconds
      for (let j = i + 1; j < sortedFills.length; j++) {
        const tx2 = sortedFills[j];
        if (processed.has(tx2.id)) continue;
        
        const tx2Timestamp = new Date(tx2.created_at).getTime();
        const timeDiff = Math.abs(tx2Timestamp - tx1Timestamp);
        
        // Stop looking if we're too far ahead in time
        if (timeDiff > 5000) break; // 5 seconds
        
        // Check if these could be opposite sides of the same trade
        if (this.areMatchingTradePair(tx1, tx2)) {
          const groupId = `advanced_trade_${Math.min(tx1Timestamp, tx2Timestamp)}_${tx1.id.slice(0, 8)}`;
          tradeGroups.set(groupId, [tx1, tx2]);
          processed.add(tx1.id);
          processed.add(tx2.id);
          
          this.logger.debug(`GROUPED_ADVANCED_FILLS: ${tx1.id} + ${tx2.id} → ${groupId}`);
          break;
        }
      }
      
      // If no match found, add as individual transaction
      if (!processed.has(tx1.id)) {
        processed.add(tx1.id);
        // Add as single-item group for consistent processing
        const groupId = `advanced_trade_single_${tx1Timestamp}_${tx1.id.slice(0, 8)}`;
        tradeGroups.set(groupId, [tx1]);
        this.logger.debug(`UNGROUPED_ADVANCED_FILL: ${tx1.id} → ${groupId}`);
      }
    }
  }

  /**
   * Check if two advanced_trade_fill transactions are matching sides of the same trade
   */
  private areMatchingTradePair(tx1: RawCoinbaseTransaction, tx2: RawCoinbaseTransaction): boolean {
    const amount1 = new Decimal(tx1.amount.amount);
    const amount2 = new Decimal(tx2.amount.amount);
    
    // One should be positive, one negative (opposite sides)
    if (amount1.isPositive() === amount2.isPositive()) {
      return false;
    }
    
    // Different currencies (base/quote pair)
    if (tx1.amount.currency === tx2.amount.currency) {
      return false;
    }
    
    // Check if native_amounts roughly match (within 5% for fees/spreads)
    if (tx1.native_amount && tx2.native_amount) {
      const native1 = new Decimal(tx1.native_amount.amount).abs();
      const native2 = new Decimal(tx2.native_amount.amount).abs();
      const diff = native1.minus(native2).abs();
      const avgNative = native1.plus(native2).dividedBy(2);
      
      if (avgNative.greaterThan(0)) {
        const percentDiff = diff.dividedBy(avgNative);
        if (percentDiff.lessThanOrEqualTo(0.05)) { // Within 5%
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Extract the trade group ID from a Track API transaction
   */
  private extractTradeGroupIdFromTrackAPI(tx: RawCoinbaseTransaction): string | null {
    // DEBUG: Log grouping attempts
    this.logger.debug(`GROUP_ID - TX: ${tx.id}, Type: ${tx.type}, Buy.id: ${tx.buy?.id}, Sell.id: ${tx.sell?.id}, Trade.id: ${tx.trade?.id}`);
    
    // For buy transactions, use buy.id as group identifier
    if (tx.buy?.id) {
      this.logger.debug(`  GROUPED_BY_BUY: ${tx.buy.id}`);
      return tx.buy.id;
    }
    
    // For sell transactions, use sell.id as group identifier  
    if (tx.sell?.id) {
      this.logger.debug(`  GROUPED_BY_SELL: ${tx.sell.id}`);
      return tx.sell.id;
    }
    
    // For trade transactions, use trade.id as group identifier
    if (tx.trade?.id) {
      this.logger.debug(`  GROUPED_BY_TRADE: ${tx.trade.id}`);
      return tx.trade.id;
    }
    
    this.logger.debug(`  NO_GROUP_ID - Transaction will be processed individually`);
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
      `COMBINE_TRADES - Combining ${transactions.length} Track API transactions into single trade`
    );
    
    // DEBUG: Log each transaction being combined
    for (const tx of transactions) {
      this.logger.debug(`  COMBINE_TX: ${tx.id}, Type: ${tx.type}, Amount: ${tx.amount.amount} ${tx.amount.currency}`);
    }

    // Use the first transaction as the base, but we'll calculate the correct amounts
    const baseTransaction = transactions[0];
    const timestamp = Math.min(...transactions.map(tx => new Date(tx.created_at).getTime()));
    
    // Find the crypto and fiat assets based on currency hierarchy
    // Traditional fiat currencies (CAD, USD, EUR) are always fiat
    // For stablecoins like USDC, they're crypto when paired with traditional fiat
    const traditionalFiatCurrencies = ['CAD', 'USD', 'EUR'];
    const allFiatCurrencies = [...traditionalFiatCurrencies, 'USDC'];
    
    // First try to find a traditional fiat currency
    const traditionalFiatTransaction = transactions.find(tx => 
      traditionalFiatCurrencies.includes(tx.amount.currency)
    );
    
    // If we have a traditional fiat, everything else is crypto (including USDC)
    let cryptoTransaction: RawCoinbaseTransaction;
    let fiatTransaction: RawCoinbaseTransaction;
    
    if (traditionalFiatTransaction) {
      fiatTransaction = traditionalFiatTransaction;
      cryptoTransaction = transactions.find(tx => tx !== traditionalFiatTransaction) || baseTransaction;
    } else {
      // No traditional fiat - use the existing logic for crypto vs stablecoin trades
      cryptoTransaction = transactions.find(tx => 
        !allFiatCurrencies.includes(tx.amount.currency)
      ) || baseTransaction;
      fiatTransaction = transactions.find(tx => 
        allFiatCurrencies.includes(tx.amount.currency)
      ) || transactions.find(tx => tx !== cryptoTransaction) || baseTransaction;
    }

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

    // Determine side based on crypto currency perspective in the trade pair
    // For CRYPTO-FIAT pairs: positive crypto amount = buy crypto, negative crypto amount = sell crypto
    let side: "buy" | "sell";
    
    if (baseTransaction.type === "sell") {
      side = "sell";
      this.logger.debug(`COMBINE_SIDE - BaseTransaction type 'sell' -> SELL side`);
    } else if (baseTransaction.type === "buy") {
      side = "buy"; 
      this.logger.debug(`COMBINE_SIDE - BaseTransaction type 'buy' -> BUY side`);
    } else {
      // For combined transactions, determine side from crypto amount perspective
      const cryptoAmount = new Decimal(cryptoTransaction.amount.amount);
      if (cryptoAmount.isNegative()) {
        side = "sell"; // Selling crypto (crypto goes out)
        this.logger.debug(`COMBINE_SIDE - Crypto amount ${cryptoAmount} negative -> SELL side`);
      } else {
        side = "buy"; // Buying crypto (crypto comes in)
        this.logger.debug(`COMBINE_SIDE - Crypto amount ${cryptoAmount} positive -> BUY side`);
      }
    }

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

    const result: UniversalTransaction = {
      id: `coinbase-track-${baseTransaction.id}`,
      type: "trade",
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: baseTransaction.status === "completed" ? "closed" : "pending",
      symbol,
      amount: { amount, currency: baseCurrency },
      side: side as "buy" | "sell",
      price,
      fee: fee || { amount: new Decimal(0), currency: baseCurrency },
      source: "coinbase",
      metadata: {
        combinedTransactions: transactions,
        groupId: this.extractTradeGroupIdFromTrackAPI(baseTransaction),
        adapterType: "track-api-combined",
      },
    };
    
    // DEBUG: Log the final combined transaction
    this.logger.debug(`COMBINED_RESULT - ID: ${result.id}, Type: ${result.type}, Side: ${result.side}, Amount: ${result.amount.amount} ${result.amount.currency}, Price: ${result.price?.amount} ${result.price?.currency}, Symbol: ${result.symbol}`);
    
    return result;
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
  private extractTradeAmount(tx: RawCoinbaseTransaction, type: string, _side: "buy" | "sell" | undefined): {
    targetAmount: Decimal;
    targetCurrency: string;
  } {
    // DEBUG: Log amount extraction
    this.logger.debug(`EXTRACT_AMOUNT - TX: ${tx.id}, Type: ${type}, Raw Amount: ${tx.amount.amount} ${tx.amount.currency}`);
    
    // For buy/sell transactions, the tx.amount is always the base currency (the asset being traded)
    // This is different from the quote currency (the currency used to pay/receive)
    if (tx.type === "buy" || tx.type === "sell" || type === "trade") {
      const result = {
        targetAmount: new Decimal(tx.amount.amount).abs(),
        targetCurrency: tx.amount.currency // This is the base currency (HNT, BTC, etc.)
      };
      this.logger.debug(`  TRADE_AMOUNT - Extracted: ${result.targetAmount} ${result.targetCurrency}`);
      return result;
    }
    
    // For non-trade transactions (deposits, withdrawals, transfers), use the transaction amount directly
    // This ensures symbol and amount.currency are the same for non-trading operations, which is correct
    const result = {
      targetAmount: new Decimal(tx.amount.amount).abs(),
      targetCurrency: tx.amount.currency
    };
    this.logger.debug(`  NON_TRADE_AMOUNT - Extracted: ${result.targetAmount} ${result.targetCurrency}`);
    return result;
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
    // DEBUG: Log price extraction
    this.logger.debug(`EXTRACT_PRICE - TX: ${tx.id}, Type: ${type}`);
    
    // Only extract price for trade transactions
    if (type !== "trade") {
      this.logger.debug(`  NO_PRICE - Non-trade transaction`);
      return undefined;
    }

    // For buy transactions, use the total cost from buy object
    if (tx.type === "buy" && tx.buy) {
      if (tx.buy.total) {
        const result = {
          amount: new Decimal(tx.buy.total.amount),
          currency: tx.buy.total.currency
        };
        this.logger.debug(`  BUY_PRICE - From buy.total: ${result.amount} ${result.currency}`);
        return result;
      }
      if (tx.buy.subtotal) {
        const result = {
          amount: new Decimal(tx.buy.subtotal.amount),
          currency: tx.buy.subtotal.currency
        };
        this.logger.debug(`  BUY_PRICE - From buy.subtotal: ${result.amount} ${result.currency}`);
        return result;
      }
    }

    // For sell transactions, use the total proceeds from sell object
    if (tx.type === "sell" && tx.sell) {
      if (tx.sell.total) {
        const result = {
          amount: new Decimal(tx.sell.total.amount),
          currency: tx.sell.total.currency
        };
        this.logger.debug(`  SELL_PRICE - From sell.total: ${result.amount} ${result.currency}`);
        return result;
      }
      if (tx.sell.subtotal) {
        const result = {
          amount: new Decimal(tx.sell.subtotal.amount),
          currency: tx.sell.subtotal.currency
        };
        this.logger.debug(`  SELL_PRICE - From sell.subtotal: ${result.amount} ${result.currency}`);
        return result;
      }
    }

    // For advanced_trade_fill, try to use native_amount as price
    if (tx.type === "advanced_trade_fill" && tx.native_amount) {
      const result = {
        amount: new Decimal(tx.native_amount.amount).abs(),
        currency: tx.native_amount.currency
      };
      this.logger.debug(`  ADVANCED_TRADE_PRICE - From native_amount: ${result.amount} ${result.currency}`);
      return result;
    }

    this.logger.debug(`  NO_PRICE - Could not extract price`);
    return undefined;
  }

}
