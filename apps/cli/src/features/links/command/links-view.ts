// Command registration for links view subcommand
import type { LinkStatus } from '@exitbook/core';
import type { Transaction, TransactionLink } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildDefinedFilters, buildViewMeta, type ViewCommandResult } from '../../shared/view-utils.js';
import type { LinkGapIssue } from '../links-gap-model.js';
import type { LinkWithTransactions } from '../links-view-model.js';
import { LinksViewApp, createGapsViewState, createLinksViewState } from '../view/index.js';

import { analyzeLinkGaps } from './links-gap-analysis.js';
import { LinksGapsCommandOptionsSchema, LinksViewCommandOptionsSchema } from './links-option-schemas.js';
import { LinksReviewHandler } from './links-review-handler.js';
import type { LinkInfo, LinksViewParams, LinksViewResult } from './links-view-utils.js';
import { filterLinksByConfidence, formatLinkInfo } from './links-view-utils.js';

/**
 * Fetch transactions for a list of links.
 */
async function fetchTransactionsForLinks(
  links: TransactionLink[],
  txRepo: { findById: (id: number, profileId?: number) => Promise<Result<Transaction | undefined, Error>> },
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

/**
 * Result data for links view command (JSON mode).
 */
type LinksViewCommandResult = ViewCommandResult<LinkInfo[]>;

/**
 * Result data for gaps view command (JSON mode).
 */
type GapsViewCommandResult = ViewCommandResult<LinkGapIssue[]>;
interface LinksCommandParams extends LinksViewParams {
  profile?: string | undefined;
}

interface LinksGapsCommandParams {
  profile?: string | undefined;
}

/**
 * Register the links view subcommand.
 */
export function registerLinksViewCommand(linksCommand: Command): void {
  linksCommand
    .command('view')
    .description('View transaction links with confidence scores')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links view                                # View all transaction links
  $ exitbook links view --profile business             # View links for one profile
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
    .option('--profile <name>', 'Use a specific profile instead of the active profile')
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
  $ exitbook links gaps --profile audit   # Scope gap analysis to one profile
  $ exitbook links gaps --json            # Output gap analysis as JSON
`
    )
    .option('--profile <name>', 'Use a specific profile instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksGapsCommand(rawOptions);
    });
}

/**
 * Execute the links view command.
 */
async function executeLinksViewCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('links-view', rawOptions, LinksViewCommandOptionsSchema);
  const params: LinksCommandParams = {
    profile: options.profile,
    status: options.status,
    minConfidence: options.minConfidence,
    maxConfidence: options.maxConfidence,
    verbose: options.verbose,
  };

  if (format === 'json') {
    await executeLinksViewJSON(params);
    return;
  }

  await executeLinksViewTUI(params);
}

async function executeLinksGapsCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('links-gaps', rawOptions, LinksGapsCommandOptionsSchema);
  const params: LinksGapsCommandParams = {
    profile: options.profile,
  };
  if (format === 'json') {
    await executeGapsViewJSON(params);
    return;
  }

  await executeGapsViewTUI(params);
}

/**
 * Execute links view in TUI mode (text mode, no JSON)
 */
async function executeLinksViewTUI(params: LinksCommandParams): Promise<void> {
  const { OverrideStore } = await import('@exitbook/data/overrides');

  await withCliCommandErrorHandling('links-view', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        console.error('\n⚠ Error:', profileResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const linkRepo = database.transactionLinks;
      const txRepo = database.transactions;
      const overrideStore = new OverrideStore(ctx.dataDir);

      const linksResult = await linkRepo.findAll({ profileId: profileResult.value.id });
      if (linksResult.isErr()) {
        console.error('\n⚠ Error:', linksResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const linksWithTransactions: LinkWithTransactions[] = await fetchTransactionsForLinks(
        linksResult.value,
        txRepo,
        profileResult.value.id
      );

      const reviewHandler = new LinksReviewHandler(database, profileResult.value.id, overrideStore);

      const handleAction = async (
        linkId: number,
        action: 'confirm' | 'reject'
      ): Promise<{ affectedLinkIds: number[]; newStatus: 'confirmed' | 'rejected' }> => {
        const result = await reviewHandler.execute({ linkId }, action);
        if (result.isErr()) {
          throw result.error;
        }

        return {
          affectedLinkIds: result.value.affectedLinkIds,
          newStatus: result.value.newStatus,
        };
      };

      const initialState = createLinksViewState(
        linksWithTransactions,
        params.status as LinkStatus,
        params.verbose ?? false,
        undefined,
        {
          maxConfidence: params.maxConfidence,
          minConfidence: params.minConfidence,
        }
      );

      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState,
          onAction: handleAction,
          onQuit: unmount,
        })
      );
    });
  });
}

/**
 * Execute gaps view in TUI mode (read-only)
 */
async function executeGapsViewTUI(params: LinksGapsCommandParams): Promise<void> {
  await withCliCommandErrorHandling('links-gaps', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        console.error('\n⚠ Error:', profileResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const txRepo = database.transactions;
      const linkRepo = database.transactionLinks;
      const accountRepo = database.accounts;

      const transactionsResult = await txRepo.findAll({ profileId: profileResult.value.id });
      if (transactionsResult.isErr()) {
        console.error('\n⚠ Error:', transactionsResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const linksResult = await linkRepo.findAll({ profileId: profileResult.value.id });
      if (linksResult.isErr()) {
        console.error('\n⚠ Error:', linksResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const accountsResult = await accountRepo.findAll({ profileId: profileResult.value.id });
      if (accountsResult.isErr()) {
        console.error('\n⚠ Error:', accountsResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const analysis = analyzeLinkGaps(transactionsResult.value, linksResult.value, {
        accounts: accountsResult.value,
      });

      await ctx.closeDatabase();

      const initialState = createGapsViewState(analysis);

      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState,
          onQuit: unmount,
        })
      );
    });
  });
}

/**
 * Execute links view in JSON mode
 */
async function executeLinksViewJSON(params: LinksCommandParams): Promise<void> {
  await withCliCommandErrorHandling('links-view', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        displayCliError('links-view', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const linkRepo = database.transactionLinks;
      const txRepo = database.transactions;

      const linksResult = await linkRepo.findAll({
        profileId: profileResult.value.id,
        status: params.status,
      });
      if (linksResult.isErr()) {
        displayCliError('links-view', linksResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      let links = linksResult.value;

      if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
        links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
      }

      const linksWithTransactions = await fetchTransactionsForLinks(links, txRepo, profileResult.value.id);
      const linkInfos: LinkInfo[] = linksWithTransactions.map((item) => {
        const linkInfo = formatLinkInfo(item.link, item.sourceTransaction, item.targetTransaction);

        if (!params.verbose) {
          linkInfo.source_transaction = undefined;
          linkInfo.target_transaction = undefined;
        }

        return linkInfo;
      });

      const result: LinksViewResult = {
        links: linkInfos,
        count: linkInfos.length,
      };

      handleLinksViewJSON(result, params);
    });
  });
}

/**
 * Execute gaps view in JSON mode
 */
async function executeGapsViewJSON(params: LinksGapsCommandParams): Promise<void> {
  await withCliCommandErrorHandling('links-gaps', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        displayCliError('links-gaps', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const txRepo = database.transactions;
      const linkRepo = database.transactionLinks;
      const accountRepo = database.accounts;

      const transactionsResult = await txRepo.findAll({ profileId: profileResult.value.id });
      if (transactionsResult.isErr()) {
        displayCliError('links-gaps', transactionsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const linksResult = await linkRepo.findAll({ profileId: profileResult.value.id });
      if (linksResult.isErr()) {
        displayCliError('links-gaps', linksResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const accountsResult = await accountRepo.findAll({ profileId: profileResult.value.id });
      if (accountsResult.isErr()) {
        displayCliError('links-gaps', accountsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const analysis = analyzeLinkGaps(transactionsResult.value, linksResult.value, {
        accounts: accountsResult.value,
      });

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

      outputSuccess('links-gaps', resultData);
    });
  });
}

/**
 * Handle links view JSON output.
 */
function handleLinksViewJSON(result: LinksViewResult, params: LinksCommandParams): void {
  const { links, count } = result;

  const resultData: LinksViewCommandResult = {
    data: links,
    meta: buildViewMeta(
      count,
      0,
      count,
      count,
      buildDefinedFilters({
        profile: params.profile,
        status: params.status,
        min_confidence: params.minConfidence,
        max_confidence: params.maxConfidence,
      })
    ),
  };

  outputSuccess('links-view', resultData);
}
