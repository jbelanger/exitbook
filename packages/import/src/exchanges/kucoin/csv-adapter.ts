import type {
  TransactionStatus,
  UniversalAdapterInfo,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
  UniversalBalance,
} from "@crypto/core";
import { createMoney, parseDecimal } from "@crypto/shared-utils";
import { BaseAdapter } from "../../shared/adapters/base-adapter.ts";
import { CsvParser } from "../csv-parser.ts";
import fs from "fs/promises";
import path from "path";
import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvKuCoinRawData,
  CsvSpotOrderRow,
} from "./types.ts";

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  TRADING_CSV:
    "UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status",
  DEPOSIT_CSV:
    "UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks",
  WITHDRAWAL_CSV:
    "UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Withdrawal Address/Account,Transfer Network,Status,Remarks",
  CONVERT_CSV:
    "UID,Account Type,Payment Account,Sell,Buy,Price,Tax,Time of Update(UTC),Status", // Legacy - not used, we get converts from account history
  ACCOUNT_HISTORY_CSV:
    "UID,Account Type,Currency,Side,Amount,Fee,Time(UTC),Remark,Type",
};

export class KuCoinCSVAdapter extends BaseAdapter {
  private cachedTransactions: CsvKuCoinRawData | null = null;

  constructor(config: UniversalExchangeAdapterConfig) {
    super(config);
  }

