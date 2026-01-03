import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import {
  closeDatabase,
  initializeDatabase,
  TransactionRepository,
  TokenMetadataRepository,
  AccountRepository,
  RawDataRepository,
  ImportSessionRepository,
  UserRepository,
} from '@exitbook/data';
import { ClearService, TransactionProcessService, TokenMetadataService } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ProcessCommandOptionsSchema } from '../shared/schemas.js';

import type { ProcessResult } from './process-handler.js';
import { ProcessHandler } from './process-handler.js';

/**
 * Process command options validated by Zod at CLI boundary
 */
export type ProcessCommandOptions = z.infer<typeof ProcessCommandOptionsSchema>;

/**
 * Process command result data.
 */
interface ProcessCommandResult {
  errors: string[];
  processed: number;
}

/**
 * Register the reprocess command.
 */
export function registerReprocessCommand(program: Command): void {
  program
    .command('reprocess')
    .description('Clear all derived data and reprocess from raw data')
    .option('--account-id <id>', 'Reprocess only a specific account ID')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeReprocessCommand(rawOptions);
    });
}

/**
 * Execute the reprocess command.
 */
async function executeReprocessCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary with Zod
  const validationResult = ProcessCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('reprocess', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  output.intro('ExitBook | Reprocess transactions');

  try {
    const spinner = output.spinner();

    if (spinner) {
      spinner.start('Processing raw provider data...');
    } else {
      // Configure logger for JSON mode
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false,
        sinks: options.json
          ? { ui: false, structured: 'file' }
          : {
              ui: false,
              structured: 'stdout',
            },
      });
    }

    const database = await initializeDatabase();

    // Initialize repositories
    const userRepository = new UserRepository(database);
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);
    const importSessionRepository = new ImportSessionRepository(database);
    const transactionLinkRepository = new TransactionLinkRepository(database);
    const costBasisRepository = new CostBasisRepository(database);
    const lotTransferRepository = new LotTransferRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager(undefined);

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const transactionProcessService = new TransactionProcessService(
      rawDataRepository,
      accountRepository,
      transactionRepository,
      providerManager,
      tokenMetadataService,
      importSessionRepository
    );
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

    // Create handler
    const handler = new ProcessHandler(transactionProcessService, providerManager, clearService);

    const result = await handler.execute({
      accountId: options.accountId,
    });

    // Cleanup
    handler.destroy();
    await closeDatabase(database);
    resetLoggerContext();

    spinner?.stop();

    if (result.isErr()) {
      output.error('reprocess', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleProcessSuccess(output, result.value);
  } catch (error) {
    resetLoggerContext();
    output.error('reprocess', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful reprocessing.
 */
function handleProcessSuccess(output: OutputManager, processResult: ProcessResult): void {
  // Prepare result data
  const resultData: ProcessCommandResult = {
    processed: processResult.processed,
    errors: processResult.errors.slice(0, 5), // First 5 errors
  };

  // Output success
  if (output.isTextMode()) {
    // Display friendly outro and stats
    output.outro(`Done. ${processResult.processed} transactions generated.`);

    if (processResult.errors.length > 0) {
      console.log(`\n⚠️  Processing errors: ${processResult.errors.length}`);
      output.note(processResult.errors.slice(0, 5).join('\n'), 'First 5 errors');
    }
  } else {
    output.json('reprocess', resultData);
  }
}
