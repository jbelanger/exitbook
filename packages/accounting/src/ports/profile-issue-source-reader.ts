import type { AssetReviewSummary } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { ProfileLinkGapSourceData } from './profile-link-gap-source-reader.js';

export interface ProfileAccountingIssueSourceData extends ProfileLinkGapSourceData {
  assetReviewSummaries: readonly AssetReviewSummary[];
}

export interface IProfileAccountingIssueSourceReader {
  loadProfileAccountingIssueSourceData(): Promise<Result<ProfileAccountingIssueSourceData, Error>>;
}
