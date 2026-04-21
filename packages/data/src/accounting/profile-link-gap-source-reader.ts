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
  },
  options?: {
    includeCrossProfileContext?: boolean | undefined;
  }
): IProfileLinkGapSourceReader {
  return {
    loadProfileLinkGapSourceData: () =>
      resultDoAsync(async function* () {
        const overrideStore = new OverrideStore(dataDir);
        const transactions = yield* await db.transactions.findAll({ profileId: profile.profileId });
        const links = yield* await db.transactionLinks.findAll({ profileId: profile.profileId });
        const accounts = yield* await db.accounts.findAll({ profileId: profile.profileId });
        const transactionAnnotations =
          transactions.length === 0
            ? []
            : yield* await db.transactionAnnotations.readAnnotations({
                kinds: ['bridge_participant'],
                tiers: ['asserted', 'heuristic'],
                transactionIds: transactions.map((transaction) => transaction.id),
              });
        const assetReviewSummaries = yield* await db.assetReview.listAll(profile.profileId);
        const excludedAssetIds = yield* await readExcludedAssetIds(overrideStore, profile.profileKey);
        const resolvedIssueKeys = yield* await readResolvedLinkGapIssueKeys(overrideStore, profile.profileKey);
        const profiles = options?.includeCrossProfileContext ? yield* await db.profiles.list() : undefined;
        const crossProfileContext =
          options?.includeCrossProfileContext && profiles !== undefined && profiles.length > 1
            ? {
                accounts: (yield* await db.accounts.findAll()).map((account) => ({
                  id: account.id,
                  profileId: account.profileId,
                })),
                activeProfileId: profile.profileId,
                profiles: profiles.map((candidate) => ({
                  displayName: candidate.displayName,
                  id: candidate.id,
                  profileKey: candidate.profileKey,
                })),
                transactions: yield* await db.transactions.findAll(),
              }
            : undefined;

        return {
          accounts,
          assetReviewSummaries,
          ...(crossProfileContext !== undefined ? { crossProfileContext } : {}),
          excludedAssetIds,
          links,
          resolvedIssueKeys,
          transactionAnnotations,
          transactions,
        };
      }),
  };
}
