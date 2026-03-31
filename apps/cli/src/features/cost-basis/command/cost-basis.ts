import {
  getDefaultCostBasisMethodForJurisdiction,
  type CostBasisJurisdiction,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting/cost-basis';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import {
  cliErr,
  jsonSuccess,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../shared/cli-contract.js';
import { detectCliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import { CostBasisApp } from '../view/cost-basis-view-components.jsx';
import { createCostBasisAssetState, createCostBasisTimelineState } from '../view/cost-basis-view-state.js';
import { buildPresentationModel } from '../view/cost-basis-view-utils.js';

import { withCostBasisCommandScope } from './cost-basis-command-scope.js';
import { registerCostBasisExportCommand } from './cost-basis-export.js';
import type { ValidatedCostBasisConfig } from './cost-basis-handler.js';
import { buildCostBasisJsonData } from './cost-basis-json.js';
import { CostBasisCommandOptionsSchema } from './cost-basis-option-schemas.js';
import { promptForCostBasisParams } from './cost-basis-prompts.jsx';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';
import { runCostBasis } from './run-cost-basis.js';

const logger = getLogger('cost-basis');

type CommandOptions = z.infer<typeof CostBasisCommandOptionsSchema>;

export function registerCostBasisCommand(program: Command, appRuntime: CliAppRuntime): void {
  const costBasisCommand = program
    .command('cost-basis')
    .description('Calculate cost basis and capital gains/losses for tax reporting')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook cost-basis --jurisdiction CA --tax-year 2024
  $ exitbook cost-basis --jurisdiction US --tax-year 2024 --method fifo --fiat-currency USD
  $ exitbook cost-basis --jurisdiction CA --tax-year 2024 --asset BTC
  $ exitbook cost-basis export --format tax-package --jurisdiction CA --tax-year 2024

Notes:
  - In text mode, missing required tax parameters are collected interactively.
  - Use "cost-basis export" to write a filing package after calculation.
`
    )
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost (CA defaults to ACB)')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US, UK, EU')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--fiat-currency <currency>', 'Fiat currency for cost basis: USD, CAD, EUR, GBP (defaults by jurisdiction)')
    .option('--asset <symbol>', 'Filter to specific asset (lands on asset history timeline)')
    .option('--refresh', 'Force recomputation and replace the latest stored snapshot for this scope')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeCostBasisCommand(rawOptions, appRuntime));

  registerCostBasisExportCommand(costBasisCommand, appRuntime);
}

async function executeCostBasisCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'cost-basis',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, CostBasisCommandOptionsSchema);

        if (format === 'json') {
          const params = yield* toCliResult(buildCostBasisInputFromFlags(options), ExitCodes.INVALID_ARGS);
          return yield* await executeCostBasisJsonCommand(options, params, appRuntime);
        }

        const params = yield* await resolveCostBasisTextParams(options);
        if (params === undefined) {
          return {
            exitCode: ExitCodes.SUCCESS,
            output: {
              kind: 'text',
              render: () => console.log('\nCost basis calculation cancelled'),
            },
          };
        }

        return yield* await executeCostBasisTextCommand(options, params, appRuntime);
      }),
  });
}

async function executeCostBasisJsonCommand(
  options: CommandOptions,
  params: ValidatedCostBasisConfig,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'cost-basis',
    appRuntime,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withCostBasisCommandScope(ctx, { format: 'json', params }, (scope) =>
            runCostBasis(scope, params, { refresh: options.refresh })
          ),
          ExitCodes.GENERAL_ERROR
        );

        return jsonSuccess(buildCostBasisJsonData(buildPresentationModel(result)));
      }),
  });
}

async function executeCostBasisTextCommand(
  options: CommandOptions,
  params: ValidatedCostBasisConfig,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'cost-basis',
    appRuntime,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await loadCostBasisTextResult(ctx, params, options.refresh),
          ExitCodes.GENERAL_ERROR
        );

        return yield* toCliResult(await buildCostBasisTuiCompletion(ctx, options, result), ExitCodes.GENERAL_ERROR);
      }),
  });
}

async function loadCostBasisTextResult(
  ctx: CommandRuntime,
  params: ValidatedCostBasisConfig,
  refresh: boolean | undefined
): Promise<Result<CostBasisWorkflowResult, Error>> {
  const spinner = createSpinner('Calculating cost basis...', false);
  try {
    return await withCostBasisCommandScope(ctx, { format: 'text', params }, (scope) =>
      runCostBasis(scope, params, { refresh })
    );
  } finally {
    stopSpinner(spinner);
  }
}

async function buildCostBasisTuiCompletion(
  ctx: CommandRuntime,
  options: CommandOptions,
  result: CostBasisWorkflowResult
): Promise<Result<ReturnType<typeof silentSuccess>, Error>> {
  try {
    const presentation = buildPresentationModel(result);
    const initialState = createCostBasisAssetState(
      presentation.context,
      presentation.assetItems,
      presentation.summary,
      {
        totalDisposals: presentation.summary.disposalsProcessed,
        totalLots: presentation.summary.lotsCreated,
      }
    );

    const finalState = resolveAssetFilter(initialState, options.asset);

    await ctx.closeDatabase();
    await renderApp((unmount) =>
      React.createElement(CostBasisApp, {
        initialState: finalState,
        onQuit: unmount,
      })
    );

    return ok(silentSuccess());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function resolveCostBasisTextParams(
  options: CommandOptions
): Promise<Result<ValidatedCostBasisConfig | undefined, CliFailure>> {
  const defaultMethodResult = options.jurisdiction
    ? getDefaultCostBasisMethodForJurisdiction(options.jurisdiction as CostBasisJurisdiction)
    : undefined;
  const defaultMethodForJurisdiction = defaultMethodResult?.isOk() ? defaultMethodResult.value : undefined;
  const needsPrompt = !options.jurisdiction || !options.taxYear || (!options.method && !defaultMethodForJurisdiction);

  if (!needsPrompt) {
    return toCliResult(buildCostBasisInputFromFlags(options), ExitCodes.INVALID_ARGS);
  }

  try {
    const promptResult = await promptForCostBasisParams(options);
    return ok(promptResult ?? undefined);
  } catch (error) {
    return cliErr(error, ExitCodes.INVALID_ARGS);
  }
}

function resolveAssetFilter(
  state: ReturnType<typeof createCostBasisAssetState>,
  assetFilter?: string
): ReturnType<typeof createCostBasisAssetState> | ReturnType<typeof createCostBasisTimelineState> {
  if (!assetFilter) return state;

  const upperFilter = assetFilter.toUpperCase();
  const assetIndex = state.assets.findIndex((asset) => asset.asset.toUpperCase() === upperFilter);
  if (assetIndex < 0) {
    logger.warn({ asset: assetFilter }, 'Asset filter did not match any assets in the calculation');
    return state;
  }

  const assetItem = state.assets[assetIndex]!;
  return createCostBasisTimelineState(assetItem, state, assetIndex);
}
