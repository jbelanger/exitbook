import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  RawDataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { ClearService, type ClearResult, type DeletionPreview } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, promptConfirm } from '../shared/prompts.js';
import { ClearCommandOptionsSchema } from '../shared/schemas.js';

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
    const output = new OutputManager('text');
    const firstError = validationResult.error.issues[0];
    output.error('clear', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;

  // Check if we should use JSON mode or --confirm bypass
  const useJsonMode = options.json ?? false;
  const useConfirmBypass = options.confirm ?? false;

  // Use TUI unless JSON mode or --confirm bypass
  if (!useJsonMode && !useConfirmBypass) {
    executeClearTUI(options);
  } else {
    await executeClearLegacy(options);
  }
}

/**
 * Execute clear command with TUI
 */
function executeClearTUI(options: {
  accountId?: number | undefined;
  confirm?: boolean | undefined;
  includeRaw?: boolean | undefined;
  json?: boolean | undefined;
  source?: string | undefined;
}): void {
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;
  let database: Awaited<ReturnType<typeof initializeDatabase>> | undefined;

  // Configure logger for TUI mode (suppress logs)
  configureLogger({
    mode: 'text',
    verbose: false,
    sinks: { ui: false, structured: 'file' },
  });

  try {
    (async () => {
      try {
        // Initialize database and repositories
        database = await initializeDatabase();
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

        // Build service params
        const params = {
          accountId: options.accountId,
          source: options.source,
          includeRaw: options.includeRaw ?? false,
        };

        // Pre-fetch both preview scenarios in parallel
        const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
          clearService.previewDeletion({ ...params, includeRaw: false }),
          clearService.previewDeletion({ ...params, includeRaw: true }),
        ]);

        if (previewWithoutRawResult.isErr()) {
          await closeDatabase(database);
          console.error(`\n⚠ Error: ${previewWithoutRawResult.error.message}`);
          process.exit(ExitCodes.GENERAL_ERROR);
        }

        if (previewWithRawResult.isErr()) {
          await closeDatabase(database);
          console.error(`\n⚠ Error: ${previewWithRawResult.error.message}`);
          process.exit(ExitCodes.GENERAL_ERROR);
        }

        const previewWithoutRaw = previewWithoutRawResult.value;
        const previewWithRaw = previewWithRawResult.value;

        // Build scope label
        const scopeLabel = await buildScopeLabel(options.accountId, options.source, accountRepository);

        // Create initial state
        const initialState = createClearViewState(
          { accountId: options.accountId, source: options.source, label: scopeLabel },
          previewWithRaw,
          previewWithoutRaw,
          options.includeRaw ?? false
        );

        // Render TUI
        inkInstance = render(
          React.createElement(ClearViewApp, {
            initialState,
            clearService,
            params,
            onQuit: () => {
              (async () => {
                if (database) {
                  await closeDatabase(database);
                }
                if (inkInstance) {
                  inkInstance.unmount();
                }
                process.exit(0);
              })().catch((error: unknown) => {
                console.error('Error during cleanup:', error instanceof Error ? error.message : String(error));
                process.exit(1);
              });
            },
          })
        );
      } catch (error) {
        if (database) {
          await closeDatabase(database);
        }
        console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
        if (inkInstance) {
          try {
            inkInstance.unmount();
          } catch {
            /* ignore unmount errors */
          }
        }
        process.exit(ExitCodes.GENERAL_ERROR);
      }
    })().catch((error: unknown) => {
      console.error('Unhandled error in clear command:', error instanceof Error ? error.message : String(error));
      process.exit(ExitCodes.GENERAL_ERROR);
    });
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
    process.exit(ExitCodes.GENERAL_ERROR);
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
async function executeClearLegacy(options: {
  accountId?: number | undefined;
  confirm?: boolean | undefined;
  includeRaw?: boolean | undefined;
  json?: boolean | undefined;
  source?: string | undefined;
}): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');
  const includeRaw = options.includeRaw ?? false;

  try {
    // Initialize database and repositories once
    const database = await initializeDatabase();
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

    try {
      // Preview deletion
      const previewResult = await clearService.previewDeletion({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      if (previewResult.isErr()) {
        await closeDatabase(database);
        output.error('clear', previewResult.error, ExitCodes.GENERAL_ERROR);
        return;
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
        await closeDatabase(database);
        if (output.isTextMode()) {
          console.error('No data to clear.');
        } else {
          output.json('clear', { deleted: preview });
        }
        return;
      }

      // Show preview and confirm (skip in JSON mode with no data, or if --confirm flag is set)
      const shouldConfirm = !options.confirm && !options.json;
      if (shouldConfirm) {
        if (output.isTextMode()) {
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
          await closeDatabase(database);
          handleCancellation('Clear cancelled');
        }
      }

      const spinner = output.spinner();
      spinner?.start('Clearing data...');

      configureLogger({
        mode: options.json ? 'json' : 'text',
        spinner: spinner || undefined,
        verbose: false,
        sinks: options.json
          ? { ui: false, structured: 'file' }
          : spinner
            ? { ui: true, structured: 'off' }
            : { ui: false, structured: 'stdout' },
      });

      // Execute deletion
      const result = await clearService.execute({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      await closeDatabase(database);
      resetLoggerContext();

      if (result.isErr()) {
        spinner?.stop('Clear failed');
        output.error('clear', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleClearSuccess(output, result.value, spinner);
    } catch (error) {
      await closeDatabase(database);
      resetLoggerContext();
      throw error;
    }
  } catch (error) {
    resetLoggerContext();
    output.error('clear', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful clear.
 */
function handleClearSuccess(
  output: OutputManager,
  clearResult: ClearResult,
  spinner: ReturnType<OutputManager['spinner']>
): void {
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

  spinner?.stop(completionMessage);

  output.json('clear', resultData);
}
