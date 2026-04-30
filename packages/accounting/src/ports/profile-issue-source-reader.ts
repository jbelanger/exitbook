import type { AssetReviewSummary } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { LedgerLinkingGapIssue } from '../ledger-linking/gaps/ledger-linking-gap-issues.js';

import type { ProfileLinkGapSourceData } from './profile-link-gap-source-reader.js';

export interface ProfileAccountingIssueSourceData extends ProfileLinkGapSourceData {
  assetReviewSummaries: readonly AssetReviewSummary[];
  ledgerLinkingGapIssues?: readonly LedgerLinkingGapIssue[] | undefined;
}

export interface IProfileAccountingIssueSourceReader {
  loadProfileAccountingIssueSourceData(): Promise<Result<ProfileAccountingIssueSourceData, Error>>;
}
