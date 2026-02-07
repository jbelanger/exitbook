// Prices set command - manually set price for an asset
// Allows bulk preparation of manual prices without interrupting enrichment

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { PricesSetCommandOptionsSchema } from '../shared/schemas.js';

import { PricesSetHandler } from './prices-set-handler.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesSetCommandOptionsSchema>;

/**
 * Register prices set command
 */
export function registerPricesSetCommand(pricesCommand: Command): void {
  pricesCommand
    .command('set')
    .description('Manually set price for an asset at a specific time')
    .requiredOption('--asset <symbol>', 'Asset symbol (e.g., BTC, ETH)')
    .requiredOption('--date <datetime>', 'Date/time (ISO 8601 format, e.g., 2024-01-15T10:30:00Z)')
    .requiredOption('--price <amount>', 'Price value (e.g., 45000.50)')
    .option('--currency <code>', 'Price currency', 'USD')
    .option('--source <name>', 'Source attribution', 'manual-cli')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executePricesSetCommand(rawOptions);
    });
}

/**
 * Execute the prices set command.
 */
async function executePricesSetCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = PricesSetCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    output.error(
      'prices-set',
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

    const { OverrideStore } = await import('@exitbook/data');
    const overrideStore = new OverrideStore();
    const handler = new PricesSetHandler(overrideStore);
    const result = await handler.execute({
      asset: options.asset,
      date: options.date,
      price: options.price,
      currency: options.currency,
      source: options.source,
    });

    resetLoggerContext();

    if (result.isErr()) {
      output.error('prices-set', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    output.json('prices-set', result.value);
  } catch (error) {
    resetLoggerContext();
    output.error('prices-set', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}
