import { buildLedgerLinkingGapIssues, runLedgerLinking } from '@exitbook/accounting/ledger-linking';
import type { IProfileAccountingIssueSourceReader } from '@exitbook/accounting/ports';
import { err, resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { OverrideStore } from '../overrides/override-store.js';

import { buildLedgerLinkingRunPorts } from './ledger-linking-ports.js';
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
        const overrideStore = new OverrideStore(dataDir);
        const ledgerLinkingRun = yield* await runLedgerLinking(
          profile.profileId,
          buildLedgerLinkingRunPorts(db, { overrideStore }),
          {
            dryRun: true,
            includeDiagnostics: true,
          }
        );
        if (ledgerLinkingRun.diagnostics === undefined) {
          return yield* err(new Error('Ledger-linking v2 diagnostics were not returned for issue projection'));
        }

        return {
          ...linkGapSource,
          assetReviewSummaries: linkGapSource.assetReviewSummaries ?? [],
          ledgerLinkingGapIssues: buildLedgerLinkingGapIssues(ledgerLinkingRun.diagnostics),
        };
      }),
  };
}
