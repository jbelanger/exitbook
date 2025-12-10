import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import {
  closeDatabase,
  initializeDatabase,
  TransactionRepository,
  TokenMetadataRepository,
  AccountRepository,
  RawDataRepository,
} from '@exitbook/data';
import { TransactionProcessService, TokenMetadataService } from '@exitbook/ingestion';
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
 * Register the process command.
 */
export function registerProcessCommand(program: Command): void {
  program
    .command('process')
    .description('Process all pending raw data from all sources')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeProcessCommand(rawOptions);
    });
}

/**
 * Execute the process command.
 */
async function executeProcessCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary with Zod
  const validationResult = ProcessCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('process', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();

    if (spinner) {
      spinner.start('Processing all pending data...');
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
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager(undefined);

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const processService = new TransactionProcessService(
      rawDataRepository,
      accountRepository,
      transactionRepository,
      tokenMetadataService
    );

    // Create handler
    const handler = new ProcessHandler(processService, providerManager);

    const result = await handler.execute({});

    // Cleanup
    handler.destroy();
    await closeDatabase(database);
    resetLoggerContext();

    spinner?.stop();

    if (result.isErr()) {
      output.error('process', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleProcessSuccess(output, result.value);
  } catch (error) {
    resetLoggerContext();
    output.error('process', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful processing.
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
    output.outro('✨ Processing complete!');
    console.log(`\n✅ Processed: ${processResult.processed} transactions`);

    if (processResult.errors.length > 0) {
      console.log(`\n⚠️  Processing errors: ${processResult.errors.length}`);
      output.note(processResult.errors.slice(0, 5).join('\n'), 'First 5 errors');
    }
  }

  output.json('process', resultData);
  process.exit(0);
}
