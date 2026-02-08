import type { MetricsSummary } from '@exitbook/http';
import type { ImportParams } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { createErrorResponse, exitCodeToErrorCode } from '../shared/cli-response.js';
import { unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { promptConfirm } from '../shared/prompts.js';
import { ImportCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import type { IngestionMonitorController } from './components/index.js';
import type { ImportResult } from './import-handler.js';
import { createImportServices } from './import-service-factory.js';
import { buildImportParams } from './import-utils.js';

/**
 * Import command options validated by Zod at CLI boundary
 */
export type ImportCommandOptions = z.infer<typeof ImportCommandOptionsSchema>;

/**
 * Summary of a single import session
 */
interface ImportSessionSummary {
  id: number;
  files?: number | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  status?: string | undefined;
}

/**
 * Import command result structure for JSON output
 */
interface ImportCommandResult {
  status: 'success' | 'warning';
  import: {
    accountId?: number | undefined;
    counts: {
      imported: number;
      processed?: number | undefined;
      skipped: number;
    };
    importSessions?: ImportSessionSummary[] | undefined;
    input: {
      address?: string | undefined;
      blockchain?: string | undefined;
      csvDir?: string | undefined;
      exchange?: string | undefined;
      processed: boolean;
    };
    processingErrors?: string[] | undefined;
    runStats?: MetricsSummary | undefined;
    source?: string | undefined;
  };
  meta: {
    timestamp: string;
  };
}

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import raw data from external sources (blockchain or exchange)')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, polkadot, bittensor)')
    .option('--csv-dir <path>', 'CSV directory for exchange sources')
    .option('--address <address>', 'Wallet address for blockchain source')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option(
      '--xpub-gap <number>',
      'Address derivation limit for xpub/extended keys (default: 20 for Bitcoin, 10 for Cardano)',
      parseInt
    )
    .option('--api-key <key>', 'API key for exchange API access')
    .option('--api-secret <secret>', 'API secret for exchange API access')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange API access (if required)')
    .option('--json', 'Output results in JSON format')
    .option('--verbose', 'Show verbose logging output')
    .action(executeImportCommand);
}

async function executeImportCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJson = isJsonMode(rawOptions);

  // Validate options at CLI boundary with Zod
  const validationResult = ImportCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    displayCliError(
      'import',
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
  const services = await createImportServices();

  // Handle Ctrl-C gracefully
  let abortHandler: (() => void) | undefined;
  if (useInk) {
    abortHandler = () => {
      // Remove handler to prevent multiple triggers
      if (abortHandler) {
        process.off('SIGINT', abortHandler);
      }

      // Mark as aborted and stop gracefully
      services.ingestionMonitor.abort();
      services.ingestionMonitor.stop().catch(() => {
        /* ignore cleanup errors on abort */
      });
      services.cleanup().catch(() => {
        /* ignore cleanup errors on abort */
      });
      resetLoggerContext();
      process.exit(130); // Standard exit code for SIGINT
    };
    process.on('SIGINT', abortHandler);
  }

  let exitCode = 0;

  try {
    // Resolve import parameters
    const params = unwrapResult(buildImportParams(options));

    // Add warning callback for single address imports (only in non-JSON mode)
    let onSingleAddressWarning: (() => Promise<boolean>) | undefined;
    if (!options.json) {
      onSingleAddressWarning = async () => {
        process.stderr.write('\n⚠️  Single address import (incomplete wallet view)\n\n');
        process.stderr.write('Single address tracking has limitations:\n');
        process.stderr.write('  • Cannot distinguish internal transfers from external sends\n');
        process.stderr.write('  • Change to other addresses will appear as withdrawals\n');
        process.stderr.write('  • Multi-address transactions may show incorrect amounts\n\n');
        process.stderr.write('For complete wallet tracking, use xpub instead:\n');
        process.stderr.write(
          `  $ exitbook import --blockchain ${params.sourceName} --address xpub... [--xpub-gap 20]\n\n`
        );
        process.stderr.write('Note: xpub imports reveal all wallet addresses (privacy trade-off)\n\n');

        return await promptConfirm('Continue with single address import?', false);
      };
    }

    const paramsWithCallback: ImportParams = {
      ...params,
      onSingleAddressWarning,
    };

    // Execute import
    const importResult = await services.handler.executeImport(paramsWithCallback);
    if (importResult.isErr()) {
      await handleCommandError(importResult.error.message, useInk, services.ingestionMonitor);
      exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    // Execute processing
    const processResult = await services.handler.processImportedSessions(importResult.value.sessions);
    if (processResult.isErr()) {
      await handleCommandError(processResult.error.message, useInk, services.ingestionMonitor);
      exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    // Combine results and output success
    const combinedResult = {
      sessions: importResult.value.sessions,
      processed: processResult.value.processed,
      processingErrors: processResult.value.processingErrors,
      runStats: services.instrumentation.getSummary(),
    };

    handleImportSuccess(output, combinedResult, params);

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
      'import',
      new Error(errorMessage),
      exitCodeToErrorCode(ExitCodes.GENERAL_ERROR)
    );
    console.log(JSON.stringify(errorResponse, undefined, 2));
  }
}

/**
 * Import result enhanced with processing metrics
 */
interface ImportResultWithMetrics extends ImportResult {
  processed?: number | undefined;
  processingErrors?: string[] | undefined;
  runStats?: MetricsSummary | undefined;
}

/**
 * Handle successful import and processing.
 */
function handleImportSuccess(output: OutputManager, importResult: ImportResultWithMetrics, params: ImportParams): void {
  // Calculate totals from sessions
  const totalImported = importResult.sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
  const totalSkipped = importResult.sessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);
  const includeSessions = importResult.sessions.length > 0;
  const firstSession = importResult.sessions[0];
  const sourceIsBlockchain = params.sourceType === 'blockchain';

  const inputData = {
    csvDir: params.csvDirectory,
    address: params.address,
    processed: importResult.processed !== undefined,
    exchange: sourceIsBlockchain ? undefined : params.sourceName,
    blockchain: sourceIsBlockchain ? params.sourceName : undefined,
  };

  const hasProcessingErrors = importResult.processingErrors && importResult.processingErrors.length > 0;
  const status = hasProcessingErrors ? 'warning' : 'success';

  let sessionSummaries: ImportSessionSummary[] | undefined;
  if (includeSessions) {
    sessionSummaries = importResult.sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : undefined,
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : undefined,
      status: s.status,
    }));
  }

  const resultData: ImportCommandResult = {
    status,
    import: {
      accountId: firstSession?.accountId,
      source: params.sourceName,
      input: inputData,
      counts: {
        imported: totalImported,
        skipped: totalSkipped,
        processed: importResult.processed,
      },
      importSessions: sessionSummaries,
      processingErrors: importResult.processingErrors?.slice(0, 5),
      runStats: importResult.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  if (output.isTextMode()) {
    // ProgressHandler already shows import summary and API call stats in completion phase
    // Only show additional processing errors if any
    if (importResult.processingErrors && importResult.processingErrors.length > 0) {
      process.stderr.write('\nFirst 5 processing errors:\n');
      for (const error of importResult.processingErrors.slice(0, 5)) {
        process.stderr.write(`  • ${error}\n`);
      }
    }
  }

  output.json('import', resultData);
}
