import type {
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

export function buildLedgerLinkingRunPorts(db: DataSession): LedgerLinkingRunPorts {
  return {
    candidateSourceReader: buildLedgerLinkingCandidateSourceReader(db),
    relationshipStore: buildLedgerLinkingRelationshipStore(db),
  };
}
