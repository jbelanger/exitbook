import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { ExportHandlerParams, NormalizedCsvOutput } from './transactions-export-utils.js';
import { convertToCSV, convertToJSON, convertToNormalizedCSV } from './transactions-export-utils.js';
import { readTransactionsForCommand } from './transactions-read-support.js';

const logger = getLogger('TransactionsExportHandler');

/**
 * Result of the export operation.
 */
interface ExportResult {
  /** Number of transactions exported */
  transactionCount: number;

  /** Export format */
  format: 'csv' | 'json';

  /** CSV format (when format is csv) */
  csvFormat?: 'normalized' | 'simple' | undefined;

  /** Source name (if filtered) */
  platformKey?: string | undefined;

  /** Outputs to write */
  outputs: ExportOutput[];
}

interface ExportOutput {
  path: string;
  content: string;
}

/**
 * Export handler - encapsulates all export business logic.
 * Reusable by both CLI command and other contexts.
 */
export class TransactionsExportHandler {
  constructor(private readonly db: DataSession) {}

  /**
   * Execute the export operation.
   */
  async execute(params: ExportHandlerParams): Promise<Result<ExportResult, Error>> {
    try {
      const transactionsResult = await readTransactionsForCommand({
        db: this.db,
        platformKey: params.platformKey,
        since: params.since,
        until: params.until,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      });
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;
      logger.info(`Retrieved ${transactions.length} transactions from database`);

      // Convert to requested format
      let outputs: ExportOutput[];
      if (params.format === 'csv') {
        const csvFormat = params.csvFormat ?? 'normalized';
        if (csvFormat === 'normalized') {
          const transactionIds = transactions.map((tx) => tx.id);
          const linksResult = await this.db.transactionLinks.findByTransactionIds(transactionIds);
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
        platformKey: params.platformKey,
        outputs,
      });
    } catch (error) {
      return wrapError(error, 'Failed to export transactions');
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
