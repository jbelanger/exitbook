import { UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { sumDetectedStakingRewardComponentsForTransactions } from '../staking-reward-components.js';

describe('sumDetectedStakingRewardComponentsForTransactions', () => {
  it('deduplicates repeated staking reward component diagnostics across transactions', () => {
    const transactions = [
      {
        diagnostics: [
          {
            code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
            message: 'wallet-scoped staking reward component',
            severity: 'info' as const,
            metadata: {
              amount: '10.524451',
              assetSymbol: 'ADA' as Currency,
              movementRole: 'staking_reward',
            },
          },
        ],
      },
      {
        diagnostics: [
          {
            code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
            message: 'wallet-scoped staking reward component',
            severity: 'info' as const,
            metadata: {
              amount: '10.524451',
              assetSymbol: 'ADA' as Currency,
              movementRole: 'staking_reward',
            },
          },
        ],
      },
    ];

    expect(sumDetectedStakingRewardComponentsForTransactions(transactions, 'ADA' as Currency).toFixed()).toBe(
      '10.524451'
    );
  });
});
