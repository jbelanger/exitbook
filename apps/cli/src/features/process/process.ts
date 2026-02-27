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
  if (options.json) {
    await executeReprocessJSON(options, registry);
  } else {
    await executeReprocessTUI(options, registry);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeReprocessJSON(options: ProcessCommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createProcessHandler(ctx, database, registry);
      if (handlerResult.isErr()) {
        displayCliError('reprocess', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }
      const handler = handlerResult.value;

      const result = await handler.execute({ accountId: options.accountId });
      if (result.isErr()) {
        displayCliError('reprocess', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputSuccess('reprocess', buildReprocessResult(result.value));
    });
  } catch (error) {
    displayCliError(
      'reprocess',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI Mode ────────────────────────────────────────────────────────────────

async function executeReprocessTUI(options: ProcessCommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createProcessHandler(ctx, database, registry);
      if (handlerResult.isErr()) {
        displayCliError('reprocess', handlerResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }
      const handler = handlerResult.value;

      ctx.onAbort(() => handler.abort());

      const result = await handler.execute({ accountId: options.accountId });
      if (result.isErr()) {
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (result.value.errors.length > 0) {
        process.stderr.write('\nFirst 5 processing errors:\n');
        for (const error of result.value.errors.slice(0, 5)) {
          process.stderr.write(`  • ${error}\n`);
        }
      }
    });
  } catch (error) {
    displayCliError(
      'reprocess',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildReprocessResult(result: BatchProcessSummaryWithMetrics): ReprocessCommandResult {
  return {
    status: result.errors.length > 0 ? 'warning' : 'success',
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
}
