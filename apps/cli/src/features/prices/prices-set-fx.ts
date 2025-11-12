// Prices set-fx command - manually set FX rate
// Allows bulk preparation of manual FX rates without interrupting enrichment

import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import { PricesSetFxHandler } from './prices-set-fx-handler.js';

interface PricesSetFxCommandOptions {
  date: string;
  from: string;
  json?: boolean | undefined;
  rate: string;
  source: string;
  to: string;
}

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: PricesSetFxCommandOptions) => {
      const output = new OutputManager(options.json ? 'json' : 'text');

      try {
        const handler = new PricesSetFxHandler();
        const result = await handler.execute({
          from: options.from,
          to: options.to,
          date: options.date,
          rate: options.rate,
          source: options.source,
        });
        handler.destroy();

        if (result.isErr()) {
          output.error('prices-set-fx', result.error, ExitCodes.GENERAL_ERROR);
          return;
        }

        output.success('prices-set-fx', result.value);
        process.exit(0);
      } catch (error) {
        output.error(
          'prices-set-fx',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR
        );
      }
    });
}
