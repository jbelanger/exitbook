import { buildTransactionBalanceImpact, type Account, type Transaction } from '@exitbook/core';
import { parseDecimal, tryParseDecimal } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

const logger = getLogger('balance-utils');

// ─── Types ──────────────────────────────────────────────────────────────────

/** Command-level status for balance verification */
export type BalanceCommandStatus = 'success' | 'warning' | 'failed';

export type BalancePartialFailureCode = 'child-account-fetch-failed' | 'balance-parse-failed';
export type BalancePartialFailureScope = 'address' | 'asset';

export interface BalancePartialFailure {
  code: BalancePartialFailureCode;
  message: string;
  scope: BalancePartialFailureScope;
  accountAddress?: string | undefined;
  assetId?: string | undefined;
  rawAmount?: string | undefined;
}

/**
 * Result from balance calculation including balances and asset metadata
 */
export interface BalanceCalculationResult {
  balances: Record<string, Decimal>; // assetId -> balance
  assetMetadata: Record<string, string>; // assetId -> assetSymbol
}

/**
 * Comparison result for a single asset balance
 */
export interface BalanceComparison {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
}

/**
 * Complete verification result for an account
 */
export interface BalanceVerificationResult {
  account: Account;
  mode?: 'verification' | 'calculated-only' | undefined;
  timestamp: number;
  status: BalanceCommandStatus;
  comparisons: BalanceComparison[];
  coverage: {
    confidence: 'high' | 'medium' | 'low';
    failedAddresses: number;
    failedAssets: number;
    overallCoverageRatio: number;
    parsedAssets: number;
    requestedAddresses: number;
    status: 'complete' | 'partial';
    successfulAddresses: number;
    totalAssets: number;
  };
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  partialFailures?: BalancePartialFailure[] | undefined;
  suggestion?: string | undefined;
  warnings?: string[] | undefined;
}

interface ConvertBalancesToDecimalsResult {
  balances: Record<string, Decimal>;
  coverage: {
    failedAssetCount: number;
    parsedAssetCount: number;
    totalAssetCount: number;
  };
  partialFailures: BalancePartialFailure[];
}

// ─── Balance calculation ────────────────────────────────────────────────────

/**
 * Calculate balances for all assets from a set of transactions.
 * Returns balances keyed by assetId and metadata mapping assetId -> assetSymbol for display.
 */
export function calculateBalances(transactions: Transaction[]): BalanceCalculationResult {
  const balances: Record<string, Decimal> = {};
  const assetMetadata: Record<string, string> = {};

  for (const transaction of transactions) {
    const balanceImpact = buildTransactionBalanceImpact(transaction);

    for (const assetImpact of balanceImpact.assets) {
      if (!balances[assetImpact.assetId]) {
        balances[assetImpact.assetId] = parseDecimal('0');
      }

      assetMetadata[assetImpact.assetId] = assetImpact.assetSymbol;
      balances[assetImpact.assetId] = balances[assetImpact.assetId]!.plus(assetImpact.netBalanceDelta);
    }
  }

  return { balances, assetMetadata };
}

// ─── Balance parsing ────────────────────────────────────────────────────────

/**
 * Convert balances from Record<string, string> to Record<string, Decimal> with explicit
 * structured partial-failure details. Invalid balances are excluded and reported.
 */
export function convertBalancesToDecimals(balances: Record<string, string>): ConvertBalancesToDecimalsResult {
  const decimalBalances: Record<string, Decimal> = {};
  const partialFailures: BalancePartialFailure[] = [];
  let parsedAssetCount = 0;

  for (const [assetId, amount] of Object.entries(balances)) {
    if (amount.trim().length === 0) {
      const message = `Failed to parse balance amount for ${assetId}: empty string is not a valid balance`;

      logger.warn({ assetId, amount }, 'Failed to parse balance amount; recording partial-failure metadata');

      partialFailures.push({
        code: 'balance-parse-failed',
        message,
        scope: 'asset',
        assetId,
        rawAmount: amount,
      });

      continue;
    }

    const parsed = { value: parseDecimal('0') };
    if (tryParseDecimal(amount, parsed)) {
      decimalBalances[assetId] = parsed.value;
      parsedAssetCount++;
    } else {
      const parseError = new Error(`Invalid decimal: ${amount}`);
      const message = `Failed to parse balance amount for ${assetId}: ${parseError.message}`;

      logger.warn(
        { error: parseError, assetId, amount },
        'Failed to parse balance amount; recording partial-failure metadata'
      );

      partialFailures.push({
        code: 'balance-parse-failed',
        message,
        scope: 'asset',
        assetId,
        rawAmount: amount,
      });
    }
  }

  return {
    balances: decimalBalances,
    coverage: {
      totalAssetCount: Object.keys(balances).length,
      parsedAssetCount,
      failedAssetCount: partialFailures.length,
    },
    partialFailures,
  };
}

// ─── Balance verification ───────────────────────────────────────────────────

/**
 * Compare calculated balances against live balances.
 * Pure function — no I/O.
 */
