import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import {
  buildCliOptionsHelpText,
  detectCliOutputFormat,
  parseCliCommandOptionsResult,
  registerCliOptionDefinitions,
  type CliOptionDefinition,
  type CliOutputFormat,
} from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { type CommandRuntime } from '../../../runtime/command-runtime.js';
import type { TransactionViewItem } from '../transactions-view-model.js';
import type { TransactionsViewState } from '../view/index.js';
import { outputTransactionStaticDetail, outputTransactionsStaticList } from '../view/transactions-static-renderer.js';

import {
  buildTransactionsBrowsePresentation,
  type TransactionsBrowseJsonDetailResult,
  type TransactionsBrowseJsonListResult,
  type TransactionsBrowseParams,
} from './transactions-browse-support.js';
import { prepareTransactionsCommandScope } from './transactions-command-scope.js';
import { TransactionsBrowseCommandOptionsSchema } from './transactions-option-schemas.js';

type TransactionsBrowseCommandOptions = z.infer<typeof TransactionsBrowseCommandOptionsSchema>;

interface PrepareTransactionsBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  transactionSelector?: string | undefined;
}

interface ExecuteTransactionsBrowseCommandInput extends PrepareTransactionsBrowseCommandInput {
  appRuntime: CliAppRuntime;
}

export interface PreparedTransactionsBrowseCommand {
  params: TransactionsBrowseParams;
  surfaceKind: 'detail' | 'list';
}

const TRANSACTIONS_FILTER_OPTION_DEFINITIONS: CliOptionDefinition[] = [
  {
    flags: '--account <selector>',
    description: 'Filter by account name or fingerprint prefix',
  },
  {
    flags: '--platform <name>',
    description: 'Filter by exchange or blockchain platform',
  },
  {
    flags: '--asset <currency>',
    description: 'Filter by asset (e.g., BTC, ETH)',
  },
  {
    flags: '--asset-id <asset-id>',
    description: 'Filter by exact asset ID',
  },
  {
    flags: '--address <value>',
    description: 'Filter by endpoint address or identifier appearing in from/to',
  },
  {
    flags: '--from <value>',
    description: 'Filter by exact from endpoint',
  },
  {
    flags: '--to <value>',
    description: 'Filter by exact to endpoint',
  },
  {
    flags: '--since <date>',
    description: 'Filter by date (ISO 8601 format, e.g., 2024-01-01)',
  },
  {
    flags: '--until <date>',
    description: 'Filter by date (ISO 8601 format, e.g., 2024-12-31)',
  },
  {
    flags: '--operation-type <type>',
    description: 'Filter by operation type',
  },
  {
    flags: '--annotation-kind <kind>',
    description: 'Filter by transaction annotation kind',
  },
  {
    flags: '--annotation-tier <tier>',
    description: 'Filter by transaction annotation tier',
  },
  {
    flags: '--no-price',
    description: 'Show only transactions without price data',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
  {
    flags: '--source-data',
    description: 'Include linked raw source rows and full payload dumps in detail output',
  },
];

const TRANSACTIONS_EXPLORE_ONLY_OPTION_DEFINITIONS: CliOptionDefinition[] = [
  {
    flags: '--limit <number>',
    description: 'Maximum number of transactions to return',
    parser: (value: string) => Number.parseInt(value, 10),
  },
];

export function registerTransactionsBrowseOptions(command: Command): Command {
  return registerCliOptionDefinitions(command, TRANSACTIONS_FILTER_OPTION_DEFINITIONS);
}

export function registerTransactionsExploreOptions(command: Command): Command {
  return registerCliOptionDefinitions(command, [
    ...TRANSACTIONS_FILTER_OPTION_DEFINITIONS,
    ...TRANSACTIONS_EXPLORE_ONLY_OPTION_DEFINITIONS,
  ]);
}

export function buildTransactionsBrowseOptionsHelpText(): string {
  return buildCliOptionsHelpText(TRANSACTIONS_FILTER_OPTION_DEFINITIONS);
}

export function prepareTransactionsBrowseCommand(
  input: PrepareTransactionsBrowseCommandInput
): Result<PreparedTransactionsBrowseCommand, CliFailure> {
  const optionsResult = parseCliCommandOptionsResult(input.rawOptions, TransactionsBrowseCommandOptionsSchema);
  if (optionsResult.isErr()) {
    return err(optionsResult.error);
  }

  const options = optionsResult.value;
  if (input.transactionSelector && hasBrowseFilters(options)) {
    return err(
      createCliFailure(
        new Error(
          'Transaction selector cannot be combined with --account, --platform, --asset, --asset-id, --address, --from, --to, --since, --until, --operation-type, --annotation-kind, --annotation-tier, or --no-price'
        ),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  if (!input.transactionSelector && options.sourceData === true) {
    return err(createCliFailure(new Error('--source-data requires a transaction selector'), ExitCodes.INVALID_ARGS));
  }

  return ok({
    params: {
      transactionSelector: input.transactionSelector,
      account: options.account,
      platform: options.platform,
      assetId: options.assetId,
      assetSymbol: options.asset,
      address: options.address,
      from: options.from,
      to: options.to,
      since: options.since,
      until: options.until,
      operationType: options.operationType,
      annotationKind: options.annotationKind,
      annotationTier: options.annotationTier,
      noPrice: options.noPrice,
      sourceData: options.sourceData,
    },
    surfaceKind: input.transactionSelector ? 'detail' : 'list',
  });
}

export async function runTransactionsBrowseCommand(input: ExecuteTransactionsBrowseCommandInput): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    appRuntime: input.appRuntime,
    command: input.commandId,
    format,
    prepare: async () => prepareTransactionsBrowseCommand(input),
    action: async (context) => executePreparedTransactionsBrowseCommand(context.runtime, context.prepared, format),
  });
}

export async function executePreparedTransactionsBrowseCommand(
  ctx: CommandRuntime,
  prepared: PreparedTransactionsBrowseCommand,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const scope = yield* toCliResult(await prepareTransactionsCommandScope(ctx, { format }), ExitCodes.GENERAL_ERROR);
    const presentation = yield* await buildTransactionsBrowsePresentation(scope, prepared.params);

    return yield* buildTransactionsBrowseCompletion(
      presentation.listJsonResult,
      presentation.detailJsonResult,
      presentation.initialState,
      presentation.selectedTransaction,
      prepared.surfaceKind,
      format
    );
  });
}

