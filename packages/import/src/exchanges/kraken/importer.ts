import fs from 'fs/promises';
import path from 'path';

import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ValidationResult } from '../../shared/importers/interfaces.ts';
import { CsvParser } from '../csv-parser.ts';
import type { CsvKrakenLedgerRow } from './types.ts';

// Expected CSV headers for validation
const EXPECTED_HEADERS = {
  LEDGERS_CSV: '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
};

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
    const expectedHeaders = {
      [EXPECTED_HEADERS.LEDGERS_CSV]: 'ledgers',
    };

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
    // Validate required fields in CSV data
    const requiredFields = ['txid', 'refid', 'time', 'type', 'asset', 'amount'];

    let invalidRecords = 0;
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      // Check first 10 records
      const record = data[i];
      for (const field of requiredFields) {
        if (!record[field as keyof CsvKrakenLedgerRow]) {
          result.errors.push(`Missing required field '${field}' in record ${i + 1}`);
          invalidRecords++;
          break;
        }
      }
    }

    if (invalidRecords > 0) {
      result.isValid = false;
      result.errors.push(`Found ${invalidRecords} invalid records (checked first 10)`);
    }

    // Check for valid timestamps
    const sampleRecord = data[0];
    if (sampleRecord && isNaN(new Date(sampleRecord.time).getTime())) {
      result.warnings.push('Invalid timestamp format detected in sample record');
    }

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
