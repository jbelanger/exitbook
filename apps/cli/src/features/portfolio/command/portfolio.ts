import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { isJsonMode } from '../../shared/json-mode.js';
import { outputSuccess } from '../../shared/json-output.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import type { PortfolioTransactionItem } from '../shared/portfolio-types.js';
import { PortfolioApp, createPortfolioAssetsState, type CreatePortfolioAssetsStateParams } from '../view/index.js';

import { createPortfolioHandler } from './portfolio-handler.js';
import { PortfolioCommandOptionsSchema } from './portfolio-option-schemas.js';
import { buildAssetIdsBySymbol, buildTransactionItems, filterTransactionsForAssets } from './portfolio-utils.js';

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
  const jsonMode = isJsonMode(rawOptions);

  const parseResult = PortfolioCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'portfolio',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      jsonMode ? 'json' : 'text'
    );
    return;
  }

  const options = parseResult.data;

  if (options.json) {
    await executePortfolioJSON(options, appRuntime);
  } else {
    await executePortfolioTUI(options, appRuntime);
  }
}

async function executePortfolioJSON(options: PortfolioCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    const normalized = normalizeOptions(options);

    await runCommand(appRuntime, async (ctx) => {
      const handlerResult = await createPortfolioHandler(ctx, {
        isJsonMode: true,
        asOf: normalized.asOf,
      });

      if (handlerResult.isErr()) {
        throw handlerResult.error;
      }

      const handler = handlerResult.value;
      const result = await handler.execute({
        method: normalized.method,
        jurisdiction: normalized.jurisdiction,
        displayCurrency: normalized.displayCurrency,
        asOf: normalized.asOf,
      });

      if (result.isErr()) {
        throw result.error;
      }

      const value = result.value;
      outputSuccess('portfolio', {
        data: {
          asOf: value.asOf,
          method: value.method,
          jurisdiction: value.jurisdiction,
          displayCurrency: value.displayCurrency,
          totalValue: value.totalValue,
          totalCost: value.totalCost,
          totalUnrealizedGainLoss: value.totalUnrealizedGainLoss,
          totalUnrealizedPct: value.totalUnrealizedPct,
          totalRealizedGainLossAllTime: value.totalRealizedGainLossAllTime,
          totalNetFiatIn: value.totalNetFiatIn,
          positions: value.positions,
          closedPositions: value.closedPositions,
        },
        warnings: value.warnings,
        meta: value.meta,
      });
    });
  } catch (error) {
    displayCliError(
      'portfolio',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

async function executePortfolioTUI(options: PortfolioCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    const normalized = normalizeOptions(options);

    await runCommand(appRuntime, async (ctx) => {
      const handlerResult = await createPortfolioHandler(ctx, {
        isJsonMode: false,
        asOf: normalized.asOf,
      });

      if (handlerResult.isErr()) {
        throw handlerResult.error;
      }

      const handler = handlerResult.value;
      // No ctx.onAbort: portfolio calculation is a single synchronous DB read — it cannot be
      // meaningfully interrupted mid-flight. The prereq abort (prices/links) is handled inside
      // createPortfolioHandler before this point.

      const spinner = createSpinner('Calculating portfolio...', false);
      let result: Awaited<ReturnType<typeof handler.execute>>;
      try {
        result = await handler.execute({
          method: normalized.method,
          jurisdiction: normalized.jurisdiction,
          displayCurrency: normalized.displayCurrency,
          asOf: normalized.asOf,
        });
      } finally {
        stopSpinner(spinner);
      }

      if (result.isErr()) {
        throw result.error;
      }

      const value = result.value;
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
    });
  } catch (error) {
    displayCliError(
      'portfolio',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

function normalizeOptions(options: PortfolioCommandOptions): NormalizedPortfolioOptions {
  const jurisdiction = (options.jurisdiction ?? 'US').toUpperCase();

  return {
    method: (options.method ?? (jurisdiction === 'CA' ? 'average-cost' : 'fifo')).toLowerCase(),
    jurisdiction,
    displayCurrency: (options.fiatCurrency ?? 'USD').toUpperCase(),
    asOf: options.asOf ? new Date(options.asOf) : new Date(),
  };
}
