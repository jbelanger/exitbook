import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getErrorMessage, type ExternalTransaction } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.js';
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
  private readonly sourceId = 'kucoin';
  private usedExternalIds: Map<string, number>;

  constructor() {
    this.logger = getLogger('kucoinImporter');
    this.usedExternalIds = new Map();
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info(`Starting KuCoin CSV import from directories: ${params.csvDirectories?.join(', ') ?? 'none'}`);

    if (!params.csvDirectories?.length) {
      return err(new Error('CSV directories are required for KuCoin import'));
    }

    // Reset external ID tracking for new import
    this.usedExternalIds.clear();
    const rawTransactions: ExternalTransaction[] = [];

    try {
      for (const csvDirectory of params.csvDirectories) {
        this.logger.info(`Processing CSV directory: ${csvDirectory}`);

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug(`Found files in directory ${csvDirectory}: ${files.join(', ')}`);

          // Process all CSV files with proper header validation
          const csvFiles = files.filter((f) => f.endsWith('.csv'));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            switch (fileType) {
              case 'trading': {
                this.logger.info(`Processing trading CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvSpotOrderRow>(filePath);

                const validationResult = validateKuCoinSpotOrders(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid trading rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} trading transactions from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  const externalId = this.getUniqueExternalId(row['Order ID']);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'spot_order',
                    rawData: { _rowType: 'spot_order', ...row },
                    normalizedData: { _rowType: 'spot_order', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'deposit': {
                this.logger.info(`Processing deposit CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);

                const validationResult = validateKuCoinDepositsWithdrawals(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid deposit rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} deposit transactions from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  // Use hash as external ID, or generate one if hash is empty
                  const baseId = row.Hash || this.generateExternalId('deposit', row['Time(UTC)'], row.Coin, row.Amount);
                  const externalId = this.getUniqueExternalId(baseId);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'deposit',
                    rawData: { _rowType: 'deposit', ...row },
                    normalizedData: { _rowType: 'deposit', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'withdrawal': {
                this.logger.info(`Processing withdrawal CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);

                const validationResult = validateKuCoinDepositsWithdrawals(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid withdrawal rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} withdrawal transactions from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  // Use hash as external ID, or generate one if hash is empty
                  const baseId =
                    row.Hash || this.generateExternalId('withdrawal', row['Time(UTC)'], row.Coin, row.Amount);
                  const externalId = this.getUniqueExternalId(baseId);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'withdrawal',
                    normalizedData: { _rowType: 'withdrawal', ...row },
                    rawData: { _rowType: 'withdrawal', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'account_history': {
                this.logger.info(`Processing account history CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvAccountHistoryRow>(filePath);

                const validationResult = validateKuCoinAccountHistory(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid account history rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} account history entries from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  // Generate external ID from timestamp, type, currency, and amount
                  const baseId = this.generateExternalId(row.Type, row['Time(UTC)'], row.Currency, row.Amount);
                  const externalId = this.getUniqueExternalId(baseId);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'account_history',
                    normalizedData: { _rowType: 'account_history', ...row },
                    rawData: { _rowType: 'account_history', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'order_splitting': {
                // Skip Spot order-splitting files to avoid duplicates with regular Spot Orders
                // Spot orders are already imported from "Spot Orders_Filled Orders.csv"
                // Only import Margin and Futures order-splitting files when those are implemented
                if (file.includes('Spot Orders_')) {
                  const recordCount = await this.countCsvRecords(filePath);
                  this.logger.info(
                    `Skipping ${recordCount} spot order-splitting transaction${recordCount === 1 ? '' : 's'}: ${file}. Using Spot Orders_Filled Orders.csv instead to avoid duplicates.`
                  );
                  break;
                }

                this.logger.info(`Processing order-splitting CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvOrderSplittingRow>(filePath);

                const validationResult = validateKuCoinOrderSplitting(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid order-splitting rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} order-splitting transactions from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  // Use Order ID + Filled Time as external ID since there can be multiple fills per order
                  const baseId = `${row['Order ID']}-${row['Filled Time(UTC)']}`;
                  const externalId = this.getUniqueExternalId(baseId);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'order_splitting',
                    normalizedData: { _rowType: 'order_splitting', ...row },
                    rawData: { _rowType: 'order_splitting', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'trading_bot': {
                this.logger.info(`Processing trading bot CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvTradingBotRow>(filePath);

                const validationResult = validateKuCoinTradingBot(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid trading bot rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                  validationResult.invalid.slice(0, 3).forEach(({ errors, rowIndex }) => {
                    const fieldErrors = errors.issues
                      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                      .join('; ');
                    this.logger.debug(`Row ${rowIndex + 1} validation errors: ${fieldErrors}`);
                  });
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} trading bot transactions from ${file}`
                );

                // Convert each row to a RawTransactionWithMetadata
                for (const row of validationResult.valid) {
                  // Use Order ID + Time Filled as external ID since there can be multiple fills per order
                  const baseId = `${row['Order ID']}-${row['Time Filled(UTC)']}`;
                  const externalId = this.getUniqueExternalId(baseId);
                  rawTransactions.push({
                    providerId: 'kucoin',
                    transactionTypeHint: 'trading_bot',
                    normalizedData: { _rowType: 'trading_bot', ...row },
                    rawData: { _rowType: 'trading_bot', ...row },
                    externalId,
                  });
                }
                break;
              }
              case 'convert':
                this.logger.warn(`Skipping convert orders CSV file - using account history instead: ${file}`);
                break;
              case 'not_implemented_futures_orders':
              case 'not_implemented_futures_pnl': {
                const recordCount = await this.countCsvRecords(filePath);
                if (recordCount > 0) {
                  this.logger.warn(
                    `Skipping ${recordCount} futures trading transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${file}. Futures trading support coming soon.`
                  );
                } else {
                  this.logger.info(`No records found in futures trading file: ${file}`);
                }
                break;
              }
              case 'not_implemented_margin_borrowings':
              case 'not_implemented_margin_orders':
              case 'not_implemented_margin_lending': {
                const recordCount = await this.countCsvRecords(filePath);
                if (recordCount > 0) {
                  this.logger.warn(
                    `Skipping ${recordCount} margin trading transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${file}. Margin trading support coming soon.`
                  );
                } else {
                  this.logger.info(`No records found in margin trading file: ${file}`);
                }
                break;
              }
              case 'not_implemented_fiat_trading':
              case 'not_implemented_fiat_deposits':
              case 'not_implemented_fiat_withdrawals':
              case 'not_implemented_fiat_p2p':
              case 'not_implemented_fiat_third_party': {
                const recordCount = await this.countCsvRecords(filePath);
                if (recordCount > 0) {
                  this.logger.warn(
                    `Skipping ${recordCount} fiat transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${file}. Fiat transaction support coming soon.`
                  );
                } else {
                  this.logger.info(`No records found in fiat transaction file: ${file}`);
                }
                break;
              }
              case 'not_implemented_earn_profit':
              case 'not_implemented_earn_staking': {
                const recordCount = await this.countCsvRecords(filePath);
                if (recordCount > 0) {
                  this.logger.warn(
                    `Skipping ${recordCount} earn/staking transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${file}. Staking rewards support coming soon.`
                  );
                } else {
                  this.logger.info(`No records found in earn/staking file: ${file}`);
                }
                break;
              }
              case 'not_implemented_trading_bot': {
                const recordCount = await this.countCsvRecords(filePath);
                if (recordCount > 0) {
                  this.logger.warn(
                    `Skipping ${recordCount} trading bot transaction${recordCount === 1 ? '' : 's'} (not yet implemented): ${file}. Trading bot transaction support coming soon.`
                  );
                } else {
                  this.logger.info(`No records found in trading bot file: ${file}`);
                }
                break;
              }
              case 'not_implemented_snapshots': {
                const recordCount = await this.countCsvRecords(filePath);
                this.logger.info(
                  `Skipping asset snapshots file (${recordCount} snapshot${recordCount === 1 ? '' : 's'}): ${file}. Snapshots are informational only and not imported.`
                );
                break;
              }
              case 'unknown':
                this.logger.warn(`Skipping unrecognized CSV file: ${file}`);
                break;
              default:
                this.logger.warn(`No handler for file type: ${fileType} in file: ${file}`);
            }
          }
        } catch (dirError) {
          this.logger.error(`Failed to process CSV directory ${csvDirectory}: ${String(dirError)}`);
          // Continue processing other directories
          continue;
        }
      }

      // Sort all transactions by timestamp
      rawTransactions.sort((a, b) => {
        const timeA = this.extractTimestamp(a.rawData);
        const timeB = this.extractTimestamp(b.rawData);
        return timeA - timeB;
      });

      this.logger.info(
        `Completed KuCoin CSV import: ${rawTransactions.length} total transactions from ${params.csvDirectories.length} directories`
      );

      return ok({
        rawTransactions,
        metadata: { importMethod: 'csv' },
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Import failed in CSV file processing: ${errorMessage}`);
      return err(new Error(`${this.sourceId} import failed: ${errorMessage}`));
    }
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
  private generateExternalId(type: string, timestamp: string, currency: string, amount: string): string {
    const data = `${type}-${timestamp}-${currency}-${amount}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Get a unique external ID, appending a counter if the ID has been used before.
   * This handles duplicate rows in CSV files.
   */
  private getUniqueExternalId(baseId: string): string {
    const count = this.usedExternalIds.get(baseId) ?? 0;
    this.usedExternalIds.set(baseId, count + 1);

    return count === 0 ? baseId : `${baseId}-${count}`;
  }

  /**
   * Extract timestamp from raw data based on transaction type.
   */
  private extractTimestamp(rawData: unknown): number {
    if (typeof rawData !== 'object' || rawData === null) {
      return 0;
    }

    const data = rawData as Record<string, unknown>;

    // Try different timestamp field names
    if ('Filled Time(UTC)' in data && typeof data['Filled Time(UTC)'] === 'string') {
      return new Date(data['Filled Time(UTC)']).getTime();
    }
    if ('Time(UTC)' in data && typeof data['Time(UTC)'] === 'string') {
      return new Date(data['Time(UTC)']).getTime();
    }

    return 0;
  }
}
