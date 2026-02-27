import type { AdapterRegistry, ImportParams } from '@exitbook/ingestion';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { promptConfirm } from '../shared/prompts.js';
import { unwrapResult } from '../shared/result-utils.js';
import { ImportCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { createImportHandler, type ImportExecuteResult } from './import-handler.js';
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
    runStats?: import('@exitbook/http').MetricsSummary | undefined;
    source?: string | undefined;
  };
  meta: {
    timestamp: string;
  };
}

export function registerImportCommand(program: Command, registry: AdapterRegistry): void {
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
    .action((rawOptions: unknown) => executeImportCommand(rawOptions, registry));
}

async function executeImportCommand(rawOptions: unknown, registry: AdapterRegistry): Promise<void> {
  const isJson = isJsonMode(rawOptions);

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
  if (options.json) {
    await executeImportJSON(options, registry);
  } else {
    await executeImportTUI(options, registry);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeImportJSON(options: ImportCommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createImportHandler(ctx, database, registry);
      if (handlerResult.isErr()) {
        displayCliError('import', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }
      const handler = handlerResult.value;

      const params = unwrapResult(buildImportParams(options, registry));
      const result = await handler.execute(params);
      if (result.isErr()) {
        displayCliError('import', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputSuccess('import', buildImportResult(result.value, params));
    });
  } catch (error) {
    displayCliError(
      'import',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI Mode ────────────────────────────────────────────────────────────────

async function executeImportTUI(options: ImportCommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createImportHandler(ctx, database, registry);
      if (handlerResult.isErr()) {
        displayCliError('import', handlerResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }
      const handler = handlerResult.value;

      ctx.onAbort(() => handler.abort());

      const params = unwrapResult(buildImportParams(options, registry));

      const paramsWithCallback: ImportParams = {
        ...params,
        onSingleAddressWarning: async () => {
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
        },
      };

      const result = await handler.execute(paramsWithCallback);
      if (result.isErr()) {
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (result.value.processingErrors.length > 0) {
        process.stderr.write('\nFirst 5 processing errors:\n');
        for (const error of result.value.processingErrors.slice(0, 5)) {
          process.stderr.write(`  • ${error}\n`);
        }
      }
    });
  } catch (error) {
    displayCliError(
      'import',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildImportResult(importResult: ImportExecuteResult, params: ImportParams): ImportCommandResult {
  const totalImported = importResult.sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
  const totalSkipped = importResult.sessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);
  const firstSession = importResult.sessions[0];
  const sourceIsBlockchain = params.sourceType === 'blockchain';

  const inputData = {
    csvDir: params.csvDirectory,
    address: params.address,
    processed: true,
    ...(sourceIsBlockchain ? { blockchain: params.sourceName } : { exchange: params.sourceName }),
  };

  const sessionSummaries =
    importResult.sessions.length > 0
      ? importResult.sessions.map((s) => ({
          id: s.id,
          startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : undefined,
          completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : undefined,
          status: s.status,
        }))
      : undefined;

  return {
    status: importResult.processingErrors.length > 0 ? 'warning' : 'success',
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
      processingErrors: importResult.processingErrors.slice(0, 5),
      runStats: importResult.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}
