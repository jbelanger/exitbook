/**
 * Link gap issue details.
 */
export type LinkGapDirection = 'inflow' | 'outflow';

export interface LinkGapIssue {
  transactionId: number;
  txFingerprint: string;
  platformKey: string;
  blockchainName?: string | undefined;
  timestamp: string;
  assetId: string;
  assetSymbol: string;
  missingAmount: string;
  totalAmount: string;
  confirmedCoveragePercent: string;
  operationCategory: string;
  operationType: string;
  suggestedCount: number;
  highestSuggestedConfidencePercent?: string | undefined;
  direction: LinkGapDirection;
}

/**
 * Link gap summary per asset.
 */
export interface LinkGapAssetSummary {
  assetSymbol: string;
  inflowOccurrences: number;
  inflowMissingAmount: string;
  outflowOccurrences: number;
  outflowMissingAmount: string;
}

/**
 * Link gap analysis result.
 */
export interface LinkGapAnalysis {
  issues: LinkGapIssue[];
  summary: {
    affected_assets: number;
    assets: LinkGapAssetSummary[];
    total_issues: number;
    uncovered_inflows: number;
    unmatched_outflows: number;
  };
}
