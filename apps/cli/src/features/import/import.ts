import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.js';
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
    const isInteractive = !options.exchange && !options.blockchain && !options.json;

    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildImportParamsFromFlags(options)),
      cancelMessage: 'Import cancelled',
      commandName: 'import',
      confirmMessage: 'Start import?',
      isInteractive,
      output,
      promptFn: promptForImportParams,
    });

    // Show starting message in flag mode
    if (output.isTextMode() && !isInteractive) {
      console.error(`Importing from ${params.sourceName}...`);
    }

    const spinner = output.spinner();
    spinner?.start('Importing data...');

    // Configure logger to route logs to spinner
    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false, // TODO: Add --verbose flag support
    });

    const result = await withDatabaseAndHandler(ImportHandler, params);

    // Reset logger context after command completes
    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Import failed');
      output.error('import', result.error, ExitCodes.GENERAL_ERROR);
      return; // TypeScript needs this even though output.error never returns
    }

    handleImportSuccess(output, result.value, isInteractive, spinner);
  } catch (error) {
    resetLoggerContext(); // Clean up logger context on error
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful import.
 */
function handleImportSuccess(
  output: OutputManager,
  importResult: ImportResult,
  isInteractive: boolean,
  spinner: ReturnType<OutputManager['spinner']>
): void {
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

  // Build completion message
  const parts: string[] = [`${importResult.imported} items`];
  if (importResult.processed !== undefined) {
    parts.push(`${importResult.processed} processed`);
  }
  parts.push(`session: ${importResult.dataSourceId}`);
  const completionMessage = `Import complete - ${parts.join(', ')}`;

  // Stop spinner with completion message
  spinner?.stop(completionMessage);

  // Output success
  if (output.isTextMode()) {
    // In interactive mode, show outro for visual closure
    if (isInteractive) {
      output.outro(`✨ Done!`);
    }

    if (importResult.processingErrors && importResult.processingErrors.length > 0) {
      console.error(`⚠️  ${importResult.processingErrors.length} processing errors`);
    }
  }

  output.success('import', resultData);

  // Don't call process.exit(0) - it triggers clack's cancellation handler
  // The process will exit naturally
}
