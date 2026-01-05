// Export prompt orchestration
// Separates interactive prompt flow from command logic

import * as p from '@clack/prompts';

import {
  isCancelled,
  handleCancellation,
  promptSourceType,
  promptExchange,
  promptBlockchain,
} from '../shared/prompts.js';

import type { ExportHandlerParams } from './export-utils.js';
import { CSV_FORMATS, EXPORT_FORMATS } from './export-utils.js';

/**
 * Interactive prompt flow for export parameters.
 * Orchestrates the full prompt sequence for export.
 */
export async function promptForExportParams(): Promise<ExportHandlerParams> {
  // Step 1: Ask if filtering by source
  const filterBySource = await p.confirm({
    message: 'Export from specific source?',
    initialValue: false,
  });

  if (isCancelled(filterBySource)) {
    handleCancellation();
  }

  let sourceName: string | undefined;
  if (filterBySource) {
    // Step 2: Source type
    const sourceType = await promptSourceType();

    // Step 3: Source name (exchange or blockchain)
    sourceName = sourceType === 'exchange' ? await promptExchange() : await promptBlockchain();
  }

  // Step 4: Export format
  const format = await p.select({
    message: 'Export format?',
    options: [
      { value: 'csv' as const, label: 'CSV', hint: 'Comma-separated values' },
      { value: 'json' as const, label: 'JSON', hint: 'Structured JSON format' },
    ],
    initialValue: 'csv' as const,
  });

  if (isCancelled(format)) {
    handleCancellation();
  }

  if (!EXPORT_FORMATS.includes(format)) {
    throw new Error(`Invalid format: ${format}`);
  }

  // Step 5: CSV format (only for CSV)
  let csvFormat: ExportHandlerParams['csvFormat'];
  if (format === 'csv') {
    const csvFormatSelection = await p.select({
      message: 'CSV format?',
      options: [
        { value: 'normalized' as const, label: 'Normalized', hint: '3 files: transactions, movements, fees' },
        { value: 'simple' as const, label: 'Simple', hint: 'Single file with multi-value cells' },
      ],
      initialValue: 'normalized' as const,
    });

    if (isCancelled(csvFormatSelection)) {
      handleCancellation();
    }

    if (!CSV_FORMATS.includes(csvFormatSelection)) {
      throw new Error(`Invalid CSV format: ${csvFormatSelection}`);
    }

    csvFormat = csvFormatSelection;
  }

  // Step 6: Date range
  const filterByDate = await p.confirm({
    message: 'Filter by date range?',
    initialValue: false,
  });

  if (isCancelled(filterByDate)) {
    handleCancellation();
  }

  let since: number | undefined;
  if (filterByDate) {
    const sinceDate = await p.text({
      message: 'Export transactions since (YYYY-MM-DD or 0 for all):',
      placeholder: '2023-01-01',
      validate: (value) => {
        if (!value) return 'Please enter a date or 0';
        if (value === '0') return; // Valid
        const timestamp = Date.parse(value);
        if (isNaN(timestamp)) return 'Invalid date format. Use YYYY-MM-DD or 0 for all history';
      },
    });

    if (isCancelled(sinceDate)) {
      handleCancellation();
    }

    since = sinceDate === '0' ? 0 : Date.parse(sinceDate);
  }

  // Step 7: Output path
  const defaultOutput = `data/transactions.${format}`;
  const outputPath = await p.text({
    message: 'Output file path:',
    placeholder: defaultOutput,
    defaultValue: defaultOutput,
    validate: (value) => {
      if (!value) return 'Please enter an output path';
    },
  });

  if (isCancelled(outputPath)) {
    handleCancellation();
  }

  return {
    sourceName,
    format,
    csvFormat,
    outputPath,
    since,
  };
}
