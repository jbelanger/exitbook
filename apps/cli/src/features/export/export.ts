import { closeDatabase, initializeDatabase } from '@exitbook/data';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';
import { promptConfirm, handleCancellation } from '../shared/prompts.ts';

import { ExportHandler } from './export-handler.ts';
import { promptForExportParams } from './export-prompts.ts';
import type { ExportCommandOptions, ExportHandlerParams } from './export-utils.ts';
import { buildExportParamsFromFlags } from './export-utils.ts';

/**
 * Extended export command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedExportCommandOptions extends ExportCommandOptions {
  clearDb?: boolean | undefined;
  json?: boolean | undefined;
}

/**
 * Export command result data.
 */
interface ExportCommandResult {
  format: string;
  outputPath: string;
  sourceName?: string | undefined;
  transactionCount: number;
}

/**
 * Register the export command.
 */
export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export transactions to CSV or JSON')
    .option('--format <type>', 'Export format (csv|json)', 'csv')
    .option('--exchange <name>', 'Export from specific exchange only')
    .option('--blockchain <name>', 'Export from specific blockchain only')
    .option('--since <date>', 'Export transactions since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--output <file>', 'Output file path')
    .option('--clear-db', 'Clear and reinitialize database before export')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedExportCommandOptions) => {
      await executeExportCommand(options);
    });
}

/**
 * Execute the export command.
 */
async function executeExportCommand(options: ExtendedExportCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Detect mode: interactive vs flag
    const isInteractiveMode = !options.exchange && !options.blockchain && !options.format && !options.json;

    let params: ExportHandlerParams;

    if (isInteractiveMode) {
      // Interactive mode - use @clack/prompts
      output.intro('exitbook export');

      params = await promptForExportParams();

      // Confirm before proceeding
      const shouldProceed = await promptConfirm('Start export?', true);
      if (!shouldProceed) {
        handleCancellation('Export cancelled');
      }
    } else {
      // Flag mode or JSON mode - use provided options
      params = buildParamsFromFlags(options);
    }

    // Show spinner in text mode (auto-configures logger)
    const spinner = output.spinner();
    if (spinner) {
      spinner.start('Exporting transactions...');
    }

    let database;
    let handler;

    try {
      // Initialize database (logs will now go through spinner)
      database = await initializeDatabase(options.clearDb);

      // Create handler and execute
      handler = new ExportHandler(database);

      const result = await handler.execute(params);

      // Stop spinner (auto-resets logger context)
      if (spinner) {
        spinner.stop();
      }

      if (result.isErr()) {
        await closeDatabase(database);
        handler.destroy();
        output.error('export', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript doesn't know output.error never returns, so add explicit return
      }

      const exportResult = result.value;

      // Check if there are any transactions to export
      if (exportResult.transactionCount === 0) {
        await closeDatabase(database);
        handler.destroy();

        const sourceInfo = exportResult.sourceName ? ` from ${exportResult.sourceName}` : '';
        const message = `No transactions found${sourceInfo} to export`;

        if (output.isTextMode()) {
          output.outro('⚠️  No data to export');
        }

        output.warn(message);
        return;
      }

      // Write file
      await import('node:fs').then((fs) => fs.promises.writeFile(exportResult.outputPath, exportResult.content));

      // Prepare result data for JSON mode
      const resultData: ExportCommandResult = {
        transactionCount: exportResult.transactionCount,
        outputPath: exportResult.outputPath,
        format: exportResult.format,
      };

      if (exportResult.sourceName) {
        resultData.sourceName = exportResult.sourceName;
      }

      // Output success
      if (output.isTextMode()) {
        output.outro('✨ Export complete!');
        const sourceInfo = exportResult.sourceName ? ` from ${exportResult.sourceName}` : '';
        console.log(
          `\n💾 Exported ${exportResult.transactionCount} transactions${sourceInfo} to: ${exportResult.outputPath}`
        );
      }

      output.success('export', resultData);

      await closeDatabase(database);
      handler.destroy();
      process.exit(0);
    } catch (error) {
      if (handler) handler.destroy();
      if (database) await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    output.error('export', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Build export parameters from CLI flags.
 * Throws error for commander to handle.
 */
function buildParamsFromFlags(options: ExtendedExportCommandOptions): ExportHandlerParams {
  const result = buildExportParamsFromFlags(options);
  if (result.isErr()) {
    throw result.error; // Convert Result to throw for commander error handling
  }
  return result.value;
}
