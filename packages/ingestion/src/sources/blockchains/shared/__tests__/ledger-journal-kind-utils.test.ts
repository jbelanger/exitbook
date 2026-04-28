import type { Currency } from '@exitbook/foundation';
import type { AccountingPostingDraft } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';
import { describe, expect, test } from 'vitest';

import { hasProtocolCustodyPosting, resolvePostingDrivenJournalKind } from '../ledger-journal-kind-utils.js';

function posting(overrides: Partial<AccountingPostingDraft> = {}): AccountingPostingDraft {
  return {
    assetId: 'blockchain:ethereum:native',
    assetSymbol: 'ETH' as Currency,
    balanceCategory: 'liquid',
    postingStableKey: 'principal:in:eth:1',
    quantity: new Decimal('1'),
    role: 'principal',
    sourceComponentRefs: [
      {
        component: {
          assetId: 'blockchain:ethereum:native',
          componentId: 'event-1',
          componentKind: 'account_delta',
          sourceActivityFingerprint: 'source:fingerprint',
        },
        quantity: new Decimal('1'),
      },
    ],
    ...overrides,
  };
}

describe('ledger journal kind utils', () => {
  test('classifies empty value postings as expense-only by default', () => {
    expect(resolvePostingDrivenJournalKind({ valuePostings: [] })).toBe('expense_only');
  });

  test('classifies all reward postings as staking rewards', () => {
    expect(
      resolvePostingDrivenJournalKind({
        valuePostings: [posting({ postingStableKey: 'reward:in:eth:1', role: 'staking_reward' })],
      })
    ).toBe('staking_reward');
  });

  test('classifies opposite-side principal postings with different assets as trades', () => {
    expect(
      resolvePostingDrivenJournalKind({
        valuePostings: [
          posting({ postingStableKey: 'principal:out:eth:1', quantity: new Decimal('-1') }),
          posting({
            assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            assetSymbol: 'USDC' as Currency,
            postingStableKey: 'principal:in:usdc:2',
            quantity: new Decimal('1000'),
          }),
        ],
      })
    ).toBe('trade');
  });

  test('keeps same-asset opposite-side principal postings as transfers', () => {
    expect(
      resolvePostingDrivenJournalKind({
        valuePostings: [
          posting({ postingStableKey: 'principal:out:eth:1', quantity: new Decimal('-1') }),
          posting({ postingStableKey: 'principal:in:eth:2', quantity: new Decimal('0.5') }),
        ],
      })
    ).toBe('transfer');
  });

  test('detects protocol custody postings and classifies them as protocol events', () => {
    const valuePostings = [
      posting({
        postingStableKey: 'protocol_deposit:out:eth:1',
        quantity: new Decimal('-1'),
        role: 'protocol_deposit',
      }),
      posting({ balanceCategory: 'staked', postingStableKey: 'principal:staked:eth:2' }),
    ];

    expect(hasProtocolCustodyPosting(valuePostings)).toBe(true);
    expect(resolvePostingDrivenJournalKind({ hasProtocolCustody: true, valuePostings })).toBe('protocol_event');
  });
});
