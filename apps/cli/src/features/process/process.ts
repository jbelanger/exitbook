import type { MetricsSummary } from '@exitbook/http';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import type { IngestionMonitorController } from '../import/components/index.js';
import { displayCliError } from '../shared/cli-error.js';
import { createErrorResponse, exitCodeToErrorCode } from '../shared/cli-response.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { ProcessCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import type { ProcessResult } from './process-handler.js';
import { createProcessServices } from './process-service-factory.js';

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

export function registerReprocessCommand(program: Command): void {
  program
    .command('reprocess')
    .description('Clear all derived data and reprocess from raw data')
    .option('--account-id <id>', 'Reprocess only a specific account ID')
    .option('--json', 'Output results in JSON format')
    .option('--verbose', 'Show verbose logging output')
    .action(executeReprocessCommand);
}

async function executeReprocessCommand(rawOptions: unknown): Promise<void> {
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
  const output = new OutputManager(options.json ? 'json' : 'text');

  // JSON mode still uses OutputManager for structured output
  // Text mode will use Ink dashboard for all display (including errors)
  const useInk = !options.json;

  // Configure logger
  configureLogger({
    mode: options.json ? 'json' : 'text',
    verbose: options.verbose ?? false,
    sinks: {
      ui: false,
      structured: options.json ? 'off' : options.verbose ? 'stdout' : 'file',
    },
  });

  // Create services using factory
  const services = await createProcessServices();

  // Handle Ctrl-C gracefully
  let abortHandler: (() => void) | undefined;
  if (useInk) {
    abortHandler = () => {
      // Remove handler to prevent multiple triggers
      if (abortHandler) {
        process.off('SIGINT', abortHandler);
      }

      // Mark as aborted and stop gracefully
      // Fire cleanup promises and exit immediately (signal handler must be sync)
      services.ingestionMonitor.abort();
      void services.ingestionMonitor.stop().catch(() => {
        /* ignore cleanup errors during exit */
      });
      void services.cleanup().catch(() => {
        /* ignore cleanup errors during exit */
      });
      resetLoggerContext();
      process.exit(130); // Standard exit code for SIGINT
    };
    process.on('SIGINT', abortHandler);
  }

  let exitCode = 0;

  try {
    // Execute reprocess
    const processResult = await services.execute({
      accountId: options.accountId,
    });

    if (processResult.isErr()) {
      await handleCommandError(processResult.error.message, useInk, services.ingestionMonitor);
      exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    // Combine results and output success
    const result = {
      ...processResult.value,
      runStats: services.instrumentation.getSummary(),
    };

    handleProcessSuccess(output, result);

    // Flush final dashboard renders before natural exit.
    // Undici agent cleanup in finally block allows process to terminate cleanly.
    await services.ingestionMonitor.stop();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await handleCommandError(errorMessage, useInk, services.ingestionMonitor);
    exitCode = ExitCodes.GENERAL_ERROR;
  } finally {
    // Remove signal handler
    if (abortHandler) {
      process.off('SIGINT', abortHandler);
    }

    // Cleanup always runs exactly once (success, error, or early return)
    await services.cleanup();
    resetLoggerContext();

    // Only exit explicitly on error; undici cleanup allows natural exit on success
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}

/**
 * Handle command error by showing in dashboard or outputting to console.
 * Returns to allow cleanup before exit.
 */
async function handleCommandError(
  errorMessage: string,
  useInk: boolean,
  ingestionMonitor: IngestionMonitorController
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
function handleProcessSuccess(output: OutputManager, result: ProcessResultWithMetrics): void {
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

  if (output.isTextMode()) {
    // Dashboard already shows reprocess summary and API call stats in completion phase
    // Only show additional processing errors if any
    if (result.errors.length > 0) {
      process.stderr.write('\nFirst 5 processing errors:\n');
      for (const error of result.errors.slice(0, 5)) {
        process.stderr.write(`  • ${error}\n`);
      }
    }
  }

  output.json('reprocess', resultData);
}
