import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import {
  AccountRepository,
  ImportSessionRepository,
  RawDataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { ClearService, type ClearResult, type DeletionPreview } from '@exitbook/ingestion';
import type { Command } from 'commander';
import React from 'react';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { handleCancellation, promptConfirm } from '../shared/prompts.js';
import { ClearCommandOptionsSchema } from '../shared/schemas.js';
import { createSpinner, stopSpinner, type SpinnerWrapper } from '../shared/spinner.js';

import { ClearViewApp, createClearViewState } from './components/index.js';

/**
 * Clear command result data.
 */
interface ClearCommandResult {
  deleted: DeletionPreview;
}

/**
 * Register the clear command.
 */
export function registerClearCommand(program: Command): void {
  program
    .command('clear')
    .description('Clear processed data (keeps raw data by default for reprocessing)')
    .option('--account-id <id>', 'Clear data for specific account ID', parseInt)
    .option('--source <name>', 'Clear data for all accounts with this source name')
    .option('--include-raw', 'Also clear raw imported data (WARNING: requires re-import)')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeClearCommand(rawOptions);
    });
}

/**
 * Execute the clear command.
 */
async function executeClearCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary with Zod
  const validationResult = ClearCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    displayCliError('clear', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR, 'text');
  }

  const options = validationResult.data;

  // Check if we should use JSON mode or --confirm bypass
  const useJsonMode = options.json ?? false;
  const useConfirmBypass = options.confirm ?? false;

  // Use TUI unless JSON mode or --confirm bypass
  if (!useJsonMode && !useConfirmBypass) {
    await executeClearTUI(options);
  } else {
    await executeClearNonTui(options);
  }
}

/**
 * Execute clear command with TUI
 */
