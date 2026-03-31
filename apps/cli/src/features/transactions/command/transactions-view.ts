import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, wrapError, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { type CommandRuntime, renderApp } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { writeFilesWithAtomicRenames } from '../../shared/file-utils.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta, parseDate } from '../../shared/view-utils.js';
import type {
  ExportCallbackResult,
  OnExport,
  TransactionViewItem,
  TransactionsViewFilters,
} from '../transactions-view-model.js';
import { TransactionsViewApp, computeCategoryCounts, createTransactionsViewState } from '../view/index.js';

import { TransactionsViewCommandOptionsSchema } from './transactions-option-schemas.js';
import { readTransactionsForCommand } from './transactions-read-support.js';
import type { ViewTransactionsParams } from './transactions-view-utils.js';
import { generateDefaultPath, toTransactionViewItem } from './transactions-view-utils.js';

type TransactionsViewCommandOptions = z.infer<typeof TransactionsViewCommandOptionsSchema>;
type ViewTransactionsCommandParams = Omit<ViewTransactionsParams, 'limit'> & { limit: number };

type ViewTransactionsCommandResult = ViewCommandResult<TransactionViewItem[]>;

export function registerTransactionsViewCommand(transactionsCommand: Command): void {
  transactionsCommand
    .command('view')
    .description('View processed transactions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions view                            # View latest 50 transactions
  $ exitbook transactions view --limit 100                # View latest 100 transactions
  $ exitbook transactions view --asset BTC                # View Bitcoin transactions only
  $ exitbook transactions view --platform kraken          # View Kraken transactions
  $ exitbook transactions view --since 2024-01-01         # View transactions from Jan 2024
  $ exitbook transactions view --operation-type trade     # View trades only
  $ exitbook transactions view --no-price                 # Find transactions missing price data

Common Usage:
  - Review recent trading activity across all exchanges
  - Audit specific assets or date ranges
  - Identify transactions that need price data
  - Verify imported data accuracy
`
    )
    .option('--platform <name>', 'Filter by exchange or blockchain platform')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH)')
    .option('--since <date>', 'Filter by date (ISO 8601 format, e.g., 2024-01-01)')
    .option('--until <date>', 'Filter by date (ISO 8601 format, e.g., 2024-12-31)')
    .option('--operation-type <type>', 'Filter by operation type')
    .option('--no-price', 'Show only transactions without price data')
    .option('--limit <number>', 'Maximum number of transactions to return', parseInt)
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeViewTransactionsCommand(rawOptions));
}

async function executeViewTransactionsCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<ViewTransactionsCommandParams>({
    command: 'transactions-view',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, TransactionsViewCommandOptionsSchema);
        return buildViewTransactionsParams(options);
      }),
    action: async (context) => executeTransactionsViewCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeTransactionsViewCommandResult(
  ctx: CommandRuntime,
  params: ViewTransactionsCommandParams,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const since = yield* toCliResult(parseSinceToUnixSeconds(params.since), ExitCodes.INVALID_ARGS);
    yield* toCliResult(validateUntilDate(params.until), ExitCodes.INVALID_ARGS);

    const transactions = yield* toCliResult(
      await readTransactionsForCommand({
        db: database,
        profileId: profile.id,
        platformKey: params.platform,
        since,
        until: params.until,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      }),
      ExitCodes.GENERAL_ERROR
    );

    if (format === 'json') {
      return buildTransactionsViewJsonCompletion(transactions, params);
    }

    return yield* await buildTransactionsViewTuiCompletion(ctx, database, profile.id, transactions, since, params);
  });
}

function buildViewTransactionsParams(options: TransactionsViewCommandOptions): ViewTransactionsCommandParams {
  return {
    platform: options.platform,
    assetSymbol: options.asset,
    since: options.since,
    until: options.until,
    operationType: options.operationType,
    noPrice: options.noPrice,
    limit: options.limit ?? 50,
  };
}

function buildTransactionsViewJsonCompletion(
  transactions: Transaction[],
  params: ViewTransactionsCommandParams
): CliCompletion {
  const limitedTransactions = transactions.slice(0, params.limit);
  const viewItems = limitedTransactions.map(toTransactionViewItem);
  const resultData: ViewTransactionsCommandResult = {
    data: viewItems,
    meta: buildViewMeta(
      viewItems.length,
      0,
      params.limit,
      transactions.length,
      buildDefinedFilters({
        platform: params.platform,
        asset: params.assetSymbol,
        since: params.since,
        until: params.until,
        operationType: params.operationType,
        noPrice: params.noPrice ? true : undefined,
      })
    ),
  };

  return jsonSuccess(resultData);
}

async function buildTransactionsViewTuiCompletion(
  ctx: CommandRuntime,
  database: DataSession,
  profileId: number,
  transactions: Transaction[],
  since: number | undefined,
  params: ViewTransactionsCommandParams
): Promise<Result<CliCompletion, CliFailure>> {
  const allViewItems = transactions.map(toTransactionViewItem);
  const categoryCounts = computeCategoryCounts(allViewItems);
  const viewItems = allViewItems.slice(0, params.limit);
  const viewFilters = buildTransactionsViewFilters(params);
  const initialState = createTransactionsViewState(viewItems, viewFilters, transactions.length, categoryCounts);

  try {
    const { TransactionsExportHandler } = await import('./transactions-export-handler.js');
    const exportHandler = new TransactionsExportHandler(database);

    const onExport: OnExport = async (exportFormat, csvFormat) => {
      try {
        const outputPath = generateDefaultPath(viewFilters, exportFormat);
        const result = await exportHandler.execute({
          profileId,
          platformKey: params.platform,
          format: exportFormat,
          csvFormat,
          outputPath,
          since,
          until: params.until,
          assetSymbol: params.assetSymbol,
          operationType: params.operationType,
          noPrice: params.noPrice,
        });
        if (result.isErr()) {
          return err(result.error);
        }

        const writeResult = await writeFilesWithAtomicRenames(result.value.outputs);
        if (writeResult.isErr()) {
          return err(new Error(`Failed to write export files: ${writeResult.error.message}`));
        }

        const exportResult: ExportCallbackResult = {
          outputPaths: writeResult.value,
          transactionCount: result.value.transactionCount,
        };
        return ok(exportResult);
      } catch (error) {
        return wrapError(error, 'Failed to export transactions');
      }
    };

    await renderApp((unmount) =>
      React.createElement(TransactionsViewApp, {
        initialState,
        onExport,
        onQuit: unmount,
      })
    );
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}

function parseSinceToUnixSeconds(since: string | undefined): Result<number | undefined, Error> {
  if (!since) {
    return ok(undefined);
  }

  const sinceResult = parseDate(since);
  if (sinceResult.isErr()) {
    return err(sinceResult.error);
  }

  return ok(Math.floor(sinceResult.value.getTime() / 1000));
}

function validateUntilDate(until: string | undefined): Result<void, Error> {
  if (!until) {
    return ok(undefined);
  }

  const untilResult = parseDate(until);
  if (untilResult.isErr()) {
    return err(untilResult.error);
  }

  return ok(undefined);
}

function buildTransactionsViewFilters(params: ViewTransactionsCommandParams): TransactionsViewFilters {
  return {
    platformFilter: params.platform,
    assetFilter: params.assetSymbol,
    operationTypeFilter: params.operationType,
    noPriceFilter: params.noPrice,
  };
}
