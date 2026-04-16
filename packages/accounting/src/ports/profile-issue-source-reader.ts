import type { Account, AssetReviewSummary, Transaction, TransactionLink } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

export interface ProfileAccountingIssueSourceData {
  accounts: readonly Account[];
  assetReviewSummaries: readonly AssetReviewSummary[];
  excludedAssetIds: ReadonlySet<string>;
  links: readonly TransactionLink[];
  resolvedIssueKeys: ReadonlySet<string>;
  transactions: readonly Transaction[];
}

export interface IProfileAccountingIssueSourceReader {
  loadProfileAccountingIssueSourceData(): Promise<Result<ProfileAccountingIssueSourceData, Error>>;
}
