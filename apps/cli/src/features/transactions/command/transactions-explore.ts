import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, wrapError, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  explorerDetailSurfaceSpec,
  explorerListSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { type CommandRuntime, renderApp } from '../../../runtime/command-runtime.js';
import { writeFilesWithAtomicRenames } from '../../shared/file-utils.js';
import { buildViewMeta } from '../../shared/view-utils.js';
import {
  getTransactionSelectorErrorExitCode,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../transaction-selector.js';
import { toTransactionViewItem } from '../transaction-view-projection.js';
import type { ExportCallbackResult, OnExport, TransactionViewItem } from '../transactions-view-model.js';
import { TransactionsViewApp, computeCategoryCounts, createTransactionsViewState } from '../view/index.js';
import { outputTransactionStaticDetail, outputTransactionsStaticList } from '../view/transactions-static-renderer.js';

import { registerTransactionsExploreOptions } from './transactions-browse-command.js';
import { buildTransactionsBrowsePresentation, type TransactionsBrowseParams } from './transactions-browse-support.js';
import type { TransactionsBrowseFilters } from './transactions-browse-utils.js';
import {
  buildTransactionsJsonFilters,
  buildTransactionsViewFilters,
  generateDefaultPath,
  parseSinceToUnixSeconds,
  validateUntilDate,
} from './transactions-browse-utils.js';
import { prepareTransactionsCommandScope } from './transactions-command-scope.js';
import { TransactionsExploreCommandOptionsSchema } from './transactions-option-schemas.js';
import { readTransactionsForCommand } from './transactions-read-support.js';

const TRANSACTIONS_EXPLORE_COMMAND_ID = 'transactions-explore';

type TransactionsExploreCommandOptions = z.infer<typeof TransactionsExploreCommandOptionsSchema>;
type ExploreTransactionsParams = TransactionsBrowseFilters & {
  limit: number;
  transactionSelector?: string | undefined;
};

interface PreparedTransactionsExploreCommand {
  params: ExploreTransactionsParams;
  presentation: ResolvedBrowsePresentation;
}

export function registerTransactionsExploreCommand(transactionsCommand: Command): void {
  registerTransactionsExploreOptions(
    transactionsCommand
      .command('explore [selector]')
      .description('Open the transactions explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook transactions explore
  $ exitbook transactions explore --limit 100
  $ exitbook transactions explore --asset BTC
  $ exitbook transactions explore --asset-id blockchain:arbitrum:0xfd086...
  $ exitbook transactions explore --platform kraken
  $ exitbook transactions explore --since 2024-01-01
  $ exitbook transactions explore --operation-type trade
  $ exitbook transactions explore --no-price
  $ exitbook transactions explore a1b2c3d4e5

Common Usage:
  - Review recent trading activity across all exchanges
  - Audit specific assets or date ranges
  - Identify transactions that need price data
  - Inspect one transaction in context before editing or exporting
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await executeTransactionsExploreCommand(selector, rawOptions);
  });
}

async function executeTransactionsExploreCommand(selector: string | undefined, rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);
  const surfaceSpec = buildExploreSurfaceSpec(selector);

  await runCliRuntimeCommand({
    command: TRANSACTIONS_EXPLORE_COMMAND_ID,
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const parsedOptions = yield* parseCliBrowseOptionsResult(
          rawOptions,
          TransactionsExploreCommandOptionsSchema,
          surfaceSpec
        );

        if (selector && hasExploreFiltersOrLimit(parsedOptions.options)) {
          return yield* cliErr(
            new Error(
              'Transaction selector cannot be combined with --platform, --asset, --asset-id, --since, --until, --operation-type, --no-price, or --limit'
            ),
            ExitCodes.INVALID_ARGS
          );
        }

        return {
          params: buildExploreTransactionsParams(parsedOptions.options, selector),
          presentation: parsedOptions.presentation,
        } satisfies PreparedTransactionsExploreCommand;
      }),
    action: async (context) => executeTransactionsExploreCommandResult(context.runtime, context.prepared),
  });
}

async function executeTransactionsExploreCommandResult(
  ctx: CommandRuntime,
  prepared: PreparedTransactionsExploreCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const since = yield* toCliResult(parseSinceToUnixSeconds(prepared.params.since), ExitCodes.INVALID_ARGS);
    yield* toCliResult(validateUntilDate(prepared.params.until), ExitCodes.INVALID_ARGS);

    const format = prepared.presentation.mode === 'json' ? 'json' : 'text';
    const scope = yield* toCliResult(await prepareTransactionsCommandScope(ctx, { format }), ExitCodes.GENERAL_ERROR);

    if (prepared.presentation.mode === 'tui') {
      return yield* await buildTransactionsExploreTuiCompletion(
        scope.database,
        scope.profile.id,
        since,
        prepared.params
      );
    }

    if (prepared.params.transactionSelector) {
      const detailPresentation = yield* await buildTransactionsBrowsePresentation(scope, {
        transactionSelector: prepared.params.transactionSelector,
      } satisfies TransactionsBrowseParams);

      if (prepared.presentation.mode === 'json') {
        const detailJsonResult = yield* toCliValue(
          detailPresentation.detailJsonResult,
          new Error('Expected a selected transaction for detail presentation'),
          ExitCodes.GENERAL_ERROR
        );
        return jsonSuccess(detailJsonResult);
      }

      const selectedTransaction = yield* toCliValue(
        detailPresentation.selectedTransaction,
        new Error('Expected a selected transaction for detail presentation'),
        ExitCodes.GENERAL_ERROR
      );

      return textSuccess(() => {
        outputTransactionStaticDetail(selectedTransaction);
      });
    }

    const transactions = yield* toCliResult(
      await readTransactionsForCommand({
        db: scope.database,
        profileId: scope.profile.id,
        platformKey: prepared.params.platform,
        since,
        until: prepared.params.until,
        assetId: prepared.params.assetId,
        assetSymbol: prepared.params.assetSymbol,
        operationType: prepared.params.operationType,
        noPrice: prepared.params.noPrice,
      }),
      ExitCodes.GENERAL_ERROR
    );

    return buildTransactionsExploreListCompletion(transactions, prepared.params, prepared.presentation.mode);
  });
}

