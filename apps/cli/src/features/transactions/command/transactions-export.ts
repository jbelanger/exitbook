import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { writeFilesWithAtomicRenames } from '../../shared/file-utils.js';

import { TransactionsExportCommandOptionsSchema } from './transactions-option-schemas.js';

type TransactionsExportCommandOptions = z.infer<typeof TransactionsExportCommandOptionsSchema>;

interface TransactionsExportCommandResult {
  data: {
    csvFormat?: string | undefined;
    format: string;
    outputPaths: string[];
    transactionCount: number;
  };
}

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
    .action((rawOptions: unknown) => executeTransactionsExportCommand(rawOptions));
}

async function executeTransactionsExportCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<TransactionsExportCommandOptions>({
    command: 'transactions-export',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, TransactionsExportCommandOptionsSchema);
      }),
    action: async (context) => executeTransactionsExportCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeTransactionsExportCommandResult(
  ctx: CommandRuntime,
  options: TransactionsExportCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const { TransactionsExportHandler } = await import('./transactions-export-handler.js');
    const exportHandler = new TransactionsExportHandler(database);
    const exportFormat = options.format ?? 'csv';
    const csvFormat = options.csvFormat ?? (exportFormat === 'csv' ? 'normalized' : undefined);
    const outputPath = options.output ?? `data/transactions.${exportFormat === 'json' ? 'json' : 'csv'}`;

    const result = yield* toCliResult(
      await exportHandler.execute({
        profileId: profile.id,
        format: exportFormat,
        csvFormat,
        outputPath,
      }),
      ExitCodes.GENERAL_ERROR
    );

    if (result.transactionCount === 0) {
      return buildEmptyTransactionsExportCompletion(exportFormat, csvFormat, format);
    }

    const outputPaths = yield* toCliResult(await writeFilesWithAtomicRenames(result.outputs), ExitCodes.GENERAL_ERROR);

    return buildTransactionsExportCompletion(
      {
        csvFormat: result.csvFormat,
        format: result.format,
        outputPaths,
        transactionCount: result.transactionCount,
      },
      format
    );
  });
}

function buildEmptyTransactionsExportCompletion(
  exportFormat: string,
  csvFormat: string | undefined,
  format: CliOutputFormat
) {
  if (format === 'json') {
    const resultData: TransactionsExportCommandResult = {
      data: {
        transactionCount: 0,
        format: exportFormat,
        csvFormat,
        outputPaths: [],
      },
    };
    return jsonSuccess(resultData);
  }

  return textSuccess(() => {
    console.log('No transactions found to export.');
  });
}

function buildTransactionsExportCompletion(result: TransactionsExportCommandResult['data'], format: CliOutputFormat) {
  if (format === 'json') {
    return jsonSuccess({ data: result } satisfies TransactionsExportCommandResult);
  }

  return textSuccess(() => {
    if (result.outputPaths.length === 1) {
      console.log(`Exported ${result.transactionCount} transactions to: ${result.outputPaths[0]}`);
      return;
    }

    console.log(`Exported ${result.transactionCount} transactions to:`);
    for (const exportPath of result.outputPaths) {
      console.log(`  - ${exportPath}`);
    }
  });
}
