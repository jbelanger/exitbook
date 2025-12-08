import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ExportHandlerParams } from './export-utils.js';
import { convertToCSV, convertToJSON } from './export-utils.js';

// Re-export for convenience
export type { ExportHandlerParams };

const logger = getLogger('ExportHandler');

/**
 * Result of the export operation.
 */
export interface ExportResult {
  /** Number of transactions exported */
  transactionCount: number;

  /** Output file path */
  outputPath: string;

  /** Export format */
  format: 'csv' | 'json';

  /** Source name (if filtered) */
  sourceName?: string | undefined;

  /** Content that was exported (for testing or JSON mode) */
  content: string;
}

/**
 * Export handler - encapsulates all export business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ExportHandler {
  constructor(private transactionRepository: TransactionRepository) {}

  /**
   * Execute the export operation.
   */
  async execute(params: ExportHandlerParams): Promise<Result<ExportResult, Error>> {
    try {
      logger.info({ params }, 'Starting export');

      // Build filter object conditionally to avoid passing undefined values
      const filters = {
        ...(params.sourceName && { sourceName: params.sourceName }),
        ...(params.since && { since: params.since }),
        includeExcluded: true, // Include all transactions in exports
      };

      // Fetch transactions from database
      const transactionsResult = await this.transactionRepository.getTransactions(filters);

      if (transactionsResult.isErr()) {
        return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
      }

      const transactions = transactionsResult.value;
      logger.info(`Retrieved ${transactions.length} transactions`);

      // Convert to requested format
      let content: string;
      if (params.format === 'csv') {
        content = convertToCSV(transactions);
      } else {
        content = convertToJSON(transactions);
      }

      logger.info(`Converted to ${params.format.toUpperCase()} format`);

      return ok({
        transactionCount: transactions.length,
        outputPath: params.outputPath,
        format: params.format,
        sourceName: params.sourceName,
        content,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources (none needed for ExportHandler, but included for consistency).
   */
  destroy(): void {
    // No resources to cleanup
  }
}