function buildExploreTransactionsParams(
  options: TransactionsExploreCommandOptions,
  transactionSelector: string | undefined
): ExploreTransactionsParams {
  return {
    transactionSelector,
    platform: options.platform,
    assetId: options.assetId,
    assetSymbol: options.asset,
    since: options.since,
    until: options.until,
    operationType: options.operationType,
    noPrice: options.noPrice,
    limit: options.limit ?? 50,
  };
}

function buildExploreSurfaceSpec(selector: string | undefined) {
  return selector
    ? explorerDetailSurfaceSpec(TRANSACTIONS_EXPLORE_COMMAND_ID)
    : explorerListSurfaceSpec(TRANSACTIONS_EXPLORE_COMMAND_ID);
}

function hasExploreFiltersOrLimit(options: TransactionsExploreCommandOptions): boolean {
  return (
    options.platform !== undefined ||
    options.asset !== undefined ||
    options.assetId !== undefined ||
    options.since !== undefined ||
    options.until !== undefined ||
    options.operationType !== undefined ||
    options.noPrice === true ||
    options.limit !== undefined
  );
}

function buildTransactionsExploreListCompletion(
  transactions: Transaction[],
  params: ExploreTransactionsParams,
  mode: 'json' | 'static'
): CliCompletion {
  const allViewItems = transactions.map(toTransactionViewItem);
  const categoryCounts = computeCategoryCounts(allViewItems);
  const visibleItems = allViewItems.slice(0, params.limit);
  const filters = buildTransactionsViewFilters(params);
  const initialState = createTransactionsViewState(visibleItems, filters, transactions.length, categoryCounts);

  if (mode === 'json') {
    return jsonSuccess({
      data: visibleItems,
      meta: buildViewMeta(
        visibleItems.length,
        0,
        params.limit,
        transactions.length,
        buildTransactionsJsonFilters(params)
      ),
    });
  }

  return textSuccess(() => {
    outputTransactionsStaticList(initialState);
  });
}

async function buildTransactionsExploreTuiCompletion(
  database: DataSession,
  profileId: number,
  since: number | undefined,
  params: ExploreTransactionsParams
): Promise<Result<CliCompletion, CliFailure>> {
  return resultDoAsync(async function* () {
    const selectedTransaction = yield* await resolveSelectedTransactionForExplore(
      database,
      profileId,
      params.transactionSelector
    );

    const transactions = yield* toCliResult(
      await readTransactionsForCommand({
        db: database,
        profileId,
        platformKey: params.platform,
        since,
        until: params.until,
        assetId: params.assetId,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const allViewItems = transactions.map(toTransactionViewItem);
    const categoryCounts = computeCategoryCounts(allViewItems);
    const viewFilters = buildTransactionsViewFilters(params);
    const selectedIndex = resolveSelectedIndex(allViewItems, selectedTransaction);
    const visibleItems = selectedTransaction ? allViewItems : allViewItems.slice(0, params.limit);
    const initialState = createTransactionsViewState(
      visibleItems,
      viewFilters,
      transactions.length,
      categoryCounts,
      selectedIndex
    );

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
            assetId: params.assetId,
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
      return yield* cliErr(error, ExitCodes.GENERAL_ERROR);
    }

    return silentSuccess();
  });
}

async function resolveSelectedTransactionForExplore(
  database: DataSession,
  profileId: number,
  transactionSelector: string | undefined
): Promise<Result<ResolvedTransactionSelector | undefined, CliFailure>> {
  return resultDoAsync(async function* () {
    if (!transactionSelector) {
      return undefined;
    }

    const selectorResult = await resolveOwnedTransactionSelector(
      {
        getByFingerprintRef: (ownerProfileId, fingerprintRef) =>
          database.transactions.findByFingerprintRef(ownerProfileId, fingerprintRef),
      },
      profileId,
      transactionSelector
    );

    if (selectorResult.isErr()) {
      return yield* cliErr(selectorResult.error, getTransactionSelectorErrorExitCode(selectorResult.error));
    }

    return selectorResult.value;
  });
}

function resolveSelectedIndex(
  transactions: TransactionViewItem[],
  selectedTransaction: ResolvedTransactionSelector | undefined
): number | undefined {
  if (!selectedTransaction) {
    return undefined;
  }

  const selectedIndex = transactions.findIndex(
    (transaction) => transaction.txFingerprint === selectedTransaction.transaction.txFingerprint
  );

  return selectedIndex >= 0 ? selectedIndex : undefined;
}
