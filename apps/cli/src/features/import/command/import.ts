import type { Account, ImportSession } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  type CliCommandResult,
} from '../../../cli/command.js';
import {
  detectCliOutputFormat,
  type CliOutputFormat,
  parseCliCommandOptionsWithOverridesResult,
} from '../../../cli/options.js';
import { promptConfirmDecision } from '../../../cli/prompts.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  getAccountSelectorErrorExitCode,
  resolveRequiredOwnedAccountSelector,
} from '../../accounts/account-selector.js';

import { withImportCommandScope, type ImportCommandScope } from './import-command-scope.js';
import { ImportCommandOptionsSchema } from './import-option-schemas.js';
import type { BatchImportExecuteResult, ImportExecuteResult } from './run-import.js';
import { runBatchImport, runSingleAccountImport } from './run-import.js';

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
      kind: 'single-cancelled';
    }
  | {
      account: Account;
      kind: 'single-completed';
      result: ImportExecuteResult;
    };

export function registerImportCommand(program: Command, appRuntime: CliAppRuntime): void {
  program
    .command('import')
    .description('Sync raw data for an existing account')
    .argument('[selector]', 'Account selector (name or fingerprint prefix)')
    .option('--all', 'Sync all top-level accounts in the selected profile')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook import kraken-main
  $ exitbook import wallet-main
  $ exitbook import 6f4c0d1a2b
  $ exitbook import --all
  $ exitbook import kraken-main --json
`
    )
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeImportCommand(selector, rawOptions, appRuntime)
    );
}

async function executeImportCommand(
  selector: string | undefined,
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const command = 'import';
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command,
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(rawOptions, { selector }, ImportCommandOptionsSchema);
      }),
    action: async (context) => executeImportCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeImportCommandResult(
  ctx: CommandRuntime,
  options: ImportCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const executionResult = await loadImportCommandExecution(ctx, options, format);

    if (executionResult.isErr()) {
      return yield* cliErr(executionResult.error, getAccountSelectorErrorExitCode(executionResult.error));
    }

    return buildImportCompletion(executionResult.value, format);
  });
}

async function loadImportCommandExecution(
  ctx: CommandRuntime,
  options: ImportCommandOptions,
  format: CliOutputFormat
): Promise<Result<ImportCommandExecution, Error>> {
  return withImportCommandScope(ctx, async (scope) => {
    if (options.all) {
      return loadBatchImportExecution(scope, format);
    }

    return loadSingleImportExecution(scope, options, format);
  });
}

async function loadBatchImportExecution(
  scope: ImportCommandScope,
  format: CliOutputFormat
): Promise<Result<ImportCommandExecution, Error>> {
  return resultDoAsync(async function* () {
    const result = yield* await runBatchImport(scope, { format });
    return {
      kind: 'batch' as const,
      result,
    };
  });
}

async function loadSingleImportExecution(
  scope: ImportCommandScope,
  options: ImportCommandOptions,
  format: CliOutputFormat
): Promise<Result<ImportCommandExecution, Error>> {
  return resultDoAsync(async function* () {
    const accountSelection = yield* await resolveRequiredOwnedAccountSelector(
      scope.accountService,
      scope.profile.id,
      options.selector,
      'Import requires an account selector or --all'
    );
    const account = accountSelection.account;
    const outcome = yield* await runSingleAccountImport(scope, { format }, buildSingleImportParams(account, format));
    if (outcome.kind === 'cancelled') {
      return {
        kind: 'single-cancelled' as const,
      };
    }

    return {
      kind: 'single-completed' as const,
      account,
      result: outcome.result,
    };
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
      process.stderr.write('  $ exitbook import wallet-xpub\n\n');
      process.stderr.write('Note: xpub imports reveal all wallet addresses (privacy trade-off)\n\n');
      return await promptConfirmDecision('Continue with single address import?', false);
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

  if (execution.kind === 'single-cancelled') {
    if (format === 'json') {
      return silentSuccess(ExitCodes.CANCELLED);
    }

    return textSuccess(() => {
      console.error('Import cancelled by user');
    }, ExitCodes.CANCELLED);
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
