import type {
  ILedgerLinkingAssetIdentityAssertionReader,
  ILedgerLinkingAssetIdentityAssertionStore,
  ILedgerLinkingCandidateSourceReader,
  ILedgerLinkingRelationshipReader,
  ILedgerLinkingRelationshipStore,
  ILedgerLinkingReviewedRelationshipOverrideReader,
  LedgerLinkingRunPorts,
} from '@exitbook/accounting/ledger-linking';
import { err } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { readLedgerLinkingRelationshipOverrides } from '../overrides/ledger-linking-relationship-replay.js';
import type { OverrideStore } from '../overrides/override-store.js';

export function buildLedgerLinkingRelationshipStore(db: DataSession): ILedgerLinkingRelationshipStore {
  return {
    replaceLedgerLinkingRelationships: (profileId, relationships) =>
      db.accountingLedger.replaceLedgerLinkingRelationships(profileId, relationships),
  };
}

export function buildLedgerLinkingRelationshipReader(db: DataSession): ILedgerLinkingRelationshipReader {
  return {
    loadLedgerLinkingRelationships: (profileId) =>
      db.accountingLedger.findLedgerLinkingRelationshipsByProfileId(profileId),
  };
}

export function buildLedgerLinkingCandidateSourceReader(db: DataSession): ILedgerLinkingCandidateSourceReader {
  return {
    loadLedgerLinkingPostingInputs: (profileId) =>
      db.accountingLedger.findLedgerLinkingPostingInputsByProfileId(profileId),
  };
}

export function buildLedgerLinkingAssetIdentityAssertionReader(
  db: DataSession
): ILedgerLinkingAssetIdentityAssertionReader {
  return {
    loadLedgerLinkingAssetIdentityAssertions: (profileId) =>
      db.accountingLedger.findLedgerLinkingAssetIdentityAssertionsByProfileId(profileId),
  };
}

export function buildLedgerLinkingAssetIdentityAssertionStore(
  db: DataSession
): ILedgerLinkingAssetIdentityAssertionStore {
  return {
    saveLedgerLinkingAssetIdentityAssertion: (profileId, assertion) =>
      db.accountingLedger.saveLedgerLinkingAssetIdentityAssertion(profileId, assertion),
    replaceLedgerLinkingAssetIdentityAssertions: (profileId, assertions) =>
      db.accountingLedger.replaceLedgerLinkingAssetIdentityAssertions(profileId, assertions),
  };
}

export interface BuildLedgerLinkingRunPortsOptions {
  overrideStore?: Pick<OverrideStore, 'exists' | 'readByScopes'> | undefined;
}

export function buildLedgerLinkingReviewedRelationshipOverrideReader(
  db: DataSession,
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>
): ILedgerLinkingReviewedRelationshipOverrideReader {
  return {
    async loadReviewedLedgerLinkingRelationshipOverrides(profileId) {
      const profileResult = await db.profiles.findById(profileId);
      if (profileResult.isErr()) {
        return err(profileResult.error);
      }

      const profile = profileResult.value;
      if (profile === undefined) {
        return err(new Error(`Cannot read ledger-linking relationship overrides for missing profile ${profileId}`));
      }

      return readLedgerLinkingRelationshipOverrides(overrideStore, profile.profileKey);
    },
  };
}

export function buildLedgerLinkingRunPorts(
  db: DataSession,
  options: BuildLedgerLinkingRunPortsOptions = {}
): LedgerLinkingRunPorts {
  return {
    assetIdentityAssertionReader: buildLedgerLinkingAssetIdentityAssertionReader(db),
    candidateSourceReader: buildLedgerLinkingCandidateSourceReader(db),
    relationshipStore: buildLedgerLinkingRelationshipStore(db),
    ...(options.overrideStore
      ? {
          reviewedRelationshipOverrideReader: buildLedgerLinkingReviewedRelationshipOverrideReader(
            db,
            options.overrideStore
          ),
        }
      : {}),
  };
}
