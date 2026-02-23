import type { MetricsSummary } from '@exitbook/http';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { createErrorResponse, exitCodeToErrorCode } from '../shared/cli-response.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { ProcessCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import type { ProcessResult } from './process-handler.js';
import { createProcessServices } from './process-service-factory.js';

const logger = getLogger('process');

/**
 * Process command options validated by Zod at CLI boundary
 */
export type ProcessCommandOptions = z.infer<typeof ProcessCommandOptionsSchema>;

/**
 * Process command result structure for JSON output
 */
interface ProcessCommandResult {
  status: 'success' | 'warning';
  reprocess: {
    counts: {
      processed: number;
    };
    processingErrors?: string[] | undefined;
    runStats?: MetricsSummary | undefined;
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
  // Check for --json flag early (even before validation) to determine output format
  const isJson = isJsonMode(rawOptions);

  // Validate options at CLI boundary with Zod
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
      const services = await createProcessServices(database, registry);
      ctx.onCleanup(async () => services.cleanup());

      if (isTuiMode) {
        ctx.onAbort(() => {
          services.ingestionMonitor.abort();
          void services.ingestionMonitor.stop().catch((cleanupErr) => {
            logger.warn({ cleanupErr }, 'Failed to stop ingestion monitor on abort');
          });
        });
      }

      // Execute reprocess
      const processResult = await services.execute({
        accountId: options.accountId,
      });

      if (processResult.isErr()) {
        await handleCommandError(processResult.error.message, isTuiMode, services.ingestionMonitor);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      // Combine results and output success
      const result = {
        ...processResult.value,
        runStats: services.instrumentation.getSummary(),
      };

      handleProcessSuccess(options.json ?? false, result);

      // Flush final dashboard renders before natural exit
      await services.ingestionMonitor.stop();
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

/**
 * Handle command error by showing in dashboard or outputting to console.
 * Returns to allow cleanup before exit.
 */
async function handleCommandError(
  errorMessage: string,
  useInk: boolean,
  ingestionMonitor: { fail(errorMessage: string): void; stop(): Promise<void> }
): Promise<void> {
  if (useInk) {
    ingestionMonitor.fail(errorMessage);
    // Stop monitor (monitor renders the error inline)
    await ingestionMonitor.stop();
  } else {
    const errorResponse = createErrorResponse(
      'reprocess',
      new Error(errorMessage),
      exitCodeToErrorCode(ExitCodes.GENERAL_ERROR)
    );
    console.log(JSON.stringify(errorResponse, undefined, 2));
  }
}

/**
 * Process result enhanced with processing metrics
 */
interface ProcessResultWithMetrics extends ProcessResult {
  runStats?: MetricsSummary | undefined;
}

/**
 * Handle successful reprocessing.
 */
function handleProcessSuccess(isJsonMode: boolean, result: ProcessResultWithMetrics): void {
  const status = result.errors.length > 0 ? 'warning' : 'success';

  const resultData: ProcessCommandResult = {
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
    // Dashboard already shows reprocess summary and API call stats in completion phase
    // Only show additional processing errors if any
    if (result.errors.length > 0) {
      process.stderr.write('\nFirst 5 processing errors:\n');
      for (const error of result.errors.slice(0, 5)) {
        process.stderr.write(`  • ${error}\n`);
      }
    }
  }
}
