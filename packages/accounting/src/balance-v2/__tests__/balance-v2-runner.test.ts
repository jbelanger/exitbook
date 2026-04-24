import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildBalanceV2FromPostings } from '../balance-v2-runner.js';
import type { BalanceV2PostingInput } from '../balance-v2-runner.js';

describe('buildBalanceV2FromPostings', () => {
  it('aggregates signed ledger postings by account and asset', () => {
    const result = assertOk(
      buildBalanceV2FromPostings([
        posting({
          accountId: 2,
          assetId: 'blockchain:cardano:native',
          quantity: '5',
          postingFingerprint: 'posting:2',
          sourceActivityFingerprint: 'activity:2',
        }),
        posting({
          accountId: 1,
          assetId: 'blockchain:cardano:native',
          quantity: '10',
          postingFingerprint: 'posting:1a',
          sourceActivityFingerprint: 'activity:1a',
        }),
        posting({
          accountId: 1,
          assetId: 'blockchain:cardano:native',
          quantity: '-3',
          journalFingerprint: 'journal:1b',
          postingFingerprint: 'posting:1b',
          sourceActivityFingerprint: 'activity:1b',
        }),
      ])
    );

    expect(
      result.balances.map((balance) => ({
        accountId: balance.accountId,
        assetId: balance.assetId,
        quantity: balance.quantity.toFixed(),
        postingFingerprints: balance.postingFingerprints,
        sourceActivityFingerprints: balance.sourceActivityFingerprints,
      }))
    ).toEqual([
      {
        accountId: 1,
        assetId: 'blockchain:cardano:native',
        quantity: '7',
        postingFingerprints: ['posting:1a', 'posting:1b'],
        sourceActivityFingerprints: ['activity:1a', 'activity:1b'],
      },
      {
        accountId: 2,
        assetId: 'blockchain:cardano:native',
        quantity: '5',
        postingFingerprints: ['posting:2'],
        sourceActivityFingerprints: ['activity:2'],
      },
    ]);
  });

  it('keeps zero aggregate balances when opposing postings net out', () => {
    const result = assertOk(
      buildBalanceV2FromPostings([
        posting({ quantity: '1', postingFingerprint: 'posting:in' }),
        posting({ quantity: '-1', postingFingerprint: 'posting:out' }),
      ])
    );

    expect(result.balances).toHaveLength(1);
    expect(result.balances[0]?.quantity.toFixed()).toBe('0');
  });

  it('rejects conflicting symbols for the same account asset', () => {
    const result = buildBalanceV2FromPostings([
      posting({ assetSymbol: 'ADA' }),
      posting({ assetSymbol: 'TADA', postingFingerprint: 'posting:tada' }),
    ]);

    expect(assertErr(result).message).toContain('conflicting symbols');
  });

  it('rejects zero-quantity postings', () => {
    const result = buildBalanceV2FromPostings([posting({ quantity: '0' })]);

    expect(assertErr(result).message).toContain('quantity must not be zero');
  });
});

function posting(
  overrides: Omit<Partial<BalanceV2PostingInput>, 'quantity'> & { quantity?: string | undefined } = {}
): BalanceV2PostingInput {
  const { quantity, ...rest } = overrides;

  return {
    accountId: 1,
    assetId: 'blockchain:cardano:native',
    assetSymbol: 'ADA',
    quantity: parseDecimal(quantity ?? '1'),
    journalFingerprint: 'journal:1',
    postingFingerprint: 'posting:1',
    sourceActivityFingerprint: 'activity:1',
    ...rest,
  };
}
