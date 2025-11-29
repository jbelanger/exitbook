import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import {
  closeDatabase,
  initializeDatabase,
  TransactionRepository,
  TokenMetadataRepository,
  UserRepository,
  AccountRepository,
} from '@exitbook/data';
import {
  ImportOrchestrator,
  TransactionProcessService,
  RawDataRepository,
  DataSourceRepository,
  TokenMetadataService,
} from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import { createClackEmitter, runWithProgress, type ProgressEmitter } from '@exitbook/ui';
import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import type { ImportResult } from './import-handler.js';
import { ImportHandler } from './import-handler.js';
import { promptForImportParams } from './import-prompts.js';
import { buildImportParamsFromFlags, type ImportCommandOptions } from './import-utils.js';

/**
 * Extended import command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedImportCommandOptions extends ImportCommandOptions {
  json?: boolean | undefined;
}

/**
 * Import command result data.
 */
interface ImportCommandResult {
  imported: number;
  dataSourceId: number;
  processed?: number | undefined;
  processingErrors?: string[] | undefined;
}

const silentProgressEmitter: ProgressEmitter = {
  emit: () => {
    // Intentionally noop for JSON output mode
  },
};

/**
 * Register the import command.
 */
export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import raw data from external sources (blockchain or exchange)')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--csv-dir <path>', 'CSV directory for exchange sources')
    .option('--address <address>', 'Wallet address for blockchain source')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option('--api-key <key>', 'API key for exchange API access')
    .option('--api-secret <secret>', 'API secret for exchange API access')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange API access (if required)')
    .option('--process', 'Process data after import (combined import+process pipeline)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedImportCommandOptions) => {
      await executeImportCommand(options);
    });
}

/**
 * Execute the import command.
 */
async function executeImportCommand(options: ExtendedImportCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildImportParamsFromFlags(options)),
      cancelMessage: 'Import cancelled',
      commandName: 'import',
      confirmMessage: 'Start import?',
      isInteractive: !options.exchange && !options.blockchain && !options.json,
      output,
      promptFn: promptForImportParams,
    });

    // Configure logger
    configureLogger({
      mode: options.json ? 'json' : 'text',
      verbose: false, // TODO: Add --verbose flag support
    });

    // Create UI emitter and run with progress context
    const emitter = options.json ? silentProgressEmitter : createClackEmitter();
    const database = await initializeDatabase();

    // Initialize repositories
    const userRepository = new UserRepository(database);
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const dataSourceRepository = new DataSourceRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager();

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const importOrchestrator = new ImportOrchestrator(
      userRepository,
      accountRepository,
      rawDataRepository,
      dataSourceRepository,
      providerManager
    );
    const processService = new TransactionProcessService(
      rawDataRepository,
      dataSourceRepository,
      accountRepository,
      transactionRepository,
      tokenMetadataService
    );

    // Create handler (pass the provider manager so it uses the same instance and can clean it up)
    const handler = new ImportHandler(importOrchestrator, processService, providerManager);

    try {
      const result = await runWithProgress(emitter, async () => {
        return await handler.execute(params);
      });

      // Cleanup
      handler.destroy();
      await closeDatabase(database);
      resetLoggerContext();

      if (result.isErr()) {
        output.error('import', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      const summary = handleImportSuccess(output, result.value);
      if (output.isTextMode() && summary) {
        output.outro(summary);
      }
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      resetLoggerContext();
      output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
    }
  } catch (error) {
    resetLoggerContext();
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful import.
 */
function handleImportSuccess(output: OutputManager, importResult: ImportResult): string | undefined {
  // Prepare result data
  const resultData: ImportCommandResult = {
    dataSourceId: importResult.dataSourceId,
    imported: importResult.imported,
  };

  if (importResult.processed !== undefined) {
    resultData.processed = importResult.processed;
  }

  if (importResult.processingErrors && importResult.processingErrors.length > 0) {
    resultData.processingErrors = importResult.processingErrors.slice(0, 5); // First 5 errors
  }

  let summary: string | undefined;

  if (output.isTextMode()) {
    const summaryParts = [`Loaded ${importResult.imported} transactions`, `Session ${importResult.dataSourceId}`];

    if (importResult.processed !== undefined) {
      summaryParts.push(`Processed ${importResult.processed}`);
    }

    summary = summaryParts.join(' · ');

    if (importResult.processingErrors && importResult.processingErrors.length > 0) {
      output.note(importResult.processingErrors.slice(0, 5).join('\n'), 'First 5 errors');
    }
  }

  output.success('import', resultData);

  // Don't call process.exit(0) - it triggers clack's cancellation handler
  // The process will exit naturally
  return summary;
}
