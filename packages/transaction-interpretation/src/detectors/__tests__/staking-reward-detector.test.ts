import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { StakingRewardDetector } from '../staking-reward-detector.js';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-staking',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'cardano',
    platformKind: overrides.platformKind ?? 'blockchain',
    status: 'success',
    from: 'staking-pool',
    to: 'wallet',
    movements: overrides.movements ?? {
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
    fees: [],
    operation: overrides.operation ?? { category: 'transfer', type: 'deposit' },
    blockchain: {
      name: overrides.platformKey ?? 'cardano',
      transaction_hash: '0xhash',
      is_confirmed: true,
    },
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('StakingRewardDetector', () => {
  it('emits asserted movement-scoped staking reward annotations for reward inflows', async () => {
    const detector = new StakingRewardDetector();
    const transaction = makeTransaction();

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([
      expect.objectContaining({
        accountId: transaction.accountId,
        transactionId: transaction.id,
        txFingerprint: transaction.txFingerprint,
        kind: 'staking_reward',
        tier: 'asserted',
        target: {
          scope: 'movement',
          movementFingerprint: 'in-0',
        },
        detectorId: 'staking-reward',
        derivedFromTxIds: [transaction.id],
        provenanceInputs: ['movement_role'],
      }),
    ]);
  });

  it('ignores inflows that are not marked with staking_reward movementRole', async () => {
    const detector = new StakingRewardDetector();
    const transaction = makeTransaction({
      movements: {
        inflows: [
          {
            assetId: 'blockchain:cardano:native',
            assetSymbol: 'ADA' as Currency,
            grossAmount: parseDecimal('10.5'),
            netAmount: parseDecimal('10.5'),
            movementFingerprint: 'in-0',
            movementRole: 'principal',
          },
        ],
        outflows: [],
      },
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([]);
  });
});
