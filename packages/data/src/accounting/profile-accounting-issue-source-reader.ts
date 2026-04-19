import type { IProfileAccountingIssueSourceReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileLinkGapSourceReader } from './profile-link-gap-source-reader.js';

export function buildProfileAccountingIssueSourceReader(
  db: DataSession,
  dataDir: string,
  profile: {
    profileId: number;
    profileKey: string;
  }
): IProfileAccountingIssueSourceReader {
  const linkGapSourceReader = buildProfileLinkGapSourceReader(db, dataDir, profile);

  return {
    loadProfileAccountingIssueSourceData: () =>
      resultDoAsync(async function* () {
        const linkGapSource = yield* await linkGapSourceReader.loadProfileLinkGapSourceData();

        return {
          ...linkGapSource,
          assetReviewSummaries: linkGapSource.assetReviewSummaries ?? [],
        };
      }),
  };
}