function buildTransactionsBrowseCompletion(
  listJsonResult: TransactionsBrowseJsonListResult,
  detailJsonResult: TransactionsBrowseJsonDetailResult | undefined,
  initialState: TransactionsViewState,
  selectedTransaction: TransactionViewItem | undefined,
  surfaceKind: 'detail' | 'list',
  format: CliOutputFormat
): Result<CliCompletion, CliFailure> {
  if (format === 'json') {
    return ok(jsonSuccess(surfaceKind === 'detail' ? (detailJsonResult ?? listJsonResult) : listJsonResult));
  }

  if (surfaceKind === 'detail') {
    const transactionResult = toCliValue(
      selectedTransaction,
      new Error('Expected a selected transaction for detail presentation'),
      ExitCodes.GENERAL_ERROR
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    return ok(
      textSuccess(() => {
        outputTransactionStaticDetail(transactionResult.value);
      })
    );
  }

  return ok(
    textSuccess(() => {
      outputTransactionsStaticList(initialState);
    })
  );
}

function hasBrowseFilters(options: TransactionsBrowseCommandOptions): boolean {
  return (
    options.account !== undefined ||
    options.platform !== undefined ||
    options.asset !== undefined ||
    options.assetId !== undefined ||
    options.address !== undefined ||
    options.from !== undefined ||
    options.to !== undefined ||
    options.since !== undefined ||
    options.until !== undefined ||
    options.operationType !== undefined ||
    options.annotationKind !== undefined ||
    options.annotationTier !== undefined ||
    options.noPrice === true
  );
}
