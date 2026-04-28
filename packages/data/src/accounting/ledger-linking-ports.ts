import type {
  ILedgerLinkingAssetIdentityAssertionReader,
  ILedgerLinkingAssetIdentityAssertionStore,
  ILedgerLinkingCandidateSourceReader,
  ILedgerLinkingRelationshipStore,
  LedgerLinkingRunPorts,
} from '@exitbook/accounting/ledger-linking';

import type { DataSession } from '../data-session.js';

export function buildLedgerLinkingRelationshipStore(db: DataSession): ILedgerLinkingRelationshipStore {
  return {
    replaceLedgerLinkingRelationships: (profileId, relationships) =>
      db.accountingLedger.replaceLedgerLinkingRelationships(profileId, relationships),
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
    replaceLedgerLinkingAssetIdentityAssertions: (profileId, assertions) =>
      db.accountingLedger.replaceLedgerLinkingAssetIdentityAssertions(profileId, assertions),
  };
}

export function buildLedgerLinkingRunPorts(db: DataSession): LedgerLinkingRunPorts {
  return {
    assetIdentityAssertionReader: buildLedgerLinkingAssetIdentityAssertionReader(db),
    candidateSourceReader: buildLedgerLinkingCandidateSourceReader(db),
    relationshipStore: buildLedgerLinkingRelationshipStore(db),
  };
}
