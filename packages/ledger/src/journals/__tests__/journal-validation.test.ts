import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { AccountingJournalDraft } from '../journal-draft.js';
import { validateAccountingJournalDraft } from '../journal-validation.js';

const ETH = assertOk(parseCurrency('ETH'));

function createSourceComponentQuantityRef(quantity: string) {
  return {
    component: {
      sourceActivityFingerprint: 'activity:1',
      componentKind: 'raw_event' as const,
      componentId: 'raw:1',
    },
    quantity: parseDecimal(quantity),
  };
}

describe('validateAccountingJournalDraft', () => {
  it('rejects duplicate posting stable keys', () => {
    const journal: AccountingJournalDraft = {
      sourceActivityFingerprint: 'activity:1',
      journalStableKey: 'journal:1',
      journalKind: 'transfer',
      postings: [
        {
          postingStableKey: 'duplicate',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          quantity: parseDecimal('-1'),
          role: 'principal',
          sourceComponentRefs: [createSourceComponentQuantityRef('1')],
        },
        {
          postingStableKey: 'duplicate',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          quantity: parseDecimal('1'),
          role: 'principal',
          sourceComponentRefs: [createSourceComponentQuantityRef('1')],
        },
      ],
    };

    const error = assertErr(validateAccountingJournalDraft(journal));
    expect(error.message).toContain('duplicate posting stable key');
  });

  it('rejects positive postings in expense_only journals', () => {
    const journal: AccountingJournalDraft = {
      sourceActivityFingerprint: 'activity:1',
      journalStableKey: 'journal:expense',
      journalKind: 'expense_only',
      postings: [
        {
          postingStableKey: 'posting:1',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          quantity: parseDecimal('0.1'),
          role: 'refund_rebate',
          sourceComponentRefs: [createSourceComponentQuantityRef('0.1')],
        },
      ],
    };

    const error = assertErr(validateAccountingJournalDraft(journal));
    expect(error.message).toContain('expense_only');
  });

  it('accepts a valid journal', () => {
    const journal: AccountingJournalDraft = {
      sourceActivityFingerprint: 'activity:1',
      journalStableKey: 'journal:valid',
      journalKind: 'trade',
      postings: [
        {
          postingStableKey: 'posting:1',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          quantity: parseDecimal('-1'),
          role: 'principal',
          sourceComponentRefs: [createSourceComponentQuantityRef('1')],
        },
        {
          postingStableKey: 'posting:fee',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          quantity: parseDecimal('-0.01'),
          role: 'fee',
          settlement: 'on-chain',
          sourceComponentRefs: [createSourceComponentQuantityRef('0.01')],
        },
      ],
    };

    assertOk(validateAccountingJournalDraft(journal));
  });
});
