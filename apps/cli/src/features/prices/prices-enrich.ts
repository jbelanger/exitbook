/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price propagation - Use newly fetched/normalized prices for ratio calculations
 */
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
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

    await runCommand(async (ctx) => {
      const database = await ctx.database();

      if (options.json) {
        // JSON mode: run handler directly without Ink UI
        const handler = new PricesEnrichHandler(database);
        ctx.onCleanup(async () => handler.destroy());

        const result = await handler.execute(params);

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

      const handler = new PricesEnrichHandler(database, eventBus, instrumentation);

      ctx.onCleanup(async () => {
        await handler.destroy();
      });

      ctx.onAbort(() => {
        controller.abort();
        void controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop controller on abort');
        });
      });

      controller.start();

      const result = await handler.execute(params);

      if (result.isErr()) {
        controller.fail(result.error.message);
        await controller.stop();
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
      } else {
        controller.complete();
        await controller.stop();
      }
    });
  } catch (error) {
    displayCliError(
      'prices-enrich',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}
