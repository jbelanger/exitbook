import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { AccountingPostingDraft } from '../posting-draft.js';
import { computeAccountingPostingFingerprint } from '../posting-fingerprint.js';

const ETH = assertOk(parseCurrency('ETH'));
const USD = assertOk(parseCurrency('USD'));

function createPosting(overrides: Partial<AccountingPostingDraft> = {}): AccountingPostingDraft {
  return {
    postingStableKey: 'posting:1',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    quantity: parseDecimal('-1'),
    role: 'principal',
    sourceComponentRefs: [
      {
        component: {
          sourceActivityFingerprint: 'activity:1',
          componentKind: 'account_delta',
          componentId: 'delta:1',
        },
        quantity: parseDecimal('1'),
      },
    ],
    ...overrides,
  };
}

describe('computeAccountingPostingFingerprint', () => {
  it('ignores role, settlement, and price when computing the fingerprint', () => {
    const firstFingerprint = assertOk(computeAccountingPostingFingerprint('ledger_journal:v1:abc', createPosting()));
    const secondFingerprint = assertOk(
      computeAccountingPostingFingerprint(
        'ledger_journal:v1:abc',
        createPosting({
          role: 'protocol_overhead',
          settlement: 'balance',
          priceAtTxTime: {
            price: {
              amount: parseDecimal('2000'),
              currency: USD,
            },
            source: 'manual',
            fetchedAt: new Date('2026-04-23T00:00:00.000Z'),
          },
        })
      )
    );

    expect(firstFingerprint).toBe(secondFingerprint);
  });
});
