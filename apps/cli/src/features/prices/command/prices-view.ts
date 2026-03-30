import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { type CommandRuntime, renderApp, withCommandPriceProviderRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import {
  createCliFailure,
  jsonSuccess,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
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

type PricesViewCommandOptions = z.infer<typeof PricesViewCommandOptionsSchema>;
type PricesViewTextMode = 'coverage' | 'missing';
type PricesViewTuiState =
  | {
      initialState: ReturnType<typeof createCoverageViewState>;
      onLoadMissing: (asset: string) => Promise<MissingPricesResult>;
    }
  | {
      initialState: ReturnType<typeof createMissingViewState>;
    };

type ViewPricesCommandResult = ViewCommandResult<{
  coverage: PriceCoverageInfo[];
  summary: ViewPricesResult['summary'];
}>;

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

async function executeViewPricesCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'prices-view',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, PricesViewCommandOptionsSchema);
        return yield* await executePricesViewCommandResult(buildViewPricesParams(options), format);
      }),
  });
}

async function executePricesViewCommandResult(
  params: ViewPricesParams,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'prices-view',
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const database = await ctx.database();
        const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
        const handler = new PricesViewHandler(database, profile.id);

        if (format === 'json') {
          return yield* await buildPricesViewJsonCompletion(handler, params);
        }

        return yield* await buildPricesViewTuiCompletion(ctx, handler, profile.profileKey, params);
      }),
  });
}

function buildViewPricesParams(options: PricesViewCommandOptions): ViewPricesParams {
  return {
    platform: options.platform,
    asset: options.asset,
    missingOnly: options.missingOnly,
  };
}

function buildPricesViewJsonCompletion(
  handler: PricesViewHandler,
  params: ViewPricesParams
): Promise<Result<CliCompletion, CliFailure>> {
  if (params.missingOnly) {
    return buildMissingPricesJsonCompletion(handler, params);
  }

  return buildCoveragePricesJsonCompletion(handler, params);
}

async function buildCoveragePricesJsonCompletion(
  handler: PricesViewHandler,
  params: ViewPricesParams
): Promise<Result<CliCompletion, CliFailure>> {
  const result = toCliResult(await handler.execute(params), ExitCodes.GENERAL_ERROR);
  if (result.isErr()) {
    return err(result.error);
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

  return ok(jsonSuccess(resultData));
}

async function buildMissingPricesJsonCompletion(
  handler: PricesViewHandler,
  params: ViewPricesParams
): Promise<Result<CliCompletion, CliFailure>> {
  const result = toCliResult(await handler.executeMissing(params), ExitCodes.GENERAL_ERROR);
  if (result.isErr()) {
    return err(result.error);
  }

  const { movements, assetBreakdown } = result.value;
  const resultData: MissingPricesCommandResult = {
    data: {
      movements: movements.map((movement) => ({
        transactionId: movement.transactionId,
        source: movement.source,
        datetime: movement.datetime,
        assetSymbol: movement.assetSymbol,
        direction: movement.direction,
        amount: movement.amount,
      })),
      assetBreakdown,
    },
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

  return ok(jsonSuccess(resultData));
}

async function buildPricesViewTuiCompletion(
  ctx: CommandRuntime,
  handler: PricesViewHandler,
  profileKey: string,
  params: ViewPricesParams
): Promise<Result<CliCompletion, CliFailure>> {
  const mode: PricesViewTextMode = params.missingOnly ? 'missing' : 'coverage';
  const initialStateResult =
    mode === 'coverage' ? await loadCoverageViewState(handler, params) : await loadMissingViewState(handler, params);

  const stateResult = toCliResult(initialStateResult, ExitCodes.GENERAL_ERROR);
  if (stateResult.isErr()) {
    return err(stateResult.error);
  }

  try {
    await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
      const overrideStore = new OverrideStore(ctx.dataDir);
      const pricesSetHandler = new PricesSetHandler(priceRuntime, overrideStore);

      await renderApp((unmount) =>
        React.createElement(PricesViewApp, {
          ...stateResult.value,
          onQuit: unmount,
          onSetPrice: async (asset: string, date: string, price: string) => {
            const result = await pricesSetHandler.execute({
              asset,
              date,
              price,
              source: 'manual-tui',
              profileKey,
            });

            if (result.isErr()) {
              throw result.error;
            }
          },
        })
      );
    });
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}

async function loadCoverageViewState(
  handler: PricesViewHandler,
  params: ViewPricesParams
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
  params: ViewPricesParams
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
