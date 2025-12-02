import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import {
  closeDatabase,
  initializeDatabase,
  TransactionRepository,
  TokenMetadataRepository,
  AccountRepository,
} from '@exitbook/data';
import {
  TransactionProcessService,
  RawDataRepository,
  ImportSessionRepository,
  TokenMetadataService,
} from '@exitbook/ingestion';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import type { ProcessResult } from './process-handler.js';
import { ProcessHandler } from './process-handler.js';

/**
 * Process command options.
 */
export interface ProcessCommandOptions {
  json?: boolean | undefined;
}

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ProcessCommandOptions) => {
      await executeProcessCommand(options);
    });
}

/**
 * Execute the process command.
 */
async function executeProcessCommand(options: ProcessCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();
    spinner?.start('Processing all pending data...');

    const database = await initializeDatabase();

    // Initialize repositories
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const importSessionRepository = new ImportSessionRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager(undefined);

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const processService = new TransactionProcessService(
      rawDataRepository,
      importSessionRepository,
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

    spinner?.stop();

    if (result.isErr()) {
      output.error('process', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleProcessSuccess(output, result.value);
  } catch (error) {
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

  output.success('process', resultData);
  process.exit(0);
}
