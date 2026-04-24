import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildLedgerBalancesFromPostings,
  diffLedgerBalancesAgainstReferences,
  type LedgerBalancePostingInput,
  type LedgerBalanceReferenceInput,
} from '../ledger-balance-runner.js';

describe('ledger balance runner', () => {
  it('aggregates signed postings by owner account and asset with provenance counts', () => {
    const result = assertOk(
      buildLedgerBalancesFromPostings([
        posting({
          ownerAccountId: 2,
          quantity: '5',
          postingFingerprint: 'posting:2',
          sourceActivityFingerprint: 'activity:2',
        }),
        posting({
          ownerAccountId: 1,
          quantity: '10',
          postingFingerprint: 'posting:1a',
          sourceActivityFingerprint: 'activity:1a',
        }),
        posting({
          ownerAccountId: 1,
          quantity: '-3',
          journalFingerprint: 'journal:1b',
          postingFingerprint: 'posting:1b',
          sourceActivityFingerprint: 'activity:1b',
        }),
      ])
    );

    expect(result.summary).toEqual({
      assetBalanceCount: 2,
      journalCount: 2,
      ownerAccountCount: 2,
      postingCount: 3,
      sourceActivityCount: 3,
    });
    expect(
      result.balances.map((balance) => ({
        ownerAccountId: balance.ownerAccountId,
        assetId: balance.assetId,
        quantity: balance.quantity.toFixed(),
        postingCount: balance.postingCount,
        postingFingerprints: balance.postingFingerprints,
        sourceActivityCount: balance.sourceActivityCount,
      }))
    ).toEqual([
      {
        ownerAccountId: 1,
        assetId: 'blockchain:cardano:native',
        quantity: '7',
        postingCount: 2,
        postingFingerprints: ['posting:1a', 'posting:1b'],
        sourceActivityCount: 2,
      },
      {
        ownerAccountId: 2,
        assetId: 'blockchain:cardano:native',
        quantity: '5',
        postingCount: 1,
        postingFingerprints: ['posting:2'],
        sourceActivityCount: 1,
      },
    ]);
  });

  it('keeps zero aggregate balances when opposing postings net out', () => {
    const result = assertOk(
      buildLedgerBalancesFromPostings([
        posting({ quantity: '1', postingFingerprint: 'posting:in' }),
        posting({ quantity: '-1', postingFingerprint: 'posting:out' }),
      ])
    );

    expect(result.balances).toHaveLength(1);
    expect(result.balances[0]?.quantity.toFixed()).toBe('0');
  });

  it('diffs ledger balances against reference balances with tolerance', () => {
    const ledger = assertOk(
      buildLedgerBalancesFromPostings([
        posting({ quantity: '10', postingFingerprint: 'posting:in' }),
        posting({ quantity: '-3', postingFingerprint: 'posting:out' }),
      ])
    );

    const diffs = assertOk(
      diffLedgerBalancesAgainstReferences({
        ledgerBalances: ledger.balances,
        referenceBalances: [reference({ quantity: '6.99' })],
        tolerance: '0.00000001',
      })
    );

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      ownerAccountId: 1,
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA',
      postingFingerprints: ['posting:in', 'posting:out'],
    });
    expect(diffs[0]?.ledgerQuantity.toFixed()).toBe('7');
    expect(diffs[0]?.referenceQuantity.toFixed()).toBe('6.99');
    expect(diffs[0]?.delta.toFixed()).toBe('0.01');
  });

  it('rejects conflicting symbols for the same owner account asset', () => {
    const result = buildLedgerBalancesFromPostings([
      posting({ assetSymbol: 'ADA' }),
      posting({ assetSymbol: 'TADA', postingFingerprint: 'posting:tada' }),
    ]);

    expect(assertErr(result).message).toContain('conflicting symbols');
  });

  it('rejects zero-quantity postings', () => {
    const result = buildLedgerBalancesFromPostings([posting({ quantity: '0' })]);

    expect(assertErr(result).message).toContain('quantity must not be zero');
  });
});

function posting(
  overrides: Omit<Partial<LedgerBalancePostingInput>, 'quantity'> & { quantity?: string | undefined } = {}
): LedgerBalancePostingInput {
  const { quantity, ...rest } = overrides;

  return {
    ownerAccountId: 1,
    assetId: 'blockchain:cardano:native',
    assetSymbol: 'ADA',
    quantity: parseDecimal(quantity ?? '1'),
    journalFingerprint: 'journal:1',
    postingFingerprint: 'posting:1',
    sourceActivityFingerprint: 'activity:1',
    ...rest,
  };
}

function reference(
  overrides: Omit<Partial<LedgerBalanceReferenceInput>, 'quantity'> & { quantity?: string | undefined } = {}
): LedgerBalanceReferenceInput {
  const { quantity, ...rest } = overrides;

  return {
    ownerAccountId: 1,
    assetId: 'blockchain:cardano:native',
    assetSymbol: 'ADA',
    quantity: parseDecimal(quantity ?? '1'),
    ...rest,
  };
}
