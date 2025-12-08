// Prices set command - manually set price for an asset
// Allows bulk preparation of manual prices without interrupting enrichment

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (rawOptions: unknown) => {
      await executePricesSetCommand(rawOptions);
    });
}

/**
 * Execute the prices set command.
 */
async function executePricesSetCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = PricesSetCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'prices-set',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const handler = new PricesSetHandler();
    const result = await handler.execute({
      asset: options.asset,
      date: options.date,
      price: options.price,
      currency: options.currency,
      source: options.source,
    });
    handler.destroy();

    if (result.isErr()) {
      output.error('prices-set', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    output.success('prices-set', result.value);
    process.exit(0);
  } catch (error) {
    output.error('prices-set', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}
