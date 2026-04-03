import type { BalanceSnapshotAssetComparisonStatus } from '@exitbook/core';

export interface StoredBalanceDateRange {
  earliest: string;
  latest: string;
}

export interface StoredBalanceAssetDiagnostics {
  txCount: number;
  dateRange?: StoredBalanceDateRange | undefined;
  totals: {
    fees: string;
    inflows: string;
    net: string;
    outflows: string;
  };
  unexplainedDelta?: string | undefined;
}

export interface StoredBalanceAssetViewItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance?: string | undefined;
  comparisonStatus?: BalanceSnapshotAssetComparisonStatus | undefined;
  isNegative: boolean;
  diagnostics: StoredBalanceAssetDiagnostics;
}
