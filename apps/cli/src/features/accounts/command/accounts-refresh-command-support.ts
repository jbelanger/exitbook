import type { Account } from '@exitbook/core';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import pc from 'picocolors';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  type CliCommandResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsWithOverridesResult } from '../../../cli/options.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import {
  formatAccountSelectorLabel,
  getAccountSelectorErrorExitCode,
  hasAccountSelectorArgument,
  resolveRequiredOwnedAccountSelector,
} from '../account-selector.js';

import { AccountsRefreshCommandOptionsSchema } from './accounts-option-schemas.js';
import { withAccountsRefreshScope, type AccountsRefreshScope } from './accounts-refresh-scope.js';
import type { AccountsRefreshEvent, AllAccountsRefreshResult, SingleRefreshResult } from './accounts-refresh-types.js';
import {
  abortAccountsRefresh,
  awaitAccountsRefreshStream,
  loadAccountsRefreshTargets,
  runAccountsRefreshAll,
  runAccountsRefreshSingle,
  startAccountsRefreshStream,
} from './run-accounts-refresh.js';

type AccountsRefreshCommandOptions = z.infer<typeof AccountsRefreshCommandOptionsSchema>;

const ACCOUNTS_REFRESH_COMMAND_ID = 'accounts-refresh';
const ACCOUNTS_REFRESH_SELECTOR_REQUIRED_MESSAGE = 'Accounts refresh requires an account selector';

interface ExecuteAccountsRefreshCommandInput {
  appRuntime: CliAppRuntime;
  rawOptions: unknown;
  selector: string | undefined;
}

