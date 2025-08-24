import type {
  TransactionStatus,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalExchangeAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import fs from 'fs/promises';
import path from 'path';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { CsvParser } from '../csv-parser.ts';
import type { CsvLedgerLiveOperationRow } from './types.ts';

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  LEDGERLIVE_CSV:
    'Operation Date,Status,Currency Ticker,Operation Type,Operation Amount,Operation Fees,Operation Hash,Account Name,Account xpub,Countervalue Ticker,Countervalue at Operation Date,Countervalue at CSV Export',
};

export class LedgerLiveCSVAdapter extends BaseAdapter {
  private cachedTransactions: CsvLedgerLiveOperationRow[] | null = null;

  constructor(config: UniversalExchangeAdapterConfig) {
    super(config);
  }

  async close(): Promise<void> {
    this.cachedTransactions = null;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: 'ledgerlive',
      name: 'Ledger Live CSV',
      type: 'exchange',
      subType: 'csv',
      capabilities: {
        supportedOperations: ['fetchTransactions'],
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
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          if (csvFiles.length > 0) {
            return true;
          }
        } catch (dirError) {
          this.logger.warn(`CSV directory test failed for directory - Error: ${dirError}, Directory: ${csvDirectory}`);
          continue;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`CSV directories test failed - Error: ${error}`);
      return false;
    }
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<CsvLedgerLiveOperationRow[]> {
    this.logger.debug(`Fetching raw transactions with params - Params: ${JSON.stringify(params)}`);
    return this.loadAllTransactions();
  }

  protected async transformTransactions(
    rawTxs: CsvLedgerLiveOperationRow[],
    params: UniversalFetchParams
  ): Promise<UniversalTransaction[]> {
    const transactions = this.processOperationRows(rawTxs);

    return transactions
      .filter(tx => !params.since || tx.timestamp >= params.since)
      .filter(tx => !params.until || tx.timestamp <= params.until);
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<unknown> {
    this.logger.debug(`Fetching raw balances with params - Params: ${JSON.stringify(params)}`);
    throw new Error('Balance fetching not supported for CSV adapter - CSV files do not contain current balance data');
  }

  protected async transformBalances(raw: unknown, params: UniversalFetchParams): Promise<UniversalBalance[]> {
    this.logger.debug(
      `Transforming raw balances with params - Raw: ${JSON.stringify(raw)}, Params: ${JSON.stringify(params)}`
    );
    throw new Error('Balance fetching not supported for CSV adapter');
  }

  /**
   * Load all transactions from CSV directories
   */
  private async loadAllTransactions(): Promise<CsvLedgerLiveOperationRow[]> {
    if (this.cachedTransactions) {
      this.logger.debug('Returning cached transactions');
      return this.cachedTransactions;
    }

    const config = this.config as UniversalExchangeAdapterConfig;
    this.logger.info(`Starting to load CSV transactions - CsvDirectories: ${config.csvDirectories}`);

    const transactions: CsvLedgerLiveOperationRow[] = [];

    try {
      // Process each directory in order
      for (const csvDirectory of config.csvDirectories || []) {
        this.logger.info(`Processing CSV directory - CsvDirectory: ${csvDirectory}`);

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug(`Found CSV files in directory - CsvDirectory: ${csvDirectory}, Files: ${files}`);

          // Process all CSV files with proper header validation
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            if (fileType === 'operations') {
              this.logger.info(`Processing ${fileType} CSV file - File: ${file}, Directory: ${csvDirectory}`);
              const fileTransactions = await this.parseCsvFile<CsvLedgerLiveOperationRow>(filePath);
              this.logger.info(
                `Parsed ${fileType} transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${fileTransactions.length}`
              );
              transactions.push(...fileTransactions);
            } else if (fileType === 'unknown') {
              this.logger.warn(`Skipping unrecognized CSV file - File: ${file}, Directory: ${csvDirectory}`);
            } else {
              this.logger.warn(`No handler for file type: ${fileType} - File: ${file}, Directory: ${csvDirectory}`);
            }
          }
        } catch (dirError) {
          this.logger.error(`Failed to process CSV directory - Error: ${dirError}, Directory: ${csvDirectory}`);
          // Continue processing other directories
          continue;
        }
      }

      // Sort by timestamp
      transactions.sort((a, b) => new Date(a['Operation Date']).getTime() - new Date(b['Operation Date']).getTime());

      this.cachedTransactions = transactions;
      this.logger.info(
        `Loaded ${transactions.length} transactions from ${config.csvDirectories?.length || 0} CSV directories`
      );

      return transactions;
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
   * Validate CSV headers and determine file type
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = {
      [EXPECTED_HEADERS.LEDGERLIVE_CSV]: 'operations',
    };
    const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

    if (fileType === 'unknown') {
      const headers = await CsvParser.getHeaders(filePath);
      this.logger.warn(`Unrecognized CSV headers in ${filePath} - Headers: ${headers}`);
    }

    return fileType;
  }

