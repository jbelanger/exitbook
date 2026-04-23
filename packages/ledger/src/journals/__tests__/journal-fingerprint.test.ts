import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { AccountingJournalDraft } from '../journal-draft.js';
import { computeAccountingJournalFingerprint } from '../journal-fingerprint.js';

const ETH = assertOk(parseCurrency('ETH'));

function createJournalDraft(kind: AccountingJournalDraft['journalKind']): AccountingJournalDraft {
  return {
    sourceActivityFingerprint: 'activity:1',
    journalStableKey: 'journal:primary',
    journalKind: kind,
    postings: [
      {
        postingStableKey: 'posting:1',
        assetId: 'blockchain:ethereum:native',
        assetSymbol: ETH,
        quantity: parseDecimal('-0.1'),
        role: 'principal',
        sourceComponentRefs: [
          {
            component: {
              sourceActivityFingerprint: 'activity:1',
              componentKind: 'account_delta',
              componentId: 'delta:1',
            },
            quantity: parseDecimal('0.1'),
          },
        ],
      },
    ],
  };
}

describe('computeAccountingJournalFingerprint', () => {
  it('ignores journal kind when computing the fingerprint', () => {
    const transferFingerprint = assertOk(computeAccountingJournalFingerprint(createJournalDraft('transfer')));
    const tradeFingerprint = assertOk(computeAccountingJournalFingerprint(createJournalDraft('trade')));

    expect(transferFingerprint).toBe(tradeFingerprint);
  });
});
