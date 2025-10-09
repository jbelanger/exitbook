// Pure utility functions for export command
// All functions are pure - no side effects

import type { StoredTransaction } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for building export parameters.
 */
export interface ExportCommandOptions {
  blockchain?: string | undefined;
  exchange?: string | undefined;
  format?: string | undefined;
  output?: string | undefined;
  since?: string | undefined;
}

/**
 * Export handler parameters.
 */
export interface ExportHandlerParams {
  /** Source name (exchange or blockchain) - optional, exports all if not provided */
  sourceName?: string | undefined;

  /** Export format (csv or json) */
  format: 'csv' | 'json';

  /** Output file path */
  outputPath: string;

  /** Since date (Unix timestamp in milliseconds) - optional */
  since?: number | undefined;
}

/**
 * Supported export formats.
 */
export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Validate export format.
 */
export function validateExportFormat(format: string): Result<ExportFormat, Error> {
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
    return err(new Error(`Invalid format: ${format}. Supported formats: ${EXPORT_FORMATS.join(', ')}`));
  }
  return ok(format as ExportFormat);
}

/**
 * Parse since date string to Unix timestamp (milliseconds).
 */
export function parseSinceDate(since: string): Result<number, Error> {
  // Handle special case: "0" means all history
  if (since === '0') {
    return ok(0);
  }

  const timestamp = Date.parse(since);
  if (isNaN(timestamp)) {
    return err(new Error('Invalid date format. Use YYYY-MM-DD, ISO timestamp, or 0 for all history'));
  }

  return ok(timestamp);
}

/**
 * Build export parameters from CLI flags.
 * Validates inputs and constructs ExportHandlerParams.
 */
export function buildExportParamsFromFlags(options: ExportCommandOptions): Result<ExportHandlerParams, Error> {
  // Validate format
  const format = options.format || 'csv';
  const formatResult = validateExportFormat(format);
  if (formatResult.isErr()) {
    return err(formatResult.error);
  }

  // Validate source selection (optional)
  const sourceName = options.exchange || options.blockchain;
  if (options.exchange && options.blockchain) {
    return err(new Error('Cannot specify both --exchange and --blockchain. Choose one or omit both to export all.'));
  }

  // Parse since date if provided
  let since: number | undefined;
  if (options.since) {
    const sinceResult = parseSinceDate(options.since);
    if (sinceResult.isErr()) {
      return err(sinceResult.error);
    }
    since = sinceResult.value;
  }

  // Build output path
  const outputPath = options.output || `data/transactions.${formatResult.value}`;

  return ok({
    sourceName,
    format: formatResult.value,
    outputPath,
    since,
  });
}

/**
 * Validate export parameters.
 */
export function validateExportParams(params: ExportHandlerParams): Result<void, Error> {
  // Format is required
  if (!params.format) {
    return err(new Error('Export format is required'));
  }

  // Output path is required
  if (!params.outputPath) {
    return err(new Error('Output path is required'));
  }

  return ok();
}

/**
 * Convert transactions to CSV format.
 */
export function convertToCSV(transactions: StoredTransaction[]): string {
  if (transactions.length === 0) return '';

  const headers = [
    'id',
    'source',
    'operation_category',
    'operation_type',
    'timestamp',
    'datetime',
    'primary_asset',
    'primary_amount',
    'primary_direction',
    'total_fee',
    'price',
    'price_currency',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    // Format datetime properly
    const datetime =
      tx.transaction_datetime || (tx.transaction_datetime ? new Date(tx.transaction_datetime).toISOString() : '');

    const values = [
      tx.id || '',
      tx.source_id || '',
      tx.operation_category || '',
      tx.operation_type || '',
      tx.transaction_datetime || '',
      datetime,
      tx.movements_primary_asset || '',
      tx.movements_primary_amount || '',
      tx.movements_primary_direction || '',
      tx.fees_total || '',
      tx.price || '',
      tx.price_currency || '',
      tx.transaction_status || '',
    ];

    // Escape values that contain commas
    const escapedValues = values.map((value) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Proper check done
      const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });

    csvLines.push(escapedValues.join(','));
  }

  return csvLines.join('\n');
}

/**
 * Convert transactions to JSON format.
 */
export function convertToJSON(transactions: StoredTransaction[]): string {
  if (transactions.length === 0) return '[]';

  const processedTransactions = transactions.map((tx) => {
    return {
      id: tx.id,
      source_id: tx.source_id,
      datetime: tx.transaction_datetime,
      status: tx.transaction_status,
      operation: {
        category: tx.operation_category,
        type: tx.operation_type,
      },
      movements: {
        primary: {
          asset: tx.movements_primary_asset,
          amount: tx.movements_primary_amount,
          direction: tx.movements_primary_direction,
        },
        inflows: tx.movements_inflows,
        outflows: tx.movements_outflows,
      },
      fees: {
        total: tx.fees_total,
        network: tx.fees_network,
        platform: tx.fees_platform,
      },
      price: tx.price,
      price_currency: tx.price_currency,
      blockchain: {
        name: tx.blockchain_name,
        block_height: tx.blockchain_block_height,
        transaction_hash: tx.blockchain_transaction_hash,
        is_confirmed: tx.blockchain_is_confirmed,
      },
      verified: tx.verified,
      created_at: tx.created_at,
    };
  });

  return JSON.stringify(processedTransactions, undefined, 2);
}
