import type { Account, ImportSession } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
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
  const { format, options } = parseCliCommandOptions('import', rawOptions, ImportCommandOptionsSchema);

  if (format === 'json') {
    await executeImportJSON(options, appRuntime);
  } else {
    await executeImportTUI(options, appRuntime);
  }
}

async function executeImportJSON(options: ImportCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const executionResult = await withImportCommandScope(ctx, async (scope) => {
        if (options.all) {
          const result = await runImportAll(scope, { format: 'json' });
          if (result.isErr()) {
            return err(result.error);
          }

          outputSuccess('import', buildBatchImportResult(result.value));
          return ok(result.value.failedCount);
        }

        const accountResult = await resolveImportAccount(scope, options);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }

        const result = await runImport(scope, { format: 'json' }, { accountId: accountResult.value.id });
        if (result.isErr()) {
          return err(result.error);
        }

        outputSuccess('import', buildImportResult(result.value, accountResult.value));
        return ok(0);
      });
      if (executionResult.isErr()) {
        displayCliError('import', executionResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      if (executionResult.value > 0) {
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
      }
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

async function executeImportTUI(options: ImportCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const executionResult = await withImportCommandScope(ctx, async (scope) => {
        if (options.all) {
          const result = await runImportAll(scope, { format: 'text' });
          if (result.isErr()) {
            return err(result.error);
          }

          return ok(result.value.failedCount);
        }

        const accountResult = await resolveImportAccount(scope, options);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }

        const result = await runImport(
          scope,
          { format: 'text' },
          {
            accountId: accountResult.value.id,
            onSingleAddressWarning: async () => {
              process.stderr.write('\n⚠  Single address import (incomplete wallet view)\n\n');
              process.stderr.write('Single address tracking has limitations:\n');
              process.stderr.write('  • Cannot distinguish internal transfers from external sends\n');
              process.stderr.write('  • Change to other addresses will appear as withdrawals\n');
              process.stderr.write('  • Multi-address transactions may show incorrect amounts\n\n');
              process.stderr.write('For complete wallet tracking, create a separate xpub account instead:\n');
              process.stderr.write(
                `  $ exitbook accounts add wallet-xpub --blockchain ${accountResult.value.platformKey} --address xpub... --xpub-gap 20\n`
              );
              process.stderr.write('  $ exitbook import --account wallet-xpub\n\n');
              process.stderr.write('Note: xpub imports reveal all wallet addresses (privacy trade-off)\n\n');
              return await promptConfirm('Continue with single address import?', false);
            },
          }
        );
        if (result.isErr()) {
          return err(result.error);
        }

        return ok(0);
      });
      if (executionResult.isErr()) {
        displayCliError('import', executionResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }
      if (executionResult.value > 0) {
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
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
