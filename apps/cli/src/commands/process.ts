import { closeDatabase, initializeDatabase } from '@exitbook/data';
import type { Command } from 'commander';

import { ProcessHandler, type ProcessHandlerParams } from '../handlers/process-handler.js';
import { ExitCodes } from '../lib/exit-codes.js';
import { OutputManager } from '../lib/output.js';
import { promptForProcessParams } from '../lib/process-prompts.js';
import { buildProcessParamsFromFlags, type ProcessCommandOptions } from '../lib/process-utils.js';
import { handleCancellation, promptConfirm } from '../lib/prompts.js';

/**
 * Extended process command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedProcessCommandOptions extends ProcessCommandOptions {
  clearDb?: boolean | undefined;
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
    .description('Transform raw imported data to universal transaction format')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin, ledgerlive)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--session <id>', 'Import session ID to process')
    .option('--since <date>', 'Process data since date (YYYY-MM-DD or timestamp)')
    .option('--all', 'Process all pending raw data for this source')
    .option('--clear-db', 'Clear and reinitialize database before processing')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedProcessCommandOptions) => {
      await executeProcessCommand(options);
    });
}

/**
 * Execute the process command.
 */
async function executeProcessCommand(options: ExtendedProcessCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Detect mode: interactive vs flag
    const isInteractiveMode = !options.exchange && !options.blockchain && !options.json;

    let params: ProcessHandlerParams;

    if (isInteractiveMode) {
      // Interactive mode - use @clack/prompts
      output.intro('exitbook process');

      params = await promptForProcessParams();

      // Confirm before proceeding
      const shouldProceed = await promptConfirm('Start processing?', true);
      if (!shouldProceed) {
        handleCancellation('Processing cancelled');
      }
    } else {
      // Flag mode or JSON mode - use provided options
      params = buildParamsFromFlags(options);
    }

    // Initialize database
    const database = await initializeDatabase(options.clearDb);

    // Create handler and execute
    const handler = new ProcessHandler(database);

    try {
      // Show spinner in text mode
      const spinner = output.spinner();
      if (spinner) {
        spinner.start('Processing data...');
      }

      const result = await handler.execute(params);

      if (spinner) {
        spinner.stop(result.isOk() ? 'Processing complete' : 'Processing failed');
      }

      if (result.isErr()) {
        await closeDatabase(database);
        handler.destroy();
        output.error('process', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript doesn't know output.error never returns, so add explicit return
      }

      const processResult = result.value;

      // Prepare result data
      const resultData: ProcessCommandResult = {
        processed: processResult.processed,
        errors: processResult.errors.slice(0, 5), // First 5 errors
      };

      // Output success
      if (output.isTextMode()) {
        // Display friendly message in text mode
        output.outro(`✨ Processing complete!`);
        output.log(`\n✅ Processed: ${processResult.processed} transactions`);

        if (processResult.errors.length > 0) {
          output.warn(`\n⚠️  Processing errors: ${processResult.errors.length}`);
          output.note(processResult.errors.slice(0, 5).join('\n'), 'First 5 errors');
        }
      }

      output.success('process', resultData);

      await closeDatabase(database);
      handler.destroy();
      process.exit(0);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    output.error('process', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Build process parameters from CLI flags.
 * Throws error for commander to handle.
 */
function buildParamsFromFlags(options: ExtendedProcessCommandOptions): ProcessHandlerParams {
  const result = buildProcessParamsFromFlags(options);
  if (result.isErr()) {
    throw result.error; // Convert Result to throw for commander error handling
  }
  return result.value;
}
