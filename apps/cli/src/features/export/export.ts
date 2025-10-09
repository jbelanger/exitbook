import { closeDatabase, initializeDatabase } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';
import { promptConfirm, handleCancellation } from '../shared/prompts.ts';

import { ExportHandler } from './export-handler.ts';
import { promptForExportParams } from './export-prompts.ts';
import type { ExportCommandOptions, ExportHandlerParams } from './export-utils.ts';
import { buildExportParamsFromFlags } from './export-utils.ts';

const logger = getLogger('ExportCommand');

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

    // Initialize database
    const database = await initializeDatabase(options.clearDb);

    // Create handler and execute
    const handler = new ExportHandler(database);

    try {
      // Show spinner in text mode
      const spinner = output.spinner();
      if (spinner) {
        spinner.start('Exporting transactions...');
      }

      const result = await handler.execute(params);

      if (spinner) {
        spinner.stop(result.isOk() ? 'Export complete' : 'Export failed');
      }

      if (result.isErr()) {
        await closeDatabase(database);
        handler.destroy();
        output.error('export', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript doesn't know output.error never returns, so add explicit return
      }

      const exportResult = result.value;

      // Write file
      await import('node:fs').then((fs) => fs.promises.writeFile(exportResult.outputPath, exportResult.content));

      // Display results in text mode
      if (output.isTextMode()) {
        const sourceInfo = exportResult.sourceName ? ` from ${exportResult.sourceName}` : '';
        logger.info(
          `\n💾 Exported ${exportResult.transactionCount} transactions${sourceInfo} to: ${exportResult.outputPath}`
        );
      }

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
        output.outro(`✨ Export complete!`);
      }

      output.success('export', resultData);

      await closeDatabase(database);
      handler.destroy();
      process.exit(0);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
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
