import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { StoredBalanceAssetDiagnosticsSummary } from './stored-balance-diagnostics.js';
import type { StoredBalanceAssetDiagnostics, StoredBalanceAssetViewItem } from './stored-balance-view.js';

export function buildStoredBalanceAssetDiagnostics(
  diagnosticsSummary: StoredBalanceAssetDiagnosticsSummary,
  comparison?: { calculatedBalance: string; liveBalance: string }
): StoredBalanceAssetDiagnostics {
  const dateRange = diagnosticsSummary.dateRange;

  let unexplainedDelta: string | undefined;
  if (comparison) {
    const live = parseDecimal(comparison.liveBalance);
    const calculated = parseDecimal(comparison.calculatedBalance);
    const diff = live.minus(calculated);
    if (!diff.isZero()) {
      unexplainedDelta = diff.toFixed();
    }
  }

  return {
    txCount: diagnosticsSummary.totals.txCount,
    dateRange,
    totals: {
      inflows: diagnosticsSummary.totals.inflows.toFixed(),
      outflows: diagnosticsSummary.totals.outflows.toFixed(),
      fees: diagnosticsSummary.totals.fees.toFixed(),
      net: diagnosticsSummary.totals.net.toFixed(),
    },
    unexplainedDelta,
  };
}

export function sortStoredBalanceAssets(assets: StoredBalanceAssetViewItem[]): StoredBalanceAssetViewItem[] {
  return [...assets].sort((a, b) => {
    if (a.isNegative && !b.isNegative) return -1;
    if (!a.isNegative && b.isNegative) return 1;
    const absA = parseDecimal(a.calculatedBalance).abs();
    const absB = parseDecimal(b.calculatedBalance).abs();
    return absB.comparedTo(absA);
  });
}

export function buildStoredBalanceAssetViewItem(
  assetId: string,
  assetSymbol: string,
  calculatedBalance: Decimal,
  diagnostics: StoredBalanceAssetDiagnostics,
  options?: {
    comparisonStatus?: StoredBalanceAssetViewItem['comparisonStatus'] | undefined;
    liveBalance?: string | undefined;
  }
): StoredBalanceAssetViewItem {
  return {
    assetId,
    assetSymbol,
    calculatedBalance: calculatedBalance.toFixed(),
    liveBalance: options?.liveBalance,
    comparisonStatus: options?.comparisonStatus,
    isNegative: calculatedBalance.isNegative(),
    diagnostics,
  };
}
