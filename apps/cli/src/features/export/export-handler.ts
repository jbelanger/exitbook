import type { TransactionLinkRepository } from '@exitbook/accounting';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ExportHandlerParams, NormalizedCsvOutput } from './export-utils.js';
import { convertToCSV, convertToJSON, convertToNormalizedCSV } from './export-utils.js';

// Re-export for convenience
export type { ExportHandlerParams };

const logger = getLogger('ExportHandler');

/**
 * Result of the export operation.
 */
export interface ExportResult {
  /** Number of transactions exported */
  transactionCount: number;

  /** Export format */
  format: 'csv' | 'json';

  /** CSV format (when format is csv) */
  csvFormat?: 'normalized' | 'simple' | undefined;

  /** Source name (if filtered) */
  sourceName?: string | undefined;

  /** Outputs to write */
  outputs: ExportOutput[];
}

export interface ExportOutput {
  path: string;
  content: string;
}

/**
 * Export handler - encapsulates all export business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ExportHandler {
  constructor(
    private transactionRepository: TransactionRepository,
    private transactionLinkRepository?: TransactionLinkRepository
  ) {}

  /**
   * Execute the export operation.
   */
  async execute(params: ExportHandlerParams): Promise<Result<ExportResult, Error>> {
    try {
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
      let outputs: ExportOutput[];
      if (params.format === 'csv') {
        const csvFormat = params.csvFormat ?? 'normalized';
        if (csvFormat === 'normalized') {
          if (!this.transactionLinkRepository) {
            return err(new Error('TransactionLinkRepository is required for normalized CSV export'));
          }

          const transactionIds = transactions.map((tx) => tx.id);
          const linksResult = await this.transactionLinkRepository.findByTransactionIds(transactionIds);
          if (linksResult.isErr()) {
            return err(new Error(`Failed to retrieve transaction links: ${linksResult.error.message}`));
          }

          const normalized = convertToNormalizedCSV(transactions, linksResult.value);
          outputs = buildNormalizedCsvOutputs(params.outputPath, normalized);
        } else {
          outputs = [
            {
              path: params.outputPath,
              content: convertToCSV(transactions),
            },
          ];
        }
      } else {
        outputs = [
          {
            path: params.outputPath,
            content: convertToJSON(transactions),
          },
        ];
      }

      logger.info(`Converted to ${params.format.toUpperCase()} format`);

      return ok({
        transactionCount: transactions.length,
        format: params.format,
        csvFormat: params.format === 'csv' ? (params.csvFormat ?? 'normalized') : undefined,
        sourceName: params.sourceName,
        outputs,
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

function buildNormalizedCsvOutputs(outputPath: string, normalized: NormalizedCsvOutput): ExportOutput[] {
  const basePath = outputPath.endsWith('.csv') ? outputPath.slice(0, -4) : outputPath;
  return [
    {
      path: outputPath,
      content: normalized.transactionsCsv,
    },
    {
      path: `${basePath}.movements.csv`,
      content: normalized.movementsCsv,
    },
    {
      path: `${basePath}.fees.csv`,
      content: normalized.feesCsv,
    },
    {
      path: `${basePath}.links.csv`,
      content: normalized.linksCsv,
    },
  ];
}
