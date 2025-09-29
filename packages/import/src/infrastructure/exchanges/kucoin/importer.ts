import fs from 'node:fs/promises';
import path from 'node:path';

import type { ImportParams, ImportRunResult } from '../../../app/ports/importers.ts';
import { BaseImporter } from '../../shared/importers/base-importer.js';
import { CsvParser } from '../csv-parser.js';

import { CSV_FILE_TYPES } from './constants.js';
import type { CsvAccountHistoryRow, CsvDepositWithdrawalRow, CsvKuCoinRawData, CsvSpotOrderRow } from './types.js';
import { validateKuCoinAccountHistory, validateKuCoinDepositsWithdrawals, validateKuCoinSpotOrders } from './utils.js';

/**
 * Importer for KuCoin CSV files.
 * Handles reading CSV files from specified directories and parsing different KuCoin export formats.
 */
export class KucoinCsvImporter extends BaseImporter {
  constructor() {
    super('kucoin');
  }

  async import(params: ImportParams): Promise<ImportRunResult> {
    this.logger.info(`Starting KuCoin CSV import from directories: ${params.csvDirectories?.join(', ') ?? 'none'}`);

    if (!params.csvDirectories?.length) {
      throw new Error('CSV directories are required for KuCoin import');
    }

    const rawData: CsvKuCoinRawData = {
      accountHistory: [],
      deposits: [],
      spotOrders: [],
      withdrawals: [],
    };

    try {
      // Process each directory in order
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

                // Validate CSV data using Zod schemas
                const validationResult = validateKuCoinSpotOrders(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid trading rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} trading transactions from ${file}`
                );
                rawData.spotOrders.push(...validationResult.valid);
                break;
              }
              case 'deposit': {
                this.logger.info(`Processing deposit CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);

                // Validate CSV data using Zod schemas
                const validationResult = validateKuCoinDepositsWithdrawals(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid deposit rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} deposit transactions from ${file}`
                );
                rawData.deposits.push(...validationResult.valid);
                break;
              }
              case 'withdrawal': {
                this.logger.info(`Processing withdrawal CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvDepositWithdrawalRow>(filePath);

                // Validate CSV data using Zod schemas
                const validationResult = validateKuCoinDepositsWithdrawals(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid withdrawal rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} withdrawal transactions from ${file}`
                );
                rawData.withdrawals.push(...validationResult.valid);
                break;
              }
              case 'account_history': {
                this.logger.info(`Processing account history CSV file: ${file}`);
                const rawRows = await this.parseCsvFile<CsvAccountHistoryRow>(filePath);

                // Validate CSV data using Zod schemas
                const validationResult = validateKuCoinAccountHistory(rawRows);

                if (validationResult.invalid.length > 0) {
                  this.logger.error(
                    `${validationResult.invalid.length} invalid account history rows in ${file}. ` +
                      `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${rawRows.length}`
                  );
                }

                this.logger.info(
                  `Parsed and validated ${validationResult.valid.length} account history entries from ${file}`
                );
                rawData.accountHistory.push(...validationResult.valid);
                break;
              }
              case 'convert':
                this.logger.warn(`Skipping convert orders CSV file - using account history instead: ${file}`);
                break;
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

      // Sort each type by timestamp
      rawData.spotOrders.sort(
        (a, b) => new Date(a['Filled Time(UTC)']).getTime() - new Date(b['Filled Time(UTC)']).getTime()
      );
      rawData.deposits.sort((a, b) => new Date(a['Time(UTC)']).getTime() - new Date(b['Time(UTC)']).getTime());
      rawData.withdrawals.sort((a, b) => new Date(a['Time(UTC)']).getTime() - new Date(b['Time(UTC)']).getTime());
      rawData.accountHistory.sort((a, b) => new Date(a['Time(UTC)']).getTime() - new Date(b['Time(UTC)']).getTime());

      const totalCount =
        rawData.spotOrders.length +
        rawData.deposits.length +
        rawData.withdrawals.length +
        rawData.accountHistory.length;

      this.logger.info(
        `Completed KuCoin CSV import: ${totalCount} total entries from ${params.csvDirectories.length} directories ` +
          `(Spot: ${rawData.spotOrders.length}, Deposits: ${rawData.deposits.length}, ` +
          `Withdrawals: ${rawData.withdrawals.length}, Account History: ${rawData.accountHistory.length})`
      );

      // Return as a single batch with all the parsed data
      return {
        rawData: [
          {
            metadata: { providerId: 'kucoin' },
            rawData,
          },
        ],
      };
    } catch (error) {
      this.handleImportError(error, 'CSV file processing');
      return {
        rawData: [],
      };
    }
  }

  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.csvDirectories?.length) {
      this.logger.error('CSV directories are required for KuCoin import');
      return false;
    }

    // Check that all directories exist and are accessible
    for (const csvDirectory of params.csvDirectories) {
      try {
        const stats = await fs.stat(csvDirectory);
        if (!stats.isDirectory()) {
          this.logger.error(`Path is not a directory: ${csvDirectory}`);
          return false;
        }

        // Check if directory contains CSV files
        const files = await fs.readdir(csvDirectory);
        const csvFiles = files.filter((f) => f.endsWith('.csv'));

        if (csvFiles.length === 0) {
          this.logger.warn(`No CSV files found in directory: ${csvDirectory}`);
        }
      } catch (dirError) {
        this.logger.error(`Cannot access CSV directory ${csvDirectory}: ${String(dirError)}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Parse a CSV file using the common parsing logic.
   */
  private async parseCsvFile<T>(filePath: string): Promise<T[]> {
    try {
      return CsvParser.parseFile<T>(filePath);
    } catch (error) {
      this.logger.error(`Failed to parse CSV file ${filePath}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Validate CSV headers and determine file type.
   */
  private async validateCSVHeaders(filePath: string): Promise<string> {
    const expectedHeaders = CSV_FILE_TYPES;

    try {
      const fileType = await CsvParser.validateHeaders(filePath, expectedHeaders);

      if (fileType === 'unknown') {
        const headers = await CsvParser.getHeaders(filePath);
        this.logger.warn(`Unrecognized CSV headers in ${filePath}: ${headers}`);
      }

      return fileType;
    } catch (error) {
      this.logger.error(`Failed to validate CSV headers for ${filePath}: ${String(error)}`);
      return 'unknown';
    }
  }
}
