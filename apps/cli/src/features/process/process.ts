import type { Command } from 'commander';

import { withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { ProcessResult } from './process-handler.ts';
import { ProcessHandler } from './process-handler.ts';

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

    const result = await withDatabaseAndHandler(ProcessHandler, {});

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
