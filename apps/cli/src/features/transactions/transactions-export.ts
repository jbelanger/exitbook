// Command registration for transactions export subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';

import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { writeFilesAtomically } from '../shared/file-utils.js';
import { OutputManager } from '../shared/output.js';
import { TransactionsExportCommandOptionsSchema } from '../shared/schemas.js';

/**
 * JSON output shape for transactions export.
 */
interface TransactionsExportCommandResult {
  data: {
    csvFormat?: string | undefined;
    format: string;
    outputPaths: string[];
    transactionCount: number;
  };
}

/**
 * Register the transactions export subcommand.
 */
export function registerTransactionsExportCommand(transactionsCommand: Command): void {
  transactionsCommand
    .command('export')
    .description('Export all transactions to CSV or JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions export                                # Export all transactions as normalized CSV
  $ exitbook transactions export --format json --output tx.json # Export as JSON
  $ exitbook transactions export --csv-format simple            # Export as simple CSV
  $ exitbook transactions export --json                         # Output metadata as JSON
`
    )
    .option('--format <type>', 'Export format (csv|json)', 'csv')
    .option('--csv-format <type>', 'CSV format (normalized|simple)')
    .option('--output <file>', 'Output file path')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeTransactionsExportCommand(rawOptions);
    });
}

/**
 * Execute the transactions export command.
 */
async function executeTransactionsExportCommand(rawOptions: unknown): Promise<void> {
  const parseResult = TransactionsExportCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'transactions-export',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  configureLogger({
    mode: isJsonMode ? 'json' : 'text',
    verbose: false,
    sinks: isJsonMode ? { ui: false, structured: 'file' } : { ui: false, structured: 'file' },
  });

  const output = new OutputManager(isJsonMode ? 'json' : 'text');

  const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
  const { TransactionLinkRepository } = await import('@exitbook/accounting');
  const { ExportHandler } = await import('../export/export-handler.js');

  let database: Awaited<ReturnType<typeof initializeDatabase>> | undefined;

  try {
    database = await initializeDatabase();
    const txRepo = new TransactionRepository(database);
    const txLinkRepo = new TransactionLinkRepository(database);
    const exportHandler = new ExportHandler(txRepo, txLinkRepo);

    const format = options.format ?? 'csv';
    const csvFormat = options.csvFormat ?? (format === 'csv' ? 'normalized' : undefined);
    const outputPath = options.output ?? `data/transactions.${format === 'json' ? 'json' : 'csv'}`;

    const result = await exportHandler.execute({
      format,
      csvFormat,
      outputPath,
    });

    await closeDatabase(database);
    database = undefined;

    if (result.isErr()) {
      output.error('transactions-export', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    if (result.value.transactionCount === 0) {
      if (output.isTextMode()) {
        console.log('\nNo transactions found to export.');
      } else {
        const jsonResult: TransactionsExportCommandResult = {
          data: {
            transactionCount: 0,
            format,
            csvFormat,
            outputPaths: [],
          },
        };
        output.json('transactions-export', jsonResult);
      }
      return;
    }

    // Write files atomically
    const writeResult = await writeFilesAtomically(result.value.outputs);
    if (writeResult.isErr()) {
      output.error('transactions-export', writeResult.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    const outputPaths = writeResult.value;

    if (isJsonMode) {
      const jsonResult: TransactionsExportCommandResult = {
        data: {
          transactionCount: result.value.transactionCount,
          format: result.value.format,
          csvFormat: result.value.csvFormat,
          outputPaths,
        },
      };
      output.json('transactions-export', jsonResult);
    } else {
      const pathList = outputPaths.length === 1 ? outputPaths[0] : outputPaths.map((p) => `\n   - ${p}`).join('');
      console.log(`\nExported ${result.value.transactionCount} transactions to: ${pathList}`);
    }
  } catch (error) {
    if (database) {
      await closeDatabase(database);
    }
    output.error(
      'transactions-export',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR
    );
  } finally {
    resetLoggerContext();
  }
}
