import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import type { TransactionAnnotation } from '../../annotations/annotation-types.js';
import { resolveExactTargetResidualRole } from '../exact-target-residual-role.js';

function makeTransaction(
  inflowDrafts: readonly {
    amount: string;
    assetId?: string | undefined;
    assetSymbol: Currency;
  }[]
): Pick<Transaction, 'movements'> {
  return {
    movements: {
      inflows: inflowDrafts.map((draft, index) => ({
        assetId: draft.assetId ?? `exchange:test:${draft.assetSymbol.toLowerCase()}`,
        assetSymbol: draft.assetSymbol,
        grossAmount: parseDecimal(draft.amount),
        movementFingerprint: `movement:tx:1:${draft.assetSymbol.toLowerCase()}:inflow:${index}`,
      })),
      outflows: [],
    },
  };
}

function makeStakingRewardComponentAnnotation(overrides?: {
  amount?: string | undefined;
  assetSymbol?: Currency | undefined;
  transactionId?: number | undefined;
}): TransactionAnnotation {
  const amount = overrides?.amount ?? '10.524451';
  const assetSymbol = overrides?.assetSymbol ?? ('ADA' as Currency);
  const transactionId = overrides?.transactionId ?? 23;

  return {
    annotationFingerprint: `annotation:staking_reward_component:${transactionId}:${assetSymbol}:${amount}`,
    accountId: 1,
    transactionId,
    txFingerprint: `tx:${transactionId}`,
    kind: 'staking_reward_component',
    tier: 'asserted',
    target: { scope: 'transaction' },
    detectorId: 'staking-reward-component',
    derivedFromTxIds: [transactionId],
    provenanceInputs: ['diagnostic'],
    metadata: {
      amount,
      assetSymbol,
      componentKey: `unattributed_staking_reward_component:${assetSymbol}:${amount}`,
    },
  };
}

describe('resolveExactTargetResidualRole', () => {
  it('uses exact explained residual metadata when present', () => {
    const role = resolveExactTargetResidualRole({
      assetSymbol: 'ADA' as Currency,
      residualQuantity: parseDecimal('10.524451'),
      targetTransaction: makeTransaction([{ assetSymbol: 'ADA' as Currency, amount: '2679.718442' }]),
      transferLinks: [
        {
          metadata: {
            explainedTargetResidualAmount: '10.524451',
            explainedTargetResidualRole: 'refund_rebate',
          },
        },
      ],
    });

    expect(role).toBe('refund_rebate');
  });

  it('falls back to staking-reward component annotations for unambiguous single-inflow targets', () => {
    const role = resolveExactTargetResidualRole({
      assetSymbol: 'ADA' as Currency,
      residualQuantity: parseDecimal('10.524451'),
      targetTransaction: makeTransaction([{ assetSymbol: 'ADA' as Currency, amount: '2679.718442' }]),
      targetTransactionAnnotations: [makeStakingRewardComponentAnnotation()],
      transferLinks: [
        {
          metadata: {
            partialMatch: true,
            fullTargetAmount: '2679.718442',
            consumedAmount: '2669.193991',
          },
        },
      ],
    });

    expect(role).toBe('staking_reward');
  });

  it('does not infer a staking-reward residual when the target has multiple inflows of the same asset', () => {
    const role = resolveExactTargetResidualRole({
      assetSymbol: 'ADA' as Currency,
      residualQuantity: parseDecimal('10.524451'),
      targetTransaction: makeTransaction([
        { assetSymbol: 'ADA' as Currency, amount: '2679.718442' },
        { assetSymbol: 'ADA' as Currency, amount: '1' },
      ]),
      targetTransactionAnnotations: [makeStakingRewardComponentAnnotation()],
      transferLinks: [],
    });

    expect(role).toBeUndefined();
  });
});
