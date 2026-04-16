import { resultDoAsync, type Result } from '@exitbook/foundation';

import { buildVisibleProfileLinkGapAnalysis } from '../linking/gaps/profile-link-gap-analysis.js';
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
    const visibleAnalysis = buildVisibleProfileLinkGapAnalysis(source);

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
