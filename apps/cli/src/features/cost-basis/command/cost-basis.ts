import { getDefaultCostBasisMethodForJurisdiction, type CostBasisJurisdiction } from '@exitbook/accounting';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { composeCostBasisHandler } from '../../../composition/accounting.js';
import type { CliAppRuntime } from '../../../composition/runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { renderApp, runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { unwrapResult } from '../../shared/result-utils.js';
import { CostBasisCommandOptionsSchema } from '../../shared/schemas.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import { isJsonMode } from '../../shared/utils.js';
import { CostBasisApp } from '../view/cost-basis-view-components.jsx';
import { createCostBasisAssetState, createCostBasisTimelineState } from '../view/cost-basis-view-state.js';
import { buildPresentationModel } from '../view/cost-basis-view-utils.js';

import { registerCostBasisExportCommand } from './cost-basis-export.js';
import type { ValidatedCostBasisConfig } from './cost-basis-handler.js';
import { outputCostBasisJSON } from './cost-basis-json.js';
import { promptForCostBasisParams } from './cost-basis-prompts.jsx';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';

const logger = getLogger('cost-basis');

type CommandOptions = z.infer<typeof CostBasisCommandOptionsSchema>;

/**
 * Register the cost-basis command.
 */
export function registerCostBasisCommand(program: Command, appRuntime: CliAppRuntime): void {
  const costBasisCommand = program
    .command('cost-basis')
    .description('Calculate cost basis and capital gains/losses for tax reporting')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost (CA defaults to ACB)')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US, UK, EU')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--fiat-currency <currency>', 'Fiat currency for cost basis: USD, CAD, EUR, GBP (defaults by jurisdiction)')
    .option('--start-date <date>', 'Custom start date (YYYY-MM-DD, requires --end-date)')
    .option('--end-date <date>', 'Custom end date (YYYY-MM-DD, requires --start-date)')
    .option('--asset <symbol>', 'Filter to specific asset (lands on asset history timeline)')
    .option('--refresh', 'Force recomputation and replace the latest stored snapshot for this scope')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeCostBasisCommand(rawOptions, appRuntime));

  registerCostBasisExportCommand(costBasisCommand, appRuntime);
}

async function executeCostBasisCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const parseResult = CostBasisCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'cost-basis',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
    return;
  }

  const options = parseResult.data;

  if (options.json) {
    await executeCostBasisCalculateJSON(options, appRuntime);
  } else {
    await executeCostBasisCalculateTUI(options, appRuntime);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeCostBasisCalculateJSON(options: CommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    const params = unwrapResult(buildCostBasisInputFromFlags(options));

    await runCommand(async (ctx) => {
      const handlerResult = await composeCostBasisHandler(appRuntime, ctx, { isJsonMode: true, params });

      if (handlerResult.isErr()) {
        displayCliError('cost-basis', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const handler = handlerResult.value;
      const result = await handler.execute(params, { refresh: options.refresh });

      if (result.isErr()) {
        displayCliError('cost-basis', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputCostBasisJSON(buildPresentationModel(result.value));
    });
  } catch (error) {
    displayCliError(
      'cost-basis',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI: Calculate Mode ─────────────────────────────────────────────────────

async function executeCostBasisCalculateTUI(options: CommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      // Step 1: Resolve params via interactive prompts or CLI flags
      let params: ValidatedCostBasisConfig;
      const defaultMethodResult = options.jurisdiction
        ? getDefaultCostBasisMethodForJurisdiction(options.jurisdiction as CostBasisJurisdiction)
        : undefined;
      const defaultMethodForJurisdiction = defaultMethodResult?.isOk() ? defaultMethodResult.value : undefined;
      const needsPrompt =
        !options.jurisdiction || !options.taxYear || (!options.method && !defaultMethodForJurisdiction);

      if (needsPrompt) {
        const promptResult = await promptForCostBasisParams(options);
        if (!promptResult) {
          console.log('\nCost basis calculation cancelled');
          return;
        }
        params = promptResult;
      } else {
        params = unwrapResult(buildCostBasisInputFromFlags(options));
      }

      // Step 2: Create handler (runs projection + linking + price enrichment prereqs)
      const handlerResult = await composeCostBasisHandler(appRuntime, ctx, { isJsonMode: false, params });
      if (handlerResult.isErr()) {
        displayCliError('cost-basis', handlerResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const handler = handlerResult.value;

      // Step 3: Calculate cost basis
      const spinner = createSpinner('Calculating cost basis...', false);
      const result = await handler.execute(params, { refresh: options.refresh });
      stopSpinner(spinner);

      if (result.isErr()) {
        displayCliError('cost-basis', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const presentation = buildPresentationModel(result.value);

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
    });
  } catch (error) {
    displayCliError(
      'cost-basis',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * If --asset is specified, find the matching asset and jump to its timeline.
 */
function resolveAssetFilter(
  state: ReturnType<typeof createCostBasisAssetState>,
  assetFilter?: string
): ReturnType<typeof createCostBasisAssetState> | ReturnType<typeof createCostBasisTimelineState> {
  if (!assetFilter) return state;

  const upperFilter = assetFilter.toUpperCase();
  const assetIndex = state.assets.findIndex((a) => a.asset.toUpperCase() === upperFilter);
  if (assetIndex < 0) {
    logger.warn({ asset: assetFilter }, 'Asset filter did not match any assets in the calculation');
    return state;
  }

  const assetItem = state.assets[assetIndex]!;
  return createCostBasisTimelineState(assetItem, state, assetIndex);
}
