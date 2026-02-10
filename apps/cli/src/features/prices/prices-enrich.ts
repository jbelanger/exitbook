import path from 'node:path';

/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price propagation - Use newly fetched/normalized prices for ratio calculations
 */
import { TransactionLinkRepository } from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { displayCliError } from '../shared/cli-error.js';
import { getDataDir } from '../shared/data-dir.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputError, outputSuccess } from '../shared/json-output.js';
import { PricesEnrichCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { PricesEnrichMonitor } from './components/prices-enrich-components.js';
import type { PriceEvent } from './events.js';
import { PricesEnrichHandler } from './prices-enrich-handler.js';
import type { PricesEnrichOptions } from './prices-enrich-handler.js';

const logger = getLogger('prices-enrich');

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesEnrichCommandOptionsSchema>;

/**
 * Register the prices enrich subcommand
 */
export function registerPricesEnrichCommand(pricesCommand: Command): void {
  pricesCommand
    .command('enrich')
    .description('Enrich prices via derive → fetch → normalize pipeline')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--on-missing <behavior>', 'How to handle missing prices: fail (abort on first error)')
    .option('--normalize-only', 'Only run FX rates stage')
    .option('--derive-only', 'Only run trade prices stage')
    .option('--fetch-only', 'Only run market prices stage')
    .option('--json', 'Output results in JSON format')
    .action(executePricesEnrichCommand);
}

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executePricesEnrichCommand(rawOptions: unknown): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const parseResult = PricesEnrichCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'prices-enrich',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    const params: PricesEnrichOptions = {
      asset: options.asset,
      onMissing: options.onMissing,
      normalizeOnly: options.normalizeOnly,
      deriveOnly: options.deriveOnly,
      fetchOnly: options.fetchOnly,
    };

    configureLogger({
      mode: options.json ? 'json' : 'text',
      verbose: false,
      sinks: {
        ui: false,
        structured: options.json ? 'off' : 'file',
      },
    });

    const dataDir = getDataDir();
    const database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
    const transactionRepo = new TransactionRepository(database);
    const linkRepo = new TransactionLinkRepository(database);

    if (options.json) {
      // JSON mode: run handler directly without Ink UI
      const handler = new PricesEnrichHandler(transactionRepo, linkRepo);

      try {
        const result = await handler.execute(params);
        await closeDatabase(database);
        resetLoggerContext();

        if (result.isErr()) {
          outputError('prices-enrich', result.error, ExitCodes.GENERAL_ERROR);
        }

        outputSuccess('prices-enrich', {
          derive: result.value.derive,
          fetch: result.value.fetch,
          normalize: result.value.normalize,
          propagation: result.value.propagation,
          runStats: result.value.runStats,
        });
      } catch (error) {
        await closeDatabase(database);
        resetLoggerContext();
        outputError(
          'prices-enrich',
          error instanceof Error ? error : new Error(String(error)),
          ExitCodes.GENERAL_ERROR
        );
      }
      return;
    }

    // Ink TUI mode
    const eventBus = new EventBus<PriceEvent>({
      onError: (err) => {
        logger.error({ err }, 'EventBus error');
      },
    });
    const instrumentation = new InstrumentationCollector();
    const controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

    const handler = new PricesEnrichHandler(transactionRepo, linkRepo, eventBus, instrumentation);

    // Handle Ctrl-C gracefully
    const abortHandler = () => {
      process.off('SIGINT', abortHandler);
      controller.abort();
      controller.stop().catch(() => {
        /* ignore cleanup errors on abort */
      });
      handler.destroy().catch(() => {
        /* ignore cleanup errors on abort */
      });
      closeDatabase(database).catch((_err) => {
        /* ignore cleanup errors on abort */
      });
      resetLoggerContext();
      process.exit(130);
    };
    process.on('SIGINT', abortHandler);

    controller.start();

    let exitCode = 0;

    try {
      const result = await handler.execute(params);

      if (result.isErr()) {
        controller.fail(result.error.message);
        await controller.stop();
        exitCode = ExitCodes.GENERAL_ERROR;
      } else {
        controller.complete();
        await controller.stop();
        // Success path exits naturally after event loop drains.
      }
    } catch (error) {
      controller.fail(error instanceof Error ? error.message : String(error));
      await controller.stop();
      exitCode = ExitCodes.GENERAL_ERROR;
    } finally {
      // Remove signal handler
      process.off('SIGINT', abortHandler);

      // Cleanup always runs exactly once (success, error, or early return)
      await handler.destroy();
      await closeDatabase(database);
      resetLoggerContext();

      // Only exit explicitly on error; undici cleanup allows natural exit on success
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    }
  } catch (error) {
    displayCliError(
      'prices-enrich',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}
