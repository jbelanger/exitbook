import type { CryptoTransaction } from '@crypto/core';
import { BaseAdapter } from './base-adapter.js';
import type { AdapterInfo, FetchParams, Transaction, Balance } from './types.js';
import type { ExchangeAdapterConfig } from './config.js';
import { CsvParser } from '../../exchanges/csv-parser.ts';
import { CsvFilters } from '../../exchanges/csv-filters.ts';
import fs from 'fs/promises';
import path from 'path';

/**
 * Base class for CSV-based universal adapters
 * Provides common functionality for parsing CSV files and managing transactions
 */
export abstract class BaseCSVAdapter extends BaseAdapter {
  protected cachedTransactions: CryptoTransaction[] | null = null;

  constructor(config: ExchangeAdapterConfig) {
    super(config);
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract getExpectedHeaders(): Record<string, string>;
  protected abstract getFileTypeHandlers(): Record<string, (filePath: string) => Promise<CryptoTransaction[]>>;

  async testConnection(): Promise<boolean> {
    try {
      const config = this.config as ExchangeAdapterConfig;
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

  protected async fetchRawTransactions(_params: FetchParams): Promise<CryptoTransaction[]> {
    return this.loadAllTransactions();
  }

  protected async transformTransactions(rawTxs: CryptoTransaction[], params: FetchParams): Promise<Transaction[]> {
    return rawTxs
      .filter(tx => !params.since || tx.timestamp >= params.since)
      .filter(tx => !params.until || tx.timestamp <= params.until)
      .map(tx => this.convertToUniversalTransaction(tx));
  }

  protected async fetchRawBalances(_params: FetchParams): Promise<any> {
    throw new Error('Balance fetching not supported for CSV adapter - CSV files do not contain current balance data');
  }

  protected async transformBalances(_raw: any, _params: FetchParams): Promise<Balance[]> {
    throw new Error('Balance fetching not supported for CSV adapter');
  }

  protected abstract convertToUniversalTransaction(cryptoTx: CryptoTransaction): Transaction;

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
    const config = this.config as ExchangeAdapterConfig;
    // If there's a UID filter configured, we could add it here
    // For now, return all rows as UID filtering isn't in the universal config
    return rows;
  }

  /**
   * Validate CSV headers and determine file type
   */
  protected async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = this.getExpectedHeaders();
    const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

    if (fileType === 'unknown') {
      const headers = await CsvParser.getHeaders(filePath);
      this.logger.warn(`Unrecognized CSV headers in ${filePath} - Headers: ${headers}`);
    }

    return fileType;
  }

  /**
   * Load all transactions from CSV directories
   */
  protected async loadAllTransactions(): Promise<CryptoTransaction[]> {
    if (this.cachedTransactions) {
      this.logger.debug('Returning cached transactions');
      return this.cachedTransactions;
    }

    const config = this.config as ExchangeAdapterConfig;
    this.logger.info(`Starting to load CSV transactions - CsvDirectories: ${config.csvDirectories}`);

    const transactions: CryptoTransaction[] = [];
    const fileTypeHandlers = this.getFileTypeHandlers();

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

            const handler = fileTypeHandlers[fileType];
            if (handler) {
              this.logger.info(`Processing ${fileType} CSV file - File: ${file}, Directory: ${csvDirectory}`);
              const fileTransactions = await handler(filePath);
              this.logger.info(`Parsed ${fileType} transactions - File: ${file}, Directory: ${csvDirectory}, Count: ${fileTransactions.length}`);
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
      transactions.sort((a, b) => a.timestamp - b.timestamp);

      this.cachedTransactions = transactions;
      this.logger.info(`Loaded ${transactions.length} transactions from ${config.csvDirectories?.length || 0} CSV directories`);

      return transactions;
    } catch (error) {
      this.logger.error(`Failed to load CSV transactions - Error: ${error}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    // Clear cached data
    this.cachedTransactions = null;
  }
}