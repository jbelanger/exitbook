import type { AdapterRegistry } from '@exitbook/ingestion';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { ProcessCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { createProcessHandler, type BatchProcessSummaryWithMetrics } from './process-handler.js';

/**
 * Process command options validated by Zod at CLI boundary
 */
export type ProcessCommandOptions = z.infer<typeof ProcessCommandOptionsSchema>;

/**
 * Process command result structure for JSON output
 */
interface ReprocessCommandResult {
  status: 'success' | 'warning';
  reprocess: {
    counts: {
      processed: number;
    };
    processingErrors?: string[] | undefined;
    runStats?: import('@exitbook/http').MetricsSummary | undefined;
  };
  meta: {
    timestamp: string;
  };
}

export function registerReprocessCommand(program: Command, registry: AdapterRegistry): void {
  program
    .command('reprocess')
    .description('Clear all derived data and reprocess from raw data')
    .option('--account-id <id>', 'Reprocess only a specific account ID')
    .option('--json', 'Output results in JSON format')
    .option('--verbose', 'Show verbose logging output')
    .action((rawOptions: unknown) => executeReprocessCommand(rawOptions, registry));
}

async function executeReprocessCommand(rawOptions: unknown, registry: AdapterRegistry): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const validationResult = ProcessCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    displayCliError(
      'reprocess',
      new Error(firstError?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = validationResult.data;
  const isTuiMode = !options.json;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = await createProcessHandler(ctx, database, registry);

      if (isTuiMode) {
        ctx.onAbort(() => handler.abort());
      }

      const result = await handler.execute({ accountId: options.accountId });
      if (result.isErr()) {
        if (!isTuiMode) {
          displayCliError('reprocess', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      handleProcessSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'reprocess',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

function handleProcessSuccess(isJsonMode: boolean, result: BatchProcessSummaryWithMetrics): void {
  const status = result.errors.length > 0 ? 'warning' : 'success';

  const resultData: ReprocessCommandResult = {
    status,
    reprocess: {
      counts: {
        processed: result.processed,
      },
      processingErrors: result.errors.slice(0, 5),
      runStats: result.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  if (isJsonMode) {
    outputSuccess('reprocess', resultData);
  } else {
    if (result.errors.length > 0) {
      process.stderr.write('\nFirst 5 processing errors:\n');
      for (const error of result.errors.slice(0, 5)) {
        process.stderr.write(`  • ${error}\n`);
      }
    }
  }
}
