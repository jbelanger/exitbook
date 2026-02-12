// Command registration for view transactions subcommand
import type { Command } from 'commander';
import { err, ok } from 'neverthrow';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { writeFilesAtomically } from '../shared/file-utils.js';
import { outputSuccess } from '../shared/json-output.js';
import { TransactionsViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta, parseDate } from '../shared/view-utils.js';

import { TransactionsViewApp, computeCategoryCounts, createTransactionsViewState } from './components/index.js';
import type { ExportCallbackResult, OnExport } from './components/index.js';
import type { ViewTransactionsParams } from './transactions-view-utils.js';
import { applyTransactionFilters, generateDefaultPath, toTransactionViewItem } from './transactions-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof TransactionsViewCommandOptionsSchema>;

/**
 * Result data for view transactions command (JSON mode).
 */
type ViewTransactionsCommandResult = ViewCommandResult<
  import('./components/transactions-view-state.js').TransactionViewItem[]
>;

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
  $ exitbook transactions view --source kraken            # View Kraken transactions
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
    .option('--source <name>', 'Filter by exchange or blockchain name')
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
  // Validate options at CLI boundary
  const parseResult = TransactionsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'transactions-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  // Build params from options
  const params: ViewTransactionsParams = {
    source: options.source,
    assetSymbol: options.asset,
    since: options.since,
    until: options.until,
    operationType: options.operationType,
    noPrice: options.noPrice,
    limit: options.limit || 50,
  };

  if (isJsonMode) {
    await executeTransactionsViewJSON(params);
  } else {
    await executeTransactionsViewTUI(params);
  }
}

/**
 * Execute transactions view in TUI mode
 */
async function executeTransactionsViewTUI(params: ViewTransactionsParams): Promise<void> {
  const { TransactionRepository } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = new TransactionRepository(database);

      let since: number | undefined;
      if (params.since) {
        const sinceResult = parseDate(params.since);
        if (sinceResult.isErr()) {
          console.error('\n⚠ Error:', sinceResult.error.message);
          ctx.exitCode = ExitCodes.INVALID_ARGS;
          return;
        }
        since = Math.floor(sinceResult.value.getTime() / 1000);
      }

      const filters = {
        ...(params.source && { sourceName: params.source }),
        ...(since && { since }),
        includeExcluded: true,
      };

      const txResult = await txRepo.getTransactions(filters);
      if (txResult.isErr()) {
        console.error('\n⚠ Error:', txResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      let transactions = txResult.value;

      const filterResult = applyTransactionFilters(transactions, params);
      if (filterResult.isErr()) {
        console.error('\n⚠ Error:', filterResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }
      transactions = filterResult.value;

      const totalCount = transactions.length;
      const allViewItems = transactions.map(toTransactionViewItem);
      const categoryCounts = computeCategoryCounts(allViewItems);
      const viewItems = params.limit ? allViewItems.slice(0, params.limit) : allViewItems;

      const viewFilters = {
        sourceFilter: params.source,
        assetFilter: params.assetSymbol,
        operationTypeFilter: params.operationType,
        noPriceFilter: params.noPrice,
      };

      const initialState = createTransactionsViewState(viewItems, viewFilters, totalCount, categoryCounts);

      const { TransactionLinkRepository } = await import('@exitbook/accounting');
      const { ExportHandler } = await import('./transactions-export-handler.js');
      const txLinkRepo = new TransactionLinkRepository(database);
      const exportHandler = new ExportHandler(txRepo, txLinkRepo);

      const onExport: OnExport = async (format, csvFormat) => {
        try {
          const outputPath = generateDefaultPath(viewFilters, format);

          const result = await exportHandler.execute({
            sourceName: params.source,
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

          const writeResult = await writeFilesAtomically(result.value.outputs);
          if (writeResult.isErr()) {
            return err(new Error(`Failed to write export files: ${writeResult.error.message}`));
          }

          const exportResult: ExportCallbackResult = {
            outputPaths: writeResult.value,
            transactionCount: result.value.transactionCount,
          };
          return ok(exportResult);
        } catch (error) {
          return err(error instanceof Error ? error : new Error(String(error)));
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
async function executeTransactionsViewJSON(params: ViewTransactionsParams): Promise<void> {
  const { TransactionRepository } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = new TransactionRepository(database);

      // Convert since to unix timestamp if provided
      let since: number | undefined;
      if (params.since) {
        const sinceResult = parseDate(params.since);
        if (sinceResult.isErr()) {
          displayCliError('view-transactions', sinceResult.error, ExitCodes.INVALID_ARGS, 'json');
          return;
        }
        since = Math.floor(sinceResult.value.getTime() / 1000);
      }

      const filters = {
        ...(params.source && { sourceName: params.source }),
        ...(since && { since }),
        includeExcluded: true,
      };

      const txResult = await txRepo.getTransactions(filters);
      if (txResult.isErr()) {
        displayCliError('view-transactions', txResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      let transactions = txResult.value;

      // Apply client-side filters
      const filterResult = applyTransactionFilters(transactions, params);
      if (filterResult.isErr()) {
        displayCliError('view-transactions', filterResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }
      transactions = filterResult.value;

      const totalCount = transactions.length;

      // Apply limit
      if (params.limit) {
        transactions = transactions.slice(0, params.limit);
      }

      // Build result with full transaction details (same as TUI)
      const viewItems = transactions.map(toTransactionViewItem);

      handleViewTransactionsJSON(viewItems, params, totalCount);
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

/**
 * Handle successful view transactions (JSON mode).
 */
function handleViewTransactionsJSON(
  viewItems: import('./components/transactions-view-state.js').TransactionViewItem[],
  params: ViewTransactionsParams,
  totalCount: number
): void {
  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.source) filters['source'] = params.source;
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
