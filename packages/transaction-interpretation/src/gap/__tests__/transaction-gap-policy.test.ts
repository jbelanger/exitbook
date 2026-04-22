import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import {
  deriveTransactionGapContextHint,
  hasLikelyDustSignal,
  shouldExcludeTransactionInflowGap,
  shouldSuppressTransactionGapIssue,
} from '../transaction-gap-policy.js';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-gap',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'cardano',
    platformKind: overrides.platformKind ?? 'blockchain',
    status: 'success',
    from: 'source',
    to: 'target',
    movements: overrides.movements ?? {
      inflows: [],
      outflows: [],
    },
    fees: [],
    diagnostics: overrides.diagnostics ?? [],
    operation: overrides.operation ?? { category: 'transfer', type: 'deposit' },
    blockchain: {
      name: overrides.platformKey ?? 'cardano',
      transaction_hash: '0xhash',
      is_confirmed: true,
    },
    excludedFromAccounting: overrides.excludedFromAccounting ?? false,
    ...overrides,
  };
}

describe('transaction-gap-policy', () => {
  it('derives diagnostic-backed gap context hints', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'classification_uncertain',
          message: 'Needs review',
          severity: 'warning',
        },
      ],
    });

    expect(deriveTransactionGapContextHint(transaction, undefined)).toEqual({
      kind: 'diagnostic',
      code: 'classification_uncertain',
      label: 'classification uncertainty',
      message: 'Needs review',
    });
  });

  it('falls back to asserted staking reward annotations', () => {
    const transaction = makeTransaction();

    expect(
      deriveTransactionGapContextHint(transaction, [
        {
          annotationFingerprint: 'annotation:staking:gap',
          accountId: transaction.accountId,
          transactionId: transaction.id,
          txFingerprint: transaction.txFingerprint,
          kind: 'staking_reward',
          tier: 'asserted',
          target: { scope: 'movement', movementFingerprint: 'in-0' },
          detectorId: 'staking-reward',
          derivedFromTxIds: [transaction.id],
          provenanceInputs: ['movement_role'],
        },
      ])
    ).toEqual({
      kind: 'annotation',
      code: 'staking_reward',
      label: 'staking reward in same tx',
      message: 'Transaction carries asserted staking reward interpretation that is excluded from transfer matching.',
    });
  });

  it('falls back to movement-role context when no diagnostic or annotation hint exists', () => {
    const transaction = makeTransaction({
      movements: {
        inflows: [
          {
            assetId: 'blockchain:cardano:native',
            assetSymbol: 'ADA' as Currency,
            grossAmount: parseDecimal('10.5'),
            netAmount: parseDecimal('10.5'),
            movementFingerprint: 'in-0',
            movementRole: 'staking_reward',
          },
        ],
        outflows: [],
      },
    });

    expect(deriveTransactionGapContextHint(transaction, undefined)).toEqual({
      kind: 'movement_role',
      code: 'staking_reward',
      label: 'staking reward in same tx',
      message: 'Transaction includes a staking reward movement that is excluded from transfer matching.',
    });
  });

  it('detects likely dust from diagnostics', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'unsolicited_dust_fanout',
          message: 'dust',
          severity: 'info',
        },
      ],
    });

    expect(hasLikelyDustSignal(transaction)).toBe(true);
  });

  it('suppresses gap issues for off-platform cash movement diagnostics', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'off_platform_cash_movement',
          message: 'cash',
          severity: 'info',
        },
      ],
    });

    expect(shouldSuppressTransactionGapIssue(transaction)).toBe(true);
  });

  it('excludes inflow gaps for interpreted airdrop claims', () => {
    const transaction = makeTransaction({
      operation: { category: 'transfer', type: 'deposit' },
    });

    expect(shouldExcludeTransactionInflowGap(transaction, { label: 'airdrop/claim' })).toBe(true);
  });

  it('excludes inflow gaps for raw minting and staking fallback operations', () => {
    expect(
      shouldExcludeTransactionInflowGap(
        makeTransaction({
          operation: { category: 'transfer', type: 'reward' },
        }),
        { label: 'transfer/deposit' }
      )
    ).toBe(true);

    expect(
      shouldExcludeTransactionInflowGap(
        makeTransaction({
          operation: { category: 'staking', type: 'unstake' },
        }),
        { label: 'staking/unstake' }
      )
    ).toBe(true);
  });
});
