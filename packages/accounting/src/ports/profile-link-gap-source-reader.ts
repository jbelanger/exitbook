import type { Account, AssetReviewSummary, Profile, Transaction, TransactionLink } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';

export interface ProfileLinkGapCrossProfileContext {
  accounts: readonly Pick<Account, 'id' | 'profileId'>[];
  activeProfileId: number;
  profiles: readonly Pick<Profile, 'displayName' | 'id' | 'profileKey'>[];
  transactions: readonly Transaction[];
}

export interface ProfileLinkGapSourceData {
  accounts: readonly Account[];
  assetReviewSummaries?: readonly AssetReviewSummary[] | undefined;
  crossProfileContext?: ProfileLinkGapCrossProfileContext | undefined;
  excludedAssetIds: ReadonlySet<string>;
  links: readonly TransactionLink[];
  resolvedIssueKeys: ReadonlySet<string>;
  transactionAnnotations?: readonly TransactionAnnotation[] | undefined;
  transactions: readonly Transaction[];
}

export interface IProfileLinkGapSourceReader {
  loadProfileLinkGapSourceData(): Promise<Result<ProfileLinkGapSourceData, Error>>;
}
