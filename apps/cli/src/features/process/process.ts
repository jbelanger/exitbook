import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { ProcessResult } from './process-handler.ts';
import { ProcessHandler } from './process-handler.ts';
import { promptForProcessParams } from './process-prompts.ts';
import type { ProcessCommandOptions } from './process-utils.ts';
import { buildProcessParamsFromFlags } from './process-utils.ts';

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
    const params = await resolveCommandParams({
      isInteractive: !options.exchange && !options.blockchain && !options.json,
      output,
      commandName: 'process',
      promptFn: promptForProcessParams,
      buildFromFlags: () => unwrapResult(buildProcessParamsFromFlags(options)),
      confirmMessage: 'Start processing?',
      cancelMessage: 'Processing cancelled',
    });

    const spinner = output.spinner();
    spinner?.start('Processing data...');

    const result = await withDatabaseAndHandler({ clearDb: options.clearDb }, ProcessHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('process', result.error, ExitCodes.GENERAL_ERROR);
      return; // TypeScript needs this even though output.error never returns
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
