// Command registration for view prices subcommand
import path from 'node:path';

import { createTransactionQueries, OverrideStore } from '@exitbook/data';
import { ManualPriceService } from '@exitbook/price-providers';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { PricesViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { PricesViewApp, createCoverageViewState, createMissingViewState } from './components/index.js';
import { PricesSetHandler } from './prices-set-handler.js';
import { ViewPricesHandler } from './prices-view-handler.js';
import type {
  AssetBreakdownEntry,
  PriceCoverageInfo,
  ViewPricesParams,
  ViewPricesResult,
} from './prices-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesViewCommandOptionsSchema>;

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
  // Validate options at CLI boundary
  const parseResult = PricesViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'prices-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;
  const isMissingMode = options.missingOnly ?? false;

  const params: ViewPricesParams = {
    source: options.source,
    asset: options.asset,
    missingOnly: options.missingOnly,
  };

  // JSON mode uses structured output functions
  if (isJsonMode) {
    if (isMissingMode) {
      await executeMissingViewJSON(params);
    } else {
      await executeViewPricesJSON(params);
    }

    return;
  }

  // TUI mode
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
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const handler = new ViewPricesHandler(txRepo);

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

      // Drill-down callback: load missing prices for a specific asset
      const handleLoadMissing = async (asset: string) => {
        const result = await handler.executeMissing({ ...params, asset });
        if (result.isErr()) throw result.error;
        return result.value;
      };

      // Set-price callback (used after drilling into missing mode)
      const overrideStore = new OverrideStore(ctx.dataDir);
      const pricesSetHandler = new PricesSetHandler(
        new ManualPriceService(path.join(ctx.dataDir, 'prices.db')),
        overrideStore
      );

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
    });
  } catch (error) {
    displayCliError(
      'prices-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute missing view in TUI mode (keeps DB open for set-price writes)
 */
async function executeMissingViewTUI(params: ViewPricesParams): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new ViewPricesHandler(txRepo);

      const missingResult = await handler.executeMissing(params);
      if (missingResult.isErr()) {
        console.error('\n⚠ Error:', missingResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const { movements, assetBreakdown } = missingResult.value;

      const initialState = createMissingViewState(movements, assetBreakdown, params.asset, params.source);

      const pricesSetHandler = new PricesSetHandler(
        new ManualPriceService(path.join(ctx.dataDir, 'prices.db')),
        overrideStore
      );

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
    });
  } catch (error) {
    displayCliError(
      'prices-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute view prices in JSON mode
 */
async function executeViewPricesJSON(params: ViewPricesParams): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const handler = new ViewPricesHandler(txRepo);

      const result = await handler.execute(params);

      if (result.isErr()) {
        displayCliError('view-prices', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const { coverage, summary } = result.value;

      const filters: Record<string, unknown> = {};
      if (params.asset) filters['asset'] = params.asset;
      if (params.source) filters['source'] = params.source;
      if (params.missingOnly) filters['missingOnly'] = params.missingOnly;

      const resultData: ViewPricesCommandResult = {
        data: { coverage, summary },
        meta: buildViewMeta(coverage.length, 0, coverage.length, coverage.length, filters),
      };

      outputSuccess('view-prices', resultData);
    });
  } catch (error) {
    displayCliError(
      'view-prices',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
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
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const handler = new ViewPricesHandler(txRepo);

      const result = await handler.executeMissing(params);

      if (result.isErr()) {
        displayCliError('view-prices', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const { movements, assetBreakdown } = result.value;

      const filters: Record<string, unknown> = {};
      if (params.asset) filters['asset'] = params.asset;
      if (params.source) filters['source'] = params.source;
      filters['missingOnly'] = true;

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
        meta: buildViewMeta(movements.length, 0, movements.length, movements.length, filters),
      };

      outputSuccess('view-prices', resultData);
    });
  } catch (error) {
    displayCliError(
      'view-prices',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}
