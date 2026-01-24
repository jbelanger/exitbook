import { BlockchainProviderManager, type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  closeDatabase,
  initializeDatabase,
  TransactionRepository,
  TokenMetadataRepository,
  UserRepository,
  AccountRepository,
  ImportSessionRepository,
  RawDataRepository,
} from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import type { MetricsSummary } from '@exitbook/http';
import {
  ImportOrchestrator,
  TransactionProcessService,
  TokenMetadataService,
  type ImportParams,
  type ImportEvent,
  type IngestionEvent,
} from '@exitbook/ingestion';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import pc from 'picocolors';

import { ProgressHandler } from '../../ui/progress-handler.js';
import { resolveInteractiveParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { promptConfirm } from '../shared/prompts.js';
import { ImportCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import type { ImportResult } from './import-handler.js';
import { ImportHandler } from './import-handler.js';
import { promptForImportParams } from './import-prompts.js';
import { buildImportParams } from './import-utils.js';

interface ImportSessionSummary {
  id: number;
  files?: number | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  status?: string | undefined;
}

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
    durationMs?: number | undefined;
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
    const output = new OutputManager(isJson ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('import', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.INVALID_ARGS);
    return;
  }

  const options = validationResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  // Create event bus for progress tracking
  type CliEvent = IngestionEvent | ProviderEvent;
  const logger = getLogger('cli.import');
  const eventBus = new EventBus<CliEvent>((err) => {
    logger.warn({ err }, 'Event handler error');
  });

  // Create progress handler and subscribe to events
  const progressHandler = new ProgressHandler();
  const unsubscribe = eventBus.subscribe((event) => {
    progressHandler.handleEvent(event);
  });

  // Configure logger:
  // - Normal mode: logs to file only (clean console via ProgressHandler)
  // - Verbose mode: logs to console AND file (see all debug output)
  // - JSON mode: logs to file only (keep stdout clean for JSON)
  configureLogger({
    mode: options.json ? 'json' : 'text',
    verbose: options.verbose ?? false,
    sinks: {
      ui: false, // No clack UI integration
      structured: options.json ? 'off' : options.verbose ? 'stdout' : 'file',
    },
  });

  try {
    const params = await resolveInteractiveParams({
      buildFromFlags: () => unwrapResult(buildImportParams(options)),
      cancelMessage: 'Import cancelled',
      commandName: 'import',
      confirmMessage: 'Start import?',
      isInteractive: !options.exchange && !options.blockchain && !options.json,
      output,
      promptFn: promptForImportParams,
    });

    const database = await initializeDatabase();

    const userRepository = new UserRepository(database);
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const importSessionRepository = new ImportSessionRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager();

    // Initialize instrumentation for API call tracking
    const instrumentation = new InstrumentationCollector();
    providerManager.setInstrumentation(instrumentation);

    // Wire up event bus for provider events
    providerManager.setEventBus(eventBus as EventBus<ProviderEvent>);

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const importOrchestrator = new ImportOrchestrator(
      userRepository,
      accountRepository,
      rawDataRepository,
      importSessionRepository,
      providerManager,
      eventBus as EventBus<ImportEvent> // Type assertion: orchestrator only emits ImportEvents
    );
    const transactionProcessService = new TransactionProcessService(
      rawDataRepository,
      accountRepository,
      transactionRepository,
      providerManager,
      tokenMetadataService,
      importSessionRepository
    );

    // Create handler (pass the provider manager so it uses the same instance and can clean it up)
    const handler = new ImportHandler(importOrchestrator, transactionProcessService, providerManager);

    try {
      // Add warning callback for single address imports (only in interactive mode)
      const paramsWithCallback = {
        ...params,
        onSingleAddressWarning: !options.json
          ? async () => {
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
            }
          : undefined,
      };

      // Step 1: Import
      const importResult = await handler.executeImport(paramsWithCallback);

      if (importResult.isErr()) {
        handler.destroy?.();
        await closeDatabase(database);
        resetLoggerContext();
        output.error('import', importResult.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      // Step 2: Process
      const processResult = await handler.processImportedSessions(importResult.value.sessions);

      // Get instrumentation summary
      const instrumentationSummary = instrumentation.getSummary();

      // Cleanup
      unsubscribe();
      handler.destroy?.();
      await closeDatabase(database);
      resetLoggerContext();

      if (processResult.isErr()) {
        output.error('import', processResult.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      // Combine results
      const combinedResult = {
        sessions: importResult.value.sessions,
        processed: processResult.value.processed,
        processingErrors: processResult.value.processingErrors,
        runStats: instrumentationSummary,
      };

      handleImportSuccess(output, combinedResult, params);

      // Exit required: BlockchainProviderManager uses fetch with keep-alive connections
      // that cannot be manually closed, preventing natural process termination
      process.exit(0);
    } catch (error) {
      unsubscribe();
      handler.destroy?.();
      await closeDatabase(database);
      resetLoggerContext();
      output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
    }
  } catch (error) {
    unsubscribe();
    resetLoggerContext();
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

interface CombinedImportResult extends ImportResult {
  processed?: number | undefined;
  processingErrors?: string[] | undefined;
  runStats?: MetricsSummary | undefined;
}

function handleImportSuccess(output: OutputManager, importResult: CombinedImportResult, params: ImportParams): void {
  // Calculate totals from sessions
  const totalImported = importResult.sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
  const totalSkipped = importResult.sessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);
  const includeSessions = importResult.sessions.length > 0;
  const firstSession = importResult.sessions[0];
  const sourceIsBlockchain = params.sourceType === 'blockchain';

  // Prepare result data (compact, account-centric)
  const resultData: ImportCommandResult = {
    status: importResult.processingErrors?.length ? 'warning' : 'success',
    import: {
      accountId: firstSession?.accountId,
      source: params.sourceName,
      input: {
        exchange: sourceIsBlockchain ? undefined : params.sourceName,
        blockchain: sourceIsBlockchain ? params.sourceName : undefined,
        csvDir: params.csvDirectory,
        address: params.address,
        processed: importResult.processed !== undefined,
      },
      counts: {
        imported: totalImported,
        skipped: totalSkipped,
        processed: importResult.processed,
      },
      importSessions: includeSessions
        ? importResult.sessions.map((s) => ({
            id: s.id,
            startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : undefined,
            completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : undefined,
            status: s.status,
          }))
        : undefined,
      processingErrors: importResult.processingErrors?.slice(0, 5),
      runStats: importResult.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  if (output.isTextMode()) {
    // ProgressHandler already shows import summary - only show additional details here
    if (importResult.processingErrors && importResult.processingErrors.length > 0) {
      process.stderr.write('\nFirst 5 processing errors:\n');
      for (const error of importResult.processingErrors.slice(0, 5)) {
        process.stderr.write(`  • ${error}\n`);
      }
    }

    // Display API call summary table
    if (importResult.runStats && importResult.runStats.total > 0) {
      process.stderr.write('\n');
      displayApiCallSummary(importResult.runStats);
    }
  }

  output.json('import', resultData);
}

/**
 * Display API call summary table
 */
function displayApiCallSummary(stats: MetricsSummary): void {
  // Calculate summary stats
  const totalCalls = stats.total;
  const avgResponseTime =
    Object.values(stats.byEndpoint).reduce((sum, m) => sum + m.avgDuration, 0) / Object.keys(stats.byEndpoint).length;

  // Build table rows from byEndpoint data
  const rows: { avgDuration: number; calls: number; endpoint: string; provider: string }[] = [];

  for (const [key, metrics] of Object.entries(stats.byEndpoint)) {
    const [provider, endpoint] = key.split(':');
    if (!provider || !endpoint) continue;

    rows.push({
      provider,
      endpoint,
      calls: metrics.calls,
      avgDuration: metrics.avgDuration,
    });
  }

  // Sort by provider, then by calls descending
  rows.sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    return b.calls - a.calls;
  });

  // Show summary header
  const width = 60;
  const line = '━'.repeat(width);

  process.stderr.write('\n');
  process.stderr.write(pc.cyan(line) + '\n');
  process.stderr.write(pc.bold(pc.cyan('API CALLS')) + '\n');
  process.stderr.write(pc.cyan(line) + '\n');
  process.stderr.write('\n');

  // Summary stats
  process.stderr.write(
    pc.bold(`${totalCalls} ${totalCalls === 1 ? 'request' : 'requests'}`) +
      pc.dim(` · avg ${Math.round(avgResponseTime)}ms`) +
      '\n'
  );
  process.stderr.write('\n');

  // Group by provider
  const byProvider = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byProvider.has(row.provider)) {
      byProvider.set(row.provider, []);
    }
    byProvider.get(row.provider)!.push(row);
  }

  // Display each provider's endpoints
  for (const [provider, providerRows] of byProvider) {
    process.stderr.write(pc.bold(provider) + '\n');

    for (const row of providerRows) {
      const durationStr = `${Math.round(row.avgDuration)}ms`;
      const callsStr = `${row.calls} ${row.calls === 1 ? 'call' : 'calls'}`;

      // Color code based on response time
      let durationColor = pc.green;
      if (row.avgDuration > 1000) durationColor = pc.red;
      else if (row.avgDuration > 500) durationColor = pc.yellow;

      const warning = row.avgDuration > 1000 ? ' ' + pc.red('⚠ slow') : '';

      process.stderr.write(`  ${pc.dim(row.endpoint)}\n`);
      process.stderr.write(`  └─ ${callsStr} · ${durationColor(durationStr)}${warning}\n`);
    }
    process.stderr.write('\n');
  }
}
