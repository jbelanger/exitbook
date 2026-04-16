import { resultDoAsync, type Result } from '@exitbook/foundation';

import { applyResolvedLinkGapVisibility, analyzeLinkGaps } from '../linking/gaps/gap-analysis.js';
import type { IProfileAccountingIssueSourceReader } from '../ports/profile-issue-source-reader.js';

import type { AccountingIssueScopeSnapshot } from './issue-model.js';
import { buildProfileAccountingIssueScopeSnapshot } from './profile-issues.js';

export interface MaterializeProfileAccountingIssueScopeSnapshotInput {
  profileId: number;
  scopeKey: string;
  sourceReader: IProfileAccountingIssueSourceReader;
  title: string;
  updatedAt?: Date | undefined;
}

export async function materializeProfileAccountingIssueScopeSnapshot(
  input: MaterializeProfileAccountingIssueScopeSnapshotInput
): Promise<Result<AccountingIssueScopeSnapshot, Error>> {
  return resultDoAsync(async function* () {
    const source = yield* await input.sourceReader.loadProfileAccountingIssueSourceData();
    const analysis = analyzeLinkGaps([...source.transactions], [...source.links], {
      accounts: source.accounts,
      excludedAssetIds: source.excludedAssetIds,
    });
    const visibleAnalysis = applyResolvedLinkGapVisibility(analysis, source.resolvedIssueKeys);

    return buildProfileAccountingIssueScopeSnapshot({
      assetReviewSummaries: source.assetReviewSummaries,
      linkGapIssues: visibleAnalysis.analysis.issues,
      profileId: input.profileId,
      scopeKey: input.scopeKey,
      title: input.title,
      updatedAt: input.updatedAt,
    });
  });
}
