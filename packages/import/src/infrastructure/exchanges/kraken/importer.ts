import fs from 'node:fs/promises';
import path from 'node:path';

import type { RawTransactionWithMetadata } from '@exitbook/data';
import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import { CsvParser } from '../csv-parser.js';

import { CSV_FILE_TYPES } from './constants.js';
import type { CsvKrakenLedgerRow } from './types.js';
import { formatKrakenValidationErrors, validateKrakenCsvRows } from './utils.js';

/**
 * Importer for Kraken CSV ledger files.
 * Handles reading CSV files from specified directories and parsing ledger data.
 */
export class KrakenCsvImporter implements IImporter {
  private readonly logger: Logger;
  private readonly sourceId = 'kraken';

  constructor() {
    this.logger = getLogger('krakenImporter');
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info(
      `Starting Kraken CSV import from directories: ${
        params.csvDirectories ? params.csvDirectories.join(', ') : 'none'
      }`
    );

    if (!params.csvDirectories?.length) {
      return err(new Error('CSV directories are required for Kraken import'));
    }

    const allTransactions: RawTransactionWithMetadata[] = [];

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

            if (fileType === 'ledgers') {
              this.logger.info(`Processing ledgers CSV file: ${file}`);
              const rawData = await this.parseCsvFile<CsvKrakenLedgerRow>(filePath);

              // Validate CSV data using Zod schemas
              const validationResult = validateKrakenCsvRows(rawData);

              if (validationResult.invalid.length > 0) {
                this.logger.error(
                  `${validationResult.invalid.length} invalid CSV rows in ${file}. ` +
                    `Invalid: ${validationResult.invalid.length}, Valid: ${validationResult.valid.length}, Total: ${validationResult.totalRows}. ` +
                    `Errors: ${formatKrakenValidationErrors(validationResult)}`
                );
              }

              this.logger.info(`Parsed and validated ${validationResult.valid.length} transactions from ${file}`);
              allTransactions.push(
                ...validationResult.valid.map((v) => ({ metadata: { file, providerId: 'kraken' }, rawData: v }))
              );
            } else if (fileType === 'unknown') {
              this.logger.warn(`Skipping unrecognized CSV file: ${file}`);
            } else {
              this.logger.warn(`No handler for file type: ${fileType} in file: ${file}`);
            }
          }
        } catch (dirError) {
          this.logger.error(`Failed to process CSV directory ${csvDirectory}: ${String(dirError)}`);
          // Continue processing other directories
          continue;
        }
      }

      this.logger.info(
        `Completed Kraken CSV import: ${allTransactions.length} transactions from ${params.csvDirectories.length} directories`
      );

      return ok({
        rawTransactions: allTransactions,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Import failed in CSV file processing: ${errorMessage}`);
      return err(new Error(`${this.sourceId} import failed: ${errorMessage}`));
    }
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
