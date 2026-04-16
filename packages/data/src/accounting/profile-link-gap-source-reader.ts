import type { IProfileLinkGapSourceReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { readExcludedAssetIds, readResolvedLinkGapIssueKeys } from '../overrides/index.js';
import { OverrideStore } from '../overrides/override-store.js';

export function buildProfileLinkGapSourceReader(
  db: DataSession,
  dataDir: string,
  profile: {
    profileId: number;
    profileKey: string;
  }
): IProfileLinkGapSourceReader {
  return {
    loadProfileLinkGapSourceData: () =>
      resultDoAsync(async function* () {
        const overrideStore = new OverrideStore(dataDir);
        const transactions = yield* await db.transactions.findAll({ profileId: profile.profileId });
        const links = yield* await db.transactionLinks.findAll({ profileId: profile.profileId });
        const accounts = yield* await db.accounts.findAll({ profileId: profile.profileId });
        const excludedAssetIds = yield* await readExcludedAssetIds(overrideStore, profile.profileKey);
        const resolvedIssueKeys = yield* await readResolvedLinkGapIssueKeys(overrideStore, profile.profileKey);

        return {
          accounts,
          excludedAssetIds,
          links,
          resolvedIssueKeys,
          transactions,
        };
      }),
  };
}
