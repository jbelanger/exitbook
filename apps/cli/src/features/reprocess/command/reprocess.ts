import type { Command } from 'commander';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { isJsonMode } from '../../shared/json-mode.js';
import { outputSuccess } from '../../shared/json-output.js';

import { runReprocess, type ProcessResultWithMetrics } from './reprocess-handler.js';
import { ProcessCommandOptionsSchema } from './reprocess-option-schemas.js';

/**
 * Process command options validated by Zod at CLI boundary
 */
type ProcessCommandOptions = z.infer<typeof ProcessCommandOptionsSchema>;

/**
 * Process command result structure for JSON output
 */
interface ReprocessCommandResult {
  status: 'success' | 'warning';
  reprocess: {
    counts: {
      failed?: number | undefined;
      processed: number;
    };
    processingErrors?: string[] | undefined;
    runStats?: import('@exitbook/observability').MetricsSummary | undefined;
  };
  meta: {
    timestamp: string;
  };
}

export function registerReprocessCommand(program: Command, appRuntime: CliAppRuntime): void {
  program
    .command('reprocess')
    .description('Clear all derived data and reprocess from raw data')
    .option('--account-id <id>', 'Reprocess only a specific account ID')
    .option('--json', 'Output results in JSON format')
    .option('--verbose', 'Show verbose logging output')
    .action((rawOptions: unknown) => executeReprocessCommand(rawOptions, appRuntime));
}

async function executeReprocessCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
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
    await executeReprocessJSON(options, appRuntime);
  } else {
    await executeReprocessTUI(options, appRuntime);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeReprocessJSON(options: ProcessCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await runReprocess(ctx, { accountId: options.accountId });
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

async function executeReprocessTUI(options: ProcessCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await runReprocess(ctx, { accountId: options.accountId });
      if (result.isErr()) {
        displayCliError('reprocess', result.error, ExitCodes.GENERAL_ERROR, 'text');
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

function buildReprocessResult(result: ProcessResultWithMetrics): ReprocessCommandResult {
  return {
    status: result.errors.length > 0 ? 'warning' : 'success',
    reprocess: {
      counts: {
        processed: result.processed,
        ...(result.failed > 0 ? { failed: result.failed } : {}),
      },
      processingErrors: result.errors.slice(0, 5),
      runStats: result.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}
