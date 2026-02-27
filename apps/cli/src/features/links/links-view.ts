// Command registration for links view subcommand
import type { LinkStatus, TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import type { Command } from 'commander';
import type { Result } from 'neverthrow';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { LinksViewCommandOptionsSchema } from '../shared/schemas.js';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.js';

import {
  LinksViewApp,
  createGapsViewState,
  createLinksViewState,
  type LinkWithTransactions,
} from './components/index.js';
import { LinksConfirmHandler } from './links-confirm-handler.js';
import type { LinkGapIssue } from './links-gap-utils.js';
import { analyzeLinkGaps } from './links-gap-utils.js';
import { LinksRejectHandler } from './links-reject-handler.js';
import type { LinkInfo, LinksViewParams, LinksViewResult } from './links-view-utils.js';
import { filterLinksByConfidence, formatLinkInfo } from './links-view-utils.js';

/**
 * Fetch transactions for a list of links.
 */
async function fetchTransactionsForLinks(
  links: TransactionLink[],
  txRepo: { findById: (id: number) => Promise<Result<UniversalTransactionData | undefined, Error>> }
): Promise<LinkWithTransactions[]> {
  const result: LinkWithTransactions[] = [];

  for (const link of links) {
    const sourceTxResult = await txRepo.findById(link.sourceTransactionId);
    const sourceTx = sourceTxResult.isOk() ? sourceTxResult.value : undefined;

    const targetTxResult = await txRepo.findById(link.targetTransactionId);
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
 * Command options validated by Zod at CLI boundary
 */
export type LinksViewCommandOptions = z.infer<typeof LinksViewCommandOptionsSchema>;

/**
 * Result data for links view command (JSON mode).
 */
type LinksViewCommandResult = ViewCommandResult<LinkInfo[]>;

/**
 * Result data for gaps view command (JSON mode).
 */
type GapsViewCommandResult = ViewCommandResult<LinkGapIssue[]>;

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
  $ exitbook links view --status suggested             # View AI-suggested links
  $ exitbook links view --status confirmed             # View user-confirmed links
  $ exitbook links view --status gaps                  # View coverage gap analysis
  $ exitbook links view --min-confidence 0.8           # View high-confidence links only
  $ exitbook links view --min-confidence 0.3 --max-confidence 0.7  # Medium confidence range
  $ exitbook links view --verbose                      # Include full transaction details
  $ exitbook links view --limit 20                     # View latest 20 links

Common Usage:
  - Review deposit/withdrawal matching between exchanges and blockchains
  - Validate high-confidence automated matches before confirming
  - Investigate low-confidence matches that need manual review
  - Audit confirmed links for accuracy
  - Identify uncovered inflows and unmatched outflows (gaps mode)

Status Values:
  suggested   - Automatically detected by the system
  confirmed   - User-verified as correct
  rejected    - User-verified as incorrect
  gaps        - Coverage gap analysis (read-only)

Confidence Scores:
  1.0  - Exact match (timestamp + amount + asset)
  0.8  - Very likely match (close timestamp, matching amount)
  0.5  - Possible match (similar timing, matching asset)
  <0.3 - Low confidence, needs manual review
`
    )
    .option('--status <status>', 'Filter by status (suggested, confirmed, rejected, gaps)')
    .option('--min-confidence <score>', 'Filter by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter by maximum confidence score (0-1)', parseFloat)
    .option('--limit <number>', 'Maximum number of links to return', parseInt)
    .option('--verbose', 'Include full transaction details (asset, amount, addresses)')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksViewCommand(rawOptions);
    });
}

/**
 * Execute the links view command.
 */
async function executeLinksViewCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = LinksViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;
  const isGapsMode = options.status === 'gaps';

  // Build params from validated options
  const params: LinksViewParams = {
    status: options.status,
    minConfidence: options.minConfidence,
    maxConfidence: options.maxConfidence,
    limit: options.limit ?? 50,
    verbose: options.verbose,
  };

  // JSON mode uses structured output functions
  if (isJsonMode) {
    if (isGapsMode) {
      await executeGapsViewJSON(params);
    } else {
      await executeLinksViewJSON(params);
    }

    return;
  }

  // Text mode uses Ink for everything (loading, data, errors)
  if (isGapsMode) {
    await executeGapsViewTUI(params);
  } else {
    await executeLinksViewTUI(params);
  }
}

/**
 * Execute links view in TUI mode (text mode, no JSON)
 */
async function executeLinksViewTUI(params: LinksViewParams): Promise<void> {
  const { createTransactionQueries, createTransactionLinkQueries, OverrideStore } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const linkRepo = createTransactionLinkQueries(database);
      const txRepo = createTransactionQueries(database);
      const overrideStore = new OverrideStore(ctx.dataDir);

      const linksResult = await linkRepo.findAll(params.status as LinkStatus);
      if (linksResult.isErr()) {
        console.error('\n⚠ Error:', linksResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      let links = linksResult.value;

      if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
        links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
      }

      const totalCount = links.length;

      if (params.limit !== undefined && params.limit > 0) {
        links = links.slice(0, params.limit);
      }

      const linksWithTransactions: LinkWithTransactions[] = await fetchTransactionsForLinks(links, txRepo);

      const confirmHandler = new LinksConfirmHandler(database, overrideStore);
      const rejectHandler = new LinksRejectHandler(database, overrideStore);

      const handleAction = async (linkId: number, action: 'confirm' | 'reject'): Promise<void> => {
        if (action === 'confirm') {
          const result = await confirmHandler.execute({ linkId });
          if (result.isErr()) {
            console.error('\n⚠ Error:', result.error.message);
          }
        } else {
          const result = await rejectHandler.execute({ linkId });
          if (result.isErr()) {
            console.error('\n⚠ Error:', result.error.message);
          }
        }
      };

      const initialState = createLinksViewState(
        linksWithTransactions,
        params.status as LinkStatus,
        params.verbose ?? false,
        totalCount
      );

      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState,
          onAction: handleAction,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'links-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute gaps view in TUI mode (read-only)
 */
async function executeGapsViewTUI(params: LinksViewParams): Promise<void> {
  const { createTransactionQueries, createTransactionLinkQueries } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const linkRepo = createTransactionLinkQueries(database);

      const transactionsResult = await txRepo.getTransactions();
      if (transactionsResult.isErr()) {
        console.error('\n⚠ Error:', transactionsResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const linksResult = await linkRepo.findAll();
      if (linksResult.isErr()) {
        console.error('\n⚠ Error:', linksResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const analysis = analyzeLinkGaps(transactionsResult.value, linksResult.value);

      await ctx.closeDatabase();

      if (params.limit !== undefined && params.limit > 0 && analysis.issues.length > params.limit) {
        analysis.issues = analysis.issues.slice(0, params.limit);
      }

      const initialState = createGapsViewState(analysis);

      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'links-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute links view in JSON mode
 */
async function executeLinksViewJSON(params: LinksViewParams): Promise<void> {
  const { createTransactionQueries, createTransactionLinkQueries } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const linkRepo = createTransactionLinkQueries(database);
      const txRepo = createTransactionQueries(database);

      const linksResult = await linkRepo.findAll(params.status as LinkStatus);
      if (linksResult.isErr()) {
        displayCliError('links-view', linksResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      let links = linksResult.value;

      if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
        links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
      }

      if (params.limit !== undefined && params.limit > 0) {
        links = links.slice(0, params.limit);
      }

      const linksWithTransactions = await fetchTransactionsForLinks(links, txRepo);
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
  } catch (error) {
    displayCliError(
      'links-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

/**
 * Execute gaps view in JSON mode
 */
async function executeGapsViewJSON(params: LinksViewParams): Promise<void> {
  const { createTransactionQueries, createTransactionLinkQueries } = await import('@exitbook/data');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const txRepo = createTransactionQueries(database);
      const linkRepo = createTransactionLinkQueries(database);

      const transactionsResult = await txRepo.getTransactions();
      if (transactionsResult.isErr()) {
        displayCliError('links-view', transactionsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const linksResult = await linkRepo.findAll();
      if (linksResult.isErr()) {
        displayCliError('links-view', linksResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const analysis = analyzeLinkGaps(transactionsResult.value, linksResult.value);

      let issues = analysis.issues;
      if (params.limit !== undefined && params.limit > 0) {
        issues = issues.slice(0, params.limit);
      }

      const resultData: GapsViewCommandResult = {
        data: issues,
        meta: {
          count: issues.length,
          offset: 0,
          limit: params.limit ?? 50,
          hasMore: issues.length < analysis.summary.total_issues,
          filters: {
            total_issues: analysis.summary.total_issues,
            uncovered_inflows: analysis.summary.uncovered_inflows,
            unmatched_outflows: analysis.summary.unmatched_outflows,
            affected_assets: analysis.summary.affected_assets,
            assets: analysis.summary.assets,
          },
        },
      };

      outputSuccess('links-view', resultData);
    });
  } catch (error) {
    displayCliError(
      'links-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

/**
 * Handle links view JSON output.
 */
function handleLinksViewJSON(result: LinksViewResult, params: LinksViewParams): void {
  const { links, count } = result;

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.status) filters['status'] = params.status;
  if (params.minConfidence !== undefined) filters['min_confidence'] = params.minConfidence;
  if (params.maxConfidence !== undefined) filters['max_confidence'] = params.maxConfidence;

  const resultData: LinksViewCommandResult = {
    data: links,
    meta: buildViewMeta(count, 0, params.limit || 50, count, filters),
  };

  outputSuccess('links-view', resultData);
}
