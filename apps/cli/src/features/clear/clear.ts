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

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, promptConfirm } from '../shared/prompts.js';
import { ClearCommandOptionsSchema } from '../shared/schemas.js';

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
