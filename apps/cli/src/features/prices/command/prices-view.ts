// Command registration for view prices subcommand
import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand, withCommandPriceProviderRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
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
import { PricesViewHandler, type MissingPricesResult } from './prices-view-handler.js';

type ViewPricesCommandParams = ViewPricesParams;
type PricesViewTextMode = 'coverage' | 'missing';
type PricesViewTuiState =
  | {
      initialState: ReturnType<typeof createCoverageViewState>;
      onLoadMissing: (asset: string) => Promise<MissingPricesResult>;
    }
  | {
      initialState: ReturnType<typeof createMissingViewState>;
    };

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
  $ exitbook prices view --platform kraken  # View coverage for Kraken transactions

Common Usage:
  - Identify which assets need price data before generating tax reports
  - Check price coverage percentage per asset
  - Find gaps in historical pricing data
`
    )
    .option('--platform <name>', 'Filter by exchange or blockchain platform')
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

  const params: ViewPricesCommandParams = {
    platform: options.platform,
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

async function executeCoverageViewTUI(params: ViewPricesCommandParams): Promise<void> {
  await withCliCommandErrorHandling('prices-view', 'text', async () => {
    await executePricesViewTUI(params, 'coverage');
  });
}

async function executeMissingViewTUI(params: ViewPricesCommandParams): Promise<void> {
  await withCliCommandErrorHandling('prices-view', 'text', async () => {
    await executePricesViewTUI(params, 'missing');
  });
}

async function executePricesViewTUI(params: ViewPricesCommandParams, mode: PricesViewTextMode): Promise<void> {
  await runCommand(async (ctx) => {
    const database = await ctx.database();
    const profileResult = await resolveCommandProfile(ctx, database);
    if (profileResult.isErr()) {
      console.error('\n⚠ Error:', profileResult.error.message);
      ctx.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    const handler = new PricesViewHandler(database, profileResult.value.id);
    const initialStateResult =
      mode === 'coverage' ? await loadCoverageViewState(handler, params) : await loadMissingViewState(handler, params);
    if (initialStateResult.isErr()) {
      console.error('\n⚠ Error:', initialStateResult.error.message);
      ctx.exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    try {
      await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
        const overrideStore = new OverrideStore(ctx.dataDir);
        const pricesSetHandler = new PricesSetHandler(priceRuntime, overrideStore);
        const handleSetPrice = async (asset: string, date: string, price: string): Promise<void> => {
          const result = await pricesSetHandler.execute({
            asset,
            date,
            price,
            source: 'manual-tui',
            profileKey: profileResult.value.profileKey,
          });
          if (result.isErr()) {
            throw result.error;
          }
        };

        await renderApp((unmount) =>
          React.createElement(PricesViewApp, {
            ...initialStateResult.value,
            onSetPrice: handleSetPrice,
            onQuit: unmount,
          })
        );
      });
    } catch (error) {
      console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
      ctx.exitCode = ExitCodes.GENERAL_ERROR;
    }
  });
}

async function loadCoverageViewState(
  handler: PricesViewHandler,
  params: ViewPricesCommandParams
): Promise<Result<PricesViewTuiState, Error>> {
  const detailResult = await handler.executeCoverageDetail(params);
  if (detailResult.isErr()) {
    return err(detailResult.error);
  }

  const summaryResult = await handler.execute(params);
  if (summaryResult.isErr()) {
    return err(summaryResult.error);
  }

  return ok({
    initialState: createCoverageViewState(
      detailResult.value,
      summaryResult.value.summary,
      params.asset,
      params.platform
    ),
    onLoadMissing: async (asset: string) => {
      const result = await handler.executeMissing({ ...params, asset });
      if (result.isErr()) {
        throw result.error;
      }

      return result.value;
    },
  });
}

async function loadMissingViewState(
  handler: PricesViewHandler,
  params: ViewPricesCommandParams
): Promise<Result<PricesViewTuiState, Error>> {
  const missingResult = await handler.executeMissing(params);
  if (missingResult.isErr()) {
    return err(missingResult.error);
  }

  const { movements, assetBreakdown } = missingResult.value;
  return ok({
    initialState: createMissingViewState(movements, assetBreakdown, params.asset, params.platform),
  });
}

/**
 * Execute view prices in JSON mode
 */
async function executeViewPricesJSON(params: ViewPricesCommandParams): Promise<void> {
  await withCliCommandErrorHandling('view-prices', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('view-prices', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const handler = new PricesViewHandler(database, profileResult.value.id);

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
            platform: params.platform,
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
async function executeMissingViewJSON(params: ViewPricesCommandParams): Promise<void> {
  await withCliCommandErrorHandling('view-prices', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('view-prices', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const handler = new PricesViewHandler(database, profileResult.value.id);

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
            platform: params.platform,
            missingOnly: true,
          })
        ),
      };

      outputSuccess('view-prices', resultData);
    });
  });
}
