// Command registration for links view subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { LinksViewApp, createLinksViewState, type LinkWithTransactions } from '../../ui/links/index.js';
import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksViewCommandOptionsSchema } from '../shared/schemas.js';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.js';

import { LinksConfirmHandler } from './links-confirm-handler.js';
import { LinksRejectHandler } from './links-reject-handler.js';
import type { LinkInfo, LinksViewParams, LinksViewResult } from './links-view-utils.js';
import { filterLinksByConfidence, formatLinkInfo } from './links-view-utils.js';

/**
 * Command options validated by Zod at CLI boundary
 */
export type LinksViewCommandOptions = z.infer<typeof LinksViewCommandOptionsSchema>;

/**
 * Result data for links view command (JSON mode).
 */
type LinksViewCommandResult = ViewCommandResult<LinkInfo[]>;

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
  $ exitbook links view --min-confidence 0.8           # View high-confidence links only
  $ exitbook links view --min-confidence 0.3 --max-confidence 0.7  # Medium confidence range
  $ exitbook links view --verbose                      # Include full transaction details
  $ exitbook links view --limit 20                     # View latest 20 links

Common Usage:
  - Review deposit/withdrawal matching between exchanges and blockchains
  - Validate high-confidence automated matches before confirming
  - Investigate low-confidence matches that need manual review
  - Audit confirmed links for accuracy

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

  // Build params from validated options
  const params: LinksViewParams = {
    status: options.status,
    minConfidence: options.minConfidence,
    maxConfidence: options.maxConfidence,
    limit: options.limit ?? 50,
    verbose: options.verbose,
  };

  // Configure logger
  configureLogger({
    mode: isJsonMode ? 'json' : 'text',
    verbose: options.verbose ?? false,
    sinks: isJsonMode ? { ui: false, structured: 'file' } : { ui: false, structured: 'file' },
  });

  // JSON mode uses OutputManager for structured output
  if (isJsonMode) {
    await executeLinksViewJSON(params);
    resetLoggerContext();
    return;
  }

  // Text mode uses Ink for everything (loading, data, errors)
  await executeLinksViewTUI(params);
  resetLoggerContext();
}

/**
 * Execute links view in TUI mode (text mode, no JSON)
 * Uses Ink for all UI including loading states and errors
 */
async function executeLinksViewTUI(params: LinksViewParams): Promise<void> {
  const { initializeDatabase, closeDatabase, TransactionRepository, OverrideStore } = await import('@exitbook/data');
  const { TransactionLinkRepository } = await import('@exitbook/accounting');

  let database: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  try {
    // Initialize database and repositories
    database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = new TransactionRepository(database);
    const overrideStore = new OverrideStore();

    // Fetch and process links
    const linksResult = await linkRepo.findAll(params.status);
    if (linksResult.isErr()) {
      throw linksResult.error;
    }

    let links = linksResult.value;

    // Apply filters
    if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
      links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
    }

    // Capture total before limiting
    const totalCount = links.length;

    if (params.limit !== undefined && params.limit > 0) {
      links = links.slice(0, params.limit);
    }

    // Fetch transaction details
    const linksWithTransactions: LinkWithTransactions[] = [];
    for (const link of links) {
      let sourceTx;
      let targetTx;

      const sourceTxResult = await txRepo.findById(link.sourceTransactionId);
      if (sourceTxResult.isOk() && sourceTxResult.value) {
        sourceTx = sourceTxResult.value;
      }

      const targetTxResult = await txRepo.findById(link.targetTransactionId);
      if (targetTxResult.isOk() && targetTxResult.value) {
        targetTx = targetTxResult.value;
      }

      linksWithTransactions.push({
        link,
        sourceTransaction: sourceTx,
        targetTransaction: targetTx,
      });
    }

    // Create handlers for confirm/reject actions
    const confirmHandler = new LinksConfirmHandler(linkRepo, txRepo, overrideStore);
    const rejectHandler = new LinksRejectHandler(linkRepo, txRepo, overrideStore);

    const handleAction = async (linkId: string, action: 'confirm' | 'reject'): Promise<void> => {
      if (action === 'confirm') {
        const result = await confirmHandler.execute({ linkId });
        if (result.isErr()) {
          throw result.error;
        }
      } else {
        const result = await rejectHandler.execute({ linkId });
        if (result.isErr()) {
          throw result.error;
        }
      }
    };

    // Create initial state
    const initialState = createLinksViewState(
      linksWithTransactions,
      params.status,
      params.verbose ?? false,
      totalCount
    );

    // Render TUI
    await new Promise<void>((resolve, reject) => {
      inkInstance = render(
        React.createElement(LinksViewApp, {
          initialState,
          onAction: handleAction,
          onQuit: () => {
            if (inkInstance) {
              inkInstance.unmount();
            }
          },
        })
      );

      // Wait for TUI to exit
      inkInstance.waitUntilExit().then(resolve).catch(reject);
    });

    // Clean up
    if (database) {
      await closeDatabase(database);
    }
  } catch (error) {
    // Show error in console (Ink already unmounted or failed to render)
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));

    // Clean up
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore unmount errors */
      }
    }
    if (database) {
      await closeDatabase(database);
    }

    process.exit(ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Execute links view in JSON mode
 * Uses OutputManager for structured output
 */
async function executeLinksViewJSON(params: LinksViewParams): Promise<void> {
  const output = new OutputManager('json');

  const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
  const { TransactionLinkRepository } = await import('@exitbook/accounting');

  let database: Awaited<ReturnType<typeof initializeDatabase>> | undefined;

  try {
    database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = new TransactionRepository(database);

    // Fetch links
    const linksResult = await linkRepo.findAll(params.status);
    if (linksResult.isErr()) {
      await closeDatabase(database);
      output.error('links-view', linksResult.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    let links = linksResult.value;

    // Apply filters
    if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
      links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
    }

    if (params.limit !== undefined && params.limit > 0) {
      links = links.slice(0, params.limit);
    }

    // Format links with transaction details
    const linkInfos: LinkInfo[] = [];
    for (const link of links) {
      let sourceTx;
      let targetTx;

      const sourceTxResult = await txRepo.findById(link.sourceTransactionId);
      if (sourceTxResult.isOk() && sourceTxResult.value) {
        sourceTx = sourceTxResult.value;
      }

      const targetTxResult = await txRepo.findById(link.targetTransactionId);
      if (targetTxResult.isOk() && targetTxResult.value) {
        targetTx = targetTxResult.value;
      }

      const linkInfo = formatLinkInfo(link, sourceTx, targetTx);

      // Remove full transaction details if not in verbose mode
      if (!params.verbose) {
        linkInfo.source_transaction = undefined;
        linkInfo.target_transaction = undefined;
      }

      linkInfos.push(linkInfo);
    }

    // Build result
    const result: LinksViewResult = {
      links: linkInfos,
      count: linkInfos.length,
    };

    await closeDatabase(database);

    // Output JSON
    handleLinksViewJSON(output, result, params);
  } catch (error) {
    if (database) {
      await closeDatabase(database);
    }
    output.error('links-view', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle links view JSON output.
 */
function handleLinksViewJSON(output: OutputManager, result: LinksViewResult, params: LinksViewParams): void {
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

  output.json('links-view', resultData);
}
