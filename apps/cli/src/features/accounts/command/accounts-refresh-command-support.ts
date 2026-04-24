import type { Account } from '@exitbook/core';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import pc from 'picocolors';
import type { z } from 'zod';

import {
  cliErr,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  type CliCommandResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsWithOverridesResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  formatAccountSelectorLabel,
  getAccountSelectorErrorExitCode,
  hasAccountSelectorArgument,
  resolveRequiredOwnedAccountSelector,
} from '../account-selector.js';

import { AccountsRefreshCommandOptionsSchema } from './accounts-option-schemas.js';
import { withAccountsRefreshScope, type AccountsRefreshScope } from './accounts-refresh-scope.js';
import { logSingleRefreshResult, runAccountsRefreshAllTextWorkflow } from './accounts-refresh-text-presentation.js';
import type { AllAccountsRefreshResult, SingleRefreshResult } from './accounts-refresh-types.js';
import { runAccountsRefreshAll, runAccountsRefreshSingle } from './run-accounts-refresh.js';

type AccountsRefreshCommandOptions = z.infer<typeof AccountsRefreshCommandOptionsSchema>;

const ACCOUNTS_REFRESH_COMMAND_ID = 'accounts-refresh';
const ACCOUNTS_REFRESH_SELECTOR_REQUIRED_MESSAGE = 'Accounts refresh requires an account selector';

interface ExecuteAccountsRefreshCommandInput {
  appRuntime: CliAppRuntime;
  rawOptions: unknown;
  selector: string | undefined;
}

export function buildAccountsRefreshHelpText(): string {
  return `
Examples:
  $ exitbook accounts refresh
  $ exitbook accounts refresh kraken-main
  $ exitbook accounts refresh --json

Notes:
  - Refresh rebuilds calculated balances and verifies live data when providers support it.
  - Exchange refresh uses provider credentials stored on the account itself.
  - If no live balance provider exists for a scope, refresh persists calculated balances and marks verification unavailable.
  - For child accounts, refresh operates on the owning parent balance scope.
`;
}

export async function executeAccountsRefreshCommand(input: ExecuteAccountsRefreshCommandInput): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    command: ACCOUNTS_REFRESH_COMMAND_ID,
    format,
    appRuntime: input.appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          input.rawOptions,
          { selector: input.selector },
          AccountsRefreshCommandOptionsSchema
        );
      }),
    action: async (context) => executeAccountsRefreshCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeAccountsRefreshCommandResult(
  ctx: CommandRuntime,
  options: AccountsRefreshCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  if (format === 'json') {
    return hasAccountSelectorArgument(options)
      ? executeAccountsRefreshSingleJsonCommand(ctx, options)
      : executeAccountsRefreshAllJsonCommand(ctx);
  }

  return hasAccountSelectorArgument(options)
    ? executeAccountsRefreshSingleTextCommand(ctx, options)
    : executeAccountsRefreshAllTextCommand(ctx);
}

async function executeAccountsRefreshSingleJsonCommand(
  ctx: CommandRuntime,
  options: AccountsRefreshCommandOptions
): Promise<CliCommandResult> {
  return executeWithAccountsRefreshScope(ctx, 'json', async (scope) => {
    const result = await runSingleAccountsRefresh(scope, options.selector);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok(buildAccountsRefreshSingleJsonCompletion(result.value));
  });
}

async function executeAccountsRefreshAllJsonCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return executeWithAccountsRefreshScope(ctx, 'json', async (scope) => {
    const result = await runAccountsRefreshAll(scope);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok(buildAccountsRefreshAllJsonCompletion(result.value));
  });
}

