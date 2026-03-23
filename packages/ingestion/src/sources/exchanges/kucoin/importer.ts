import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { RawTransactionInput } from '@exitbook/core';
import { getErrorMessage, sha256Hex } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';

import type { IImporter, ImportBatchResult, StreamingImportParams } from '../../../shared/types/importers.js';
import { parseCsvFile, validateCsvHeaders } from '../shared/csv-parser-utils.js';

import { CSV_FILE_TYPES } from './constants.js';
import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from './types.js';
import {
  validateKuCoinAccountHistory,
  validateKuCoinDepositsWithdrawals,
  validateKuCoinOrderSplitting,
  validateKuCoinSpotOrders,
  validateKuCoinTradingBot,
} from './utils.js';

/**
 * Importer for KuCoin CSV files.
 * Handles reading CSV files from specified directories and parsing different KuCoin export formats.
 */
export class KucoinCsvImporter implements IImporter {
  private readonly logger: Logger;
  private readonly sourceName = 'kucoin';
  private usedEventIds: Map<string, number>;

  constructor() {
    this.logger = getLogger('kucoinImporter');
    this.usedEventIds = new Map();
  }

  /**
   * Streaming import - yields one batch per CSV file
   * Memory-bounded: processes one file at a time
   * Supports resumption via cursor (skips completed files)
   */
  async *importStreaming(params: StreamingImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    this.logger.debug(`Starting KuCoin CSV import from directory: ${params.csvDirectory ?? 'none'}`);

    if (!params.csvDirectory) {
      yield err(new Error('CSV directory is required for KuCoin import'));
      return;
    }

    // Reset external ID tracking for new import
    this.usedEventIds.clear();

    // Track total fetched across all files for cursor
    let totalFetched = 0;

    // Resume support: build set of completed files from cursor (using full file paths)
    const completedFiles = new Set<string>();
    if (params.cursor) {
      for (const [operationType, cursorState] of Object.entries(params.cursor)) {
        if (operationType.startsWith('csv:kucoin:') && cursorState.metadata?.isComplete) {
          const filePath = cursorState.metadata['filePath'] as string | undefined;
          if (filePath) {
            completedFiles.add(filePath);
          }
        }
      }
    }

    try {
      this.logger.info(`Reading files from CSV directory: ${params.csvDirectory}`);

      try {
        const csvFiles = await this.collectCsvFiles(params.csvDirectory);

        for (const filePath of csvFiles) {
          const file = path.basename(filePath);

          // Skip if already completed (using full path)
          if (completedFiles.has(filePath)) {
            this.logger.info(`• Skipped previously processed file: ${filePath}`);
            continue;
          }

          const fileType = await this.validateCSVHeaders(filePath);

          // Skip unknown or unimplemented file types
          if (fileType === 'unknown' || fileType.startsWith('not_implemented_') || fileType === 'convert') {
            if (fileType === 'unknown') {
              this.logger.warn(`• Skipping unrecognized CSV file: ${file}`);
            }
            continue;
          }

          // Process file based on type (pass full path for unique identification)
          const batchResult = await this.processFileAsBatch(filePath, fileType, totalFetched);

          if (batchResult.isErr()) {
            yield err(batchResult.error);
            return;
          }

          const batch = batchResult.value;
          totalFetched += batch.rawTransactions.length;

          // Update cursor with cumulative total
          batch.cursor.totalFetched = totalFetched;

          yield ok(batch);

          this.logger.info(
            `Processed ${batch.rawTransactions.length} transactions from ${filePath} (total: ${totalFetched})`
          );
        }
      } catch (dirError) {
        this.logger.error(`Failed to process CSV directory ${params.csvDirectory}: ${String(dirError)}`);
        yield err(new Error(`Failed to process directory ${params.csvDirectory}: ${getErrorMessage(dirError)}`));
        return;
      }

      this.logger.debug(`Completed KuCoin CSV streaming import: ${totalFetched} total transactions`);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CSV streaming import failed: ${errorMessage}`);
      yield err(new Error(`${this.sourceName} streaming import failed: ${errorMessage}`));
    }
  }

  /**
   * Process a single CSV file as a batch (used by streaming import)
   * @param filePath - Full absolute path to the CSV file (used for unique identification)
   * @param fileType - Type of CSV file (trading, deposit, etc.)
   * @param currentTotalFetched - Running total of transactions fetched so far
   */
  private async processFileAsBatch(
    filePath: string,
    fileType: string,
    currentTotalFetched: number
  ): Promise<Result<ImportBatchResult, Error>> {
    const rawTransactions: RawTransactionInput[] = [];
    const fileName = path.basename(filePath);

    try {
      switch (fileType) {
        case 'trading': {
          this.logger.info(`Processing trading CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvSpotOrderRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(filePath, 'trading', rawRows, validateKuCoinSpotOrders, (row) => {
              const timeStr = row['Filled Time(UTC)'] || row['Order Time(UTC)'];
              return {
                providerName: 'kucoin',
                transactionTypeHint: 'spot_order',
                timestamp: this.parseTimestamp(timeStr),
                providerData: { _rowType: 'spot_order', ...row },
                normalizedData: { _rowType: 'spot_order', ...row },
                eventId: this.getUniqueEventId(row['Order ID']),
              };
            })
          );
          break;
        }