interface RefreshTextProgressTotals {
  errors: number;
  matches: number;
  mismatches: number;
  partialCoverageScopes: number;
  skipped: number;
  total: number;
  verified: number;
  warnings: number;
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

async function runAccountsRefreshAllTextWorkflow(
  ctx: CommandRuntime,
  scope: AccountsRefreshScope
): Promise<Result<CliCompletion, Error>> {
  const sortedResult = await loadAccountsRefreshTargets(scope);
  if (sortedResult.isErr()) {
    return err(sortedResult.error);
  }

  const accounts = sortedResult.value;
  const relay = new EventRelay<AccountsRefreshEvent>();
  const labels = new Map(accounts.map((item) => [item.accountId, formatRefreshAccountLabel(item.account)]));
  const totals: RefreshTextProgressTotals = {
    total: accounts.length,
    skipped: 0,
    verified: 0,
    matches: 0,
    mismatches: 0,
    warnings: 0,
    partialCoverageScopes: 0,
    errors: 0,
  };

  console.log(pc.dim(`Refreshing balances for ${formatCount(accounts.length, 'account')}...`));

  for (const account of accounts) {
    if (!account.skipReason) {
      continue;
    }

    totals.skipped += 1;
    console.log(pc.dim(`- ${labels.get(account.accountId) ?? account.accountId}: skipped (${account.skipReason})`));
  }

  relay.connect((event) => {
    switch (event.type) {
      case 'VERIFICATION_STARTED':
        console.log(pc.dim(`• ${labels.get(event.accountId) ?? event.accountId}: refreshing...`));
        return;
      case 'VERIFICATION_COMPLETED':
        totals.verified += 1;
        totals.matches += event.result.matchCount;
        totals.mismatches += event.result.mismatchCount;
        totals.warnings += event.result.warningCount;
        totals.partialCoverageScopes += event.result.partialCoverageCount;
        console.log(formatRefreshCompletionLine(labels.get(event.accountId) ?? `${event.accountId}`, event.result));
        return;
      case 'VERIFICATION_ERROR':
        totals.errors += 1;
        console.log(pc.red(`✗ ${labels.get(event.accountId) ?? event.accountId}: ${event.error}`));
        return;
      case 'VERIFICATION_SKIPPED':
        return;
      case 'ABORTING':
        console.log(pc.yellow('Aborting refresh...'));
        return;
      case 'ALL_VERIFICATIONS_COMPLETE':
        return;
    }
  });

  startAccountsRefreshStream(scope, accounts, relay);
  ctx.onAbort(() => abortAccountsRefresh(scope));
  const streamStatus = await awaitAccountsRefreshStream(scope);

  console.log('');
  const completionLine = `${totals.total} total · ${totals.verified} verified · ${totals.skipped} skipped · ${totals.errors} errors`;

  if (streamStatus === 'aborted') {
    console.log(pc.yellow(`Refresh aborted: ${completionLine}`));
    console.log(
      pc.dim(
        `Matches: ${totals.matches} · mismatches: ${totals.mismatches} · warnings: ${totals.warnings} · partial coverage scopes: ${totals.partialCoverageScopes}`
      )
    );
    return ok(silentSuccess(ExitCodes.CANCELLED));
  }

  console.log(formatRefreshWorkflowFooter(totals, completionLine));
  console.log(
    pc.dim(
      `Matches: ${totals.matches} · mismatches: ${totals.mismatches} · warnings: ${totals.warnings} · partial coverage scopes: ${totals.partialCoverageScopes}`
    )
  );

  return ok(silentSuccess());
}

function logSingleRefreshResult(result: SingleRefreshResult): void {
  const requestedLabel = formatRefreshAccountLabel(result.requestedAccount ?? result.account);
  const scopeLabel = formatRefreshAccountLabel(result.account);

  if (result.requestedAccount && result.requestedAccount.id !== result.account.id) {
    console.log(pc.dim(`Requested account: ${requestedLabel}`));
    console.log(pc.dim(`Balance scope: ${scopeLabel}`));
  }

  if (result.mode === 'calculated-only') {
    const warning = result.verificationResult.warnings?.[0] ?? 'Live verification unavailable.';
    console.log(pc.yellow(`! ${scopeLabel}: stored calculated balances only`));
    console.log(pc.dim(warning));
    console.log(
      pc.dim(
        `Assets: ${result.assets.length} · coverage ${result.verificationResult.coverage.status} (${result.verificationResult.coverage.confidence})`
      )
    );
    return;
  }

  const summary = result.verificationResult.summary;
  console.log(
    formatSuccessLine(
      `${scopeLabel}: ${result.verificationResult.status} · ${summary.matches} match · ${summary.mismatches} mismatch · ${summary.warnings} warning`
    )
  );
  console.log(
    pc.dim(
      `Assets: ${summary.totalCurrencies} · coverage ${result.verificationResult.coverage.status} (${result.verificationResult.coverage.confidence})`
    )
  );
}

function formatRefreshCompletionLine(
  label: string,
  result: {
    matchCount: number;
    mismatchCount: number;
    partialCoverageCount: number;
    status: 'error' | 'failed' | 'pending' | 'skipped' | 'success' | 'verifying' | 'warning';
    warningCount: number;
  }
): string {
  const coverageSuffix = result.partialCoverageCount > 0 ? ' · partial coverage' : '';
  const message = `${label}: ${result.status} · ${result.matchCount} match · ${result.mismatchCount} mismatch · ${result.warningCount} warning${coverageSuffix}`;

  switch (result.status) {
    case 'success':
      return formatSuccessLine(message);
    case 'warning':
      return pc.yellow(`! ${message}`);
    case 'failed':
    case 'error':
      return pc.red(`✗ ${message}`);
    case 'pending':
    case 'verifying':
    case 'skipped':
      return pc.dim(message);
  }
}

function formatRefreshAccountLabel(account: Pick<Account, 'accountFingerprint' | 'name' | 'platformKey'>): string {
  return `${formatAccountSelectorLabel(account)} (${account.platformKey})`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatRefreshWorkflowFooter(totals: RefreshTextProgressTotals, completionLine: string): string {
  if (totals.errors > 0 && totals.verified === 0) {
    return pc.red(`✗ Refresh finished with errors: ${completionLine}`);
  }

  if (totals.errors > 0 || totals.mismatches > 0 || totals.warnings > 0 || totals.partialCoverageScopes > 0) {
    return pc.yellow(`! Refresh finished with issues: ${completionLine}`);
  }

  return formatSuccessLine(`Refresh complete: ${completionLine}`);
}