  /**
   * Process the loaded operation rows into universal transactions
   */
  private processOperationRows(rows: CsvLedgerLiveOperationRow[]): UniversalTransaction[] {
    const transactions: UniversalTransaction[] = [];

    this.logger.info(`Processing ${rows.length} LedgerLive operations`);

    for (const row of rows) {
      // Skip empty or invalid rows
      if (!row['Operation Date'] || !row['Currency Ticker'] || !row['Operation Amount']) {
        this.logger.warn(`Skipping invalid row with missing required fields - Row: ${JSON.stringify(row)}`);
        continue;
      }

      const transaction = this.convertOperationToUniversalTransaction(row);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    this.logger.info(`Converted ${transactions.length} LedgerLive operations to universal transactions`);
    return transactions;
  }

  private mapStatus(status: string): TransactionStatus {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'closed';
      case 'pending':
        return 'open';
      case 'failed':
        return 'canceled';
      default:
        return 'closed'; // Default to closed for unknown statuses
    }
  }

  private mapOperationType(operationType: string): 'trade' | 'deposit' | 'withdrawal' | null {
    switch (operationType.toUpperCase()) {
      case 'IN':
        return 'deposit';
      case 'OUT':
        return 'withdrawal';
      case 'FEES':
        return null; // Fee-only transactions will be handled separately
      case 'STAKE':
      case 'DELEGATE':
      case 'UNDELEGATE':
      case 'WITHDRAW_UNBONDED':
      case 'OPT_OUT':
        return null; // These are special operations, handled as metadata
      default:
        return null;
    }
  }

  private convertOperationToUniversalTransaction(row: CsvLedgerLiveOperationRow): UniversalTransaction | null {
    const operationType = this.mapOperationType(row['Operation Type']);

    // Skip transactions that don't map to standard types (like FEES, STAKE, etc.)
    if (!operationType) {
      this.logger.debug(
        `Skipping non-standard operation type - Type: ${row['Operation Type']}, Hash: ${row['Operation Hash']}`
      );
      return null;
    }

    const timestamp = new Date(row['Operation Date']).getTime();
    const amount = parseDecimal(row['Operation Amount']).abs(); // Ensure positive amount
    const fee = parseDecimal(row['Operation Fees'] || '0');
    const currency = row['Currency Ticker'];
    const status = this.mapStatus(row['Status']);

    // For LedgerLive, negative amounts in OUT operations are normal
    // The mapOperationType already determines if it's deposit/withdrawal
    const netAmount = amount.minus(fee);

    return {
      id: row['Operation Hash'],
      type: operationType,
      timestamp,
      datetime: row['Operation Date'],
      status,
      amount: createMoney(netAmount.toNumber(), currency),
      fee: createMoney(fee.toNumber(), currency),
      symbol: undefined,
      price: undefined,
      source: 'ledgerlive',
      network: 'exchange',
      metadata: {
        originalRow: row,
        operationType: row['Operation Type'],
        accountName: row['Account Name'],
        accountXpub: row['Account xpub'],
        countervalueTicker: row['Countervalue Ticker'],
        countervalueAtOperation: row['Countervalue at Operation Date'],
        countervalueAtExport: row['Countervalue at CSV Export'],
        grossAmount: amount.toNumber(), // Store original amount before fee deduction
      },
    };
  }
}
