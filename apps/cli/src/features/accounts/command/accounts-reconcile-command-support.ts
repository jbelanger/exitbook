import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  type CliCommandResult,
  type CliCompletion,
  type ExitCode,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsWithOverridesResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { createCliCommandResourceFactories } from '../../../runtime/command-capability-factories.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { getAccountSelectorErrorExitCode, resolveOwnedOptionalAccountSelector } from '../account-selector.js';
import { createCliAccountLifecycleService } from '../account-service.js';

import { AccountsReconcileCommandOptionsSchema } from './accounts-option-schemas.js';
import { AccountsReconcileRunner } from './accounts-reconcile-runner.js';
import { logAccountsReconcileResult } from './accounts-reconcile-text-presentation.js';
import type { AccountsReconcileOptions, AccountsReconcileResult } from './accounts-reconcile-types.js';
import { sortAccountsByRefreshPriority } from './accounts-refresh-utils.js';

type AccountsReconcileCommandOptions = z.infer<typeof AccountsReconcileCommandOptionsSchema>;

const ACCOUNTS_RECONCILE_COMMAND_ID = 'accounts-reconcile';

interface ExecuteAccountsReconcileCommandInput {
  appRuntime: CliAppRuntime;
  rawOptions: unknown;
  selector: string | undefined;
}

export function buildAccountsReconcileHelpText(): string {
  return `
Examples:
  $ exitbook accounts reconcile
  $ exitbook accounts reconcile ethereum-main
  $ exitbook accounts reconcile ethereum-main --reference live
  $ exitbook accounts reconcile ethereum-main --refresh-live --all
  $ exitbook accounts reconcile --json

Notes:
  - Reconcile compares ledger-native balances against a selected reference.
  - The default reference is the latest stored live balance snapshot; it does not hit providers.
  - Use --reference live or --refresh-live to refresh live balances before comparing.
  - Text output shows issue rows by default; use --all to include matched rows.
  - Use --strict for CI-style non-zero exit when any scope is not fully matched.
`;
}

export async function executeAccountsReconcileCommand(input: ExecuteAccountsReconcileCommandInput): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    command: ACCOUNTS_RECONCILE_COMMAND_ID,
    format,
    appRuntime: input.appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          input.rawOptions,
          { selector: input.selector },
          AccountsReconcileCommandOptionsSchema
        );
      }),
    action: async (context) => executeAccountsReconcileCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeAccountsReconcileCommandResult(
  ctx: CommandRuntime,
  options: AccountsReconcileCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  const runnerOptions = toRunnerOptions(options);
  const database = await ctx.openDatabaseSession();

  const profileResult = await resolveCommandProfile(ctx, database);
  if (profileResult.isErr()) {
    return cliErr(profileResult.error, ExitCodes.CONFIG_ERROR);
  }
  const profile = profileResult.value;

  const readyResult = await ensureProcessedTransactionsReady(ctx, {
    format,
    profileId: profile.id,
  });
  if (readyResult.isErr()) {
    return cliErr(readyResult.error, ExitCodes.GENERAL_ERROR);
  }

  const accountService = createCliAccountLifecycleService(database);
  const selectionResult = await resolveOwnedOptionalAccountSelector(accountService, profile.id, options.selector);
  if (selectionResult.isErr()) {
    return cliErr(selectionResult.error, getAccountSelectorErrorExitCode(selectionResult.error));
  }

  const accountsResult = selectionResult.value
    ? ok([selectionResult.value.account])
    : await accountService.listTopLevel(profile.id);
  if (accountsResult.isErr()) {
    return cliErr(accountsResult.error, ExitCodes.DATABASE_ERROR);
  }

  if (accountsResult.value.length === 0) {
    return cliErr(new Error('No accounts found for the selected profile'), ExitCodes.NOT_FOUND);
  }

  const balanceWorkflow =
    runnerOptions.referenceSource === 'live'
      ? await createCliCommandResourceFactories(ctx, database).balanceWorkflowFactory.getOrCreate()
      : undefined;
  const runner = new AccountsReconcileRunner({ db: database, balanceWorkflow });
  const sortedAccounts = sortAccountsByRefreshPriority(
    accountsResult.value.map((account) => ({
      accountId: account.id,
      accountType: account.accountType,
      account,
    }))
  ).map((item) => item.account);
  const result = await runner.reconcileAccounts(sortedAccounts, runnerOptions);
  if (result.isErr()) {
    return cliErr(result.error, ExitCodes.GENERAL_ERROR);
  }

  const freshnessResult = await annotateStoredReferenceFreshness(database, result.value);
  if (freshnessResult.isErr()) {
    return cliErr(freshnessResult.error, ExitCodes.DATABASE_ERROR);
  }

  return format === 'json'
    ? buildJsonCompletion(result.value, runnerOptions)
    : buildTextCompletion(result.value, runnerOptions);
}

function toRunnerOptions(options: AccountsReconcileCommandOptions): AccountsReconcileOptions {
  return {
    includeMatchedRows: options.all === true,
    referenceSource: options.refreshLive === true ? 'live' : (options.reference ?? 'stored'),
    strict: options.strict === true,
    tolerance: options.tolerance,
  };
}

function buildJsonCompletion(
  result: AccountsReconcileResult,
  options: AccountsReconcileOptions
): Result<CliCompletion, never> {
  return ok(jsonSuccess(result, { timestamp: new Date().toISOString() }, getReconcileExitCode(result, options)));
}

function buildTextCompletion(
  result: AccountsReconcileResult,
  options: AccountsReconcileOptions
): Result<CliCompletion, never> {
  return ok(
    textSuccess(
      () =>
        logAccountsReconcileResult(result, {
          includeMatchedRows: options.includeMatchedRows,
        }),
      getReconcileExitCode(result, options)
    )
  );
}

function getReconcileExitCode(result: AccountsReconcileResult, options: AccountsReconcileOptions): ExitCode {
  if (!options.strict || result.status === 'matched') {
    return ExitCodes.SUCCESS;
  }

  return ExitCodes.GENERAL_ERROR;
}

async function annotateStoredReferenceFreshness(
  database: DataSession,
  result: AccountsReconcileResult
): Promise<Result<void, Error>> {
  if (result.referenceSource !== 'stored') {
    return ok(undefined);
  }

  const freshnessPorts = buildBalancesFreshnessPorts(database);
  for (const scope of result.scopes) {
    const freshnessResult = await freshnessPorts.checkFreshness(scope.account.id);
    if (freshnessResult.isErr()) {
      return err(freshnessResult.error);
    }

    if (freshnessResult.value.status !== 'fresh') {
      scope.diagnostics.reason =
        scope.diagnostics.reason ??
        `Stored balance snapshot is ${freshnessResult.value.status}: ${freshnessResult.value.reason ?? 'no detail'}`;
    }
  }

  return ok(undefined);
}
