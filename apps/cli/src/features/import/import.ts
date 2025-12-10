import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
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
import {
  ImportOrchestrator,
  TransactionProcessService,
  TokenMetadataService,
  type ImportParams,
} from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { promptConfirm } from '../shared/prompts.js';
import { ImportCommandOptionsSchema } from '../shared/schemas.js';

import type { ImportResult } from './import-handler.js';
import { ImportHandler } from './import-handler.js';
import { promptForImportParams } from './import-prompts.js';
import type { ImportCommandOptions } from './import-utils.js';
import { buildImportParams } from './import-utils.js';

/**
 * Import command result data.
 */
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
    source?: string | undefined;
  };
  meta: {
    durationMs?: number | undefined;
    timestamp: string;
  };
}

/**
 * Register the import command.
 */
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
    .option('--process', 'Process data after import (combined import+process pipeline)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ImportCommandOptions) => {
      await executeImportCommand(options);
    });
}

/**
 * Execute the import command.
 */
async function executeImportCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary with Zod
  const validationResult = ImportCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('import', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');
  const spinner = output.spinner();

  try {
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildImportParams(options)),
      cancelMessage: 'Import cancelled',
      commandName: 'import',
      confirmMessage: 'Start import?',
      isInteractive: !options.exchange && !options.blockchain && !options.json,
      output,
      promptFn: promptForImportParams,
    });

    if (spinner) {
      spinner.start(`Importing from ${params.sourceName}...`);
    } else {
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false, // TODO: Add --verbose flag support
        sinks: options.json
          ? { ui: false, structured: 'file' }
          : {
              ui: false,
              structured: 'stdout',
            },
      });
    }

    const database = await initializeDatabase();

    // Initialize repositories
    const userRepository = new UserRepository(database);
    const accountRepository = new AccountRepository(database);
    const transactionRepository = new TransactionRepository(database);
    const rawDataRepository = new RawDataRepository(database);
    const importSessionRepository = new ImportSessionRepository(database);
    const tokenMetadataRepository = new TokenMetadataRepository(database);

    // Initialize provider manager
    const providerManager = new BlockchainProviderManager();

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, providerManager);
    const importOrchestrator = new ImportOrchestrator(
      userRepository,
      accountRepository,
      rawDataRepository,
      importSessionRepository,
      providerManager
    );
    const processService = new TransactionProcessService(
      rawDataRepository,
      accountRepository,
      transactionRepository,
      tokenMetadataService
    );

    // Create handler (pass the provider manager so it uses the same instance and can clean it up)
    const handler = new ImportHandler(importOrchestrator, processService, providerManager);

    try {
      // Add warning callback for single address imports (only in interactive mode)
      const paramsWithCallback = {
        ...params,
        onSingleAddressWarning: !options.json
          ? async () => {
              output.warn('⚠️  Single address import (incomplete wallet view)');
              output.log('');
              output.log('Single address tracking has limitations:');
              output.log('  • Cannot distinguish internal transfers from external sends');
              output.log('  • Change to other addresses will appear as withdrawals');
              output.log('  • Multi-address transactions may show incorrect amounts');
              output.log('');
              output.log('For complete wallet tracking, use xpub instead:');
              output.log(`  $ exitbook import --blockchain ${params.sourceName} --address xpub... [--xpub-gap 20]`);
              output.log('');
              output.log('Note: xpub imports reveal all wallet addresses (privacy trade-off)');
              output.log('');

              return await promptConfirm('Continue with single address import?', false);
            }
          : undefined,
      };

      const result = await handler.execute(paramsWithCallback);

      // Cleanup
      handler.destroy();
      await closeDatabase(database);
      resetLoggerContext();

      if (result.isErr()) {
        spinner?.stop('Import failed');
        output.error('import', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      const summary = handleImportSuccess(output, result.value, params);
      spinner?.stop('Import complete');
      if (output.isTextMode() && summary) {
        output.outro(summary);
      }
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      resetLoggerContext();
      spinner?.stop('Import failed');
      output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
    }
  } catch (error) {
    resetLoggerContext();
    spinner?.stop('Import failed');
    output.error('import', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful import.
 */
function handleImportSuccess(
  output: OutputManager,
  importResult: ImportResult,
  params: ImportParams
): string | undefined {
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
        processed: Boolean(importResult.processed ?? params.shouldProcess),
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
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  let summary: string | undefined;

  if (output.isTextMode()) {
    const summaryParts: string[] = [];

    // Show imported count
    summaryParts.push(`Loaded ${totalImported} transactions`);

    // Show skipped if any
    if (totalSkipped > 0) {
      summaryParts.push(`${totalSkipped} skipped (duplicates)`);
    }

    // Show session info (single session ID or count for multiple)
    if (importResult.sessions.length === 1) {
      summaryParts.push(`Session ${importResult.sessions[0]?.id}`);
    } else {
      summaryParts.push(`${importResult.sessions.length} sessions`);
    }

    if (importResult.processed !== undefined) {
      summaryParts.push(`Processed ${importResult.processed}`);
    }

    summary = summaryParts.join(' · ');

    if (importResult.processingErrors && importResult.processingErrors.length > 0) {
      output.note(importResult.processingErrors.slice(0, 5).join('\n'), 'First 5 errors');
    }
  }

  output.success('import', resultData);

  // Don't call process.exit(0) - it triggers clack's cancellation handler
  // The process will exit naturally
  return summary;
}
