// Pure utility functions for export command
// All functions are pure - no side effects

import type { FeeMovementDraft, PriceAtTxTime, Transaction, TransactionLink } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { err, ok, resultDo } from '@exitbook/foundation';
import type { z } from 'zod';

import type { CsvFormat } from '../transactions-export-model.js';

import type { ExportCommandOptionsSchema } from './transactions-option-schemas.js';

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
  platformKey?: string | undefined;

  /** Export format (csv or json) */
  format: 'csv' | 'json';

  /** CSV export format (normalized or simple). Required when format = csv */
  csvFormat?: CsvFormat | undefined;

  /** Output file path */
  outputPath: string;

  /** Since date (Unix timestamp in milliseconds) - optional */
  since?: number | undefined;

  /** Filter by transactions until this date (ISO string or YYYY-MM-DD) */
  until?: string | undefined;

  /** Filter by asset symbol */
  assetSymbol?: string | undefined;

  /** Filter by operation type */
  operationType?: string | undefined;

  /** Filter to transactions missing price data */
  noPrice?: boolean | undefined;
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
 * Build export parameters from validated CLI flags.
 * No validation needed - options are already validated by Zod schema.
 */
export function buildExportParamsFromFlags(options: ExportCommandOptions): Result<ExportHandlerParams, Error> {
  return resultDo(function* () {
    const platformKey = options.exchange || options.blockchain;
    const format = options.format ?? 'csv';
    const csvFormat = options.csvFormat ?? 'normalized';

    if (format !== 'csv' && options.csvFormat) {
      yield* err(new Error('--csv-format is only supported for CSV exports'));
    }

    const since = options.since ? yield* parseSinceDate(options.since) : undefined;
    const outputPath = options.output || `data/transactions.${format}`;

    return {
      platformKey,
      format,
      csvFormat: format === 'csv' ? csvFormat : undefined,
      outputPath,
      since,
    };
  });
}

/**
 * Convert transactions to CSV format.
 */
export function convertToCSV(transactions: Transaction[]): string {
  if (transactions.length === 0) return '';

  const headers = [
    'id',
    'tx_fingerprint',
    'source',
    'operation_category',
    'operation_type',
    'datetime',
    'inflow_assets',
    'inflow_amounts',
    'outflow_assets',
    'outflow_amounts',
    'network_fee_assets',
    'network_fee_amounts',
    'platform_fee_assets',
    'platform_fee_amounts',
    'status',
  ];
  const csvLines = [headers.join(',')];

  for (const tx of transactions) {
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];
    const networkFees = filterFeesByScope(tx.fees, 'network');
    const platformFees = filterFeesByScope(tx.fees, 'platform');

    const values = [
      tx.id ?? '',
      tx.txFingerprint,
      tx.source ?? '',
      tx.operation.category ?? '',
      tx.operation.type ?? '',
      tx.datetime ?? '',
      formatMovementAssets(inflows),
      formatMovementAmounts(inflows),
      formatMovementAssets(outflows),
      formatMovementAmounts(outflows),
      formatFeeAssets(networkFees),
      formatFeeAmounts(networkFees),
      formatFeeAssets(platformFees),
      formatFeeAmounts(platformFees),
      tx.status ?? '',
    ];

    csvLines.push(formatCsvLine(values));
  }

  return csvLines.join('\n');
}

export interface NormalizedCsvOutput {
  transactionsCsv: string;
  movementsCsv: string;
  feesCsv: string;
  linksCsv: string;
}

