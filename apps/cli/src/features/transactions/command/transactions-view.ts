import { err, ok, wrapError, type Result } from '@exitbook/foundation';
// Command registration for view transactions subcommand
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { writeFilesWithAtomicRenames } from '../../shared/file-utils.js';
import { outputSuccess } from '../../shared/json-output.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildViewMeta, parseDate } from '../../shared/view-utils.js';
import type { ExportCallbackResult, OnExport, TransactionViewItem } from '../transactions-view-model.js';
import { TransactionsViewApp, computeCategoryCounts, createTransactionsViewState } from '../view/index.js';

import { TransactionsViewCommandOptionsSchema } from './transactions-option-schemas.js';
import { readTransactionsForCommand } from './transactions-read-support.js';
import type { ViewTransactionsParams } from './transactions-view-utils.js';
import { generateDefaultPath, toTransactionViewItem } from './transactions-view-utils.js';

type ViewTransactionsCommandParams = ViewTransactionsParams;

/**
 * Result data for view transactions command (JSON mode).
 */
type ViewTransactionsCommandResult = ViewCommandResult<TransactionViewItem[]>;

/**
 * Register the transactions view subcommand.
 */
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
    .action(async (rawOptions: unknown) => {
      await executeViewTransactionsCommand(rawOptions);
    });
}

/**
 * Execute the view transactions command.
 */
async function executeViewTransactionsCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions(
    'transactions-view',
    rawOptions,
    TransactionsViewCommandOptionsSchema
  );

  // Build params from options
  const params: ViewTransactionsCommandParams = {
    platform: options.platform,
    assetSymbol: options.asset,
    since: options.since,
    until: options.until,
    operationType: options.operationType,
    noPrice: options.noPrice,
    limit: options.limit || 50,
  };

  if (format === 'json') {
    await executeTransactionsViewJSON(params);
  } else {
    await executeTransactionsViewTUI(params);
  }
}

/**
 * Execute transactions view in TUI mode
 */
async function executeTransactionsViewTUI(params: ViewTransactionsCommandParams): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        console.error('\n⚠ Error:', profileResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const sinceResult = parseSinceToUnixSeconds(params.since);
      if (sinceResult.isErr()) {
        console.error('\n⚠ Error:', sinceResult.error.message);
        ctx.exitCode = ExitCodes.INVALID_ARGS;
        return;
      }

      const transactionsResult = await readTransactionsForCommand({
        db: database,
        profileId: profileResult.value.id,
        platformKey: params.platform,
        since: sinceResult.value,
        until: params.until,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      });
      if (transactionsResult.isErr()) {
        console.error('\n⚠ Error:', transactionsResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const totalCount = transactionsResult.value.length;
      const allViewItems = transactionsResult.value.map(toTransactionViewItem);
      const categoryCounts = computeCategoryCounts(allViewItems);
      const viewItems = params.limit ? allViewItems.slice(0, params.limit) : allViewItems;

      const viewFilters = {
        platformFilter: params.platform,
        assetFilter: params.assetSymbol,
        operationTypeFilter: params.operationType,
        noPriceFilter: params.noPrice,
      };

      const initialState = createTransactionsViewState(viewItems, viewFilters, totalCount, categoryCounts);

      const { TransactionsExportHandler } = await import('./transactions-export-handler.js');
      const exportHandler = new TransactionsExportHandler(database);

      const onExport: OnExport = async (format, csvFormat) => {
        try {
          const outputPath = generateDefaultPath(viewFilters, format);

          const result = await exportHandler.execute({
            profileId: profileResult.value.id,
            platformKey: params.platform,
            format,
            csvFormat,
            outputPath,
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
    });
  } catch (error) {
    displayCliError(
      'transactions-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute transactions view in JSON mode
 */
async function executeTransactionsViewJSON(params: ViewTransactionsCommandParams): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('view-transactions', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const sinceResult = parseSinceToUnixSeconds(params.since);
      if (sinceResult.isErr()) {
        displayCliError('view-transactions', sinceResult.error, ExitCodes.INVALID_ARGS, 'json');
        return;
      }

      const transactionsResult = await readTransactionsForCommand({
        db: database,
        profileId: profileResult.value.id,
        platformKey: params.platform,
        since: sinceResult.value,
        until: params.until,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      });
      if (transactionsResult.isErr()) {
        displayCliError('view-transactions', transactionsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      let transactions = transactionsResult.value;

      // Apply limit
      if (params.limit) {
        transactions = transactions.slice(0, params.limit);
      }

      // Build result with full transaction details (same as TUI)
      const viewItems = transactions.map(toTransactionViewItem);

      handleViewTransactionsJSON(viewItems, params, transactionsResult.value.length);
    });
  } catch (error) {
    displayCliError(
      'view-transactions',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
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

/**
 * Handle successful view transactions (JSON mode).
 */
function handleViewTransactionsJSON(
  viewItems: TransactionViewItem[],
  params: ViewTransactionsCommandParams,
  totalCount: number
): void {
  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.platform) filters['platform'] = params.platform;
  if (params.assetSymbol) filters['asset'] = params.assetSymbol;
  if (params.since) filters['since'] = params.since;
  if (params.until) filters['until'] = params.until;
  if (params.operationType) filters['operationType'] = params.operationType;
  if (params.noPrice) filters['noPrice'] = params.noPrice;

  const resultData: ViewTransactionsCommandResult = {
    data: viewItems,
    meta: buildViewMeta(viewItems.length, 0, params.limit || 50, totalCount, filters),
  };

  outputSuccess('view-transactions', resultData);
}
