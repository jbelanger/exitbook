import type { CryptoTransaction, ExchangeInfo, IExchangeAdapter, TransactionType } from '@crypto/core';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import fs from 'fs/promises';
import path from 'path';
import { CsvFilters } from '../../../utils/csv-filters.ts';
import { CsvParser } from '../../../utils/csv-parser.ts';


export interface CSVConfig {
  csvDirectories: string[];
  uid?: string;
}

export interface FileTypeHandler {
  type: string;
  parser: (filePath: string) => Promise<CryptoTransaction[]>;
}

/**
 * Base class for CSV-based exchange adapters
 * Provides common functionality for parsing CSV files and managing transactions
 */
export abstract class BaseCSVAdapter implements IExchangeAdapter {
  protected logger: Logger;
  protected config: CSVConfig;
  private cachedTransactions: CryptoTransaction[] | null = null;

  constructor(config: CSVConfig, loggerName: string) {
    this.config = config;
    this.logger = getLogger(loggerName);
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract getExpectedHeaders(): Record<string, string>;
  protected abstract getFileTypeHandlers(): Record<string, (filePath: string) => Promise<CryptoTransaction[]>>;
  public abstract getExchangeInfo(): Promise<ExchangeInfo>;

  /**
   * Parse a CSV file using the common parsing logic
   */
  protected async parseCsvFile<T>(filePath: string): Promise<T[]> {
    return CsvParser.parseFile<T>(filePath);
  }

  /**
   * Filter rows by UID if configured
   */
  protected filterByUid<T extends { UID: string }>(rows: T[]): T[] {
    return CsvFilters.filterByUid(rows, this.config.uid);
  }

  /**
   * Validate CSV headers and determine file type
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = this.getExpectedHeaders();
    const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

    if (fileType === 'unknown') {
      const headers = await CsvParser.getHeaders(filePath);
      this.logger.warn(`Unrecognized CSV headers in ${filePath}:`, { headers });
    }

    return fileType;
  }

  /**
   * Test if the CSV directories contain expected files
   */
  async testConnection(): Promise<boolean> {
    try {
      for (const csvDirectory of this.config.csvDirectories) {
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
          this.logger.warn('CSV directory test failed for directory', {
            error: dirError,
            directory: csvDirectory
          });
          continue;
        }
      }

      return false;
    } catch (error) {
      this.logger.error('CSV directories test failed', {
        error,
        directories: this.config.csvDirectories
      });
      return false;
    }
  }

  /**
   * Load all transactions from CSV directories
   */
  protected async loadAllTransactions(): Promise<CryptoTransaction[]> {
    if (this.cachedTransactions) {
      this.logger.debug('Returning cached transactions');
      return this.cachedTransactions;
    }

    this.logger.info('Starting to load CSV transactions', {
      csvDirectories: this.config.csvDirectories
    });

    const transactions: CryptoTransaction[] = [];
    const fileTypeHandlers = this.getFileTypeHandlers();

    try {
      // Process each directory in order
      for (const csvDirectory of this.config.csvDirectories) {
        this.logger.info('Processing CSV directory', { csvDirectory });

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug('Found CSV files in directory', { csvDirectory, files });

          // Process all CSV files with proper header validation
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            const handler = fileTypeHandlers[fileType];
            if (handler) {
              this.logger.info(`Processing ${fileType} CSV file`, { file, directory: csvDirectory });
              const fileTransactions = await handler(filePath);
              this.logger.info(`Parsed ${fileType} transactions`, {
                file,
                directory: csvDirectory,
                count: fileTransactions.length
              });
              transactions.push(...fileTransactions);
            } else if (fileType === 'unknown') {
              this.logger.warn('Skipping unrecognized CSV file', { file, directory: csvDirectory });
            } else {
              this.logger.warn(`No handler for file type: ${fileType}`, { file, directory: csvDirectory });
            }
          }
        } catch (dirError) {
          this.logger.error('Failed to process CSV directory', {
            error: dirError,
            directory: csvDirectory
          });
          // Continue processing other directories
          continue;
        }
      }

      // Sort by timestamp
      transactions.sort((a, b) => a.timestamp - b.timestamp);

      this.cachedTransactions = transactions;
      this.logger.info(`Loaded ${transactions.length} transactions from ${this.config.csvDirectories.length} CSV directories`);

      return transactions;
    } catch (error) {
      this.logger.error('Failed to load CSV transactions', { error });
      throw error;
    }
  }

  /**
   * Generic method to fetch transactions by type with optional time filtering
   */
  private async fetchTransactionsByType(type?: TransactionType, since?: number): Promise<CryptoTransaction[]> {
    const transactions = await this.loadAllTransactions();

    let filtered = type ? transactions.filter(tx => tx.type === type) : transactions;

    if (since) {
      filtered = filtered.filter(tx => tx.timestamp >= since);
    }

    return filtered;
  }

  // Standard IExchangeAdapter implementations
  async fetchAllTransactions(since?: number): Promise<CryptoTransaction[]> {
    return this.fetchTransactionsByType(undefined, since);
  }

  async fetchTrades(since?: number): Promise<CryptoTransaction[]> {
    return this.fetchTransactionsByType('trade', since);
  }

  async fetchDeposits(since?: number): Promise<CryptoTransaction[]> {
    return this.fetchTransactionsByType('deposit', since);
  }

  async fetchWithdrawals(since?: number): Promise<CryptoTransaction[]> {
    return this.fetchTransactionsByType('withdrawal', since);
  }

  async fetchClosedOrders(since?: number): Promise<CryptoTransaction[]> {
    // For CSV, closed orders are essentially the same as trades
    return this.fetchTrades(since);
  }

  async fetchLedger(_since?: number): Promise<CryptoTransaction[]> {
    // Most CSV adapters don't support ledger to prevent double-counting
    return [];
  }

  async fetchBalance(): Promise<never> {
    // CSV files don't contain current balance information
    throw new Error('Balance fetching not supported for CSV adapter - CSV files do not contain current balance data');
  }

  async close(): Promise<void> {
    // Clear cached data
    this.cachedTransactions = null;
  }
}