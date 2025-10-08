import { closeDatabase, initializeDatabase } from '@exitbook/data';
import type { Command } from 'commander';

import { ImportHandler, type ImportHandlerParams } from '../handlers/import-handler.js';
import { ExitCodes } from '../lib/exit-codes.js';
import { promptForImportParams } from '../lib/import-prompts.js';
import { buildImportParamsFromFlags, type ImportCommandOptions } from '../lib/import-utils.js';
import { OutputManager } from '../lib/output.js';
import { handleCancellation, promptConfirm } from '../lib/prompts.js';

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

    // Initialize database
    const database = await initializeDatabase(options.clearDb);

    // Create handler and execute
    const handler = new ImportHandler(database);

    try {
      // Show spinner in text mode
      const spinner = output.spinner();
      if (spinner) {
        spinner.start('Importing data...');
      }

      const result = await handler.execute(params);

      if (spinner) {
        spinner.stop(result.isOk() ? 'Import complete' : 'Import failed');
      }

      if (result.isErr()) {
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

      // Output success
      if (output.isTextMode()) {
        // Display friendly message in text mode
        output.outro(`✨ Import complete!`);
        output.log(`\n📊 Imported: ${importResult.imported} items`);
        output.log(`🔑 Session ID: ${importResult.importSessionId}`);

        if (importResult.processed !== undefined) {
          output.log(`✅ Processed: ${importResult.processed} transactions`);
        }

        if (importResult.processingErrors && importResult.processingErrors.length > 0) {
          output.warn(`\n⚠️  Processing errors: ${importResult.processingErrors.length}`);
          output.note(importResult.processingErrors.slice(0, 5).join('\n'), 'First 5 errors');
        }
      }

      output.success('import', resultData);

      await closeDatabase(database);
      handler.destroy();
      process.exit(0);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Build import parameters from CLI flags using pure function.
 * Throws error for commander to handle.
 */
function buildParamsFromFlags(options: ExtendedImportCommandOptions): ImportHandlerParams {
  const result = buildImportParamsFromFlags(options);
  if (result.isErr()) {
    throw result.error; // Convert Result to throw for commander error handling
  }
  return result.value;
}