        case 'deposit': {
          this.logger.info(`Processing deposit CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(filePath, 'deposit', rawRows, validateKuCoinDepositsWithdrawals, (row) => ({
              providerName: 'kucoin',
              transactionTypeHint: 'deposit',
              timestamp: this.parseTimestamp(row['Time(UTC)']),
              providerData: { _rowType: 'deposit', ...row },
              normalizedData: { _rowType: 'deposit', ...row },
              eventId: this.getUniqueEventId(
                row.Hash || this.generateEventId('deposit', row['Time(UTC)'], row.Coin, row.Amount)
              ),
            }))
          );
          break;
        }

        case 'withdrawal': {
          this.logger.info(`Processing withdrawal CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(filePath, 'withdrawal', rawRows, validateKuCoinDepositsWithdrawals, (row) => ({
              providerName: 'kucoin',
              transactionTypeHint: 'withdrawal',
              timestamp: this.parseTimestamp(row['Time(UTC)']),
              normalizedData: { _rowType: 'withdrawal', ...row },
              providerData: { _rowType: 'withdrawal', ...row },
              eventId: this.getUniqueEventId(
                row.Hash || this.generateEventId('withdrawal', row['Time(UTC)'], row.Coin, row.Amount)
              ),
            }))
          );
          break;
        }

        case 'account_history': {
          this.logger.info(`Processing account history CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvAccountHistoryRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(filePath, 'account history', rawRows, validateKuCoinAccountHistory, (row) => ({
              providerName: 'kucoin',
              transactionTypeHint: 'account_history',
              timestamp: this.parseTimestamp(row['Time(UTC)']),
              normalizedData: { _rowType: 'account_history', ...row },
              providerData: { _rowType: 'account_history', ...row },
              eventId: this.getUniqueEventId(
                this.generateEventId(row.Type, row['Time(UTC)'], row.Currency, row.Amount)
              ),
            }))
          );
          break;
        }

        case 'order_splitting': {
          // Skip Spot order-splitting files to avoid duplicates
          if (fileName.includes('Spot Orders_')) {
            const recordCount = await this.countCsvRecords(filePath);
            this.logger.info(
              `Skipping ${recordCount} spot order-splitting transaction${recordCount === 1 ? '' : 's'}: ${fileName}. Using Spot Orders_Filled Orders.csv instead to avoid duplicates.`
            );
            return this.emptyBatch(filePath, currentTotalFetched);
          }

          this.logger.info(`Processing order-splitting CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvOrderSplittingRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(
              filePath,
              'order-splitting',
              rawRows,
              validateKuCoinOrderSplitting,
              (row) => ({
                providerName: 'kucoin',
                transactionTypeHint: 'order_splitting',
                timestamp: this.parseTimestamp(row['Filled Time(UTC)']),
                normalizedData: { _rowType: 'order_splitting', ...row },
                providerData: { _rowType: 'order_splitting', ...row },
                eventId: this.getUniqueEventId(`${row['Order ID']}-${row['Filled Time(UTC)']}`),
              }),
              (validRows) => this.filterMainAccountRows(validRows, fileName, 'order-splitting')
            )
          );
          break;
        }

        case 'trading_bot': {
          this.logger.info(`Processing trading bot CSV file: ${fileName}`);
          const rawRows = await this.parseCsvFile<CsvTradingBotRow>(filePath);
          rawTransactions.push(
            ...this.processValidatedRows(
              filePath,
              'trading bot',
              rawRows,
              validateKuCoinTradingBot,
              (row) => {
                const timestamp = this.parseTimestamp(row['Time Filled(UTC)']);
                return {
                  providerName: 'kucoin',
                  transactionTypeHint: 'trading_bot',
                  timestamp,
                  normalizedData: { _rowType: 'trading_bot', ...row },
                  providerData: { _rowType: 'trading_bot', ...row },
                  eventId: this.getUniqueEventId(`${row['Order ID']}-${timestamp}-${row['Filled Amount']}`),
                };
              },
              (validRows) => this.filterMainAccountRows(validRows, fileName, 'trading bot')
            )
          );
          break;
        }

