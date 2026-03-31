import type { PortfolioResult } from '@exitbook/accounting/portfolio';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
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
import type { PortfolioTransactionItem } from '../shared/portfolio-history-types.js';
import {
  buildAssetIdsBySymbol,
  buildTransactionItems,
  filterTransactionsForAssets,
} from '../shared/portfolio-history-utils.js';
import { PortfolioApp, createPortfolioAssetsState, type CreatePortfolioAssetsStateParams } from '../view/index.js';

import { withPortfolioCommandScope } from './portfolio-command-scope.js';
import { PortfolioCommandOptionsSchema } from './portfolio-option-schemas.js';
import { runPortfolio } from './run-portfolio.js';

type PortfolioCommandOptions = z.infer<typeof PortfolioCommandOptionsSchema>;

interface NormalizedPortfolioOptions {
  asOf: Date;
  displayCurrency: string;
  jurisdiction: string;
  method: string;
}

export function registerPortfolioCommand(program: Command, appRuntime: CliAppRuntime): void {
  program
    .command('portfolio')
    .description('View current portfolio holdings, allocation, and unrealized P&L')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook portfolio
  $ exitbook portfolio --jurisdiction CA --method average-cost --fiat-currency CAD
  $ exitbook portfolio --as-of 2025-12-31T23:59:59Z
  $ exitbook portfolio --json

Notes:
  - Use an ISO 8601 timestamp for --as-of.
  - Jurisdiction can change the default cost-basis method.
`
    )
    .option(
      '--method <method>',
      'Cost basis method: fifo, lifo, average-cost (default: fifo; CA defaults to average-cost)'
    )
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US (default: US)')
    .option('--fiat-currency <currency>', 'Display currency: USD, CAD, EUR, GBP (default: USD)')
    .option('--as-of <datetime>', 'Point-in-time snapshot (ISO 8601, default: now)')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executePortfolioCommand(rawOptions, appRuntime));
}

async function executePortfolioCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'portfolio',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, PortfolioCommandOptionsSchema);
        const normalized = yield* normalizePortfolioOptionsResult(options);
        return yield* await executePortfolioCommandResult(normalized, format, appRuntime);
      }),
  });
}

async function executePortfolioCommandResult(
  normalized: NormalizedPortfolioOptions,
  format: 'json' | 'text',
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'portfolio',
    appRuntime,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(await loadPortfolioResult(ctx, normalized, format), ExitCodes.GENERAL_ERROR);

        if (format === 'json') {
          return jsonSuccess({
            data: {
              asOf: result.asOf,
              method: result.method,
              jurisdiction: result.jurisdiction,
              displayCurrency: result.displayCurrency,
              totalValue: result.totalValue,
              totalCost: result.totalCost,
              totalUnrealizedGainLoss: result.totalUnrealizedGainLoss,
              totalUnrealizedPct: result.totalUnrealizedPct,
              totalRealizedGainLossAllTime: result.totalRealizedGainLossAllTime,
              totalNetFiatIn: result.totalNetFiatIn,
              positions: result.positions,
              closedPositions: result.closedPositions,
            },
            warnings: result.warnings,
            meta: result.meta,
          });
        }

        return yield* toCliResult(await buildPortfolioTuiCompletion(ctx, result), ExitCodes.GENERAL_ERROR);
      }),
  });
}

async function loadPortfolioResult(
  ctx: CommandRuntime,
  normalized: NormalizedPortfolioOptions,
  format: 'json' | 'text'
): Promise<Result<PortfolioResult, Error>> {
  if (format === 'json') {
    return withPortfolioCommandScope(ctx, { asOf: normalized.asOf, format }, (scope) =>
      runPortfolio(scope, {
        method: normalized.method,
        jurisdiction: normalized.jurisdiction,
        displayCurrency: normalized.displayCurrency,
        asOf: normalized.asOf,
      })
    );
  }

  const spinner = createSpinner('Calculating portfolio...', false);
  try {
    return await withPortfolioCommandScope(ctx, { asOf: normalized.asOf, format }, (scope) =>
      runPortfolio(scope, {
        method: normalized.method,
        jurisdiction: normalized.jurisdiction,
        displayCurrency: normalized.displayCurrency,
        asOf: normalized.asOf,
      })
    );
  } finally {
    stopSpinner(spinner);
  }
}

async function buildPortfolioTuiCompletion(
  ctx: CommandRuntime,
  value: PortfolioResult
): Promise<Result<ReturnType<typeof silentSuccess>, Error>> {
  try {
    const assetIdsBySymbol = buildAssetIdsBySymbol(value.transactions);

    const transactionsByAssetId = new Map<string, PortfolioTransactionItem[]>();
    for (const position of [...value.positions, ...value.closedPositions]) {
      const holdingAssetIds = position.sourceAssetIds ?? [position.assetId];
      const symbolAssetIds = assetIdsBySymbol.get(position.assetSymbol.trim().toUpperCase()) ?? [];
      const historyAssetIds = Array.from(new Set([...holdingAssetIds, ...symbolAssetIds]));
      const filteredTransactions = filterTransactionsForAssets(value.transactions, historyAssetIds);
      const transactionItems = buildTransactionItems(filteredTransactions, historyAssetIds);
      transactionsByAssetId.set(position.assetId, transactionItems);
    }

    const stateParams: CreatePortfolioAssetsStateParams = {
      asOf: value.asOf,
      method: value.method,
      jurisdiction: value.jurisdiction,
      displayCurrency: value.displayCurrency,
      positions: value.positions,
      closedPositions: value.closedPositions,
      transactionsByAssetId,
      warnings: value.warnings,
      totalTransactions: value.transactions.length,
      totalValue: value.totalValue,
      totalCost: value.totalCost,
      totalUnrealizedGainLoss: value.totalUnrealizedGainLoss,
      totalUnrealizedPct: value.totalUnrealizedPct,
      totalRealizedGainLossAllTime: value.totalRealizedGainLossAllTime,
      totalNetFiatIn: value.totalNetFiatIn,
    };

    const initialState = createPortfolioAssetsState(stateParams);

    await ctx.closeDatabase();
    await renderApp((unmount) =>
      React.createElement(PortfolioApp, {
        initialState,
        onQuit: unmount,
      })
    );

    return ok(silentSuccess());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function normalizePortfolioOptionsResult(
  options: PortfolioCommandOptions
): Result<NormalizedPortfolioOptions, CliFailure> {
  const jurisdiction = (options.jurisdiction ?? 'US').toUpperCase();
  const asOf = options.asOf ? new Date(options.asOf) : new Date();

  if (Number.isNaN(asOf.getTime())) {
    return cliErr(new Error('Invalid --as-of datetime. Use an ISO 8601 timestamp.'), ExitCodes.INVALID_ARGS);
  }

  return ok({
    method: (options.method ?? (jurisdiction === 'CA' ? 'average-cost' : 'fifo')).toLowerCase(),
    jurisdiction,
    displayCurrency: (options.fiatCurrency ?? 'USD').toUpperCase(),
    asOf,
  });
}
