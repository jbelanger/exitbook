import { materializeProfileAccountingIssueScopeSnapshot } from '@exitbook/accounting/issues';
import type { Result } from '@exitbook/foundation';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { buildProfileProjectionScopeKey } from '../projections/profile-scope-key.js';

import { buildProfileAccountingIssueSourceReader } from './profile-accounting-issue-source-reader.js';

interface ProfileAccountingIssueProjectionScope {
  displayName: string;
  profileId: number;
  profileKey: string;
}

export function refreshProfileAccountingIssueProjection(
  db: DataSession,
  dataDir: string,
  profile: ProfileAccountingIssueProjectionScope
): Promise<Result<void, Error>> {
  return resultDoAsync(async function* () {
    const snapshot = yield* await materializeProfileAccountingIssueScopeSnapshot({
      profileId: profile.profileId,
      scopeKey: buildProfileProjectionScopeKey(profile.profileId),
      sourceReader: buildProfileAccountingIssueSourceReader(db, dataDir, {
        profileId: profile.profileId,
        profileKey: profile.profileKey,
      }),
      title: profile.displayName,
    });

    yield* await db.accountingIssues.reconcileScope(snapshot);
  });
}
