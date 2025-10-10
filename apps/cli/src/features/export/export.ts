import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { ExportResult } from './export-handler.ts';
import { ExportHandler } from './export-handler.ts';
import { promptForExportParams } from './export-prompts.ts';
import type { ExportCommandOptions } from './export-utils.ts';
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
    const params = await resolveCommandParams({
      isInteractive: !options.exchange && !options.blockchain && !options.format && !options.json,
      output,
      commandName: 'export',
      promptFn: promptForExportParams,
      buildFromFlags: () => unwrapResult(buildExportParamsFromFlags(options)),
      confirmMessage: 'Start export?',
      cancelMessage: 'Export cancelled',
    });

    const spinner = output.spinner();
    spinner?.start('Exporting transactions...');

    const result = await withDatabaseAndHandler({ clearDb: options.clearDb }, ExportHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('export', result.error, ExitCodes.GENERAL_ERROR);
      return; // TypeScript needs this even though output.error never returns
    }

    await handleExportSuccess(output, result.value);
  } catch (error) {
    output.error('export', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful export.
 */
async function handleExportSuccess(output: OutputManager, exportResult: ExportResult): Promise<void> {
  // Check if there are any transactions to export
  if (exportResult.transactionCount === 0) {
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
  process.exit(0);
}
