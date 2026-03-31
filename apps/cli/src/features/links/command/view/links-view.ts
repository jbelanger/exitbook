import type { TransactionLink } from '@exitbook/core';
import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

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
} from '../../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import { renderApp, type CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { buildDefinedFilters, buildViewMeta, type ViewCommandResult } from '../../../shared/view-utils.js';
import type { LinkGapIssue } from '../../links-gap-model.js';
import type { LinkWithTransactions } from '../../links-view-model.js';
import { LinksViewApp, createGapsViewState, createLinksViewState } from '../../view/index.js';
import { LinksGapsCommandOptionsSchema, LinksViewCommandOptionsSchema } from '../links-option-schemas.js';
import { LinksReviewHandler } from '../review/links-review-handler.js';

import { analyzeLinkGaps } from './links-gap-analysis.js';
import {
  filterLinksByConfidence,
  formatLinkInfo,
  type LinkInfo,
  type LinksViewParams,
} from './links-view-presenter.js';

type LinksCommandDatabase = Awaited<ReturnType<CommandRuntime['database']>>;

async function fetchTransactionsForLinks(
  links: TransactionLink[],
  txRepo: LinksCommandDatabase['transactions'],
  profileId: number
): Promise<LinkWithTransactions[]> {
  const result: LinkWithTransactions[] = [];

  for (const link of links) {
    const sourceTxResult = await txRepo.findById(link.sourceTransactionId, profileId);
    const sourceTx = sourceTxResult.isOk() ? sourceTxResult.value : undefined;

    const targetTxResult = await txRepo.findById(link.targetTransactionId, profileId);
    const targetTx = targetTxResult.isOk() ? targetTxResult.value : undefined;

    result.push({
      link,
      sourceTransaction: sourceTx,
      targetTransaction: targetTx,
    });
  }

  return result;
}

type LinksViewCommandResult = ViewCommandResult<LinkInfo[]>;
type GapsViewCommandResult = ViewCommandResult<LinkGapIssue[]>;

export function registerLinksViewCommand(linksCommand: Command): void {
  linksCommand
    .command('view')
    .description('View transaction links with confidence scores')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links view                                # View all transaction links
  $ exitbook links view --status suggested             # View AI-suggested links
  $ exitbook links view --status confirmed             # View user-confirmed links
  $ exitbook links view --min-confidence 0.8           # View high-confidence links only
  $ exitbook links view --min-confidence 0.3 --max-confidence 0.7  # Medium confidence range
  $ exitbook links view --verbose                      # Include full transaction details

Common Usage:
  - Review deposit/withdrawal matching between exchanges and blockchains
  - Validate high-confidence automated matches before confirming
  - Investigate low-confidence matches that need manual review
  - Audit confirmed links for accuracy
  - Inspect link gap coverage separately with \`exitbook links gaps\`

Status Values:
  suggested   - Automatically detected by the system
  confirmed   - User-verified as correct
  rejected    - User-verified as incorrect

Confidence Scores:
  1.0  - Exact match (timestamp + amount + asset)
  0.8  - Very likely match (close timestamp, matching amount)
  0.5  - Possible match (similar timing, matching asset)
  <0.3 - Low confidence, needs manual review
`
    )
    .option('--status <status>', 'Filter by status (suggested, confirmed, rejected)')
    .option('--min-confidence <score>', 'Filter by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter by maximum confidence score (0-1)', parseFloat)
    .option('--verbose', 'Include full transaction details (asset, amount, addresses)')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksViewCommand(rawOptions);
    });
}

