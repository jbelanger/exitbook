import type {
  CryptoTransaction,
  Money,
  TransactionType,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from "@crypto/core";
import * as ccxt from "ccxt"; // Import all as ccxt to get access to types like ccxt.Account
import { Decimal } from "decimal.js";
import { BaseCCXTAdapter } from "../base-ccxt-adapter.ts";
import type { CCXTTransaction } from "../../shared/utils/transaction-transformer.ts";
import type { CoinbaseCredentials } from "./types.ts"; // Import from types.ts

// Options for configuring the Coinbase adapter
interface CoinbaseAdapterOptions {
  enableOnlineVerification?: boolean;
}

// CoinbaseAccount extends ccxt.Account and customizes some types for internal use (Decimal for balance)
interface CoinbaseAccount {
  id: string;
  currency: string;
  balance: Decimal | number;
  type: string;
  code: string; // Required by ccxt.Account
  info: ccxt.Balance; // Required by ccxt.Account
  free?: number;
  used?: number;
  total?: number;
}
/**
 * Specialized Coinbase adapter that uses fetchLedger for comprehensive transaction data
 *
 * COINBASE LEDGER API QUIRKS AND WHY THIS IS COMPLICATED:
 *
 * 1. DOUBLE-NESTED INFO STRUCTURE:
 *    - Coinbase ledger entries have info.info structure (double nested)
 *    - The inner info contains the actual Coinbase transaction data
 *    - This is because CCXT wraps the raw Coinbase response in its own structure
 *
 * 2. TRADE GROUPING COMPLEXITY:
 *    - A single buy/sell order creates multiple ledger entries
 *    - Example: Buying BTC with CAD creates:
 *      * Entry 1: CAD going out (direction: "out", currency: "CAD")
 *      * Entry 2: BTC coming in (direction: "in", currency: "BTC")
 *    - Both entries share the same order ID but represent different sides of the trade
 *
 * 3. FEE DUPLICATION ISSUE:
 *    - Each ledger entry contains the SAME fee information for the same order
 *    - Must deduplicate fees by order ID to avoid double counting
 *    - Example: 10.98 CAD fee appears in both CAD-out and BTC-in entries
 *
 * 4. DIRECTION-BASED TRANSACTION TYPES:
 *    - "send" transactions can be either deposits OR withdrawals
 *    - Must check direction field: "in" = deposit, "out" = withdrawal
 *    - This is counter-intuitive but reflects Coinbase's perspective
 *
 * 5. BUY/SELL AMOUNT/PRICE INVERSION:
 *    - For BUY: inEntries = base currency, outEntries = quote currency
 *    - For SELL: outEntries = base currency, inEntries = quote currency
 *    - Direction field indicates money flow, not trade semantics
 *
 * 6. PRICE CALCULATION:
 *    - Price should exclude fees (net cost of asset)
 *    - Total from Coinbase includes fees, must subtract them
 *    - Only subtract fees if fee currency matches quote currency
 *
 * 7. DEPOSITS/WITHDRAWALS SHOULD NOT HAVE PRICE:
 *    - Only trade transactions should have price fields populated
 *    - Deposits and withdrawals represent transfers, not exchanges
 *
 * DEBUGGING GUIDE:
 * To enable detailed debug logging, set environment variable:
 * export DEBUG_COINBASE=true
 *
 * This will log:
 * - Raw entry structures for each trade group
 * - Fee calculation details and deduplication
 * - Final combined trade results
 * - Transaction type extraction decisions
 */
export class CoinbaseCCXTAdapter extends BaseCCXTAdapter {
  private accounts: CoinbaseAccount[] | null = null;

  constructor(
    configOrCredentials: CoinbaseCredentials,
    enableOnlineVerificationOrOptions?: CoinbaseAdapterOptions | boolean,
  ) {
    let enableOnlineVerification: boolean = false;

    const credentials = configOrCredentials;
    const options =
      (enableOnlineVerificationOrOptions as CoinbaseAdapterOptions) || {};
    enableOnlineVerification =
      typeof enableOnlineVerificationOrOptions === "boolean"
        ? enableOnlineVerificationOrOptions
        : options.enableOnlineVerification || false;

    // Create universal adapter config
    const adapterConfig: UniversalExchangeAdapterConfig = {
      type: "exchange",
      id: "coinbase",
      subType: "ccxt",
      credentials: {
        apiKey: credentials.apiKey,
        secret: credentials.secret,
        password: credentials.passphrase,
      },
    };

    // Create Coinbase Advanced Trade exchange
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exchange = new (ccxt as any).coinbaseadvanced({
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      password: credentials.passphrase, // Coinbase uses password field for passphrase
      sandbox: credentials.sandbox ?? false,
      enableRateLimit: true,
      rateLimit: 100,
    });

    super(exchange, adapterConfig, enableOnlineVerification);

    this.logger.info(
      `Initialized Coinbase Ledger adapter - RateLimit: ${this.exchange.rateLimit}, Sandbox: ${credentials.sandbox}`,
    );
  }

  protected createExchange() {
    return this.exchange; // Already created in constructor
  }

  /**
   * Override to fetch only the raw ledger entries from the API.
   * This should return the raw CCXT response, not a transformed one.
   */
  protected async fetchRawTransactions(
    params: UniversalFetchParams,
  ): Promise<CryptoTransaction[]> {
    // This is the only place we should be calling the exchange API.
    // We can reuse the pagination logic from the old fetchLedger method.
    const rawLedgerEntries = await this.fetchAllLedgerEntriesWithPagination(
      params.since,
    );

    // Transform raw CCXT entries to CryptoTransaction[] before returning to satisfy the base class's return type
    return this.transformCCXTTransactions(
      rawLedgerEntries as CCXTTransaction[],
      "ledger",
    );
  }

  /**
   * Override to handle Coinbase's unique ledger entry grouping and transformation.
   * This is where all transformation logic now lives.
   */
  protected async transformTransactions(
    rawCryptoTxs: CryptoTransaction[],
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    const requestedTypes = params.transactionTypes || [
      "trade",
      "deposit",
      "withdrawal",
      "order",
      "ledger",
    ];
    this.logger.info(
      `Transforming ${rawCryptoTxs.length} raw Coinbase ledger entries for types: ${requestedTypes.join(", ")}`,
    );

    // We no longer transform from raw CCXT entries here, as fetchRawTransactions already does the conversion.
    // Now we directly process the CryptoTransaction array.
    const processedCryptoTxs: CryptoTransaction[] =
      await this.processLedgerEntries(rawCryptoTxs);

    // Filter transactions by requested types before final transformation
    const filteredTxs = processedCryptoTxs.filter((tx: CryptoTransaction) => {
      if (!tx.type) return false;
      return requestedTypes.includes(tx.type);
    });

    const filteredCount = processedCryptoTxs.length - filteredTxs.length;
    if (filteredCount > 0) {
      this.logger.info(
        `Filtered out ${filteredCount} transactions not matching requested types`,
      );
    }

    // Finally, convert the filtered CryptoTransactions to the UniversalTransaction format.
    return super.transformTransactions(filteredTxs, params);
    // The base transformTransactions method already handles this final mapping.
  }

  // Helper to contain the fetching logic
  private async fetchAllLedgerEntriesWithPagination(
    since?: number,
  ): Promise<ccxt.LedgerEntry[]> {
    // Move the logic from the old `fetchLedger` method here.
    // This method should return the raw, unprocessed entries from `this.exchange.fetchLedger()`.
    try {
      if (!this.exchange.has["fetchLedger"]) {
        this.logger.warn(
          "Coinbase does not support fetchLedger - falling back to standard methods",
        );
        return [];
      }

      // Load accounts to get available currencies and account IDs
      await this.loadAccounts();

      const allEntries: ccxt.LedgerEntry[] = []; // This will contain raw CCXT ledger entries

      if (!this.accounts || this.accounts.length === 0) {
        this.logger.warn("No accounts available for ledger fetching");
        return [];
      }

      // Use account IDs directly instead of currencies since Coinbase Advanced Trade prefers account_id
      this.logger.info(
        `Fetching ledger entries for ${this.accounts.length} accounts`,
      );

      for (const account of this.accounts) {
        try {
          if (!account.id || !account.currency) {
            this.logger.warn(
              `Skipping account with missing id or currency - Account: ${JSON.stringify(account)}`,
            );
            continue;
          }

          const entries = await this.fetchLedgerWithAccountId(
            account.id,
            account.currency,
            since,
          );
          allEntries.push(...entries);
          this.logger.debug(
            `Fetched ${entries.length} ledger entries for account ${account.id} (${account.currency})`,
          );
        } catch (accountError) {
          this.logger.warn(
            `Failed to fetch ledger for account ${account.id} - AccountId: ${account.id}, Currency: ${account.currency}, Error: ${accountError instanceof Error ? accountError.message : "Unknown error"}`,
          );
        }
      }

      this.logger.info(
        `Fetched ${allEntries.length} total ledger entries from Coinbase`,
      );

      // Return raw entries without any transformation
      return allEntries;
    } catch (error) {
      this.handleError(error, "fetchAllLedgerEntriesWithPagination");
      throw error;
    }
  }

  /**
   * Fetch ledger entries with pagination for a specific account
   */
  private async fetchLedgerWithAccountId(
    accountId: string,
    currency: string,
    since?: number,
  ): Promise<ccxt.LedgerEntry[]> {
    const allEntries: ccxt.LedgerEntry[] = []; // This will contain raw CCXT ledger entries
    let hasMore = true;
    let startingAfter: string | undefined;
    const pageSize = 100; // CCXT default for Coinbase

    while (hasMore) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = {
          limit: pageSize,
          paginate: false, // We handle pagination manually for better control
          account_id: accountId, // Pass account_id to satisfy Coinbase requirement
        };

        // Add pagination cursor if available
        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        this.logger.debug(
          `Fetching ledger page for account: ${accountId} (${currency}) - AccountId: ${accountId}, Currency: ${currency}, StartingAfter: ${startingAfter}, PageSize: ${pageSize}`,
        );

        // Pass currency as the first parameter since CCXT expects it
        const entries = await this.exchange.fetchLedger(
          undefined,
          since,
          pageSize,
          params,
        );

        if (entries.length === 0) {
          hasMore = false;
          break;
        }

        allEntries.push(...entries);

        // Check if there are more pages
        if (entries.length < pageSize) {
          hasMore = false;
        } else {
          // Use the last entry's ID as the starting point for the next page
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            // Coinbase ledger entries have 'info' which contains the raw API response.
            // The cursor for pagination might be in lastEntry.info.cursor or lastEntry.info.id.
            // For ccxt.LedgerEntry, id is usually the primary identifier.
            startingAfter = lastEntry.id;

            if (!startingAfter) {
              // If we can't get pagination cursor, stop to avoid infinite loop
              this.logger.warn(
                "No pagination cursor available from last entry, stopping pagination",
              );
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }

        // Prevent infinite loops
        if (allEntries.length > 50000) {
          // Reasonable safety limit
          this.logger.warn("Reached pagination safety limit, stopping fetch");
          break;
        }
      } catch (pageError) {
        this.logger.error(
          `Error fetching ledger page for account - AccountId: ${accountId}, Currency: ${currency}, StartingAfter: ${startingAfter}, Error: ${pageError instanceof Error ? pageError.message : "Unknown error"}`,
        );
        throw pageError;
      }
    }

    return allEntries;
  }

  /**
   * Process ledger entries to group orders and fills into complete trades
   */
  private async processLedgerEntries(
    ledgerTransactions: CryptoTransaction[],
  ): Promise<CryptoTransaction[]> {
    this.logger.info(
      `Processing Coinbase ledger entries for grouping - TotalEntries: ${ledgerTransactions.length}`,
    );

    this.logger.info(
      `Processing all ledger transactions - TotalCount: ${ledgerTransactions.length}`,
    );

    // Restore the original grouping approach now that we understand the data structure
    const tradeGroups = new Map<string, CryptoTransaction[]>();
    const nonTradeTransactions: CryptoTransaction[] = [];

    // Group trade entries by their reference IDs
    for (const transaction of ledgerTransactions) {
      if (this.isTradeRelatedTransaction(transaction)) {
        const groupId = this.extractTradeGroupId(transaction);
        if (groupId) {
          if (!tradeGroups.has(groupId)) {
            tradeGroups.set(groupId, []);
          }
          tradeGroups.get(groupId)!.push(transaction);
        } else {
          // Trade entry without group ID, treat as individual transaction
          nonTradeTransactions.push(
            this.convertLedgerEntryToTrade(transaction),
          );
        }
      } else {
        nonTradeTransactions.push(this.convertLedgerEntryToTrade(transaction));
      }
    }

    // Convert grouped trade entries into single trade transactions
    const groupedTrades = this.createTradeFromGroups(tradeGroups);

    const result = [...groupedTrades, ...nonTradeTransactions];

    this.logger.info(
      `Completed ledger entry processing - TotalTransactions: ${result.length}, TradeGroups: ${tradeGroups.size}, GroupedTrades: ${groupedTrades.length}, NonTradeTransactions: ${nonTradeTransactions.length}`,
    );

    return result;
  }

  /**
   * Extract the trade group ID from a Coinbase ledger entry
   */
  private extractTradeGroupId(transaction: CryptoTransaction): string | null {
    const info =
      transaction.info &&
      typeof transaction.info === "object" &&
      transaction.info !== null
        ? (transaction.info as any).info // Double nested structure
        : null;
    if (!info || typeof info !== "object" || info === null) return null;

    // Extract group IDs from different transaction types
    if (info.buy?.id) {
      return info.buy.id;
    }
    if (info.trade?.id) {
      return info.trade.id;
    }
    if (info.sell?.id) {
      return info.sell.id;
    }

    // For advanced trade fills, check the nested structure
    if (info.advanced_trade_fill?.order_id) {
      return info.advanced_trade_fill.order_id;
    }

    // For other possible locations
    if (info.order_id) {
      return info.order_id;
    }

    return null;
  }

  /**
   * Create single trade transactions from grouped ledger entries
   */
  private createTradeFromGroups(
    tradeGroups: Map<string, CryptoTransaction[]>,
  ): CryptoTransaction[] {
    const trades: CryptoTransaction[] = [];

    for (const [groupId, entries] of tradeGroups.entries()) {
      if (entries.length === 0) continue;

      try {
        // For single entry, convert directly
        if (entries.length === 1) {
          const entry = entries[0];
          if (entry) {
            trades.push(this.convertLedgerEntryToTrade(entry));
          }
          continue;
        }

        // For multiple entries, combine them into a single trade
        const combinedTrade = this.combineMultipleLedgerEntries(
          groupId,
          entries,
        );
        if (combinedTrade) {
          trades.push(combinedTrade);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create trade from group ${groupId} - Error: ${error instanceof Error ? error.message : "Unknown error"}, EntriesCount: ${entries.length}`,
        );

        // Fallback: convert each entry individually
        for (const entry of entries) {
          trades.push(this.convertLedgerEntryToTrade(entry));
        }
      }
    }

    return trades;
  }

  /**
   * Combine multiple ledger entries into a single trade transaction
   */
  private combineMultipleLedgerEntries(
    groupId: string,
    entries: CryptoTransaction[],
  ): CryptoTransaction | null {
    if (entries.length === 0) return null;

    // Use the first entry as the base
    const baseEntry = entries[0];
    const timestamp = Math.min(...entries.map((e) => e.timestamp));

    // Determine the trade symbol and sides from the entries
    const inEntries = entries.filter(
      (e) =>
        e.info &&
        typeof e.info === "object" &&
        e.info !== null &&
        "direction" in e.info &&
        e.info.direction === "in",
    );
    const outEntries = entries.filter(
      (e) =>
        e.info &&
        typeof e.info === "object" &&
        e.info !== null &&
        "direction" in e.info &&
        e.info.direction === "out",
    );

    // If we have both in and out entries, this is a proper trade
    if (inEntries.length > 0 && outEntries.length > 0) {
      // Extract symbol from advanced_trade_fill data more comprehensively
      let symbol = this.extractSymbolFromInfo(baseEntry?.info);

      // If symbol is still unknown, try to construct it from currencies
      if (!symbol || symbol === "unknown") {
        const firstInEntry = inEntries[0];
        const firstOutEntry = outEntries[0];
        const baseCurrency =
          firstInEntry?.info &&
          typeof firstInEntry.info === "object" &&
          firstInEntry.info !== null &&
          "currency" in firstInEntry.info
            ? (firstInEntry.info as any).currency
            : undefined;
        const quoteCurrency =
          firstOutEntry?.info &&
          typeof firstOutEntry.info === "object" &&
          firstOutEntry.info !== null &&
          "currency" in firstOutEntry.info
            ? (firstOutEntry.info as any).currency
            : undefined;
        if (baseCurrency && quoteCurrency) {
          symbol = `${baseCurrency}-${quoteCurrency}`;
        }
      }

      // Extract side from advanced_trade_fill data
      const baseEntryInfo =
        baseEntry?.info &&
        typeof baseEntry.info === "object" &&
        baseEntry.info !== null
          ? (baseEntry.info as any)
          : null;
      const advancedTradeInfo = baseEntryInfo?.info?.advanced_trade_fill;
      const side =
        advancedTradeInfo?.order_side ||
        this.extractSideFromInfo(baseEntry?.info);

      // COINBASE DIRECTION SEMANTICS (this is the confusing part):
      // - direction: "in" = money coming INTO your account
      // - direction: "out" = money going OUT OF your account
      //
      // For BUY trades: You spend quote currency (out) to receive base currency (in)
      // For SELL trades: You send base currency (out) to receive quote currency (in)
      //
      // This is counter-intuitive because "direction" is about account flow, not trade semantics!
      let baseCurrency: string;
      let quoteCurrency: string;
      let totalBaseAmount: Decimal;
      let totalQuoteAmount: Decimal;

      if (side === "buy") {
        // Buy: receiving base currency (in), spending quote currency (out)
        const firstInEntry = inEntries[0];
        const firstOutEntry = outEntries[0];
        baseCurrency =
          (firstInEntry?.info &&
          typeof firstInEntry.info === "object" &&
          firstInEntry.info !== null &&
          "currency" in firstInEntry.info
            ? (firstInEntry.info as any).currency
            : null) || "unknown";
        quoteCurrency =
          (firstOutEntry?.info &&
          typeof firstOutEntry.info === "object" &&
          firstOutEntry.info !== null &&
          "currency" in firstOutEntry.info
            ? (firstOutEntry.info as any).currency
            : null) || "unknown";

        totalBaseAmount = inEntries.reduce((sum, entry) => {
          const amount =
            entry.amount && typeof entry.amount === "object"
              ? entry.amount.amount
              : new Decimal(0);
          return sum.plus(amount);
        }, new Decimal(0));

        totalQuoteAmount = outEntries.reduce((sum, entry) => {
          const amount =
            entry.amount && typeof entry.amount === "object"
              ? entry.amount.amount
              : new Decimal(0);
          return sum.plus(amount);
        }, new Decimal(0));
      } else {
        // Sell: sending base currency (out), receiving quote currency (in)
        const firstOutEntry = outEntries[0];
        const firstInEntry = inEntries[0];
        baseCurrency =
          (firstOutEntry?.info &&
          typeof firstOutEntry.info === "object" &&
          firstOutEntry.info !== null &&
          "currency" in firstOutEntry.info
            ? (firstOutEntry.info as any).currency
            : null) || "unknown";
        quoteCurrency =
          (firstInEntry?.info &&
          typeof firstInEntry.info === "object" &&
          firstInEntry.info !== null &&
          "currency" in firstInEntry.info
            ? (firstInEntry.info as any).currency
            : null) || "unknown";

        totalBaseAmount = outEntries.reduce((sum, entry) => {
          const amount =
            entry.amount && typeof entry.amount === "object"
              ? entry.amount.amount
              : new Decimal(0);
          return sum.plus(amount);
        }, new Decimal(0));

        totalQuoteAmount = inEntries.reduce((sum, entry) => {
          const amount =
            entry.amount && typeof entry.amount === "object"
              ? entry.amount.amount
              : new Decimal(0);
          return sum.plus(amount);
        }, new Decimal(0));
      }

      // Sum all fees from all entries - deduplicate by order ID to avoid double counting
      // CRITICAL: Coinbase includes the SAME fee in multiple ledger entries for the same order.
      // Example: A buy order creates CAD-out and BTC-in entries, both containing identical fee data.
      // Without deduplication, we'd count fees twice (e.g., 10.98 + 10.98 = 21.96 instead of 10.98).
      const seenFees = new Set<string>(); // Track fee IDs to avoid duplicates
      const totalFee = entries.reduce((sum, entry) => {
        // Check direct fee first
        if (entry.fee && typeof entry.fee === "object" && entry.fee.amount) {
          const feeKey = `direct_${entry.id}_${entry.fee.amount}_${entry.fee.currency}`;
          if (!seenFees.has(feeKey)) {
            seenFees.add(feeKey);
            return sum.plus(entry.fee.amount);
          }
        }

        // Check nested fee structures in buy/sell info
        const nestedInfo =
          entry.info && typeof entry.info === "object" && entry.info !== null
            ? (entry.info as any).info
            : null;
        if (nestedInfo?.buy?.fee?.amount) {
          const orderId = nestedInfo.buy?.id || "unknown";
          const feeKey = `buy_${orderId}_${nestedInfo.buy.fee.amount}_${nestedInfo.buy.fee.currency}`;
          if (!seenFees.has(feeKey)) {
            seenFees.add(feeKey);
            return sum.plus(new Decimal(nestedInfo.buy.fee.amount));
          }
        }
        if (nestedInfo?.sell?.fee?.amount) {
          const orderId = nestedInfo.sell?.id || "unknown";
          const feeKey = `sell_${orderId}_${nestedInfo.sell.fee.amount}_${nestedInfo.sell.fee.currency}`;
          if (!seenFees.has(feeKey)) {
            seenFees.add(feeKey);
            return sum.plus(new Decimal(nestedInfo.sell.fee.amount));
          }
        }

        return sum;
      }, new Decimal(0));

      // Get fee currency from the first entry that has a fee
      let feeCurrency = entries.find(
        (e) => e.fee && typeof e.fee === "object" && e.fee.currency,
      )?.fee?.currency;

      // If no direct fee currency, check nested structures
      if (!feeCurrency) {
        for (const entry of entries) {
          const nestedInfo =
            entry.info && typeof entry.info === "object" && entry.info !== null
              ? (entry.info as any).info
              : null;
          if (nestedInfo?.buy?.fee?.currency) {
            feeCurrency = nestedInfo.buy.fee.currency;
            break;
          }
          if (nestedInfo?.sell?.fee?.currency) {
            feeCurrency = nestedInfo.sell.fee.currency;
            break;
          }
        }
      }

      // Calculate price excluding fees if fee currency matches quote currency
      // COINBASE PRICE SEMANTICS:
      // - Coinbase's "total" includes fees (e.g., 747.94 CAD = 736.96 cost + 10.98 fee)
      // - We want "price" to be the net cost of the asset (736.96 CAD)
      // - Only subtract fees if they're in the same currency as the price
      let priceAmount = totalQuoteAmount;
      if (totalFee.greaterThan(0) && feeCurrency === quoteCurrency) {
        priceAmount = totalQuoteAmount.minus(totalFee);
      }

      const combinedTrade: CryptoTransaction = {
        id: `${groupId}-combined`,
        type: "trade",
        timestamp,
        datetime: new Date(timestamp).toISOString(),
        symbol: symbol || "unknown",
        amount: { amount: totalBaseAmount, currency: baseCurrency },
        side: side as "buy" | "sell",
        price: { amount: priceAmount, currency: quoteCurrency },
        fee:
          totalFee.greaterThan(0) && feeCurrency
            ? {
                amount: totalFee,
                currency: feeCurrency,
              }
            : undefined, // Explicitly set to undefined if no fee
        status: "closed",
        info: {
          groupId,
          entries: entries.map((e) => e.info),
          combinedBy: "CoinbaseCCXTAdapter",
        },
      };

      return combinedTrade;
    }

    // Fallback: single entry trade
    return baseEntry ? this.convertLedgerEntryToTrade(baseEntry) : null;
  }

  /**
   * Convert a Coinbase ledger entry to a proper transaction with correct price, side, and type
   */
  private convertLedgerEntryToTrade(
    transaction: CryptoTransaction,
  ): CryptoTransaction {
    const info = transaction.info;
    if (!info) return transaction;

    // Extract the proper transaction type from Coinbase ledger entry
    const properType = this.extractTransactionType(info);

    // Extract symbol, side, and price information
    const symbol = this.extractSymbolFromInfo(info);
    const side = this.extractSideFromInfo(info);
    const price = this.extractPriceFromInfo(
      info,
      transaction.price,
      properType,
    );

    // Create a proper transaction from the ledger entry
    const enhancedTransaction: CryptoTransaction = {
      ...transaction,
      type: properType,
      symbol: symbol || "unknown", // Ensure symbol is always a string
      side: side as "buy" | "sell",
      price: price || undefined, // Ensure price is explicitly undefined if not present
      info: {
        ...info,
        convertedBy: "CoinbaseCCXTAdapter",
        originalType:
          info && typeof info === "object" && info !== null && "type" in info
            ? (info as any).type
            : undefined,
      },
    };

    return enhancedTransaction;
  }

  /**
   * Determine if transaction is trade-related
   */
  private isTradeRelatedTransaction(transaction: CryptoTransaction): boolean {
    const info = transaction.info;
    if (!info || typeof info !== "object" || info === null) return false;

    const type = (
      "type" in info && typeof (info as any).type === "string"
        ? (info as any).type
        : ""
    ).toLowerCase();

    // Coinbase ledger entries that represent trades
    return (
      type === "trade" || type === "advanced_trade_fill" || type === "match"
    );
  }

  /**
   * Extract the proper transaction type from Coinbase ledger entry
   */
  private extractTransactionType(info: {
    type?: string;
    direction?: string;
    info?: { type?: string; info?: { type?: string } };
  }): TransactionType {
    const type = info.type?.toLowerCase() || "";

    // First check the deeply nested info structure for more specific types
    const nestedInfo = info?.info;
    const deepNestedInfo = nestedInfo?.info;

    // Check the deepest nested type first (most specific)
    if (deepNestedInfo?.type) {
      const deepType = deepNestedInfo.type.toLowerCase();
      switch (deepType) {
        case "buy":
        case "sell":
          return "trade";
        case "send":
          // COINBASE "SEND" CONFUSION:
          // A "send" transaction can be either a deposit OR withdrawal depending on direction.
          // - send + direction:"in" = Someone sent crypto TO you (deposit)
          // - send + direction:"out" = You sent crypto to someone else (withdrawal)
          // This reflects Coinbase's perspective: "send" is the transaction type, direction shows the flow.
          return info.direction === "in" ? "deposit" : "withdrawal";
        case "request":
          return "deposit";
        case "transfer":
          return "transfer";
        case "fiat_deposit":
          return "deposit";
        case "fiat_withdrawal":
          return "withdrawal";
        case "subscription":
        case "subscription_fee":
        case "subscription_payment":
          return "fee";
        case "retail_simple_dust":
          // Dust conversion - small amounts converted to base currency
          return "trade";
      }
    }

    // Check the first nested level
    if (nestedInfo?.type) {
      const nestedType = nestedInfo.type.toLowerCase();
      switch (nestedType) {
        case "buy":
        case "sell":
          return "trade";
        case "send":
          // COINBASE "SEND" CONFUSION:
          // A "send" transaction can be either a deposit OR withdrawal depending on direction.
          // - send + direction:"in" = Someone sent crypto TO you (deposit)
          // - send + direction:"out" = You sent crypto to someone else (withdrawal)
          // This reflects Coinbase's perspective: "send" is the transaction type, direction shows the flow.
          return info.direction === "in" ? "deposit" : "withdrawal";
        case "request":
          return "deposit";
        case "transfer":
          return "transfer";
        case "fiat_deposit":
          return "deposit";
        case "fiat_withdrawal":
          return "withdrawal";
        case "subscription":
        case "subscription_fee":
        case "subscription_payment":
          return "fee";
        case "retail_simple_dust":
          // Dust conversion - small amounts converted to base currency
          return "trade";
      }
    }

    // Map Coinbase ledger types to our transaction types
    switch (type) {
      case "trade":
      case "advanced_trade_fill":
      case "match":
        return "trade";
      case "deposit":
      case "pro_deposit":
      case "coinbase_deposit":
        return "deposit";
      case "withdrawal":
      case "pro_withdrawal":
      case "coinbase_withdrawal":
      case "send":
        // Check direction: 'in' means receiving (deposit), 'out' means sending (withdrawal)
        return info.direction === "in" ? "deposit" : "withdrawal";
      case "transfer":
      case "pro_transfer":
        return "transfer";
      case "fee":
      case "advanced_trade_fee":
      case "subscription":
      case "subscription_fee":
      case "subscription_payment":
        return "fee";
      case "retail_simple_dust":
        // Dust conversion - small amounts converted to base currency
        return "trade";
      default:
        // Log error for unparseable transaction types - these should not exist
        this.logger.error(
          `Unable to determine transaction type from Coinbase ledger entry - Type: ${type}, NestedType: ${(nestedInfo as { type?: string })?.type}, DeepNestedType: ${(deepNestedInfo as { type?: string })?.type}, Direction: ${(info as { direction?: string }).direction}, TransactionId: ${(info as { id?: string }).id}, RawInfo: ${JSON.stringify(info, null, 2)}`,
        );

        // Throw error instead of falling back to 'ledger' type
        throw new Error(
          `Cannot determine transaction type for Coinbase entry: ${type} (ID: ${(info as { id?: string }).id || "unknown"})`,
        );
    }
  }

  /**
   * Extract symbol from transaction info
   *
   * COINBASE SYMBOL EXTRACTION COMPLEXITY:
   * Symbols are buried deep in nested structures and can be in multiple locations:
   * 1. info.info.advanced_trade_fill.product_id (most reliable for trades)
   * 2. info.info.buy.product_id or info.info.sell.product_id
   * 3. Fallback to top-level fields (often missing)
   *
   * The double-nested structure (info.info) is due to CCXT wrapping Coinbase's response.
   */
  private extractSymbolFromInfo(info: unknown): string | undefined {
    // Check the deeply nested structure first for advanced_trade_fill (most reliable)
    const nestedInfo = (info as { info?: unknown }).info;
    if (
      (nestedInfo as { advanced_trade_fill?: { product_id?: string } })
        ?.advanced_trade_fill?.product_id
    ) {
      return (nestedInfo as { advanced_trade_fill: { product_id: string } })
        .advanced_trade_fill.product_id;
    }

    // Check for buy/sell nested structures
    if ((nestedInfo as { buy?: { product_id?: string } })?.buy?.product_id) {
      return (nestedInfo as { buy: { product_id: string } }).buy.product_id;
    }

    if ((nestedInfo as { sell?: { product_id?: string } })?.sell?.product_id) {
      return (nestedInfo as { sell: { product_id: string } }).sell.product_id;
    }

    // Check for trade nested structure
    if (
      (nestedInfo as { trade?: { product_id?: string } })?.trade?.product_id
    ) {
      return (nestedInfo as { trade: { product_id: string } }).trade.product_id;
    }

    return (
      (info as { symbol?: string }).symbol ||
      (info as { product_id?: string }).product_id ||
      (info as { currency_pair?: string }).currency_pair ||
      undefined
    );
  }

  /**
   * Extract trade side from transaction info
   */
  private extractSideFromInfo(info: unknown): string {
    // First check explicit side fields
    if ((info as { order_side?: string }).order_side)
      return (info as { order_side: string }).order_side;
    if ((info as { side?: string }).side)
      return (info as { side: string }).side;
    if ((info as { trade_side?: string }).trade_side)
      return (info as { trade_side: string }).trade_side;

    // For Coinbase Advanced Trade, infer from direction and nested info
    const nestedInfo = (info as { info?: unknown }).info;
    if (nestedInfo) {
      if ((nestedInfo as { buy?: unknown }).buy) return "buy";
      if ((nestedInfo as { sell?: unknown }).sell) return "sell";
    }

    // Infer from direction for non-trade transactions
    if ((info as { direction?: string }).direction === "in") return "buy"; // Receiving currency
    if ((info as { direction?: string }).direction === "out") return "sell"; // Sending currency

    // Try to infer from amount sign (if available)
    if (
      (info as { amount?: number }).amount &&
      typeof (info as { amount: number }).amount === "number"
    ) {
      return (info as { amount: number }).amount > 0 ? "buy" : "sell";
    }

    return "unknown";
  }

  /**
   * Extract price information from Coinbase ledger entry
   *
   * COINBASE PRICE EXTRACTION RULES:
   * 1. Only trade transactions should have prices (deposits/withdrawals are transfers, not exchanges)
   * 2. Price represents the total cost/proceeds, not per-unit price
   * 3. For buy/sell transactions, extract from nested buy.total or sell.total
   * 4. These totals include fees, which we subtract later in combineMultipleLedgerEntries
   */
  private extractPriceFromInfo(
    info: unknown,
    fallbackPrice?: Money,
    transactionType?: string,
  ): Money | undefined {
    // CRITICAL: Don't extract price for deposits and withdrawals - they're transfers, not trades
    if (transactionType === "deposit" || transactionType === "withdrawal") {
      return undefined;
    }

    // For Coinbase buy/sell transactions, extract total cost from nested structure
    const nestedInfo = (info as { info?: unknown }).info;
    if ((nestedInfo as { buy?: unknown })?.buy) {
      const buyInfo = (
        nestedInfo as {
          buy: { total?: { amount?: string | number; currency?: string } };
        }
      ).buy;
      if (buyInfo.total?.amount && buyInfo.total?.currency) {
        // Return the total cost (what was spent)
        return {
          amount: new Decimal(
            Math.abs(parseFloat(buyInfo.total.amount as string)),
          ),
          currency: buyInfo.total.currency,
        };
      }
    }

    if ((nestedInfo as { sell?: unknown })?.sell) {
      const sellInfo = (
        nestedInfo as {
          sell: { total?: { amount?: string | number; currency?: string } };
        }
      ).sell;
      if (sellInfo.total?.amount && sellInfo.total?.currency) {
        // Return the total proceeds (what was received)
        return {
          amount: new Decimal(
            Math.abs(parseFloat(sellInfo.total.amount as string)),
          ),
          currency: sellInfo.total.currency,
        };
      }
    }

    // For trade transaction types, check for total or amount fields
    if (
      transactionType === "trade" ||
      transactionType === "limit" ||
      transactionType === "market"
    ) {
      if (
        (info as { total?: number }).total &&
        typeof (info as { total: number }).total === "number"
      ) {
        return {
          amount: new Decimal(Math.abs((info as { total: number }).total)),
          currency: (info as { currency?: string }).currency || "USD",
        };
      }

      if (
        (info as { amount?: number }).amount &&
        typeof (info as { amount: number }).amount === "number"
      ) {
        return {
          amount: new Decimal(Math.abs((info as { amount: number }).amount)),
          currency: (info as { currency?: string }).currency || "USD",
        };
      }
    }

    // Use fallback price from CCXT if available for trade transactions only
    if (
      (transactionType === "trade" ||
        transactionType === "limit" ||
        transactionType === "market") &&
      fallbackPrice
    ) {
      return fallbackPrice;
    }

    return undefined;
  }

  /**
   * Load Coinbase accounts (inherited from CoinbaseCCXTAdapter)
   */
  private async loadAccounts(): Promise<void> {
    if (this.accounts !== null) {
      return; // Already loaded
    }

    try {
      this.logger.info("Loading Coinbase accounts for ledger adapter...");

      // First try fetchAccounts
      if (this.exchange.has["fetchAccounts"]) {
        try {
          const accounts = await this.exchange.fetchAccounts();

          this.accounts = accounts
            .filter(
              (
                account: ccxt.Account,
              ): account is ccxt.Account & {
                id: string;
                code: string;
                type?: string;
              } => !!account.id && !!account.code,
            )
            .map((account) => ({
              id: account.id,
              currency: account.code, // Use 'code' field for currency
              balance: 0, // We don't need balance for ledger fetching
              type: account.type || "wallet",
              code: account.code,
              info: account.info || {},
            }));

          if ((this.accounts ?? []).length > 0) {
            this.logger.info(
              `Loaded ${this.accounts!.length} Coinbase accounts for ledger processing`,
            );
            return;
          } else {
            this.logger.warn(
              "fetchAccounts returned accounts but none were valid, trying balance fallback",
            );
          }
        } catch (fetchAccountsError) {
          this.logger.warn(
            `fetchAccounts failed, trying balance fallback - Error: ${fetchAccountsError instanceof Error ? fetchAccountsError.message : "Unknown error"}`,
          );
        }
      } else {
        this.logger.info("fetchAccounts not supported, using balance fallback");
      }

      // Fallback: create accounts from balance data
      this.logger.info("Using balance data to create accounts...");
      const balance = await this.exchange.fetchBalance();

      this.accounts = [];

      for (const [currency, balanceInfo] of Object.entries(balance)) {
        if (
          currency === "info" ||
          currency === "free" ||
          currency === "used" ||
          currency === "total"
        ) {
          continue;
        }
        const info = balanceInfo as ccxt.Balance;

        if (info && typeof info === "object") {
          // Include zero-balance accounts for historical transactions
          this.accounts.push({
            id: `${currency.toLowerCase()}-account`,
            currency: currency,
            balance: info.total || 0,
            type: "spot",
            code: currency,
            info: info,
          });
        }
      }

      this.logger.info(
        `Created ${this.accounts.length} fallback accounts from balance data`,
      );

      if (this.accounts.length === 0) {
        this.logger.error(
          "No accounts could be loaded from either fetchAccounts or balance data",
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to load Coinbase accounts - Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      this.accounts = [];
      throw error;
    }
  }
}
