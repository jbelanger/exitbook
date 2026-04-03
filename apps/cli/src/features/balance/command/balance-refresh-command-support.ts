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
import { formatSuccessLine } from '../../../cli/success.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import {
  formatAccountSelectorLabel,
  getAccountSelectorErrorExitCode,
  hasAccountSelectorArgument,
  resolveRequiredOwnedAccountSelector,
} from '../../accounts/account-selector.js';
import type { BalanceEvent } from '../view/balance-view-state.js';

import { withBalanceCommandScope, type BalanceCommandScope } from './balance-command-scope.js';
import type { AllAccountsVerificationResult, SingleRefreshResult } from './balance-handler-types.js';
import { BalanceRefreshCommandOptionsSchema } from './balance-option-schemas.js';
import {
  abortBalanceVerification,
  awaitBalanceVerificationStream,
  loadBalanceVerificationAccounts,
  runBalanceRefreshAll,
  runBalanceRefreshSingle,
  startBalanceVerificationStream,
} from './run-balance.js';

type BalanceRefreshCommandOptions = z.infer<typeof BalanceRefreshCommandOptionsSchema>;

interface ExecuteStoredBalanceRefreshCommandInput {
  appRuntime: CliAppRuntime;
  commandId: string;
  selector: string | undefined;
  selectorRequiredMessage: string;
  rawOptions: unknown;
}

interface RefreshTextProgressTotals {
  errors: number;
  matches: number;
  mismatches: number;
  skipped: number;
  total: number;
  verified: number;
}

export function buildStoredBalanceRefreshHelpText(params: {
  canonicalCommandPath: string;
  examplesCommandPath: string;
  preferCanonical: boolean;
}): string {
  return `
Examples:
  $ ${params.examplesCommandPath}
  $ ${params.examplesCommandPath} kraken-main
  $ ${params.examplesCommandPath} --json

Notes:
  - Refresh rebuilds calculated balances and verifies live data when providers support it.
  - Exchange refresh uses provider credentials stored on the account itself.
  - If no live balance provider exists for a scope, refresh persists calculated balances and marks verification unavailable.
  - For child accounts, refresh operates on the owning parent balance scope.
  - Prefer "${params.canonicalCommandPath}" for balance refresh workflows.${params.preferCanonical ? '' : ' This command remains available as a compatibility alias.'}
`;
}

export async function executeStoredBalanceRefreshCommand(
  input: ExecuteStoredBalanceRefreshCommandInput
): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    command: input.commandId,
    format,
    appRuntime: input.appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          input.rawOptions,
          { selector: input.selector },
          BalanceRefreshCommandOptionsSchema
        );
      }),
    action: async (context) =>
      executeStoredBalanceRefreshCommandResult(
        context.runtime,
        context.prepared,
        format,
        input.selectorRequiredMessage
      ),
  });
}

async function executeStoredBalanceRefreshCommandResult(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions,
  format: 'json' | 'text',
  selectorRequiredMessage: string
): Promise<CliCommandResult> {
  if (format === 'json') {
    return hasAccountSelectorArgument(options)
      ? executeBalanceRefreshSingleJsonCommand(ctx, options, selectorRequiredMessage)
      : executeBalanceRefreshAllJsonCommand(ctx);
  }

  return hasAccountSelectorArgument(options)
    ? executeBalanceRefreshSingleTextCommand(ctx, options, selectorRequiredMessage)
    : executeBalanceRefreshAllTextCommand(ctx);
}

async function executeBalanceRefreshSingleJsonCommand(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions,
  selectorRequiredMessage: string
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'json', needsWorkflow: true }, async (scope) => {
      const selection = await resolveRequiredOwnedAccountSelector(
        scope.accountService,
        scope.profile.id,
        options.selector,
        selectorRequiredMessage
      );
      if (selection.isErr()) {
        return err(selection.error);
      }

      const result = await runBalanceRefreshSingle(scope, {
        accountId: selection.value.account.id,
      });
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(buildBalanceRefreshSingleJsonCompletion(result.value));
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshAllJsonCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'json', needsWorkflow: true }, async (scope) => {
      const result = await runBalanceRefreshAll(scope);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(buildBalanceRefreshAllJsonCompletion(result.value));
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshSingleTextCommand(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions,
  selectorRequiredMessage: string
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, async (scope) => {
      const selection = await resolveRequiredOwnedAccountSelector(
        scope.accountService,
        scope.profile.id,
        options.selector,
        selectorRequiredMessage
      );
      if (selection.isErr()) {
        return err(selection.error);
      }

      const requestedAccount = selection.value.account;
      console.log(pc.dim(`Refreshing ${formatRefreshAccountLabel(requestedAccount)}...`));

      const result = await runBalanceRefreshSingle(scope, {
        accountId: requestedAccount.id,
      });
      if (result.isErr()) {
        return err(result.error);
      }

      logSingleRefreshResult(result.value);
      return ok(silentSuccess());
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshAllTextCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, async (scope) =>
      runBalanceRefreshAllTextWorkflow(ctx, scope)
    );

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

function buildBalanceRefreshSingleJsonCompletion(result: SingleRefreshResult): CliCompletion {
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

function buildBalanceRefreshAllJsonCompletion(result: AllAccountsVerificationResult): CliCompletion {
  return jsonSuccess(
    { accounts: result.accounts },
    {
      totalAccounts: result.totals.total,
      verified: result.totals.verified,
      skipped: result.totals.skipped,
      matches: result.totals.matches,
      mismatches: result.totals.mismatches,
      timestamp: new Date().toISOString(),
    }
  );
}

async function runBalanceRefreshAllTextWorkflow(
  ctx: CommandRuntime,
  scope: BalanceCommandScope
): Promise<Result<CliCompletion, Error>> {
  const sortedResult = await loadBalanceVerificationAccounts(scope);
  if (sortedResult.isErr()) {
    return err(sortedResult.error);
  }

  const accounts = sortedResult.value;
  const relay = new EventRelay<BalanceEvent>();
  const labels = new Map(accounts.map((item) => [item.accountId, formatRefreshAccountLabel(item.account)]));
  const totals: RefreshTextProgressTotals = {
    total: accounts.length,
    skipped: 0,
    verified: 0,
    matches: 0,
    mismatches: 0,
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
        totals.mismatches += event.result.mismatchCount + event.result.warningCount;
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

  startBalanceVerificationStream(scope, accounts, relay);
  ctx.onAbort(() => abortBalanceVerification(scope));
  await awaitBalanceVerificationStream(scope);

  console.log('');
  console.log(
    formatSuccessLine(
      `Refresh complete: ${totals.total} total · ${totals.verified} verified · ${totals.skipped} skipped · ${totals.errors} errors`
    )
  );
  console.log(pc.dim(`Matches: ${totals.matches} · mismatches/warnings: ${totals.mismatches}`));

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
    status: 'error' | 'failed' | 'pending' | 'skipped' | 'success' | 'verifying' | 'warning';
    warningCount: number;
  }
): string {
  const message = `${label}: ${result.status} · ${result.matchCount} match · ${result.mismatchCount} mismatch · ${result.warningCount} warning`;

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
