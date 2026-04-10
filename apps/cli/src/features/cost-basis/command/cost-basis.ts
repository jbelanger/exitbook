import { getDefaultCostBasisMethodForJurisdiction, type CostBasisJurisdiction } from '@exitbook/accounting/cost-basis';
import { ok, resultDoAsync, resultTry, resultTryAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  cliErr,
  completeCliRuntime,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import { buildCostBasisReadinessWarnings } from '../cost-basis-readiness.js';
import { CostBasisApp } from '../view/cost-basis-view-components.jsx';
import { createCostBasisAssetState, createCostBasisTimelineState } from '../view/cost-basis-view-state.js';
import { buildPresentationModel, type CostBasisPresentationModel } from '../view/cost-basis-view-utils.js';

import { withCostBasisCommandScope } from './cost-basis-command-scope.js';
import { registerCostBasisExportCommand } from './cost-basis-export.js';
import type { CostBasisArtifactExecutionResult, ValidatedCostBasisConfig } from './cost-basis-handler.js';
import { buildCostBasisJsonData } from './cost-basis-json.js';
import { CostBasisCommandOptionsSchema } from './cost-basis-option-schemas.js';
import { promptForCostBasisParams } from './cost-basis-prompts.jsx';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';
import { runCostBasisArtifact } from './run-cost-basis.js';

const logger = getLogger('cost-basis');

type CommandOptions = z.infer<typeof CostBasisCommandOptionsSchema>;
interface PreparedCostBasisCommand {
  mode: 'json' | 'text';
  options: CommandOptions;
  params: ValidatedCostBasisConfig;
}

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

  await runCliRuntimeCommand({
    command: 'cost-basis',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, CostBasisCommandOptionsSchema);

        if (format === 'json') {
          const params = yield* toCliResult(buildCostBasisInputFromFlags(options), ExitCodes.INVALID_ARGS);
          return {
            mode: 'json',
            options,
            params,
          } satisfies PreparedCostBasisCommand;
        }

        const params = yield* await resolveCostBasisTextParams(options);
        if (params === undefined) {
          return completeCliRuntime(
            textSuccess(() => {
              console.log('\nCost basis calculation cancelled');
            })
          );
        }

        return {
          mode: 'text',
          options,
          params,
        } satisfies PreparedCostBasisCommand;
      }),
    action: async ({ runtime, prepared }) => {
      if (prepared.mode === 'json') {
        return executeCostBasisJsonCommand(runtime, prepared.options, prepared.params);
      }

      return executeCostBasisTextCommand(runtime, prepared.options, prepared.params);
    },
  });
}

async function executeCostBasisJsonCommand(
  ctx: CommandRuntime,
  options: CommandOptions,
  params: ValidatedCostBasisConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const result = yield* toCliResult(
      await withCostBasisCommandScope(ctx, { format: 'json', params }, (scope) =>
        runCostBasisArtifact(scope, params, { refresh: options.refresh })
      ),
      ExitCodes.GENERAL_ERROR
    );

    const presentation = yield* toCliResult(buildCostBasisPresentation(result), ExitCodes.GENERAL_ERROR);

    return jsonSuccess(buildCostBasisJsonData(presentation));
  });
}

async function executeCostBasisTextCommand(
  ctx: CommandRuntime,
  options: CommandOptions,
  params: ValidatedCostBasisConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const result = yield* toCliResult(
      await loadCostBasisTextResult(ctx, params, options.refresh),
      ExitCodes.GENERAL_ERROR
    );

    return yield* toCliResult(await buildCostBasisTuiCompletion(ctx, options, result), ExitCodes.GENERAL_ERROR);
  });
}

async function loadCostBasisTextResult(
  ctx: CommandRuntime,
  params: ValidatedCostBasisConfig,
  refresh: boolean | undefined
): Promise<Result<CostBasisArtifactExecutionResult, Error>> {
  const spinner = createSpinner('Calculating cost basis...', false);
  try {
    return await withCostBasisCommandScope(ctx, { format: 'text', params }, (scope) =>
      runCostBasisArtifact(scope, params, { refresh })
    );
  } finally {
    stopSpinner(spinner);
  }
}

async function buildCostBasisTuiCompletion(
  ctx: CommandRuntime,
  options: CommandOptions,
  result: CostBasisArtifactExecutionResult
): Promise<Result<ReturnType<typeof silentSuccess>, Error>> {
  return resultTryAsync(async function* () {
    const presentation = yield* buildCostBasisPresentation(result);
    const initialState = createCostBasisAssetState(
      presentation.context,
      presentation.assetItems,
      presentation.summary,
      {
        readinessWarnings: presentation.readinessWarnings,
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

    return silentSuccess();
  }, 'Failed to render cost basis view');
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

function buildCostBasisPresentation(
  result: CostBasisArtifactExecutionResult
): Result<CostBasisPresentationModel, Error> {
  return resultTry(function* () {
    const readinessWarnings = yield* buildCostBasisReadinessWarnings(result);
    return buildPresentationModel(result.artifact, { readinessWarnings });
  }, 'Failed to build cost basis presentation');
}
