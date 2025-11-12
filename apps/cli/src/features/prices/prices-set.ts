// Prices set command - manually set price for an asset
// Allows bulk preparation of manual prices without interrupting enrichment

import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import { PricesSetHandler } from './prices-set-handler.js';

interface PricesSetCommandOptions {
  asset: string;
  currency: string;
  date: string;
  json?: boolean | undefined;
  price: string;
  source: string;
}

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
    .action(async (options: PricesSetCommandOptions) => {
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
    });
}