export function convertToNormalizedCSV(
  transactions: Transaction[],
  links: TransactionLink[] = []
): NormalizedCsvOutput {
  if (transactions.length === 0) {
    return { transactionsCsv: '', movementsCsv: '', feesCsv: '', linksCsv: '' };
  }

  const transactionHeaders = [
    'id',
    'tx_fingerprint',
    'account_id',
    'source',
    'operation_category',
    'operation_type',
    'datetime',
    'timestamp',
    'status',
    'from',
    'to',
    'blockchain_name',
    'block_height',
    'transaction_hash',
    'is_confirmed',
    'is_spam',
    'excluded_from_accounting',
  ];

  const movementHeaders = [
    'tx_id',
    'direction',
    'asset_id',
    'asset_symbol',
    'gross_amount',
    'net_amount',
    'price_amount',
    'price_currency',
    'price_source',
    'price_fetched_at',
    'price_granularity',
    'fx_rate_to_usd',
    'fx_source',
    'fx_timestamp',
  ];

  const feeHeaders = [
    'tx_id',
    'asset_id',
    'asset_symbol',
    'amount',
    'scope',
    'settlement',
    'price_amount',
    'price_currency',
    'price_source',
    'price_fetched_at',
    'price_granularity',
    'fx_rate_to_usd',
    'fx_source',
    'fx_timestamp',
  ];

  const linkHeaders = [
    'link_id',
    'source_transaction_id',
    'target_transaction_id',
    'asset_symbol',
    'source_amount',
    'target_amount',
    'link_type',
    'confidence_score',
    'status',
    'reviewed_by',
    'reviewed_at',
    'created_at',
    'updated_at',
    'match_criteria_json',
    'metadata_json',
  ];

  const transactionLines = [transactionHeaders.join(',')];
  const movementLines = [movementHeaders.join(',')];
  const feeLines = [feeHeaders.join(',')];
  const linkLines = [linkHeaders.join(',')];

  for (const tx of transactions) {
    transactionLines.push(
      formatCsvLine([
        tx.id,
        tx.txFingerprint,
        tx.accountId,
        tx.source,
        tx.operation.category,
        tx.operation.type,
        tx.datetime,
        tx.timestamp,
        tx.status,
        tx.from,
        tx.to,
        tx.blockchain?.name,
        tx.blockchain?.block_height,
        tx.blockchain?.transaction_hash,
        tx.blockchain?.is_confirmed,
        tx.isSpam,
        tx.excludedFromAccounting,
      ])
    );

    const inflows = tx.movements.inflows ?? [];
    for (const movement of inflows) {
      const priceFields = formatPriceFields(movement.priceAtTxTime);
      movementLines.push(
        formatCsvLine([
          tx.id,
          'in',
          movement.assetId,
          movement.assetSymbol,
          movement.grossAmount.toFixed(),
          movement.netAmount?.toFixed(),
          ...priceFields,
        ])
      );
    }

    const outflows = tx.movements.outflows ?? [];
    for (const movement of outflows) {
      const priceFields = formatPriceFields(movement.priceAtTxTime);
      movementLines.push(
        formatCsvLine([
          tx.id,
          'out',
          movement.assetId,
          movement.assetSymbol,
          movement.grossAmount.toFixed(),
          movement.netAmount?.toFixed(),
          ...priceFields,
        ])
      );
    }

    for (const fee of tx.fees ?? []) {
      const priceFields = formatPriceFields(fee.priceAtTxTime);
      feeLines.push(
        formatCsvLine([
          tx.id,
          fee.assetId,
          fee.assetSymbol,
          fee.amount.toFixed(),
          fee.scope,
          fee.settlement,
          ...priceFields,
        ])
      );
    }
  }

  for (const link of links) {
    linkLines.push(
      formatCsvLine([
        link.id,
        link.sourceTransactionId,
        link.targetTransactionId,
        link.assetSymbol,
        link.sourceAmount.toFixed(),
        link.targetAmount.toFixed(),
        link.linkType,
        link.confidenceScore.toFixed(),
        link.status,
        link.reviewedBy ?? '',
        link.reviewedAt ? link.reviewedAt.toISOString() : '',
        link.createdAt.toISOString(),
        link.updatedAt.toISOString(),
        JSON.stringify(link.matchCriteria),
        link.metadata ? JSON.stringify(link.metadata) : '',
      ])
    );
  }

  return {
    transactionsCsv: transactionLines.join('\n'),
    movementsCsv: movementLines.join('\n'),
    feesCsv: feeLines.join('\n'),
    linksCsv: linkLines.join('\n'),
  };
}

function formatMovementAssets(movements: NonNullable<Transaction['movements']['inflows']>): string {
  if (movements.length === 0) return '';
  return movements.map((movement) => movement.assetSymbol).join(';');
}

function formatMovementAmounts(movements: NonNullable<Transaction['movements']['inflows']>): string {
  if (movements.length === 0) return '';
  return movements.map((movement) => movement.grossAmount.toFixed()).join(';');
}

function filterFeesByScope(fees: FeeMovementDraft[], scope: FeeMovementDraft['scope']): FeeMovementDraft[] {
  return fees.filter((fee) => fee.scope === scope);
}

function formatFeeAssets(fees: FeeMovementDraft[]): string {
  if (fees.length === 0) return '';
  return fees.map((fee) => fee.assetSymbol).join(';');
}

function formatFeeAmounts(fees: FeeMovementDraft[]): string {
  if (fees.length === 0) return '';
  return fees.map((fee) => fee.amount.toFixed()).join(';');
}

function formatPriceFields(priceAtTxTime: PriceAtTxTime | undefined): string[] {
  if (!priceAtTxTime) {
    return ['', '', '', '', '', '', '', ''];
  }

  return [
    priceAtTxTime.price.amount.toFixed(),
    priceAtTxTime.price.currency.toString(),
    priceAtTxTime.source,
    priceAtTxTime.fetchedAt.toISOString(),
    priceAtTxTime.granularity ?? '',
    priceAtTxTime.fxRateToUSD?.toFixed() ?? '',
    priceAtTxTime.fxSource ?? '',
    priceAtTxTime.fxTimestamp ? priceAtTxTime.fxTimestamp.toISOString() : '',
  ];
}

function formatCsvLine(values: unknown[]): string {
  // Escape values per RFC 4180: quote fields containing commas, quotes, or newlines
  // and escape internal quotes by doubling them
  const escapedValues = values.map((value) => {
    if (value === null || value === undefined) {
      return '';
    }

    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- acceptable here
    const stringValue = String(value);

    // If value contains comma, quote, or newline, it must be quoted
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      // Escape quotes by doubling them, then wrap in quotes
      return `"${stringValue.replaceAll('"', '""')}"`;
    }

    return stringValue;
  });

  return escapedValues.join(',');
}

/**
 * Convert transactions to JSON format.
 */
export function convertToJSON(transactions: Transaction[]): string {
  if (transactions.length === 0) return '[]';
  return JSON.stringify(transactions, undefined, 2);
}
