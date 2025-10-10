import { closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';
import { promptConfirm, handleCancellation } from '../shared/prompts.ts';

import type { ImportHandlerParams } from './import-handler.ts';
import { ImportHandler } from './import-handler.ts';
import { promptForImportParams } from './import-prompts.ts';
import { buildImportParamsFromFlags, type ImportCommandOptions } from './import-utils.ts';

/**
 * Extended import command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedImportCommandOptions extends ImportCommandOptions {
  clearDb?: boolean | undefined;
  json?: boolean | undefined;
  since?: string | undefined;
  until?: string | undefined;
}

/**
 * Import command result data.
 */
interface ImportCommandResult {
  imported: number;
  importSessionId: number;
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
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin, ledgerlive)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--csv-dir <path>', 'CSV directory for exchange sources')
    .option('--address <address>', 'Wallet address for blockchain source')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option('--api-key <key>', 'API key for exchange API access')
    .option('--api-secret <secret>', 'API secret for exchange API access')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange API access (if required)')
    .option('--since <date>', 'Import data since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--until <date>', 'Import data until date (YYYY-MM-DD or timestamp)')
    .option('--process', 'Process data after import (combined import+process pipeline)')
    .option('--clear-db', 'Clear and reinitialize database before import')
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
    // Detect mode: interactive vs flag
    const isInteractiveMode = !options.exchange && !options.blockchain && !options.json;

    let params: ImportHandlerParams;

    if (isInteractiveMode) {
      // Interactive mode - use @clack/prompts
      output.intro('exitbook import');

      params = await promptForImportParams();

      // Confirm before proceeding
      const shouldProceed = await promptConfirm('Start import?', true);
      if (!shouldProceed) {
        handleCancellation('Import cancelled');
      }
    } else {
      // Flag mode or JSON mode - use provided options
      params = buildParamsFromFlags(options);
    }

    // Show starting message and spinner in text mode
    if (output.isTextMode()) {
      if (!isInteractiveMode) {
        // Flag mode: show simple message
        console.error(`Importing from ${params.sourceName}...`);
      }
      // Interactive mode: already within clack flow, no extra message needed
    }

    const spinner = output.spinner();
    if (spinner) {
      spinner.start('Importing data...');
    }

    // Configure logger to route logs to spinner
    configureLogger({
      spinner: spinner || undefined,
      mode: options.json ? 'json' : 'text',
      verbose: false, // TODO: Add --verbose flag support
    });

    // Initialize database (after spinner starts so logs appear indented)
    const database = await initializeDatabase(options.clearDb);

    // Create handler and execute
    const handler = new ImportHandler(database);

    try {
      const result = await handler.execute(params);

      // Reset logger context after command completes
      resetLoggerContext();

      if (result.isErr()) {
        if (spinner) {
          spinner.stop('Import failed');
        }
        await closeDatabase(database);
        handler.destroy();
        output.error('import', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript doesn't know output.error never returns, so add explicit return
      }

      const importResult = result.value;

      // Prepare result data
      const resultData: ImportCommandResult = {
        importSessionId: importResult.importSessionId,
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
      parts.push(`session: ${importResult.importSessionId}`);
      const completionMessage = `Import complete - ${parts.join(', ')}`;

      // Stop spinner with completion message
      if (spinner) {
        spinner.stop(completionMessage);
      }

      // Output success
      if (output.isTextMode()) {
        // In interactive mode, spinner.stop() already showed the message with ◇
        // In flag mode, spinner.stop() also showed the message
        // Just show outro in interactive mode for visual closure
        if (isInteractiveMode) {
          output.outro(`✨ Done!`);
        }

        if (importResult.processingErrors && importResult.processingErrors.length > 0) {
          console.error(`⚠️  ${importResult.processingErrors.length} processing errors`);
        }
      }

      output.success('import', resultData);

      await closeDatabase(database);
      handler.destroy();
      // Don't call process.exit(0) - it triggers clack's cancellation handler
      // The process will exit naturally
    } catch (error) {
      resetLoggerContext(); // Clean up logger context on error
      handler.destroy();
      await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    resetLoggerContext(); // Clean up logger context on error
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Build import parameters from CLI flags.
 * Throws error for commander to handle.
 */
function buildParamsFromFlags(options: ExtendedImportCommandOptions): ImportHandlerParams {
  const result = buildImportParamsFromFlags(options);
  if (result.isErr()) {
    throw result.error; // Convert Result to throw for commander error handling
  }
  return result.value;
}
