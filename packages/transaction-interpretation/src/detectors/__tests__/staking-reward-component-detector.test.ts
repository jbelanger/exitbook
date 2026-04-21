import { UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE, type Transaction } from '@exitbook/core';
import { type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { StakingRewardComponentDetector } from '../staking-reward-component-detector.js';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-staking-component',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'cardano',
    platformKind: overrides.platformKind ?? 'blockchain',
    status: 'success',
    from: 'staking-pool',
    to: 'wallet',
    movements: overrides.movements ?? {
      inflows: [],
      outflows: [],
    },
    fees: [],
    diagnostics: overrides.diagnostics ?? [
      {
        code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
        message: 'wallet-scoped staking reward component',
        severity: 'info',
        metadata: {
          amount: '10.5',
          assetSymbol: 'ADA' as Currency,
          movementRole: 'staking_reward',
        },
      },
    ],
    operation: overrides.operation ?? { category: 'transfer', type: 'withdrawal' },
    blockchain: {
      name: overrides.platformKey ?? 'cardano',
      transaction_hash: '0xhash',
      is_confirmed: true,
    },
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('StakingRewardComponentDetector', () => {
  it('emits asserted transaction-scoped staking reward component annotations from diagnostics', async () => {
    const detector = new StakingRewardComponentDetector();
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
        kind: 'staking_reward_component',
        tier: 'asserted',
        target: { scope: 'transaction' },
        detectorId: 'staking-reward-component',
        derivedFromTxIds: [transaction.id],
        provenanceInputs: ['diagnostic'],
        metadata: {
          amount: '10.5',
          assetSymbol: 'ADA',
          componentKey: 'unattributed_staking_reward_component:ADA:10.5',
        },
      }),
    ]);
  });

  it('deduplicates repeated component diagnostics within one transaction', async () => {
    const detector = new StakingRewardComponentDetector();
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
          message: 'wallet-scoped staking reward component',
          severity: 'info',
          metadata: {
            amount: '10.5',
            assetSymbol: 'ADA' as Currency,
            movementRole: 'staking_reward',
          },
        },
        {
          code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
          message: 'wallet-scoped staking reward component',
          severity: 'info',
          metadata: {
            amount: '10.5',
            assetSymbol: 'ADA' as Currency,
            movementRole: 'staking_reward',
          },
        },
      ],
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toHaveLength(1);
  });

  it('ignores transactions without unattributed staking reward diagnostics', async () => {
    const detector = new StakingRewardComponentDetector();
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'bridge',
          severity: 'info',
          metadata: {
            protocol: 'wormhole',
          },
        },
      ],
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
