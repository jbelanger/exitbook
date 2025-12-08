// Pure utility functions for export command
// All functions are pure - no side effects

import type { UniversalTransactionData } from '@exitbook/core';
import { computePrimaryMovement } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { z } from 'zod';

import type { ExportCommandOptionsSchema } from '../shared/schemas.js';

/**
 * Export command options validated by Zod at CLI boundary
 * Using z.input to get the input type (before defaults are applied)
 */
export type ExportCommandOptions = z.input<typeof ExportCommandOptionsSchema>;

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
 * Build export parameters from validated CLI flags.
 * No validation needed - options are already validated by Zod schema.
 */
export function buildExportParamsFromFlags(options: ExportCommandOptions): Result<ExportHandlerParams, Error> {
  const sourceName = options.exchange || options.blockchain;
  const format = options.format ?? 'csv';

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
  const outputPath = options.output || `data/transactions.${format}`;

  return ok({
    sourceName,
    format,
    outputPath,
    since,
  });
}

/**
 * Convert transactions to CSV format.
 */
export function convertToCSV(transactions: UniversalTransactionData[]): string {
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

    // Extract network and platform fees from the fees array
    const networkFee = tx.fees?.find((fee) => fee.scope === 'network');
    const platformFee = tx.fees?.find((fee) => fee.scope === 'platform');

    const values = [
      tx.id || '',
      tx.source || '',
      tx.operation.category || '',
      tx.operation.type || '',
      tx.datetime || '',
      primary?.asset || '',
      primary?.amount.toFixed() || '',
      primary?.direction || '',
      networkFee?.amount.toFixed() || '',
      networkFee?.asset || '',
      platformFee?.amount.toFixed() || '',
      platformFee?.asset || '',
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
export function convertToJSON(transactions: UniversalTransactionData[]): string {
  if (transactions.length === 0) return '[]';
  return JSON.stringify(transactions, undefined, 2);
}
