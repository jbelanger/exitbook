import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import {
  buildAnnotationsByTransactionId,
  filterTransactionsByInterpretationFilters,
} from '../transactions-annotation-utils.js';

import type { ExportHandlerParams, NormalizedCsvOutput } from './transactions-export-utils.js';
import { convertToCSV, convertToJSON, convertToNormalizedCSV } from './transactions-export-utils.js';
import { readTransactionAnnotationsForCommand, readTransactionsForCommand } from './transactions-read-support.js';

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
        profileId: params.profileId,
        accountIds: params.accountIds,
        platformKey: params.platformKey,
        since: params.since,
        until: params.until,
        assetId: params.assetId,
        assetSymbol: params.assetSymbol,
        operationFilter: params.operationFilter,
        noPrice: params.noPrice,
      });
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;
      const annotationsResult = await readTransactionAnnotationsForCommand({
        db: this.db,
        transactionIds: transactions.map((transaction) => transaction.id),
      });
      if (annotationsResult.isErr()) {
        return err(annotationsResult.error);
      }

      const annotationsByTransactionId = buildAnnotationsByTransactionId(annotationsResult.value);
      const filteredTransactions = filterTransactionsByInterpretationFilters(transactions, annotationsByTransactionId, {
        annotationKind: params.annotationKind,
        annotationTier: params.annotationTier,
        operationFilter: params.operationFilter,
      });
      const filteredTransactionIds = new Set(filteredTransactions.map((transaction) => transaction.id));
      const filteredAnnotations = annotationsResult.value.filter((annotation) =>
        filteredTransactionIds.has(annotation.transactionId)
      );
      const filteredAnnotationsByTransactionId = buildAnnotationsByTransactionId(filteredAnnotations);

      logger.info(
        {
          annotationKind: params.annotationKind,
          annotationTier: params.annotationTier,
          filteredCount: filteredTransactions.length,
          retrievedCount: transactions.length,
        },
        'Retrieved transactions and interpretation for export'
      );

      // Convert to requested format
      let outputs: ExportOutput[];
      if (params.format === 'csv') {
        const csvFormat = params.csvFormat ?? 'normalized';
        if (csvFormat === 'normalized') {
          const transactionIds = filteredTransactions.map((tx) => tx.id);
          const linksResult = await this.db.transactionLinks.findByTransactionIds(transactionIds);
          if (linksResult.isErr()) {
            return err(new Error(`Failed to retrieve transaction links: ${linksResult.error.message}`));
          }

          const normalized = convertToNormalizedCSV(
            filteredTransactions,
            linksResult.value,
            filteredAnnotationsByTransactionId
          );
          outputs = buildNormalizedCsvOutputs(params.outputPath, normalized);
        } else {
          outputs = [
            {
              path: params.outputPath,
              content: convertToCSV(filteredTransactions, filteredAnnotationsByTransactionId),
            },
          ];
        }
      } else {
        outputs = [
          {
            path: params.outputPath,
            content: convertToJSON(filteredTransactions, filteredAnnotationsByTransactionId),
          },
        ];
      }

      logger.info(`Converted to ${params.format.toUpperCase()} format`);

      return ok({
        transactionCount: filteredTransactions.length,
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
      path: `${basePath}.annotations.csv`,
      content: normalized.annotationsCsv,
    },
    {
      path: `${basePath}.diagnostics.csv`,
      content: normalized.diagnosticsCsv,
    },
    {
      path: `${basePath}.user-notes.csv`,
      content: normalized.userNotesCsv,
    },
    {
      path: `${basePath}.links.csv`,
      content: normalized.linksCsv,
    },
  ];
}
