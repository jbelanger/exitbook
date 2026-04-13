/**
 * Link gap issue details.
 */
export type LinkGapDirection = 'inflow' | 'outflow';
export type GapCueKind = 'likely_correlated_service_swap' | 'likely_cross_chain_migration';

export interface GapContextHint {
  kind: 'diagnostic' | 'movement_role';
  code: string;
  label: string;
  message: string;
}

export interface LinkGapIssueIdentity {
  assetId: string;
  direction: LinkGapDirection;
  txFingerprint: string;
}

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
  gapCue?: GapCueKind | undefined;
  contextHint?: GapContextHint | undefined;
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

export function buildLinkGapIssueKey(identity: LinkGapIssueIdentity): string {
  return `${identity.txFingerprint}|${identity.assetId}|${identity.direction}`;
}
