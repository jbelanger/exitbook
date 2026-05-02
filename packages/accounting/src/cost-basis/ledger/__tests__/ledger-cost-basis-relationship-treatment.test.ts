import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import {
  classifyLedgerCostBasisRelationshipTreatment,
  type LedgerCostBasisRelationshipBasisTreatment,
} from '../ledger-cost-basis-relationship-treatment.js';

describe('classifyLedgerCostBasisRelationshipTreatment', () => {
  it('keeps semantic relationship kind separate from cost-basis treatment', () => {
    const cases: readonly {
      relationshipKind: AccountingJournalRelationshipKind;
      treatment: LedgerCostBasisRelationshipBasisTreatment;
    }[] = [
      { relationshipKind: 'internal_transfer', treatment: 'carry_basis' },
      { relationshipKind: 'same_hash_carryover', treatment: 'carry_basis' },
      { relationshipKind: 'bridge', treatment: 'carry_basis' },
      { relationshipKind: 'asset_migration', treatment: 'carry_basis' },
      { relationshipKind: 'external_transfer', treatment: 'dispose_and_acquire' },
    ];

    for (const testCase of cases) {
      expect(classifyLedgerCostBasisRelationshipTreatment({ relationshipKind: testCase.relationshipKind })).toBe(
        testCase.treatment
      );
    }
  });
});
