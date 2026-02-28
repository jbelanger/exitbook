// Command registration for transactions export subcommand
import type { Command } from 'commander';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { writeFilesAtomically } from '../shared/file-utils.js';
import { outputSuccess } from '../shared/json-output.js';
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

  const { ExportHandler } = await import('./transactions-export-handler.js');

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const exportHandler = new ExportHandler(database);

      const format = options.format ?? 'csv';
      const csvFormat = options.csvFormat ?? (format === 'csv' ? 'normalized' : undefined);
      const outputPath = options.output ?? `data/transactions.${format === 'json' ? 'json' : 'csv'}`;

      const result = await exportHandler.execute({
        format,
        csvFormat,
        outputPath,
      });

      if (result.isErr()) {
        displayCliError('transactions-export', result.error, ExitCodes.GENERAL_ERROR, isJsonMode ? 'json' : 'text');
      }

      if (result.value.transactionCount === 0) {
        if (!isJsonMode) {
          console.log('No transactions found to export.');
        } else {
          const jsonResult: TransactionsExportCommandResult = {
            data: {
              transactionCount: 0,
              format,
              csvFormat,
              outputPaths: [],
            },
          };
          outputSuccess('transactions-export', jsonResult);
        }
        return;
      }

      // Write files atomically
      const writeResult = await writeFilesAtomically(result.value.outputs);
      if (writeResult.isErr()) {
        displayCliError(
          'transactions-export',
          writeResult.error,
          ExitCodes.GENERAL_ERROR,
          isJsonMode ? 'json' : 'text'
        );
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
        outputSuccess('transactions-export', jsonResult);
      } else {
        if (outputPaths.length === 1) {
          console.log(`Exported ${result.value.transactionCount} transactions to: ${outputPaths[0]}`);
        } else {
          console.log(`Exported ${result.value.transactionCount} transactions to:`);
          for (const exportPath of outputPaths) {
            console.log(`  - ${exportPath}`);
          }
        }
      }
    });
  } catch (error) {
    displayCliError(
      'transactions-export',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      isJsonMode ? 'json' : 'text'
    );
  }
}
