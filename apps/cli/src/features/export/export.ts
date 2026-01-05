import { TransactionLinkRepository } from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { resolveCommandParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ExportCommandOptionsSchema } from '../shared/schemas.js';

import type { ExportResult } from './export-handler.js';
import { ExportHandler } from './export-handler.js';
import { promptForExportParams } from './export-prompts.js';
import { buildExportParamsFromFlags } from './export-utils.js';

/**
 * Export command options validated by Zod at CLI boundary
 */
export type ExportCommandOptions = z.infer<typeof ExportCommandOptionsSchema>;

/**
 * Export command result data.
 */
interface ExportCommandResult {
  format: string;
  outputPaths: string[];
  csvFormat?: string | undefined;
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
    .option('--csv-format <type>', 'CSV format (normalized|simple)')
    .option('--exchange <name>', 'Export from specific exchange only')
    .option('--blockchain <name>', 'Export from specific blockchain only')
    .option('--since <date>', 'Export transactions since date (YYYY-MM-DD, timestamp, or 0 for all history)')
    .option('--output <file>', 'Output file path')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeExportCommand(rawOptions);
    });
}

/**
 * Execute the export command.
 */
async function executeExportCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary with Zod
  const validationResult = ExportCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('export', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;
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

    // Configure logger if no spinner (JSON mode) or if spinner exists (text mode)
    if (spinner) {
      // Spinner will configure logger via its start() method
    } else {
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false,
        sinks: options.json ? { ui: false, structured: 'file' } : { ui: false, structured: 'stdout' },
      });
    }

    const database = await initializeDatabase();
    const transactionRepository = new TransactionRepository(database);
    const transactionLinkRepository = new TransactionLinkRepository(database);
    const handler = new ExportHandler(transactionRepository, transactionLinkRepository);

    try {
      const result = await handler.execute(params);

      handler.destroy();
      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('export', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript needs this even though output.error never returns
      }

      await handleExportSuccess(output, result.value);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      spinner?.stop('Export failed');
      resetLoggerContext();
      throw error;
    }
  } catch (error) {
    resetLoggerContext();
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

  // Write files
  await import('node:fs').then((fs) =>
    Promise.all(exportResult.outputs.map((output) => fs.promises.writeFile(output.path, output.content)))
  );

  // Prepare result data for JSON mode
  const resultData: ExportCommandResult = {
    transactionCount: exportResult.transactionCount,
    outputPaths: exportResult.outputs.map((output) => output.path),
    format: exportResult.format,
    csvFormat: exportResult.csvFormat,
  };

  if (exportResult.sourceName) {
    resultData.sourceName = exportResult.sourceName;
  }

  // Output success
  if (output.isTextMode()) {
    output.outro('✨ Export complete!');
    const sourceInfo = exportResult.sourceName ? ` from ${exportResult.sourceName}` : '';
    const outputSummary =
      exportResult.outputs.length === 1
        ? exportResult.outputs[0]?.path
        : exportResult.outputs.map((output) => output.path).join('\n   - ');

    console.log(`\n💾 Exported ${exportResult.transactionCount} transactions${sourceInfo} to:\n   - ${outputSummary}`);
  }

  output.json('export', resultData);
  process.exit(0);
}