  async close(): Promise<void> {
    this.cachedTransactions = null;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: "kucoin",
      name: "KuCoin CSV",
      type: "exchange",
      subType: "csv",
      capabilities: {
        supportedOperations: ["fetchTransactions"],
        maxBatchSize: 1000,
        supportsHistoricalData: true,
        supportsPagination: false,
        requiresApiKey: false,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const config = this.config as UniversalExchangeAdapterConfig;
      for (const csvDirectory of config.csvDirectories || []) {
        try {
          const stats = await fs.stat(csvDirectory);
          if (!stats.isDirectory()) {
            continue;
          }

          const files = await fs.readdir(csvDirectory);
          const csvFiles = files.filter((f) => f.endsWith(".csv"));

          if (csvFiles.length > 0) {
            return true;
          }
        } catch (dirError) {
          this.logger.warn(
            `CSV directory test failed for directory - Error: ${dirError}, Directory: ${csvDirectory}`,
          );
          continue;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`CSV directories test failed - Error: ${error}`);
      return false;
    }
  }

  protected async fetchRawTransactions(
    _params: UniversalFetchParams,
  ): Promise<CsvKuCoinRawData> {
    return this.loadAllSeparatedTransactions();
  }

  protected async transformTransactions(
    rawData: CsvKuCoinRawData,
    params: UniversalFetchParams,
  ): Promise<UniversalTransaction[]> {
    const transactions: UniversalTransaction[] = [];

    // Process each type directly without separation logic
    for (const row of rawData.spotOrders) {
      const transaction = this.convertSpotOrderToTransaction(row);
      transactions.push(transaction);
    }

    for (const row of rawData.deposits) {
      const transaction = this.convertDepositToTransaction(row);
      transactions.push(transaction);
    }

    for (const row of rawData.withdrawals) {
      const transaction = this.convertWithdrawalToTransaction(row);
      transactions.push(transaction);
    }

    // Process account history (convert market transactions)
    const convertTransactions = this.processAccountHistory(
      rawData.accountHistory,
    );
    transactions.push(...convertTransactions);

    return transactions
      .filter((tx) => !params.since || tx.timestamp >= params.since)
      .filter((tx) => !params.until || tx.timestamp <= params.until);
  }

  protected async fetchRawBalances(
    _params: UniversalFetchParams,
  ): Promise<unknown> {
    throw new Error(
      "Balance fetching not supported for CSV adapter - CSV files do not contain current balance data",
    );
  }

  protected async transformBalances(
    _raw: unknown,
    _params: UniversalFetchParams,
  ): Promise<UniversalBalance[]> {
    throw new Error("Balance fetching not supported for CSV adapter");
  }

  /**
   * Load all transactions from CSV directories, separated by type
   */
  private async loadAllSeparatedTransactions(): Promise<CsvKuCoinRawData> {
    if (this.cachedTransactions) {
      this.logger.debug("Returning cached transactions");
      return this.cachedTransactions;
    }

    const config = this.config as UniversalExchangeAdapterConfig;
    this.logger.info(
      `Starting to load CSV transactions - CsvDirectories: ${config.csvDirectories}`,
    );

    const rawData: CsvKuCoinRawData = {
      spotOrders: [],
      deposits: [],
      withdrawals: [],
      accountHistory: [],
    };

    try {
      // Process each directory in order
      for (const csvDirectory of config.csvDirectories || []) {
        this.logger.info(
          `Processing CSV directory - CsvDirectory: ${csvDirectory}`,
        );

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug(
            `Found CSV files in directory - CsvDirectory: ${csvDirectory}, Files: ${files}`,
          );

          // Process all CSV files with proper header validation
          const csvFiles = files.filter((f) => f.endsWith(".csv"));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            switch (fileType) {
              case "trading": {
                this.logger.info(
                  `Processing trading CSV file - File: ${file}, Directory: ${csvDirectory}`,
                );
                const rows = await this.parseSpotOrders(filePath);
                this.logger.info(
                  `Parsed trading transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${rows.length}`,
                );
                rawData.spotOrders.push(...rows);
                break;
              }
              case "deposit": {
                this.logger.info(
                  `Processing deposit CSV file - File: ${file}, Directory: ${csvDirectory}`,
                );
                const rows = await this.parseDepositHistory(filePath);
                this.logger.info(
                  `Parsed deposit transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${rows.length}`,
                );
                rawData.deposits.push(...rows);
                break;
              }
              case "withdrawal": {
                this.logger.info(
                  `Processing withdrawal CSV file - File: ${file}, Directory: ${csvDirectory}`,
                );
                const rows = await this.parseWithdrawalHistory(filePath);
                this.logger.info(
                  `Parsed withdrawal transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${rows.length}`,
                );
                rawData.withdrawals.push(...rows);
                break;
              }
              case "account_history": {
                this.logger.info(
                  `Processing account history CSV file - File: ${file}, Directory: ${csvDirectory}`,
                );
                const rows = await this.parseAccountHistory(filePath);
                this.logger.info(
                  `Parsed account history transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${rows.length}`,
                );
                rawData.accountHistory.push(...rows);
                break;
              }
              case "convert":
                this.logger.warn(
                  `Skipping convert orders CSV file - using account history instead - File: ${filePath}`,
                );
                break;
              case "unknown":
                this.logger.warn(
                  `Skipping unrecognized CSV file - File: ${file}, Directory: ${csvDirectory}`,
                );
                break;
              default:
                this.logger.warn(
                  `No handler for file type: ${fileType} - File: ${file}, Directory: ${csvDirectory}`,
                );
            }
          }
        } catch (dirError) {
          this.logger.error(
            `Failed to process CSV directory - Error: ${dirError}, Directory: ${csvDirectory}`,
          );
          // Continue processing other directories
          continue;
        }
      }

      // Sort each type by timestamp
      rawData.spotOrders.sort(
        (a, b) =>
          new Date(a["Filled Time(UTC)"]).getTime() -
          new Date(b["Filled Time(UTC)"]).getTime(),
      );
      rawData.deposits.sort(
        (a, b) =>
          new Date(a["Time(UTC)"]).getTime() -
          new Date(b["Time(UTC)"]).getTime(),
      );
      rawData.withdrawals.sort(
        (a, b) =>
          new Date(a["Time(UTC)"]).getTime() -
          new Date(b["Time(UTC)"]).getTime(),
      );
      rawData.accountHistory.sort(
        (a, b) =>
          new Date(a["Time(UTC)"]).getTime() -
          new Date(b["Time(UTC)"]).getTime(),
      );

      const totalCount =
        rawData.spotOrders.length +
        rawData.deposits.length +
        rawData.withdrawals.length +
        rawData.accountHistory.length;

      this.cachedTransactions = rawData;
      this.logger.info(
        `Loaded ${totalCount} transactions from ${config.csvDirectories?.length || 0} CSV directories - Spot: ${rawData.spotOrders.length}, Deposits: ${rawData.deposits.length}, Withdrawals: ${rawData.withdrawals.length}, Account History: ${rawData.accountHistory.length}`,
      );

      return rawData;
    } catch (error) {
      this.logger.error(`Failed to load CSV transactions - Error: ${error}`);
      throw error;
    }
  }

  /**
   * Parse a CSV file using the common parsing logic
   */
  private async parseCsvFile<T>(filePath: string): Promise<T[]> {
    return CsvParser.parseFile<T>(filePath);
  }

  /**
   * Filter rows by UID if configured
   */
  private filterByUid<T extends { UID: string }>(rows: T[]): T[] {
    // If there's a UID filter configured, we could add it here
    // For now, return all rows as UID filtering isn't in the universal config
    return rows;
  }

  /**
   * Validate CSV headers and determine file type
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = {
      [EXPECTED_HEADERS.TRADING_CSV]: "trading",
      [EXPECTED_HEADERS.DEPOSIT_CSV]: "deposit",
      [EXPECTED_HEADERS.WITHDRAWAL_CSV]: "withdrawal",
      [EXPECTED_HEADERS.CONVERT_CSV]: "convert",
      [EXPECTED_HEADERS.ACCOUNT_HISTORY_CSV]: "account_history",
    };
    const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

    if (fileType === "unknown") {
      const headers = await CsvParser.getHeaders(filePath);
      this.logger.warn(
        `Unrecognized CSV headers in ${filePath} - Headers: ${headers}`,
      );
    }

    return fileType;
  }

  private async parseSpotOrders(filePath: string): Promise<CsvSpotOrderRow[]> {
    const rows = await this.parseCsvFile<CsvSpotOrderRow>(filePath);
    return this.filterByUid(rows);
  }

  private async parseDepositHistory(
    filePath: string,
  ): Promise<CsvDepositWithdrawalRow[]> {
    const rows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);
    return this.filterByUid(rows);
  }

  private async parseWithdrawalHistory(
    filePath: string,
  ): Promise<CsvDepositWithdrawalRow[]> {
    const rows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);
    return this.filterByUid(rows);
  }

  private async parseAccountHistory(
    filePath: string,
  ): Promise<CsvAccountHistoryRow[]> {
    const rows = await this.parseCsvFile<CsvAccountHistoryRow>(filePath);
    return this.filterByUid(rows);
  }

  private mapStatus(
    status: string,
    type: "spot" | "deposit_withdrawal",
  ): TransactionStatus {
    if (!status) return "pending";

    const statusLower = status.toLowerCase();

    if (type === "spot") {
      switch (statusLower) {
        case "deal":
          return "closed";
        case "part_deal":
          return "open";
        case "cancel":
          return "canceled";
        default:
          return "pending";
      }
    } else {
      // deposit_withdrawal
      switch (statusLower) {
        case "success":
          return "ok";
        case "pending":
          return "pending";
        case "failed":
          return "failed";
        case "canceled":
          return "canceled";
        default:
          return "pending";
      }
    }
  }

  private convertSpotOrderToTransaction(
    row: CsvSpotOrderRow,
  ): UniversalTransaction {
    const timestamp = new Date(row["Filled Time(UTC)"]).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split("-");

    return {
      id: row["Order ID"],
      type: "trade",
      timestamp,
      datetime: row["Filled Time(UTC)"],
      status: this.mapStatus(row.Status, "spot"),
      amount: createMoney(row["Filled Amount"], baseCurrency || "unknown"),
      price: createMoney(row["Filled Volume"], quoteCurrency || "unknown"),
      fee: createMoney(row.Fee, row["Fee Currency"]),
      symbol: `${baseCurrency}/${quoteCurrency}`,
      source: "kucoin",
      network: "exchange",
      metadata: {
        originalRow: row,
        side: row.Side.toLowerCase() as "buy" | "sell",
        orderType: row["Order Type"],
        filledVolume: parseDecimal(row["Filled Volume"]).toNumber(),
        filledVolumeUSDT: parseDecimal(row["Filled Volume (USDT)"]).toNumber(),
        orderTime: row["Order Time(UTC)"],
        orderPrice: parseDecimal(row["Order Price"]).toNumber(),
        orderAmount: parseDecimal(row["Order Amount"]).toNumber(),
      },
    };
  }

  private convertDepositToTransaction(
    row: CsvDepositWithdrawalRow,
  ): UniversalTransaction {
    const timestamp = new Date(row["Time(UTC)"]).getTime();

    return {
      id:
        row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      type: "deposit",
      timestamp,
      datetime: row["Time(UTC)"],
      status: this.mapStatus(row.Status, "deposit_withdrawal"),
      amount: createMoney(row.Amount, row.Coin),
      fee: row.Fee ? createMoney(row.Fee, row.Coin) : undefined,
      source: "kucoin",
      network: "exchange",
      metadata: {
        originalRow: row,
        hash: row.Hash,
        transferNetwork: row["Transfer Network"],
        address: row["Deposit Address"],
        remarks: row.Remarks,
      },
    };
  }

  private convertWithdrawalToTransaction(
    row: CsvDepositWithdrawalRow,
  ): UniversalTransaction {
    const timestamp = new Date(row["Time(UTC)"]).getTime();

    return {
      id:
        row.Hash ||
        `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
      type: "withdrawal",
      timestamp,
      datetime: row["Time(UTC)"],
      status: this.mapStatus(row.Status, "deposit_withdrawal"),
      amount: createMoney(row.Amount, row.Coin),
      fee: row.Fee ? createMoney(row.Fee, row.Coin) : undefined,
      source: "kucoin",
      network: "exchange",
      metadata: {
        originalRow: row,
        hash: row.Hash,
        transferNetwork: row["Transfer Network"],
        address: row["Withdrawal Address/Account"],
        remarks: row.Remarks,
      },
    };
  }

  // Process account history to extract convert market transactions
  private processAccountHistory(
    filteredRows: CsvAccountHistoryRow[],
  ): UniversalTransaction[] {
    const convertTransactions: UniversalTransaction[] = [];
    const convertMarketRows = filteredRows.filter(
      (row) => row.Type === "Convert Market",
    );

    // Group convert market entries by timestamp
    const convertGroups = new Map<string, CsvAccountHistoryRow[]>();

    for (const row of convertMarketRows) {
      const timestamp = row["Time(UTC)"];
      if (!convertGroups.has(timestamp)) {
        convertGroups.set(timestamp, []);
      }
      convertGroups.get(timestamp)!.push(row);
    }

    // Process each group of convert transactions
    for (const [timestamp, group] of convertGroups) {
      if (group.length === 2) {
        // Should be one deposit and one withdrawal
        const deposit = group.find((row) => row.Side === "Deposit");
        const withdrawal = group.find((row) => row.Side === "Withdrawal");

        if (deposit && withdrawal) {
          const convertTx = this.convertAccountHistoryConvertToTransaction(
            deposit,
            withdrawal,
            timestamp,
          );
          convertTransactions.push(convertTx);
        } else {
          this.logger.warn(
            `Convert Market group missing deposit/withdrawal pair - Timestamp: ${timestamp}, Group: ${JSON.stringify(group)}`,
          );
        }
      } else {
        this.logger.warn(
          `Convert Market group has unexpected number of entries - Timestamp: ${timestamp}, Count: ${group.length}, Group: ${JSON.stringify(group)}`,
        );
      }
    }

    return convertTransactions;
  }

  private convertAccountHistoryConvertToTransaction(
    deposit: CsvAccountHistoryRow,
    withdrawal: CsvAccountHistoryRow,
    timestamp: string,
  ): UniversalTransaction {
    const timestampMs = new Date(timestamp).getTime();

    const sellCurrency = withdrawal.Currency;
    const sellAmount = withdrawal.Amount;
    const buyCurrency = deposit.Currency;
    const buyAmount = deposit.Amount;

    // Create a synthetic symbol for the conversion
    const symbol = `${sellCurrency}/${buyCurrency}`;

    // Calculate total fees (both deposit and withdrawal fees)
    const withdrawalFee = withdrawal.Fee
      ? parseDecimal(withdrawal.Fee).toNumber()
      : 0;
    const depositFee = deposit.Fee ? parseDecimal(deposit.Fee).toNumber() : 0;

    return {
      id: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      type: "trade",
      timestamp: timestampMs,
      datetime: timestamp,
      status: "closed", // Account history entries are completed transactions
      amount: createMoney(sellAmount, sellCurrency),
      price: createMoney(buyAmount, buyCurrency),
      fee:
        withdrawalFee + depositFee > 0
          ? createMoney((withdrawalFee + depositFee).toString(), sellCurrency)
          : undefined,
      symbol,
      source: "kucoin",
      network: "exchange",
      metadata: {
        type: "convert_market",
        side: "sell",
        sellAmount: parseDecimal(sellAmount).toNumber(),
        sellCurrency,
        buyAmount: parseDecimal(buyAmount).toNumber(),
        buyCurrency,
        withdrawalRow: withdrawal,
        depositRow: deposit,
        withdrawalFee,
        depositFee,
      },
    };
  }
}
