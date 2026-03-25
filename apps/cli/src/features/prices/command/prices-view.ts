// Command registration for view prices subcommand
import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { withCliPriceProviderRuntime } from '../../shared/cli-price-provider-runtime.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import type {
  AssetBreakdownEntry,
  PriceCoverageInfo,
  ViewPricesParams,
  ViewPricesResult,
} from '../prices-view-model.js';
import { PricesViewApp, createCoverageViewState, createMissingViewState } from '../view/index.js';

import { PricesViewCommandOptionsSchema } from './prices-option-schemas.js';
import { PricesSetHandler } from './prices-set-handler.js';
import { PricesViewHandler } from './prices-view-handler.js';

/**
 * Result data for view prices command (JSON mode).
 */
type ViewPricesCommandResult = ViewCommandResult<{
  coverage: PriceCoverageInfo[];
  summary: ViewPricesResult['summary'];
}>;

/**
 * Register the prices view subcommand.
 */
export function registerPricesViewCommand(pricesCommand: Command): void {
  pricesCommand
    .command('view')
    .description('View price coverage statistics')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices view                    # View price coverage for all assets
  $ exitbook prices view --asset BTC        # View price coverage for Bitcoin only
  $ exitbook prices view --missing-only     # Show only assets missing price data
  $ exitbook prices view --source kraken    # View coverage for Kraken transactions

Common Usage:
  - Identify which assets need price data before generating tax reports
  - Check price coverage percentage per asset
  - Find gaps in historical pricing data
`
    )
    .option('--source <name>', 'Filter by exchange or blockchain name')
    .option('--asset <currency>', 'Filter by specific asset (e.g., BTC, ETH)')
    .option('--missing-only', 'Show only assets with missing price data')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeViewPricesCommand(rawOptions);
    });
}

/**
 * Execute the view prices command.
 */
async function executeViewPricesCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('prices-view', rawOptions, PricesViewCommandOptionsSchema);
  const isMissingMode = options.missingOnly ?? false;

  const params: ViewPricesParams = {
    source: options.source,
    asset: options.asset,
    missingOnly: options.missingOnly,
  };

  if (format === 'json') {
    if (isMissingMode) {
      await executeMissingViewJSON(params);
    } else {
      await executeViewPricesJSON(params);
    }

    return;
  }

  if (isMissingMode) {
    await executeMissingViewTUI(params);
  } else {
    await executeCoverageViewTUI(params);
  }
}

/**
 * Execute coverage view in TUI mode (keeps DB open for drill-down into missing mode)
 */
async function executeCoverageViewTUI(params: ViewPricesParams): Promise<void> {
  await withCliCommandErrorHandling('prices-view', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = new PricesViewHandler(database);

      const detailResult = await handler.executeCoverageDetail(params);
      if (detailResult.isErr()) {
        console.error('\n⚠ Error:', detailResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const summaryResult = await handler.execute(params);
      if (summaryResult.isErr()) {
        console.error('\n⚠ Error:', summaryResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const initialState = createCoverageViewState(
        detailResult.value,
        summaryResult.value.summary,
        params.asset,
        params.source
      );

      const handleLoadMissing = async (asset: string) => {
        const result = await handler.executeMissing({ ...params, asset });
        if (result.isErr()) throw result.error;
        return result.value;
      };

      const priceRuntimeUseResult = await withCliPriceProviderRuntime(
        { dataDir: ctx.dataDir },
        async (priceRuntime) => {
          const overrideStore = new OverrideStore(ctx.dataDir);
          const pricesSetHandler = new PricesSetHandler(priceRuntime, overrideStore);

          const handleSetPrice = async (asset: string, date: string, price: string): Promise<void> => {
            const result = await pricesSetHandler.execute({ asset, date, price, source: 'manual-tui' });
            if (result.isErr()) throw result.error;
          };

          await renderApp((unmount) =>
            React.createElement(PricesViewApp, {
              initialState,
              onLoadMissing: handleLoadMissing,
              onSetPrice: handleSetPrice,
              onQuit: unmount,
            })
          );
        }
      );
      if (priceRuntimeUseResult.isErr()) {
        console.error('\n⚠ Error:', priceRuntimeUseResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
      }
    });
  });
}

/**
 * Execute missing view in TUI mode (keeps DB open for set-price writes)
 */
async function executeMissingViewTUI(params: ViewPricesParams): Promise<void> {
  await withCliCommandErrorHandling('prices-view', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new PricesViewHandler(database);

      const missingResult = await handler.executeMissing(params);
      if (missingResult.isErr()) {
        console.error('\n⚠ Error:', missingResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const { movements, assetBreakdown } = missingResult.value;

      const initialState = createMissingViewState(movements, assetBreakdown, params.asset, params.source);

      const priceRuntimeUseResult = await withCliPriceProviderRuntime(
        { dataDir: ctx.dataDir },
        async (priceRuntime) => {
          const pricesSetHandler = new PricesSetHandler(priceRuntime, overrideStore);

          const handleSetPrice = async (asset: string, date: string, price: string): Promise<void> => {
            const result = await pricesSetHandler.execute({ asset, date, price, source: 'manual-tui' });
            if (result.isErr()) {
              throw result.error;
            }
          };

          await renderApp((unmount) =>
            React.createElement(PricesViewApp, {
              initialState,
              onSetPrice: handleSetPrice,
              onQuit: unmount,
            })
          );
        }
      );
      if (priceRuntimeUseResult.isErr()) {
        console.error('\n⚠ Error:', priceRuntimeUseResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
      }
    });
  });
}

/**
 * Execute view prices in JSON mode
 */
async function executeViewPricesJSON(params: ViewPricesParams): Promise<void> {
  await withCliCommandErrorHandling('view-prices', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = new PricesViewHandler(database);

      const result = await handler.execute(params);

      if (result.isErr()) {
        displayCliError('view-prices', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const { coverage, summary } = result.value;

      const resultData: ViewPricesCommandResult = {
        data: { coverage, summary },
        meta: buildViewMeta(
          coverage.length,
          0,
          coverage.length,
          coverage.length,
          buildDefinedFilters({
            asset: params.asset,
            source: params.source,
            missingOnly: params.missingOnly ? true : undefined,
          })
        ),
      };

      outputSuccess('view-prices', resultData);
    });
  });
}

/**
 * Result data for missing prices JSON mode.
 */
type MissingPricesCommandResult = ViewCommandResult<{
  assetBreakdown: AssetBreakdownEntry[];
  movements: {
    amount: string;
    assetSymbol: string;
    datetime: string;
    direction: string;
    source: string;
    transactionId: number;
  }[];
}>;

/**
 * Execute missing prices in JSON mode
 */
async function executeMissingViewJSON(params: ViewPricesParams): Promise<void> {
  await withCliCommandErrorHandling('view-prices', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = new PricesViewHandler(database);

      const result = await handler.executeMissing(params);

      if (result.isErr()) {
        displayCliError('view-prices', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const { movements, assetBreakdown } = result.value;

      const jsonMovements = movements.map((m) => ({
        transactionId: m.transactionId,
        source: m.source,
        datetime: m.datetime,
        assetSymbol: m.assetSymbol,
        direction: m.direction,
        amount: m.amount,
      }));

      const resultData: MissingPricesCommandResult = {
        data: { movements: jsonMovements, assetBreakdown },
        meta: buildViewMeta(
          movements.length,
          0,
          movements.length,
          movements.length,
          buildDefinedFilters({
            asset: params.asset,
            source: params.source,
            missingOnly: true,
          })
        ),
      };

      outputSuccess('view-prices', resultData);
    });
  });
}
