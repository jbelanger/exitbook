// Prices set-fx command - manually set FX rate
// Allows bulk preparation of manual FX rates without interrupting enrichment

import path from 'node:path';

import { OverrideStore } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { getDataDir } from '../shared/data-dir.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { PricesSetFxCommandOptionsSchema } from '../shared/schemas.js';

import { PricesSetFxHandler } from './prices-set-fx-handler.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesSetFxCommandOptionsSchema>;

/**
 * Register prices set-fx command
 */
export function registerPricesSetFxCommand(pricesCommand: Command): void {
  pricesCommand
    .command('set-fx')
    .description('Manually set FX rate between two currencies')
    .requiredOption('--from <currency>', 'Source currency (e.g., EUR, CAD)')
    .requiredOption('--to <currency>', 'Target currency (e.g., USD)')
    .requiredOption('--date <datetime>', 'Date/time (ISO 8601 format, e.g., 2024-01-15T10:30:00Z)')
    .requiredOption('--rate <value>', 'FX rate value (e.g., 1.08 for EUR→USD)')
    .option('--source <name>', 'Source attribution', 'user-provided')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executePricesSetFxCommand(rawOptions);
    });
}

/**
 * Execute the prices set-fx command.
 */
async function executePricesSetFxCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = PricesSetFxCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    output.error(
      'prices-set-fx',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Configure logger for JSON mode
    if (options.json) {
      configureLogger({
        mode: 'json',
        verbose: false,
        sinks: { ui: false, structured: 'file' },
      });
    }

    const dataDir = getDataDir();
    const overrideStore = new OverrideStore(dataDir);
    const handler = new PricesSetFxHandler(path.join(dataDir, 'prices.db'), overrideStore);
    const result = await handler.execute({
      from: options.from,
      to: options.to,
      date: options.date,
      rate: options.rate,
      source: options.source,
    });

    resetLoggerContext();

    if (result.isErr()) {
      output.error('prices-set-fx', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    output.json('prices-set-fx', result.value);
  } catch (error) {
    resetLoggerContext();
    output.error('prices-set-fx', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}