export function registerLinksGapsCommand(linksCommand: Command): void {
  linksCommand
    .command('gaps')
    .description('View transaction-link coverage gap analysis')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links gaps                   # View uncovered inflows and unmatched outflows
  $ exitbook links gaps --json            # Output gap analysis as JSON
`
    )
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksGapsCommand(rawOptions);
    });
}

async function executeLinksViewCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<LinksViewParams>({
    command: 'links-view',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, LinksViewCommandOptionsSchema);
        return {
          status: options.status,
          minConfidence: options.minConfidence,
          maxConfidence: options.maxConfidence,
          verbose: options.verbose,
        };
      }),
    action: async (context) => executeLinksViewCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeLinksGapsCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<void>({
    command: 'links-gaps',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        yield* parseCliCommandOptionsResult(rawOptions, LinksGapsCommandOptionsSchema);
        return;
      }),
    action: async (context) => executeLinksGapsCommandResult(context.runtime, format),
  });
}

async function executeLinksViewCommandResult(
  ctx: CommandRuntime,
  params: LinksViewParams,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const linksResult = yield* toCliResult(
      await database.transactionLinks.findAll({
        profileId: profile.id,
        status: params.status,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const filteredLinks =
      params.minConfidence !== undefined || params.maxConfidence !== undefined
        ? filterLinksByConfidence(linksResult, params.minConfidence, params.maxConfidence)
        : linksResult;

    const linksWithTransactions = await fetchTransactionsForLinks(filteredLinks, database.transactions, profile.id);

    if (format === 'json') {
      return buildLinksViewJsonCompletion(linksWithTransactions, params);
    }

    return yield* await buildLinksViewTuiCompletion(ctx, database, profile, linksWithTransactions, params);
  });
}

async function executeLinksGapsCommandResult(ctx: CommandRuntime, format: CliOutputFormat): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const analysis = yield* toCliResult(await loadLinksGapAnalysis(database, profile.id), ExitCodes.GENERAL_ERROR);

    if (format === 'json') {
      return buildLinksGapsJsonCompletion(analysis);
    }

    return yield* await buildLinksGapsTuiCompletion(ctx, analysis);
  });
}

function buildLinksViewJsonCompletion(
  linksWithTransactions: LinkWithTransactions[],
  params: LinksViewParams
): CliCompletion {
  const linkInfos = linksWithTransactions.map((item) => {
    const linkInfo = formatLinkInfo(item.link, item.sourceTransaction, item.targetTransaction);

    if (!params.verbose) {
      linkInfo.source_transaction = undefined;
      linkInfo.target_transaction = undefined;
    }

    return linkInfo;
  });

  const count = linkInfos.length;
  const resultData: LinksViewCommandResult = {
    data: linkInfos,
    meta: buildViewMeta(
      count,
      0,
      count,
      count,
      buildDefinedFilters({
        status: params.status,
        min_confidence: params.minConfidence,
        max_confidence: params.maxConfidence,
      })
    ),
  };

  return jsonSuccess(resultData);
}

async function buildLinksViewTuiCompletion(
  ctx: CommandRuntime,
  database: LinksCommandDatabase,
  profile: { id: number; profileKey: string },
  linksWithTransactions: LinkWithTransactions[],
  params: LinksViewParams
): Promise<Result<CliCompletion, CliFailure>> {
  const reviewHandler = new LinksReviewHandler(
    database as never,
    profile.id,
    profile.profileKey,
    new OverrideStore(ctx.dataDir)
  );
  const initialState = createLinksViewState(linksWithTransactions, params.status, params.verbose ?? false, undefined, {
    maxConfidence: params.maxConfidence,
    minConfidence: params.minConfidence,
  });

  try {
    await renderApp((unmount) =>
      React.createElement(LinksViewApp, {
        initialState,
        onAction: async (linkId, action) => {
          const result = await reviewHandler.execute({ linkId }, action);
          if (result.isErr()) {
            throw result.error;
          }

          return {
            affectedLinkIds: result.value.affectedLinkIds,
            newStatus: result.value.newStatus,
          };
        },
        onQuit: unmount,
      })
    );
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}

function buildLinksGapsJsonCompletion(analysis: ReturnType<typeof analyzeLinkGaps>): CliCompletion {
  const resultData: GapsViewCommandResult = {
    data: analysis.issues,
    meta: {
      count: analysis.issues.length,
      offset: 0,
      limit: analysis.issues.length,
      hasMore: false,
      filters: {
        total_issues: analysis.summary.total_issues,
        uncovered_inflows: analysis.summary.uncovered_inflows,
        unmatched_outflows: analysis.summary.unmatched_outflows,
        affected_assets: analysis.summary.affected_assets,
        assets: analysis.summary.assets,
      },
    },
  };

  return jsonSuccess(resultData);
}

async function buildLinksGapsTuiCompletion(
  ctx: CommandRuntime,
  analysis: ReturnType<typeof analyzeLinkGaps>
): Promise<Result<CliCompletion, CliFailure>> {
  try {
    await ctx.closeDatabase();

    const initialState = createGapsViewState(analysis);
    await renderApp((unmount) =>
      React.createElement(LinksViewApp, {
        initialState,
        onQuit: unmount,
      })
    );
  } catch (error) {
    return err(createCliFailure(error, ExitCodes.GENERAL_ERROR));
  }

  return ok(silentSuccess());
}

async function loadLinksGapAnalysis(
  database: LinksCommandDatabase,
  profileId: number
): Promise<Result<ReturnType<typeof analyzeLinkGaps>, Error>> {
  const transactionsResult = await database.transactions.findAll({ profileId });
  if (transactionsResult.isErr()) {
    return err(transactionsResult.error);
  }

  const linksResult = await database.transactionLinks.findAll({ profileId });
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  const accountsResult = await database.accounts.findAll({ profileId });
  if (accountsResult.isErr()) {
    return err(accountsResult.error);
  }

  return ok(
    analyzeLinkGaps(transactionsResult.value, linksResult.value, {
      accounts: accountsResult.value,
    })
  );
}