        case 'convert':
          this.logger.warn(`Skipping convert orders CSV file - using account history instead: ${fileName}`);
          return this.emptyBatch(filePath, currentTotalFetched);

        case 'not_implemented_futures_orders':
        case 'not_implemented_futures_pnl':
          return this.skipNotImplemented(filePath, 'futures trading', currentTotalFetched);

        case 'not_implemented_margin_borrowings':
        case 'not_implemented_margin_orders':
        case 'not_implemented_margin_lending':
          return this.skipNotImplemented(filePath, 'margin trading', currentTotalFetched);

        case 'not_implemented_fiat_trading':
        case 'not_implemented_fiat_deposits':
        case 'not_implemented_fiat_withdrawals':
        case 'not_implemented_fiat_p2p':
        case 'not_implemented_fiat_third_party':
          return this.skipNotImplemented(filePath, 'fiat', currentTotalFetched);

        case 'not_implemented_earn_profit':
        case 'not_implemented_earn_staking':
          return this.skipNotImplemented(filePath, 'earn/staking', currentTotalFetched);

        case 'not_implemented_trading_bot':
          return this.skipNotImplemented(filePath, 'trading bot', currentTotalFetched);

        case 'not_implemented_snapshots': {
          const recordCount = await this.countCsvRecords(filePath);
          this.logger.info(
            `Skipping asset snapshots file (${recordCount} snapshot${recordCount === 1 ? '' : 's'}): ${fileName}. Snapshots are informational only and not imported.`
          );
          return this.emptyBatch(filePath, currentTotalFetched);
        }

        case 'unknown':
          this.logger.warn(`Skipping unrecognized CSV file: ${fileName}`);
          return this.emptyBatch(filePath, currentTotalFetched);

