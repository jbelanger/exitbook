import type { ILedgerLinkingRelationshipStore } from '@exitbook/accounting/ledger-linking';

import type { DataSession } from '../data-session.js';

export function buildLedgerLinkingRelationshipStore(db: DataSession): ILedgerLinkingRelationshipStore {
  return {
    replaceLedgerLinkingRelationships: (profileId, relationships) =>
      db.accountingLedger.replaceLedgerLinkingRelationships(profileId, relationships),
  };
}