async function executeClearTUI(options: {
  accountId?: number | undefined;
  confirm?: boolean | undefined;
  includeRaw?: boolean | undefined;
  json?: boolean | undefined;
  source?: string | undefined;
}): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const userRepository = new UserRepository(database);
      const accountRepository = new AccountRepository(database);
      const transactionRepository = new TransactionRepository(database);
      const transactionLinkRepository = new TransactionLinkRepository(database);
      const costBasisRepository = new CostBasisRepository(database);
      const lotTransferRepository = new LotTransferRepository(database);
      const rawDataRepository = new RawDataRepository(database);
      const importSessionRepository = new ImportSessionRepository(database);

      const clearService = new ClearService(
        userRepository,
        accountRepository,
        transactionRepository,
        transactionLinkRepository,
        costBasisRepository,
        lotTransferRepository,
        rawDataRepository,
        importSessionRepository
      );

      const params = {
        accountId: options.accountId,
        source: options.source,
        includeRaw: options.includeRaw ?? false,
      };

      const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
        clearService.previewDeletion({ ...params, includeRaw: false }),
        clearService.previewDeletion({ ...params, includeRaw: true }),
      ]);

      if (previewWithoutRawResult.isErr()) {
        console.error(`\n⚠ Error: ${previewWithoutRawResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (previewWithRawResult.isErr()) {
        console.error(`\n⚠ Error: ${previewWithRawResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const previewWithoutRaw = previewWithoutRawResult.value;
      const previewWithRaw = previewWithRawResult.value;

      const scopeLabel = await buildScopeLabel(options.accountId, options.source, accountRepository);

      const initialState = createClearViewState(
        { accountId: options.accountId, source: options.source, label: scopeLabel },
        previewWithRaw,
        previewWithoutRaw,
        options.includeRaw ?? false
      );

      await renderApp((unmount) =>
        React.createElement(ClearViewApp, {
          initialState,
          clearService,
          params,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'clear',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Build scope label from account ID or source
 */
async function buildScopeLabel(
  accountId: number | undefined,
  source: string | undefined,
  accountRepo: AccountRepository
): Promise<string> {
  if (accountId) {
    const accountResult = await accountRepo.findById(accountId);
    if (accountResult.isOk() && accountResult.value) {
      return `#${accountId} ${accountResult.value.sourceName}`;
    }
    return `#${accountId}`;
  }
  if (source) {
    return `(${source})`;
  }
  return 'all accounts';
}

/**
 * Execute clear command in legacy mode (JSON or --confirm bypass)
 */
async function executeClearNonTui(options: {
  accountId?: number | undefined;
  confirm?: boolean | undefined;
  includeRaw?: boolean | undefined;
  json?: boolean | undefined;
  source?: string | undefined;
}): Promise<void> {
  const includeRaw = options.includeRaw ?? false;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const userRepository = new UserRepository(database);
      const accountRepository = new AccountRepository(database);
      const transactionRepository = new TransactionRepository(database);
      const transactionLinkRepository = new TransactionLinkRepository(database);
      const costBasisRepository = new CostBasisRepository(database);
      const lotTransferRepository = new LotTransferRepository(database);
      const rawDataRepository = new RawDataRepository(database);
      const importSessionRepository = new ImportSessionRepository(database);

      const clearService = new ClearService(
        userRepository,
        accountRepository,
        transactionRepository,
        transactionLinkRepository,
        costBasisRepository,
        lotTransferRepository,
        rawDataRepository,
        importSessionRepository
      );

      // Preview deletion
      const previewResult = await clearService.previewDeletion({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      if (previewResult.isErr()) {
        displayCliError('clear', previewResult.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      const preview = previewResult.value;

      // Check if there's anything to delete
      const totalToDelete =
        preview.accounts +
        preview.transactions +
        preview.links +
        preview.lots +
        preview.disposals +
        preview.transfers +
        preview.calculations;
      if (totalToDelete === 0 && (!includeRaw || (preview.sessions === 0 && preview.rawData === 0))) {
        if (!options.json) {
          console.error('No data to clear.');
        } else {
          outputSuccess('clear', { deleted: preview });
        }
        return;
      }

      // Show preview and confirm (skip in JSON mode with no data, or if --confirm flag is set)
      const shouldConfirm = !options.confirm && !options.json;
      if (shouldConfirm) {
        if (!options.json) {
          console.error('\nThis will clear:');
          if (preview.accounts > 0) console.error(`  • ${preview.accounts} accounts`);
          if (preview.transactions > 0) console.error(`  • ${preview.transactions} transactions`);
          if (preview.links > 0) console.error(`  • ${preview.links} transaction links`);
          if (preview.lots > 0) console.error(`  • ${preview.lots} acquisition lots`);
          if (preview.disposals > 0) console.error(`  • ${preview.disposals} lot disposals`);
          if (preview.transfers > 0) console.error(`  • ${preview.transfers} lot transfers`);
          if (preview.calculations > 0) console.error(`  • ${preview.calculations} cost basis calculations`);

          if (includeRaw) {
            console.error('\n⚠️  WARNING: Raw data will also be deleted:');
            if (preview.sessions > 0) console.error(`  • ${preview.sessions} import sessions`);
            if (preview.rawData > 0) console.error(`  • ${preview.rawData} raw data items`);
            console.error('\n⚠️  You will need to re-import from exchanges/blockchains (slow, rate-limited).');
          } else {
            console.error('\nRaw imported data will be preserved:');
            if (preview.sessions > 0) console.error(`  • ${preview.sessions} sessions`);
            if (preview.rawData > 0) console.error(`  • ${preview.rawData} raw data items`);
            console.error(
              '\nYou can reprocess with: exitbook process' + (options.source ? ` --source ${options.source}` : '')
            );
          }
          console.error('');
        }

        const confirmMessage = includeRaw ? 'Delete ALL data including raw imports?' : 'Clear processed data?';
        const shouldProceed = await promptConfirm(confirmMessage, false);
        if (!shouldProceed) {
          handleCancellation('Clear cancelled');
        }
      }

      const spinner = createSpinner('Clearing data...', options.json ?? false);

      // Execute deletion
      const result = await clearService.execute({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      if (result.isErr()) {
        stopSpinner(spinner);
        displayCliError('clear', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleClearSuccess(result.value, spinner, options.json ?? false);
    });
  } catch (error) {
    displayCliError(
      'clear',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

/**
 * Handle successful clear.
 */
function handleClearSuccess(clearResult: ClearResult, spinner: SpinnerWrapper | undefined, isJsonMode: boolean): void {
  const resultData: ClearCommandResult = {
    deleted: clearResult.deleted,
  };

  const parts: string[] = [];
  if (clearResult.deleted.accounts > 0) parts.push(`${clearResult.deleted.accounts} accounts`);
  if (clearResult.deleted.transactions > 0) parts.push(`${clearResult.deleted.transactions} transactions`);
  if (clearResult.deleted.links > 0) parts.push(`${clearResult.deleted.links} links`);
  if (clearResult.deleted.lots > 0) parts.push(`${clearResult.deleted.lots} lots`);
  if (clearResult.deleted.disposals > 0) parts.push(`${clearResult.deleted.disposals} disposals`);
  if (clearResult.deleted.transfers > 0) parts.push(`${clearResult.deleted.transfers} transfers`);
  if (clearResult.deleted.rawData > 0) parts.push(`${clearResult.deleted.rawData} raw items`);
  if (clearResult.deleted.sessions > 0) parts.push(`${clearResult.deleted.sessions} sessions`);

  const completionMessage =
    parts.length > 0 ? `Clear complete - ${parts.join(', ')}` : 'Clear complete - no data deleted';

  stopSpinner(spinner, completionMessage);

  if (isJsonMode) {
    outputSuccess('clear', resultData);
  }
}