        default:
          this.logger.warn(`No handler for file type: ${fileType} in file: ${fileName}`);
          return this.emptyBatch(filePath, currentTotalFetched);
      }

      const lastTransaction = rawTransactions.at(-1);
      const lastTransactionId = lastTransaction?.eventId ?? `csv:kucoin:${filePath}:none`;
      return ok({
        rawTransactions,
        streamType: `csv:kucoin:${filePath}`,
        cursor: this.createFileCursor(filePath, lastTransactionId, rawTransactions.length, currentTotalFetched, true),
        isComplete: true,
      });
    } catch (error) {
      return err(new Error(`Failed to process ${fileName}: ${getErrorMessage(error)}`));
    }
  }

  /**
   * Validate rows, log validation errors, and build RawTransactionInput objects.
   * An optional rowFilter is applied to valid rows before building (e.g. filterMainAccountRows).
   */
  private processValidatedRows<T>(
    filePath: string,
    rowLabel: string,
    rows: T[],
    validator: (rows: T[]) => {
      invalid: { errors: { issues: { message: string; path: PropertyKey[] }[] }; rowIndex: number }[];
      valid: T[];
    },
    buildTransaction: (row: T) => RawTransactionInput,
    rowFilter?: (validRows: T[]) => T[]
  ): RawTransactionInput[] {
    const fileName = path.basename(filePath);
    const result = validator(rows);

    if (result.invalid.length > 0) {
      this.logger.error(
        `${result.invalid.length} invalid ${rowLabel} rows in ${fileName}. ` +
          `Invalid: ${result.invalid.length}, Valid: ${result.valid.length}, Total: ${rows.length}`
      );
      result.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
        const fieldErrors = errors.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
      });
    }

    this.logger.info(`Parsed and validated ${result.valid.length} ${rowLabel} entries from ${fileName}`);
    const processableRows = rowFilter ? rowFilter(result.valid) : result.valid;
    return processableRows.map(buildTransaction);
  }

  /**
   * Log and return an empty batch for not-yet-implemented CSV file types.
   */
  private async skipNotImplemented(
    filePath: string,
    categoryLabel: string,
    currentTotalFetched: number
  ): Promise<Result<ImportBatchResult, Error>> {
    const fileName = path.basename(filePath);
    const recordCount = await this.countCsvRecords(filePath);
    if (recordCount > 0) {
      this.logger.warn(
        `Skipping ${recordCount} ${categoryLabel} transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${fileName}. ${categoryLabel.charAt(0).toUpperCase() + categoryLabel.slice(1)} support coming soon.`
      );
    } else {
      this.logger.info(`No records found in ${categoryLabel} file: ${fileName}`);
    }
    return this.emptyBatch(filePath, currentTotalFetched);
  }

  /**
   * Return an empty ImportBatchResult for files that are skipped entirely.
   */
  private emptyBatch(filePath: string, currentTotalFetched: number): Result<ImportBatchResult, Error> {
    return ok({
      rawTransactions: [],
      streamType: `csv:kucoin:${filePath}`,
      cursor: this.createFileCursor(filePath, `csv:kucoin:${filePath}:none`, 0, currentTotalFetched, true),
      isComplete: true,
    });
  }

  /**
   * Create a cursor for a CSV file
   * @param filePath - Full absolute path to the CSV file (ensures uniqueness)
   * @param lastTransactionId - ID of the last transaction in this batch
   * @param rowCount - Number of rows/transactions in this file
   * @param currentTotal - Cumulative total before this file
   * @param isComplete - Whether this file is complete
   */
  private createFileCursor(
    filePath: string,
    lastTransactionId: string,
    rowCount: number,
    currentTotal: number,
    isComplete: boolean
  ) {
    return {
      primary: {
        type: 'pageToken' as const,
        value: filePath, // Use full path for uniqueness
        providerName: 'kucoin',
      },
      lastTransactionId,
      totalFetched: currentTotal + rowCount,
      metadata: {
        providerName: 'kucoin',
        updatedAt: Date.now(),
        isComplete,
        filePath, // Store full path for resume detection
        fileName: path.basename(filePath), // Also store basename for readability
        rowCount,
      },
    };
  }

  /**
   * Parse a CSV file using the common parsing logic.
   */
  private async parseCsvFile<T>(filePath: string): Promise<T[]> {
    try {
      return parseCsvFile<T>(filePath);
    } catch (error) {
      this.logger.error(`Failed to parse CSV file ${filePath}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Recursively collect CSV files under a root directory.
   * Skips symlinked directories to avoid cycles.
   */
  private async collectCsvFiles(rootDir: string): Promise<string[]> {
    const results: string[] = [];
    const stack: string[] = [rootDir];

    while (stack.length > 0) {
      const currentDir = stack.pop() as string;
      let entries: Dirent[];

      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        this.logger.error(`Failed to read directory ${currentDir}: ${String(error)}`);
        throw error;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Avoid following symlinks to prevent infinite loops
          if (entry.isSymbolicLink()) continue;
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.csv')) {
          results.push(fullPath);
        }
      }
    }

    // Sort for deterministic ordering across runs
    results.sort();
    return results;
  }

  /**
   * Filter rows to mainAccount only. KuCoin sometimes labels sub-accounts differently;
   * we currently ingest only mainAccount rows to keep balances aligned with spot/funding.
   */
  private filterMainAccountRows<T extends { ['Account Type']?: string }>(
    rows: T[],
    fileName: string,
    rowLabel: string
  ): T[] {
    const filtered = rows.filter((row) => (row['Account Type'] ?? '').toLowerCase() === 'mainaccount');
    const skipped = rows.length - filtered.length;
    if (skipped > 0) {
      this.logger.warn(
        `Skipped ${skipped}/${rows.length} ${rowLabel} rows with Account Type != mainAccount in ${fileName}`
      );
    }
    return filtered;
  }
  /**
   * Count the number of data records in a CSV file (excluding header).
   */
  private async countCsvRecords(filePath: string): Promise<number> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      // Subtract 1 for header row, return 0 if only header or empty
      return Math.max(0, lines.length - 1);
    } catch (error) {
      this.logger.error(`Failed to count records in ${filePath}: ${String(error)}`);
      return 0;
    }
  }

  /**
   * Validate CSV headers and determine file type.
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = CSV_FILE_TYPES;

    try {
      const fileType = await validateCsvHeaders(filePath, expectedHeaders);
      return fileType;
    } catch (error) {
      this.logger.error(`Failed to validate CSV headers for ${filePath}: ${String(error)}`);
      return 'unknown';
    }
  }

  /**
   * Generate a deterministic external ID from row fields.
   * Used when CSV rows don't have a natural unique identifier.
   */
  private generateEventId(type: string, timestamp: string, currency: string, amount: string): string {
    const data = `${type}-${timestamp}-${currency}-${amount}`;
    return sha256Hex(data).substring(0, 16);
  }

  /**
   * Get a unique event ID, appending a counter if the ID has been used before.
   * This handles duplicate rows in CSV files.
   */
  private getUniqueEventId(baseId: string): string {
    const count = this.usedEventIds.get(baseId) ?? 0;
    this.usedEventIds.set(baseId, count + 1);

    return count === 0 ? baseId : `${baseId}-${count}`;
  }

  /**
   * Parse KuCoin CSV timestamp to Unix milliseconds
   * KuCoin timestamps are in format "YYYY-MM-DD HH:MM:SS" (UTC)
   */
  private parseTimestamp(timeStr: string): number {
    // KuCoin CSV timestamps are already in UTC
    // Add 'Z' suffix to ensure proper UTC parsing
    const isoString = timeStr.replace(' ', 'T') + 'Z';
    return new Date(isoString).getTime();
  }
}
