import {
  buildLedgerLinkingCrossProfileCounterpartsByCandidateId,
  buildLedgerLinkingGapIssues,
  runLedgerLinking,
  type LedgerLinkingCrossProfileDiagnostics,
  type LedgerLinkingDiagnostics,
  type LedgerLinkingRunPorts,
} from '@exitbook/accounting/ledger-linking';
import type { IProfileAccountingIssueSourceReader } from '@exitbook/accounting/ports';
import { err, resultDoAsync, type Result } from '@exitbook/foundation';

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
        const ledgerLinkingRunPorts = buildLedgerLinkingRunPorts(db, { overrideStore });
        const ledgerLinkingDiagnostics = yield* await loadLedgerLinkingDiagnostics(
          profile.profileId,
          ledgerLinkingRunPorts
        );
        const crossProfileDiagnostics =
          ledgerLinkingDiagnostics.unmatchedCandidates.length === 0
            ? []
            : yield* await loadCrossProfileLedgerLinkingDiagnostics(db, ledgerLinkingRunPorts, profile.profileId);
        const crossProfileCounterpartsByCandidateId = buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
          ledgerLinkingDiagnostics,
          crossProfileDiagnostics
        );

        return {
          ...linkGapSource,
          assetReviewSummaries: linkGapSource.assetReviewSummaries ?? [],
          ledgerLinkingGapIssues: buildLedgerLinkingGapIssues(ledgerLinkingDiagnostics, {
            crossProfileCounterpartsByCandidateId,
          }),
        };
      }),
  };
}

function loadLedgerLinkingDiagnostics(
  profileId: number,
  ports: LedgerLinkingRunPorts
): Promise<Result<LedgerLinkingDiagnostics, Error>> {
  return resultDoAsync(async function* () {
    const ledgerLinkingRun = yield* await runLedgerLinking(profileId, ports, {
      dryRun: true,
      includeDiagnostics: true,
    });
    if (ledgerLinkingRun.diagnostics === undefined) {
      return yield* err(new Error(`Ledger-linking v2 diagnostics were not returned for profile ${profileId}`));
    }

    return ledgerLinkingRun.diagnostics;
  });
}

function loadCrossProfileLedgerLinkingDiagnostics(
  db: DataSession,
  ports: LedgerLinkingRunPorts,
  activeProfileId: number
): Promise<Result<LedgerLinkingCrossProfileDiagnostics[], Error>> {
  return resultDoAsync(async function* () {
    const profiles = yield* await db.profiles.list();
    if (profiles.length <= 1) {
      return [];
    }

    const crossProfileDiagnostics: LedgerLinkingCrossProfileDiagnostics[] = [];
    for (const candidateProfile of profiles) {
      if (candidateProfile.id === activeProfileId) {
        continue;
      }

      const diagnostics = yield* await loadLedgerLinkingDiagnostics(candidateProfile.id, ports);
      crossProfileDiagnostics.push({
        diagnostics,
        profileDisplayName: candidateProfile.displayName,
        profileId: candidateProfile.id,
        profileKey: candidateProfile.profileKey,
      });
    }

    return crossProfileDiagnostics;
  });
}
