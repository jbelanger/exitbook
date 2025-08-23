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
  RawCoinbaseLedgerEntry,
} from "./types.ts";

/**
 * Direct Coinbase Advanced Trade API adapter
 *
 * Replaces CoinbaseCCXTAdapter with a clean, direct API integration that eliminates
 * the complexity of CCXT's abstraction layer. This adapter provides:
 *
 * 1. Clean data access - no more info.info nested structures
 * 2. Direct API authentication using Coinbase's native signature method
 * 3. Simplified trade grouping logic working with clean data structures
 * 4. Better error handling and debugging capabilities
 * 5. Type-safe API responses with comprehensive TypeScript interfaces
 *
 * Architecture: Raw Coinbase API → UniversalTransaction (no CCXT layer)
 *
 * API Documentation: https://docs.cloud.coinbase.com/advanced-trade-api/docs/welcome
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
      `Initialized Coinbase Direct adapter - Exchange: ${config.id}, Sandbox: ${credentials.sandbox || false}`,
    );
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "coinbase",
      name: "Coinbase Advanced Trade",
      type: "exchange",
      subType: "rest",
      capabilities: {
        supportedOperations: ["fetchTransactions", "fetchBalances"],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: true,
        rateLimit: {
          requestsPerSecond: 10,
          burstLimit: 15,
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
  ): Promise<RawCoinbaseLedgerEntry[]> {
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit",
      "withdrawal",
    ];
    this.logger.info(
      `Starting raw ledger fetch from Coinbase for types: ${requestedTypes.join(", ")} - Since: ${params.since}`,
    );

    // Load accounts if not already cached
    await this.loadAccounts();

    if (!this.accounts || this.accounts.length === 0) {
      this.logger.warn("No accounts available for transaction fetching");
      return [];
    }

    const allEntries: RawCoinbaseLedgerEntry[] = [];

    // Fetch ledger entries from all accounts
    for (const account of this.accounts) {
      try {
        this.logger.debug(
          `Fetching ledger for account ${account.uuid} (${account.currency})`,
        );

        const ledgerParams = {
          limit: 100,
          start_date: params.since ? new Date(params.since).toISOString() : "",
          end_date: params.until ? new Date(params.until).toISOString() : "",
        };

        const entries = await this.apiClient.getAllAccountLedgerEntries(
          account.uuid,
          ledgerParams,
        );
        allEntries.push(...entries);

        this.logger.debug(
          `Fetched ${entries.length} ledger entries for account ${account.uuid} (${account.currency})`,
        );
      } catch (accountError) {
        this.logger.warn(
          `Failed to fetch ledger for account ${account.uuid} - Error: ${accountError instanceof Error ? accountError.message : "Unknown error"}`,
        );
        // Continue with other accounts instead of failing completely
      }
    }

    this.logger.info(
      `Fetched ${allEntries.length} total ledger entries from ${this.accounts.length} accounts`,
    );
    return allEntries;
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
    rawEntries: RawCoinbaseLedgerEntry[],
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit",
      "withdrawal",
    ];
    this.logger.info(
      `Transforming ${rawEntries.length} raw Coinbase ledger entries for types: ${requestedTypes.join(", ")}`,
    );

    // Group trade entries by order ID for proper trade reconstruction
    const tradeGroups = this.groupTradeEntries(rawEntries);
    const transactions: UniversalTransaction[] = [];

    // Process grouped trades
    for (const [orderId, entries] of tradeGroups.entries()) {
      try {
        const trade = this.createTradeFromEntries(orderId, entries);
        if (trade && requestedTypes.includes(trade.type)) {
          transactions.push(trade);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create trade from group ${orderId} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );

        // Fallback: convert entries individually
        for (const entry of entries) {
          const transaction = this.createTransactionFromEntry(entry);
          if (transaction && requestedTypes.includes(transaction.type)) {
            transactions.push(transaction);
          }
        }
      }
    }

    // Process non-trade entries (deposits, withdrawals, transfers, fees)
    const nonTradeEntries = rawEntries.filter(
      (entry) => !this.isTradeRelatedEntry(entry),
    );
    for (const entry of nonTradeEntries) {
      try {
        const transaction = this.createTransactionFromEntry(entry);
        if (transaction && requestedTypes.includes(transaction.type)) {
          transactions.push(transaction);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to transform entry ${entry.id} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    this.logger.info(
      `Transformed ${rawEntries.length} ledger entries into ${transactions.length} transactions - TradeGroups: ${tradeGroups.size}, NonTrade: ${nonTradeEntries.length}`,
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
        const availableAmount = new Decimal(
          account.available_balance?.value || "0",
        );
        const holdAmount = new Decimal(account.hold?.value || "0");
        const totalAmount = availableAmount.plus(holdAmount);

        // Only include accounts with non-zero balances
        if (totalAmount.greaterThan(0)) {
          balances.push({
            currency: account.currency,
            free: availableAmount.toNumber(),
            used: holdAmount.toNumber(),
            total: totalAmount.toNumber(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to transform balance for account ${account.uuid} - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
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

      // Filter to active accounts only
      this.accounts = this.accounts.filter((account) => account.active);

      this.logger.info(
        `Loaded ${this.accounts.length} active Coinbase accounts`,
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
   * Group trade-related ledger entries by order ID
   */
  private groupTradeEntries(
    entries: RawCoinbaseLedgerEntry[],
  ): Map<string, RawCoinbaseLedgerEntry[]> {
    const groups = new Map<string, RawCoinbaseLedgerEntry[]>();

    for (const entry of entries) {
      if (this.isTradeRelatedEntry(entry)) {
        const orderId = entry.details.order_id;
        if (orderId) {
          if (!groups.has(orderId)) {
            groups.set(orderId, []);
          }
          groups.get(orderId)!.push(entry);
        }
      }
    }

    return groups;
  }

  /**
   * Determine if ledger entry is trade-related
   */
  private isTradeRelatedEntry(entry: RawCoinbaseLedgerEntry): boolean {
    const tradeTypes = ["TRADE_FILL", "MATCH", "FEE"];
    return tradeTypes.includes(entry.type) || Boolean(entry.details.order_id);
  }

  /**
   * Create a single trade transaction from grouped ledger entries
   */
  private createTradeFromEntries(
    orderId: string,
    entries: RawCoinbaseLedgerEntry[],
  ): UniversalTransaction | null {
    if (entries.length === 0) return null;

    const baseEntry = entries[0];
    const timestamp = new Date(baseEntry.created_at).getTime();

    // Separate credit (incoming) and debit (outgoing) entries
    const creditEntries = entries.filter(
      (entry) => entry.direction === "CREDIT",
    );
    const debitEntries = entries.filter((entry) => entry.direction === "DEBIT");

    // For a proper trade, we need both credit and debit entries
    if (creditEntries.length === 0 || debitEntries.length === 0) {
      // Single-sided entry, treat as individual transaction
      return this.createTransactionFromEntry(baseEntry);
    }

    // Determine trade direction from the first entry's order side
    const side = baseEntry.details.order_side?.toLowerCase() as "buy" | "sell";
    const symbol = baseEntry.details.product_id || "unknown";

    // For buy orders: credit = base currency, debit = quote currency
    // For sell orders: debit = base currency, credit = quote currency
    let baseCurrency: string;
    let quoteCurrency: string;
    let baseAmount: Decimal;
    let quoteAmount: Decimal;

    if (side === "buy") {
      // Buy: receiving base currency, spending quote currency
      baseCurrency = creditEntries[0]?.amount.currency || "unknown";
      quoteCurrency = debitEntries[0]?.amount.currency || "unknown";

      baseAmount = creditEntries.reduce(
        (sum, entry) => sum.plus(new Decimal(entry.amount.value).abs()),
        new Decimal(0),
      );
      quoteAmount = debitEntries.reduce(
        (sum, entry) => sum.plus(new Decimal(entry.amount.value).abs()),
        new Decimal(0),
      );
    } else {
      // Sell: sending base currency, receiving quote currency
      baseCurrency = debitEntries[0]?.amount.currency || "unknown";
      quoteCurrency = creditEntries[0]?.amount.currency || "unknown";

      baseAmount = debitEntries.reduce(
        (sum, entry) => sum.plus(new Decimal(entry.amount.value).abs()),
        new Decimal(0),
      );
      quoteAmount = creditEntries.reduce(
        (sum, entry) => sum.plus(new Decimal(entry.amount.value).abs()),
        new Decimal(0),
      );
    }

    // Calculate total fees (deduplicated by order ID)
    const totalFee = this.calculateTotalFees(entries, orderId);
    const feeCurrency = entries.find((entry) => entry.details.fee)?.details.fee
      ?.currency;

    // Calculate price excluding fees if fee currency matches quote currency
    // Price should be the net cost of the asset (excluding fees)
    let finalQuoteAmount = quoteAmount;
    if (totalFee.greaterThan(0) && feeCurrency === quoteCurrency) {
      finalQuoteAmount = quoteAmount.minus(totalFee);
    }

    return {
      id: `coinbase-trade-${orderId}`,
      type: "trade",
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: "closed",
      symbol,
      amount: { amount: baseAmount, currency: baseCurrency },
      side,
      price: { amount: finalQuoteAmount, currency: quoteCurrency },
      fee:
        totalFee.greaterThan(0) && feeCurrency
          ? {
              amount: totalFee,
              currency: feeCurrency,
            }
          : { amount: new Decimal(0), currency: quoteCurrency },
      source: "coinbase",
      metadata: {
        orderId,
        entries: entries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          direction: entry.direction,
        })),
        adapterType: "native",
      },
    };
  }

  /**
   * Create transaction from individual ledger entry
   */
  private createTransactionFromEntry(
    entry: RawCoinbaseLedgerEntry,
  ): UniversalTransaction | null {
    const timestamp = new Date(entry.created_at).getTime();
    const amount = new Decimal(entry.amount.value).abs();

    // Map Coinbase ledger types to universal transaction types
    let type: "trade" | "deposit" | "withdrawal" | "transfer" | "fee";

    switch (entry.type) {
      case "DEPOSIT":
        type = "deposit";
        break;
      case "WITHDRAWAL":
        type = "withdrawal";
        break;
      case "TRANSFER":
        type = "transfer";
        break;
      case "FEE":
      case "SUBSCRIPTION_FEE":
        type = "fee";
        break;
      case "TRADE_FILL":
      case "MATCH":
        type = "trade";
        break;
      default:
        this.logger.debug(
          `Unknown ledger entry type: ${entry.type}, treating as transfer`,
        );
        type = "transfer";
    }

    return {
      id: `coinbase-${entry.id}`,
      type,
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: "closed",
      symbol: entry.details.product_id || "unknown",
      amount: { amount, currency: entry.amount.currency },
      side: entry.direction === "CREDIT" ? "buy" : "sell",
      fee: entry.details.fee
        ? {
            amount: new Decimal(entry.details.fee.value),
            currency: entry.details.fee.currency,
          }
        : { amount: new Decimal(0), currency: entry.amount.currency },
      source: "coinbase",
      metadata: {
        ledgerEntryId: entry.id,
        ledgerType: entry.type,
        direction: entry.direction,
        details: entry.details,
        adapterType: "native",
      },
    };
  }

  /**
   * Calculate total fees for a group of entries, deduplicating by order ID
   */
  private calculateTotalFees(
    entries: RawCoinbaseLedgerEntry[],
    orderId: string,
  ): Decimal {
    const seenFees = new Set<string>();

    return entries.reduce((total, entry) => {
      if (entry.details.fee) {
        const feeKey = `${orderId}-${entry.details.fee.value}-${entry.details.fee.currency}`;
        if (!seenFees.has(feeKey)) {
          seenFees.add(feeKey);
          return total.plus(entry.details.fee.value);
        }
      }
      return total;
    }, new Decimal(0));
  }
}
