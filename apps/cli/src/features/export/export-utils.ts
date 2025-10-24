// Pure utility functions for export command
// All functions are pure - no side effects

import type { UniversalTransaction } from '@exitbook/core';
import { computePrimaryMovement } from '@exitbook/core';
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
export function convertToCSV(transactions: UniversalTransaction[]): string {
  if (transactions.length === 0) return '';

  const headers = [
    'id',
    'source',
    'operation_category',
    'operation_type',
    'datetime',
    'primary_asset',
    'primary_amount',
    'primary_direction',
    'network_fee_amount',
    'network_fee_currency',
    'platform_fee_amount',
    'platform_fee_currency',
    'price',
    'price_currency',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    // Compute primary movement from inflows/outflows
    const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

    const values = [
      tx.id || '',
      tx.source || '',
      tx.operation.category || '',
      tx.operation.type || '',
      tx.datetime || '',
      primary?.asset || '',
      primary?.amount.toFixed() || '',
      primary?.direction || '',
      tx.fees.network?.amount.toFixed() || '',
      tx.fees.network?.asset.toString() || '',
      tx.fees.platform?.amount.toFixed() || '',
      tx.fees.platform?.asset.toString() || '',
      tx.status || '',
    ];

    // Escape values per RFC 4180: quote fields containing commas, quotes, or newlines
    // and escape internal quotes by doubling them
    const escapedValues = values.map((value) => {
      const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

      // If value contains comma, quote, or newline, it must be quoted
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        // Escape quotes by doubling them, then wrap in quotes
        return `"${stringValue.replaceAll('"', '""')}"`;
      }

      return stringValue;
    });

    csvLines.push(escapedValues.join(','));
  }

  return csvLines.join('\n');
}

/**
 * Convert transactions to JSON format.
 */
export function convertToJSON(transactions: UniversalTransaction[]): string {
  if (transactions.length === 0) return '[]';
  return JSON.stringify(transactions, undefined, 2);
}
