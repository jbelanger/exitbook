import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';

import type { CostBasisLedgerRelationship } from '../../ports/cost-basis-ledger-persistence.js';

export type LedgerCostBasisRelationshipBasisTreatment = 'carry_basis' | 'dispose_and_acquire';

const RELATIONSHIP_KIND_BASIS_TREATMENTS = {
  asset_migration: 'carry_basis',
  bridge: 'carry_basis',
  external_transfer: 'dispose_and_acquire',
  internal_transfer: 'carry_basis',
  same_hash_carryover: 'carry_basis',
} satisfies Record<AccountingJournalRelationshipKind, LedgerCostBasisRelationshipBasisTreatment>;

export function classifyLedgerCostBasisRelationshipTreatment(
  relationship: Pick<CostBasisLedgerRelationship, 'relationshipKind'>
): LedgerCostBasisRelationshipBasisTreatment {
  return RELATIONSHIP_KIND_BASIS_TREATMENTS[relationship.relationshipKind];
}
