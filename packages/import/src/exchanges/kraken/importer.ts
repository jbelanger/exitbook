import fs from 'fs/promises';
import path from 'path';

import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ValidationResult } from '../../shared/importers/interfaces.ts';
import { CsvParser } from '../csv-parser.ts';
import { CSV_FILE_TYPES } from './constants.ts';
import type { CsvKrakenLedgerRow } from './types.ts';
import { formatKrakenValidationErrors, validateKrakenCsvRows } from './utils.ts';

/**
 * Importer for Kraken CSV ledger files.
 * Handles reading CSV files from specified directories and parsing ledger data.
 */
export class KrakenCsvImporter extends BaseImporter<CsvKrakenLedgerRow> {
  constructor() {
    super('kraken');
  }

  /**
   * Parse a CSV file using the common parsing logic.
   */
  private async parseCsvFile<T>(filePath: string): Promise<T[]> {
    try {
      return CsvParser.parseFile<T>(filePath);
    } catch (error) {
      this.logger.error(`Failed to parse CSV file ${filePath}: ${error}`);
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
      this.logger.error(`Failed to validate CSV headers for ${filePath}: ${error}`);
      return 'unknown';
    }
  }

  async importFromSource(params: ImportParams): Promise<CsvKrakenLedgerRow[]> {
    this.logger.info(`Starting Kraken CSV import from directories: ${params.csvDirectories}`);

    if (!params.csvDirectories?.length) {
      throw new Error('CSV directories are required for Kraken import');
    }

    const allTransactions: CsvKrakenLedgerRow[] = [];

    try {
      // Process each directory in order
      for (const csvDirectory of params.csvDirectories) {
        this.logger.info(`Processing CSV directory: ${csvDirectory}`);

        try {
          const files = await fs.readdir(csvDirectory);
          this.logger.debug(`Found files in directory ${csvDirectory}: ${files}`);

          // Process all CSV files with proper header validation
          const csvFiles = files.filter(f => f.endsWith('.csv'));

          for (const file of csvFiles) {
            const filePath = path.join(csvDirectory, file);
            const fileType = await this.validateCSVHeaders(filePath);

            if (fileType === 'ledgers') {
              this.logger.info(`Processing ledgers CSV file: ${file}`);
              const fileTransactions = await this.parseCsvFile<CsvKrakenLedgerRow>(filePath);
              this.logger.info(`Parsed ${fileTransactions.length} transactions from ${file}`);
              allTransactions.push(...fileTransactions);
            } else if (fileType === 'unknown') {
              this.logger.warn(`Skipping unrecognized CSV file: ${file}`);
            } else {
              this.logger.warn(`No handler for file type: ${fileType} in file: ${file}`);
            }
          }
        } catch (dirError) {
          this.logger.error(`Failed to process CSV directory ${csvDirectory}: ${dirError}`);
          // Continue processing other directories
          continue;
        }
      }

      // Sort by timestamp
      allTransactions.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      this.logger.info(
        `Completed Kraken CSV import: ${allTransactions.length} transactions from ${params.csvDirectories.length} directories`
      );

      return allTransactions;
    } catch (error) {
      this.handleImportError(error, 'CSV file processing');
    }
  }

  protected validateRawDataSpecific(data: CsvKrakenLedgerRow[], result: ValidationResult): ValidationResult {
    this.logger.debug(`Validating ${data.length} Kraken CSV rows with Zod schema`);

    const validationResult = validateKrakenCsvRows(data);

    if (validationResult.invalid.length > 0) {
      const errorMessage = formatKrakenValidationErrors(validationResult);
      this.logger.warn(`Kraken CSV validation issues: ${errorMessage}`);

      // Add detailed error information
      result.warnings.push(errorMessage);

      // Add individual errors for the first few invalid rows
      validationResult.invalid.slice(0, 5).forEach(({ errors, rowIndex }) => {
        const fieldErrors = errors.issues.map(
          issue => `Row ${rowIndex + 1}, ${issue.path.join('.')}: ${issue.message}`
        );
        result.errors.push(...fieldErrors);
      });

      // If there are too many errors, mark as invalid
      const errorRate = validationResult.invalid.length / validationResult.totalRows;
      if (errorRate > 0.1) {
        // More than 10% error rate
        result.isValid = false;
        result.errors.push(`High error rate: ${(errorRate * 100).toFixed(1)}% of rows failed validation`);
      }
    }

    this.logger.info(
      `Kraken CSV validation: ${validationResult.valid.length} valid, ${validationResult.invalid.length} invalid rows`
    );
    return result;
  }

  protected async validateSourceSpecific(params: ImportParams): Promise<boolean> {
    if (!params.csvDirectories?.length) {
      this.logger.error('CSV directories are required for Kraken import');
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
        const csvFiles = files.filter(f => f.endsWith('.csv'));

        if (csvFiles.length === 0) {
          this.logger.warn(`No CSV files found in directory: ${csvDirectory}`);
        }
      } catch (dirError) {
        this.logger.error(`Cannot access CSV directory ${csvDirectory}: ${dirError}`);
        return false;
      }
    }

    return true;
  }
}
