import pc from 'picocolors';

import { formatAccountSelectorLabel } from '../../accounts/account-selector.js';

import type {
  EvmFamilyLedgerStressDiff,
  EvmFamilyLedgerStressResult,
  EvmFamilyLedgerStressScopeResult,
} from './evm-family-ledger-stress-types.js';

export function logEvmFamilyLedgerStressResult(result: EvmFamilyLedgerStressResult): void {
  console.log(pc.bold('EVM-family ledger stress'));
  console.log(`Chains: ${formatChains(result.chains)}`);
  console.log();

  for (const scope of result.scopes) {
    logScope(scope);
  }

  if (result.staleExpectedDiffs.length > 0) {
    console.log(pc.bold('Stale expected diffs'));
    for (const diff of result.staleExpectedDiffs) {
      console.log(
        `  ${diff.accountFingerprint.slice(0, 10)} ${diff.assetId} ${pc.dim(diff.balanceCategory)} delta ${diff.delta}`
      );
      console.log(pc.dim(`    ${diff.reason}`));
    }
    console.log();
  }

  console.log(pc.bold('Summary'));
  console.log(
    [
      `${result.summary.checkedAccounts} accounts`,
      `${result.summary.rawRows} raw rows`,
      `${result.summary.legacyTransactions} legacy txs`,
      `${result.summary.ledgerSourceActivities} source activities`,
      `${result.summary.ledgerJournals} journals`,
      `${result.summary.ledgerPostings} postings`,
      `${result.summary.unexpectedDiffs} unexpected diffs`,
      `${result.summary.acceptedDiffs} accepted diffs`,
      `${result.summary.staleExpectedDiffs} stale expected`,
    ].join(' | ')
  );
}

function logScope(scope: EvmFamilyLedgerStressScopeResult): void {
  const status = colorScopeStatus(scope.status, scope.status.toUpperCase());
  console.log(`${status} ${formatAccountSelectorLabel(scope.account)} (${scope.account.platformKey})`);

  if (scope.diagnostics.reason) {
    console.log(`  ${pc.dim(scope.diagnostics.reason)}`);
  } else {
    console.log(
      pc.dim(
        `  ${scope.diagnostics.rawRows} raw rows; ${scope.diagnostics.legacyTransactions} legacy txs; ${scope.diagnostics.ledgerSourceActivities} source activities; ${scope.diagnostics.ledgerJournals} journals; ${scope.diagnostics.ledgerPostings} postings`
      )
    );
  }

  for (const diff of scope.diffs) {
    logDiff(diff);
  }

  console.log();
}

function logDiff(diff: EvmFamilyLedgerStressDiff): void {
  const status = diff.status === 'accepted_diff' ? pc.yellow('accepted') : pc.red('unexpected');
  const delta = formatSignedQuantity(diff.delta);
  console.log(
    `  ${status} ${diff.assetSymbol} ${pc.dim(diff.balanceCategory)} ledger ${diff.ledgerQuantity} legacy ${diff.referenceQuantity} delta ${delta}`
  );
  console.log(pc.dim(`    ${diff.assetId}; ${diff.postingFingerprints.length} posting refs`));

  if (diff.expectedReason) {
    console.log(pc.dim(`    ${diff.expectedReason}`));
  }
}

function colorScopeStatus(status: EvmFamilyLedgerStressScopeResult['status'], label: string): string {
  switch (status) {
    case 'passed':
      return pc.green(label);
    case 'accepted_diffs':
      return pc.yellow(label);
    case 'failed':
      return pc.red(label);
    case 'unavailable':
      return pc.gray(label);
  }
}

function formatChains(chains: readonly string[]): string {
  const visibleCoreChains = chains.filter((chain) => ['arbitrum', 'avalanche', 'ethereum', 'theta'].includes(chain));
  if (visibleCoreChains.length === 4 && chains.length > 8) {
    return `all EVM-compatible chains plus theta (${chains.length} chains)`;
  }

  return chains.join(', ');
}

function formatSignedQuantity(quantity: string): string {
  if (quantity.startsWith('-') || quantity === '0') {
    return quantity;
  }

  return `+${quantity}`;
}
