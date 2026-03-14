// Prices set command - manually set price for an asset
// Allows bulk preparation of manual prices without interrupting enrichment

import path from 'node:path';

import { ManualPriceService } from '@exitbook/price-providers';
import type { Command } from 'commander';

import { displayCliError } from '../../shared/cli-error.js';
import { getDataDir } from '../../shared/data-dir.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { PricesSetCommandOptionsSchema } from '../../shared/schemas.js';

import { PricesSetHandler } from './prices-set-handler.js';

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
    displayCliError(
      'prices-set',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJsonMode ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    const { OverrideStore, buildCostBasisArtifactInvalidationPorts, DataContext } = await import('@exitbook/data');
    const dataDir = getDataDir();
    const overrideStore = new OverrideStore(dataDir);
    const service = new ManualPriceService(path.join(dataDir, 'prices.db'));
    const db = await DataContext.initialize(path.join(dataDir, 'transactions.db'));
    if (db.isErr()) {
      throw db.error;
    }

    try {
      const handler = new PricesSetHandler(service, overrideStore, buildCostBasisArtifactInvalidationPorts(db.value));
      const result = await handler.execute({
        asset: options.asset,
        date: options.date,
        price: options.price,
        currency: options.currency,
        source: options.source,
      });

      if (result.isErr()) {
        displayCliError('prices-set', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      if (options.json) {
        outputSuccess('prices-set', result.value);
      } else {
        console.log('✅ Price set successfully');
        console.log(`   Asset: ${result.value.asset}`);
        console.log(`   Date: ${result.value.timestamp.toISOString()}`);
        console.log(`   Price: ${result.value.price} ${result.value.currency}`);
        console.log(`   Source: ${result.value.source}`);
      }
    } finally {
      await db.value.close();
    }
  } catch (error) {
    displayCliError(
      'prices-set',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}
