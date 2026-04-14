import { analyzeLinkGaps, applyResolvedLinkGapVisibility, type LinkGapIssue } from '@exitbook/accounting/linking';
import type { AssetReviewSummary } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { readExcludedAssetIds, readResolvedLinkGapIssueKeys } from '../overrides/index.js';
import { OverrideStore } from '../overrides/override-store.js';

export interface ProfileAccountingIssueSourceData {
  assetReviewSummaries: readonly AssetReviewSummary[];
  hiddenResolvedIssueCount: number;
  linkGapIssues: readonly LinkGapIssue[];
}

export async function loadProfileAccountingIssueSourceData(
  db: DataSession,
  dataDir: string,
  profile: {
    profileId: number;
    profileKey: string;
  }
): Promise<Result<ProfileAccountingIssueSourceData, Error>> {
  return resultDoAsync(async function* () {
    const overrideStore = new OverrideStore(dataDir);
    const transactions = yield* await db.transactions.findAll({ profileId: profile.profileId });
    const links = yield* await db.transactionLinks.findAll({ profileId: profile.profileId });
    const accounts = yield* await db.accounts.findAll({ profileId: profile.profileId });
    const assetReviewSummaries = yield* await db.assetReview.listAll(profile.profileId);
    const excludedAssetIds = yield* await readExcludedAssetIds(overrideStore, profile.profileKey);
    const resolvedIssueKeys = yield* await readResolvedLinkGapIssueKeys(overrideStore, profile.profileKey);

    const analysis = analyzeLinkGaps(transactions, links, {
      accounts,
      excludedAssetIds,
    });
    const visibleAnalysis = applyResolvedLinkGapVisibility(analysis, resolvedIssueKeys);

    return {
      assetReviewSummaries,
      hiddenResolvedIssueCount: visibleAnalysis.hiddenResolvedIssueCount,
      linkGapIssues: visibleAnalysis.analysis.issues,
    };
  });
}
