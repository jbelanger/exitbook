import type { Account } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import pc from 'picocolors';

import { ExitCodes, silentSuccess, type CliCompletion } from '../../../cli/command.js';
import { formatSuccessLine } from '../../../cli/success.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { isInteractiveTerminal } from '../../../runtime/interactive-terminal.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import { createSpinner, failSpinner, stopSpinner, type SpinnerWrapper } from '../../shared/spinner.js';
import { formatAccountSelectorLabel } from '../account-selector.js';

import type { AccountsRefreshScope } from './accounts-refresh-scope.js';
import type { AccountsRefreshEvent, SingleRefreshResult } from './accounts-refresh-types.js';
import {
  abortAccountsRefresh,
  awaitAccountsRefreshStream,
  loadAccountsRefreshTargets,
  startAccountsRefreshStream,
} from './run-accounts-refresh.js';

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

interface RefreshCompletionResult {
  matchCount: number;
  mismatchCount: number;
  partialCoverageCount: number;
  status: 'error' | 'failed' | 'pending' | 'skipped' | 'success' | 'verifying' | 'warning';
  warningCount: number;
}

export async function runAccountsRefreshAllTextWorkflow(
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
  const platformKeys = new Map(accounts.map((item) => [item.accountId, item.platformKey]));
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
  let needsImportGuidance = false;
  const interactive = isInteractiveTerminal();
  let activeSpinner: SpinnerWrapper | undefined;

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
      case 'VERIFICATION_STARTED': {
        const label = labels.get(event.accountId) ?? `${event.accountId}`;
        if (interactive) {
          activeSpinner = createSpinner(pc.dim(`${label}: refreshing...`), false);
        } else {
          console.log(pc.dim(`• ${label}: refreshing...`));
        }
        return;
      }
      case 'VERIFICATION_COMPLETED': {
        totals.verified += 1;
        totals.matches += event.result.matchCount;
        totals.mismatches += event.result.mismatchCount;
        totals.warnings += event.result.warningCount;
        totals.partialCoverageScopes += event.result.partialCoverageCount;
        const label = labels.get(event.accountId) ?? `${event.accountId}`;
        if (activeSpinner) {
          completeRefreshSpinner(activeSpinner, label, event.result);
          activeSpinner = undefined;
        } else {
          console.log(formatRefreshCompletionLine(label, event.result));
        }
        return;
      }
      case 'VERIFICATION_ERROR': {
        totals.errors += 1;
        const errorPresentation = formatBatchRefreshError(event.error, platformKeys.get(event.accountId) ?? undefined);
        needsImportGuidance ||= errorPresentation.needsImportGuidance;
        const label = labels.get(event.accountId) ?? `${event.accountId}`;
        if (activeSpinner) {
          failSpinner(activeSpinner, pc.red(`${label}: ${errorPresentation.message}`));
          activeSpinner = undefined;
        } else {
          console.log(pc.red(`✗ ${label}: ${errorPresentation.message}`));
        }
        return;
      }
      case 'VERIFICATION_SKIPPED':
        return;
      case 'ABORTING':
        stopSpinner(activeSpinner);
        activeSpinner = undefined;
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
  const completionLine = buildRefreshCompletionLine(totals);
  const detailsLine = buildRefreshOutcomeDetailsLine(totals);
  const importGuidanceLine = needsImportGuidance ? buildRefreshImportGuidanceLine() : undefined;

  if (streamStatus === 'aborted') {
    console.log(pc.yellow(`Refresh aborted: ${completionLine}`));
    if (detailsLine) {
      console.log(pc.dim(detailsLine));
    }
    if (importGuidanceLine) {
      console.log(pc.dim(importGuidanceLine));
    }
    return ok(silentSuccess(ExitCodes.CANCELLED));
  }

  console.log(formatRefreshWorkflowFooter(totals, completionLine));
  if (detailsLine) {
    console.log(pc.dim(detailsLine));
  }
  if (importGuidanceLine) {
    console.log(pc.dim(importGuidanceLine));
  }

  return ok(silentSuccess());
}

export function logSingleRefreshResult(result: SingleRefreshResult): void {
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
    logLedgerBalanceShadowSummary(result);
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
  logLedgerBalanceShadowSummary(result);
}

function completeRefreshSpinner(spinner: SpinnerWrapper, label: string, result: RefreshCompletionResult): void {
  const coverageSuffix = result.partialCoverageCount > 0 ? ' · partial coverage' : '';
  const message = `${label}: ${result.status} · ${result.matchCount} match · ${result.mismatchCount} mismatch · ${result.warningCount} warning${coverageSuffix}`;

  switch (result.status) {
    case 'success':
      stopSpinner(spinner, message);
      return;
    case 'warning':
      spinner.ora.stopAndPersist({ symbol: pc.yellow('!'), text: pc.yellow(message) });
      return;
    case 'failed':
    case 'error':
      failSpinner(spinner, pc.red(message));
      return;
    case 'pending':
    case 'verifying':
    case 'skipped':
      spinner.ora.stopAndPersist({ symbol: ' ', text: pc.dim(message) });
      return;
  }
}

function formatRefreshCompletionLine(label: string, result: RefreshCompletionResult): string {
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

function buildRefreshCompletionLine(totals: RefreshTextProgressTotals): string {
  return `${totals.total} total · ${totals.verified} verified · ${totals.skipped} skipped · ${formatCount(totals.errors, 'error')}`;
}

function buildRefreshOutcomeDetailsLine(totals: RefreshTextProgressTotals): string | undefined {
  const parts: string[] = [];

  if (totals.matches > 0) {
    parts.push(formatCount(totals.matches, 'match'));
  }
  if (totals.mismatches > 0) {
    parts.push(formatCount(totals.mismatches, 'mismatch'));
  }
  if (totals.warnings > 0) {
    parts.push(formatCount(totals.warnings, 'warning'));
  }
  if (totals.partialCoverageScopes > 0) {
    parts.push(formatPartialCoverageResultCount(totals.partialCoverageScopes));
  }

  return parts.length > 0 ? `Details: ${parts.join(' · ')}` : undefined;
}

function formatPartialCoverageResultCount(count: number): string {
  return `${count} partial coverage result${count === 1 ? '' : 's'}`;
}

function logLedgerBalanceShadowSummary(result: SingleRefreshResult): void {
  const shadow = result.ledgerBalanceShadow;
  if (shadow === undefined || shadow.status === 'unavailable') {
    return;
  }

  const message = `Ledger balance shadow: ${shadow.status} · ${shadow.summary.liveMatches} live match · ${shadow.summary.liveMismatches} live mismatch · ${shadow.summary.legacyDiffs} legacy diff`;
  const formatter = shadow.status === 'failed' ? pc.red : shadow.status === 'warning' ? pc.yellow : pc.dim;
  console.log(formatter(message));
}

function buildRefreshImportGuidanceLine(): string {
  return 'Next: run "exitbook import" for accounts without completed imported data, then rerun "exitbook accounts refresh".';
}

function formatBatchRefreshError(
  error: string,
  platformKey: string | undefined
): { message: string; needsImportGuidance: boolean } {
  if (platformKey) {
    if (error.startsWith(`No imported transaction data found for ${platformKey}.`)) {
      return {
        message: 'No imported transaction data found.',
        needsImportGuidance: true,
      };
    }

    if (error.startsWith(`No completed import found for ${platformKey}.`)) {
      return {
        message: 'No completed import found.',
        needsImportGuidance: true,
      };
    }
  }

  return { message: error, needsImportGuidance: false };
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
