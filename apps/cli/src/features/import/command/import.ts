import type { Account, ImportSession } from '@exitbook/core';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, silentSuccess, toCliResult, type CliCommandResult } from '../../shared/cli-contract.js';
import {
  detectCliOutputFormat,
  parseCliCommandOptionsResult,
  type CliOutputFormat,
} from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { promptConfirm } from '../../shared/prompts.js';

import { withImportCommandScope } from './import-command-scope.js';
import { ImportCommandOptionsSchema } from './import-option-schemas.js';
import type { BatchImportExecuteResult, ImportExecuteResult } from './run-import.js';
import { resolveImportAccount, runImport, runImportAll } from './run-import.js';

type ImportCommandOptions = z.infer<typeof ImportCommandOptionsSchema>;

interface ImportSessionSummary {
  accountId: number;
  completedAt?: string | undefined;
  id: number;
  startedAt?: string | undefined;
  status?: string | undefined;
}

interface ImportCommandResult {
  status: 'success';
  import: {
    account: {
      accountType: Account['accountType'];
      id: number;
      name?: string | undefined;
      platformKey: string;
    };
    counts: {
      imported: number;
      skipped: number;
    };
    importSessions?: ImportSessionSummary[] | undefined;
    mode: 'single';
    runStats?: import('@exitbook/observability').MetricsSummary | undefined;
  };
  meta: {
    timestamp: string;
  };
}

interface BatchImportCommandResult {
  status: 'partial-failure' | 'success';
  import: {
    accounts: {
      account: {
        accountType: Account['accountType'];
        id: number;
        name: string;
        platformKey: string;
      };
      counts: {
        imported: number;
        skipped: number;
      };
      errorMessage?: string | undefined;
      status: 'completed' | 'failed';
      syncMode: string;
    }[];
    failedCount: number;
    mode: 'batch';
    profile: string;
    runStats?: import('@exitbook/observability').MetricsSummary | undefined;
    totalCount: number;
  };
  meta: {
    timestamp: string;
  };
}

type ImportCommandExecution =
  | {
      kind: 'batch';
      result: BatchImportExecuteResult;
    }
  | {
      account: Account;
      kind: 'single';
      result: ImportExecuteResult;
    };

export function registerImportCommand(program: Command, appRuntime: CliAppRuntime): void {
  program
    .command('import')
    .description('Sync raw data for an existing account')
    .option('--account <name>', 'Named account to sync')
    .option('--account-id <number>', 'Account ID to sync', parseInt)
    .option('--all', 'Sync all top-level accounts in the selected profile')
    .option('--json', 'Output results in JSON format')
    .option('--verbose', 'Show verbose logging output')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook import --account kraken-main
  $ exitbook import --account wallet-main
  $ exitbook import --all
  $ exitbook import --account-id 42 --json
`
    )
    .action((rawOptions: unknown) => executeImportCommand(rawOptions, appRuntime));
}

async function executeImportCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const command = 'import';
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command,
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, ImportCommandOptionsSchema);
        return yield* await executeImportCommandResult(options, format, appRuntime);
      }),
  });
}

async function executeImportCommandResult(
  options: ImportCommandOptions,
  format: CliOutputFormat,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'import',
    appRuntime,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const execution = yield* toCliResult(
          await withImportCommandScope(ctx, async (scope) =>
            resultDoAsync(async function* () {
              if (options.all) {
                const result = yield* await runImportAll(scope, { format });
                return {
                  kind: 'batch' as const,
                  result,
                };
              }

              const account = yield* await resolveImportAccount(scope, options);
              const result = yield* await runImport(scope, { format }, buildSingleImportParams(account, format));
              return {
                kind: 'single' as const,
                account,
                result,
              };
            })
          ),
          ExitCodes.GENERAL_ERROR
        );

        return buildImportCompletion(execution, format);
      }),
  });
}

function buildSingleImportParams(account: Account, format: CliOutputFormat) {
  if (format === 'json') {
    return {
      accountId: account.id,
    };
  }

  return {
    accountId: account.id,
    onSingleAddressWarning: async () => {
      process.stderr.write('\n⚠  Single address import (incomplete wallet view)\n\n');
      process.stderr.write('Single address tracking has limitations:\n');
      process.stderr.write('  • Cannot distinguish internal transfers from external sends\n');
      process.stderr.write('  • Change to other addresses will appear as withdrawals\n');
      process.stderr.write('  • Multi-address transactions may show incorrect amounts\n\n');
      process.stderr.write('For complete wallet tracking, create a separate xpub account instead:\n');
      process.stderr.write(
        `  $ exitbook accounts add wallet-xpub --blockchain ${account.platformKey} --address xpub... --xpub-gap 20\n`
      );
      process.stderr.write('  $ exitbook import --account wallet-xpub\n\n');
      process.stderr.write('Note: xpub imports reveal all wallet addresses (privacy trade-off)\n\n');
      return await promptConfirm('Continue with single address import?', false);
    },
  };
}

function buildImportCompletion(execution: ImportCommandExecution, format: CliOutputFormat) {
  if (execution.kind === 'batch') {
    const exitCode = execution.result.failedCount > 0 ? ExitCodes.GENERAL_ERROR : undefined;
    if (format === 'json') {
      return jsonSuccess(buildBatchImportResult(execution.result), undefined, exitCode);
    }

    return silentSuccess(exitCode);
  }

  if (format === 'json') {
    return jsonSuccess(buildImportResult(execution.result, execution.account));
  }

  return silentSuccess();
}

function buildImportResult(importResult: ImportExecuteResult, account: Account): ImportCommandResult {
  const totalImported = importResult.sessions.reduce((sum, session) => sum + session.transactionsImported, 0);
  const totalSkipped = importResult.sessions.reduce((sum, session) => sum + session.transactionsSkipped, 0);

  return {
    status: 'success',
    import: {
      mode: 'single',
      account: {
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        platformKey: account.platformKey,
      },
      counts: {
        imported: totalImported,
        skipped: totalSkipped,
      },
      importSessions:
        importResult.sessions.length > 0
          ? importResult.sessions.map((session) => buildSessionSummary(session))
          : undefined,
      runStats: importResult.runStats,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}

function buildBatchImportResult(importResult: BatchImportExecuteResult): BatchImportCommandResult {
  return {
    status: importResult.failedCount > 0 ? 'partial-failure' : 'success',
    import: {
      accounts: importResult.accounts.map((accountResult) => ({
        account: accountResult.account,
        counts: accountResult.counts,
        errorMessage: accountResult.errorMessage,
        status: accountResult.status,
        syncMode: accountResult.syncMode,
      })),
      failedCount: importResult.failedCount,
      mode: 'batch',
      profile: importResult.profileDisplayName,
      runStats: importResult.runStats,
      totalCount: importResult.totalCount,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}

function buildSessionSummary(session: ImportSession): ImportSessionSummary {
  return {
    id: session.id,
    accountId: session.accountId,
    startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : undefined,
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : undefined,
    status: session.status,
  };
}