export function compareBalances(
  calculated: Record<string, Decimal>,
  live: Record<string, Decimal>,
  assetMetadata: Record<string, string>,
  tolerance = 0.00000001
): BalanceComparison[] {
  const comparisons: BalanceComparison[] = [];
  const allAssetIds = new Set([...Object.keys(calculated), ...Object.keys(live)]);

  for (const assetId of allAssetIds) {
    const calcBalance = calculated[assetId] || parseDecimal('0');
    const liveBalance = live[assetId] || parseDecimal('0');

    const difference = calcBalance.minus(liveBalance);
    const absDifference = difference.abs();

    let status: 'match' | 'warning' | 'mismatch';
    let percentageDiff = 0;

    if (absDifference.lessThanOrEqualTo(tolerance)) {
      status = 'match';
      percentageDiff = 0;
    } else {
      if (!liveBalance.isZero()) {
        percentageDiff = absDifference.dividedBy(liveBalance.abs()).times(100).toNumber();
      } else if (!calcBalance.isZero()) {
        percentageDiff = 100;
      }

      if (percentageDiff < 1) {
        status = 'warning';
      } else {
        status = 'mismatch';
      }
    }

    const assetSymbol = assetMetadata[assetId] ?? assetId;

    comparisons.push({
      assetId,
      assetSymbol,
      calculatedBalance: calcBalance.toFixed(),
      liveBalance: liveBalance.toFixed(),
      difference: difference.toFixed(),
      percentageDiff,
      status,
    });
  }

  return comparisons.sort((a, b) => {
    const absA = parseDecimal(a.calculatedBalance).abs();
    const absB = parseDecimal(b.calculatedBalance).abs();
    return absB.comparedTo(absA);
  });
}

/**
 * Assemble a verification result from comparisons.
 * Pure function — no I/O.
 */
export function createVerificationResult(
  account: Account,
  comparisons: BalanceComparison[],
  lastImportTimestamp?: number,
  hasTransactions = true,
  warnings?: string[],
  coverage?: BalanceVerificationResult['coverage'],
  partialFailures?: BalancePartialFailure[]
): BalanceVerificationResult {
  const summary = {
    totalCurrencies: comparisons.length,
    matches: comparisons.filter((c) => c.status === 'match').length,
    warnings: comparisons.filter((c) => c.status === 'warning').length,
    mismatches: comparisons.filter((c) => c.status === 'mismatch').length,
  };

  const effectiveCoverage: BalanceVerificationResult['coverage'] = coverage ?? {
    status: 'complete',
    confidence: 'high',
    requestedAddresses: 1,
    successfulAddresses: 1,
    failedAddresses: 0,
    totalAssets: comparisons.length,
    parsedAssets: comparisons.length,
    failedAssets: 0,
    overallCoverageRatio: 1,
  };

  let status: 'success' | 'warning' | 'failed';
  if (summary.mismatches > 0 && hasTransactions) {
    status = 'failed';
  } else if (
    summary.warnings > 0 ||
    summary.mismatches > 0 ||
    (warnings?.length ?? 0) > 0 ||
    effectiveCoverage.status === 'partial' ||
    (partialFailures?.length ?? 0) > 0
  ) {
    status = 'warning';
  } else {
    status = 'success';
  }

  let suggestion: string | undefined;
  if (summary.mismatches > 0) {
    if (!hasTransactions) {
      suggestion = 'No transactions imported yet. Run import to fetch transaction history.';
    } else if (lastImportTimestamp) {
      const daysSinceImport = (Date.now() - lastImportTimestamp) / (1000 * 60 * 60 * 24);

      if (daysSinceImport > 7) {
        const daysRounded = Math.floor(daysSinceImport);
        suggestion = `Last import was ${daysRounded} days ago. Run import again to fetch recent transactions.`;
      } else {
        suggestion =
          'Balance mismatch detected. You may have missing transactions. Try running import again to ensure all transactions are captured.';
      }
    } else {
      suggestion = 'No transactions imported yet. Run import to fetch transaction history.';
    }
  }

  return {
    account,
    mode: 'verification',
    timestamp: Date.now(),
    status,
    comparisons,
    coverage: effectiveCoverage,
    summary,
    partialFailures: partialFailures && partialFailures.length > 0 ? partialFailures : undefined,
    suggestion,
    warnings,
  };
}

/**
 * Generate a markdown report from verification results.
 * Pure function — no I/O.
 */
export function generateVerificationReport(results: BalanceVerificationResult[]): string {
  const timestamp = new Date().toISOString();
  let report = `# Balance Verification Report - ${timestamp}\n\n`;

  for (const result of results) {
    report += `## ${result.account.platformKey} (${result.account.accountType})\n`;
    report += `- **Account ID**: ${result.account.id}\n`;
    report += `- **Status**: ${result.status.toUpperCase()}\n`;
    report += `- **Total Currencies**: ${result.summary.totalCurrencies}\n`;
    report += `- **Matches**: ${result.summary.matches}\n`;
    report += `- **Warnings**: ${result.summary.warnings}\n`;
    report += `- **Mismatches**: ${result.summary.mismatches}\n\n`;

    if (result.suggestion) {
      report += `- **Suggestion**: ${result.suggestion}\n\n`;
    }

    const issues = result.comparisons.filter((c) => c.status !== 'match');
    if (issues.length > 0) {
      report += `### Issues Found:\n`;
      for (const issue of issues) {
        report += `- **${issue.assetSymbol}**: `;
        report += `Live: ${issue.liveBalance}, `;
        report += `Calculated: ${issue.calculatedBalance}, `;
        report += `Diff: ${issue.difference} (${issue.percentageDiff.toFixed(2)}%)\n`;
      }
      report += '\n';
    }
  }

  const totalAccounts = results.length;
  const successfulAccounts = results.filter((r) => r.status === 'success').length;
  const warningAccounts = results.filter((r) => r.status === 'warning').length;
  const failedAccounts = results.filter((r) => r.status === 'failed').length;

  report += `## Overall Summary\n`;
  report += `- **Total Accounts**: ${totalAccounts}\n`;
  report += `- **Successful**: ${successfulAccounts}\n`;
  report += `- **Warnings**: ${warningAccounts}\n`;
  report += `- **Failed**: ${failedAccounts}\n\n`;

  return report;
}
