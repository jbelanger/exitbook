import type { ClearResult, DeletionPreview } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, promptConfirm } from '../shared/prompts.js';
import { ClearCommandOptionsSchema } from '../shared/schemas.js';

import { ClearHandler } from './clear-handler.js';
import { buildClearParamsFromFlags } from './clear-utils.js';

/**
 * Clear command options validated by Zod at CLI boundary
 */
export type ClearCommandOptions = z.infer<typeof ClearCommandOptionsSchema>;

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

  try {
    const params = unwrapResult(buildClearParamsFromFlags(options));

    // Create service and handler to preview deletion
    const {
      initializeDatabase,
      closeDatabase,
      UserRepository: UserRepo,
      TransactionRepository: TxRepo,
      AccountRepository: AcctRepo,
      RawDataRepository: RDRepo,
      ImportSessionRepository: DSRepo,
    } = await import('@exitbook/data');
    const {
      TransactionLinkRepository: TLRepo,
      CostBasisRepository: CBRepo,
      LotTransferRepository: LTRepo,
    } = await import('@exitbook/accounting');
    const { ClearService } = await import('@exitbook/ingestion');

    const database = await initializeDatabase();
    const previewUserRepo = new UserRepo(database);
    const acctRepo = new AcctRepo(database);
    const txRepo = new TxRepo(database);
    const tlRepo = new TLRepo(database);
    const cbRepo = new CBRepo(database);
    const ltRepo = new LTRepo(database);
    const rdRepo = new RDRepo(database);
    const dsRepo = new DSRepo(database);

    const clearService = new ClearService(previewUserRepo, acctRepo, txRepo, tlRepo, cbRepo, ltRepo, rdRepo, dsRepo);
    const handler = new ClearHandler(clearService);

    const previewResult = await handler.previewDeletion(params);
    handler.destroy();
    await closeDatabase(database);

    if (previewResult.isErr()) {
      output.error('clear', previewResult.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    const preview = previewResult.value;

    // Check if there's anything to delete
    const totalToDelete =
      preview.transactions +
      preview.links +
      preview.lots +
      preview.disposals +
      preview.transfers +
      preview.calculations;
    if (totalToDelete === 0 && (!params.includeRaw || (preview.sessions === 0 && preview.rawData === 0))) {
      if (output.isTextMode()) {
        console.error('No data to clear.');
      } else {
        output.success('clear', { deleted: preview });
      }
      return;
    }

    // Show preview and confirm (skip in JSON mode with no data, or if --confirm flag is set)
    const shouldConfirm = !options.confirm && !options.json;
    if (shouldConfirm) {
      if (output.isTextMode()) {
        console.error('\nThis will clear:');
        if (preview.transactions > 0) console.error(`  • ${preview.transactions} transactions`);
        if (preview.links > 0) console.error(`  • ${preview.links} transaction links`);
        if (preview.lots > 0) console.error(`  • ${preview.lots} acquisition lots`);
        if (preview.disposals > 0) console.error(`  • ${preview.disposals} lot disposals`);
        if (preview.transfers > 0) console.error(`  • ${preview.transfers} lot transfers`);
        if (preview.calculations > 0) console.error(`  • ${preview.calculations} cost basis calculations`);

        if (params.includeRaw) {
          console.error('\n⚠️  WARNING: Raw data will also be deleted:');
          if (preview.sessions > 0) console.error(`  • ${preview.sessions} import sessions`);
          if (preview.rawData > 0) console.error(`  • ${preview.rawData} raw data items`);
          console.error('\n⚠️  You will need to re-import from exchanges/blockchains (slow, rate-limited).');
        } else {
          console.error('\nRaw imported data will be preserved:');
          if (preview.sessions > 0) console.error(`  • ${preview.sessions} sessions`);
          if (preview.rawData > 0) console.error(`  • ${preview.rawData} raw data items`);
          console.error(
            '\nYou can reprocess with: exitbook process' + (params.source ? ` --source ${params.source}` : '')
          );
        }
        console.error('');
      }

      const confirmMessage = params.includeRaw ? 'Delete ALL data including raw imports?' : 'Clear processed data?';
      const shouldProceed = await promptConfirm(confirmMessage, false);
      if (!shouldProceed) {
        handleCancellation('Clear cancelled');
      }
    }

    const spinner = output.spinner();
    spinner?.start('Clearing data...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize database, repositories, and service
    const {
      initializeDatabase: initDb,
      closeDatabase: closeDb,
      UserRepository,
      TransactionRepository,
      AccountRepository,
      RawDataRepository,
      ImportSessionRepository,
    } = await import('@exitbook/data');
    const { TransactionLinkRepository, CostBasisRepository, LotTransferRepository } = await import(
      '@exitbook/accounting'
    );
    const { ClearService: ClearSvc } = await import('@exitbook/ingestion');

    const db = await initDb();
    const userRepo = new UserRepository(db);
    const accountRepo = new AccountRepository(db);
    const transactionRepo = new TransactionRepository(db);
    const transactionLinkRepo = new TransactionLinkRepository(db);
    const costBasisRepo = new CostBasisRepository(db);
    const lotTransferRepo = new LotTransferRepository(db);
    const rawDataRepo = new RawDataRepository(db);
    const sessionRepo = new ImportSessionRepository(db);

    const clearSvc = new ClearSvc(
      userRepo,
      accountRepo,
      transactionRepo,
      transactionLinkRepo,
      costBasisRepo,
      lotTransferRepo,
      rawDataRepo,
      sessionRepo
    );
    const clearHandler = new ClearHandler(clearSvc);

    const result = await clearHandler.execute(params);
    clearHandler.destroy();
    await closeDb(db);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Clear failed');
      output.error('clear', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleClearSuccess(output, result.value, spinner);
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

  output.success('clear', resultData);
}
