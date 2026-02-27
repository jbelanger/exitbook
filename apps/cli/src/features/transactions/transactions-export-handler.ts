import type { TransactionLinkQueries, TransactionQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ExportHandlerParams, NormalizedCsvOutput } from './transactions-export-utils.js';
import { convertToCSV, convertToJSON, convertToNormalizedCSV } from './transactions-export-utils.js';
import type { ViewTransactionsParams } from './transactions-view-utils.js';
import { applyTransactionFilters } from './transactions-view-utils.js';

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
    private transactionRepository: TransactionQueries,
    private transactionLinkRepository: TransactionLinkQueries
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

      let transactions = transactionsResult.value;
      logger.info(`Retrieved ${transactions.length} transactions from database`);

      // Apply in-memory filters (asset, operationType, noPrice, until)
      const filterParams: Partial<ViewTransactionsParams> = {
        until: params.until,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      };

      const filteredResult = applyTransactionFilters(transactions, filterParams as ViewTransactionsParams);
      if (filteredResult.isErr()) {
        return err(filteredResult.error);
      }

      transactions = filteredResult.value;
      logger.info(`Filtered to ${transactions.length} transactions`);

      // Convert to requested format
      let outputs: ExportOutput[];
      if (params.format === 'csv') {
        const csvFormat = params.csvFormat ?? 'normalized';
        if (csvFormat === 'normalized') {
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