async function executeAccountsRefreshSingleTextCommand(
  ctx: CommandRuntime,
  options: AccountsRefreshCommandOptions
): Promise<CliCommandResult> {
  return executeWithAccountsRefreshScope(ctx, 'text', async (scope) => {
    const result = await runSingleAccountsRefresh(scope, options.selector, (requestedAccount) => {
      console.log(pc.dim(`Refreshing ${formatRefreshAccountLabel(requestedAccount)}...`));
    });
    if (result.isErr()) {
      return err(result.error);
    }

    logSingleRefreshResult(result.value);
    return ok(silentSuccess());
  });
}

async function executeAccountsRefreshAllTextCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return executeWithAccountsRefreshScope(ctx, 'text', async (scope) => runAccountsRefreshAllTextWorkflow(ctx, scope));
}

async function executeWithAccountsRefreshScope(
  ctx: CommandRuntime,
  format: 'json' | 'text',
  operation: (scope: AccountsRefreshScope) => Promise<Result<CliCompletion, Error>>
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withAccountsRefreshScope(ctx, { format, needsWorkflow: true }, operation);

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function runSingleAccountsRefresh(
  scope: AccountsRefreshScope,
  selector: string | undefined,
  onSelectedAccount?: (account: Account) => void
): Promise<Result<SingleRefreshResult, Error>> {
  const selection = await resolveRequiredOwnedAccountSelector(
    scope.accountService,
    scope.profile.id,
    selector,
    ACCOUNTS_REFRESH_SELECTOR_REQUIRED_MESSAGE
  );
  if (selection.isErr()) {
    return err(selection.error);
  }

  onSelectedAccount?.(selection.value.account);
  return runAccountsRefreshSingle(scope, {
    accountId: selection.value.account.id,
  });
}

function buildAccountsRefreshSingleJsonCompletion(result: SingleRefreshResult): CliCompletion {
  const { account, requestedAccount, verificationResult, streamMetadata } = result;

  return jsonSuccess({
    status: verificationResult.status,
    mode: result.mode,
    balances:
      result.mode === 'verification'
        ? result.comparisons
        : result.assets.map((asset) => ({
            assetId: asset.assetId,
            assetSymbol: asset.assetSymbol,
            calculatedBalance: asset.calculatedBalance,
            diagnostics: asset.diagnostics,
          })),
    summary: verificationResult.summary,
    coverage: verificationResult.coverage,
    ledgerBalanceShadow: result.ledgerBalanceShadow,
    source: {
      type: account.accountType === 'blockchain' ? 'blockchain' : 'exchange',
      name: account.platformKey,
      address: account.accountType === 'blockchain' ? account.identifier : undefined,
    },
    account: {
      id: account.id,
      type: account.accountType,
      platformKey: account.platformKey,
      identifier: account.identifier,
      providerName: account.providerName,
    },
    ...(requestedAccount && {
      requestedAccount: {
        id: requestedAccount.id,
        type: requestedAccount.accountType,
        platformKey: requestedAccount.platformKey,
        identifier: requestedAccount.identifier,
        providerName: requestedAccount.providerName,
      },
    }),
    meta: {
      timestamp: new Date(verificationResult.timestamp).toISOString(),
      ...(streamMetadata && { streams: streamMetadata }),
    },
    suggestion: verificationResult.suggestion,
    partialFailures: verificationResult.partialFailures,
    warnings: verificationResult.warnings,
  });
}

function buildAccountsRefreshAllJsonCompletion(result: AllAccountsRefreshResult): CliCompletion {
  return jsonSuccess(
    { accounts: result.accounts },
    {
      totalAccounts: result.totals.total,
      verified: result.totals.verified,
      skipped: result.totals.skipped,
      errors: result.totals.errors,
      matches: result.totals.matches,
      mismatches: result.totals.mismatches,
      warnings: result.totals.warnings,
      partialCoverageScopes: result.totals.partialCoverageScopes,
      timestamp: new Date().toISOString(),
    }
  );
}

function formatRefreshAccountLabel(account: Pick<Account, 'accountFingerprint' | 'name' | 'platformKey'>): string {
  return `${formatAccountSelectorLabel(account)} (${account.platformKey})`;
}
