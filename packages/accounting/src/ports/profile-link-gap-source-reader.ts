import type { Account, Transaction, TransactionLink } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

export interface ProfileLinkGapSourceData {
  accounts: readonly Account[];
  excludedAssetIds: ReadonlySet<string>;
  links: readonly TransactionLink[];
  resolvedIssueKeys: ReadonlySet<string>;
  transactions: readonly Transaction[];
}

export interface IProfileLinkGapSourceReader {
  loadProfileLinkGapSourceData(): Promise<Result<ProfileLinkGapSourceData, Error>>;
}
