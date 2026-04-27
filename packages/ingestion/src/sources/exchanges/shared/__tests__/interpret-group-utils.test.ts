import type { Currency } from '@exitbook/foundation';
import { describe, expect, test } from 'vitest';

import type { ExchangeMovementDraft } from '../exchange-interpretation.js';
import { consolidateMovements } from '../interpret-group-utils.js';

function movement(overrides: Partial<ExchangeMovementDraft>): ExchangeMovementDraft {
  return {
    assetId: 'exchange:coinbase:usdc',
    assetSymbol: 'USDC' as Currency,
    grossAmount: '1',
    netAmount: '1',
    ...overrides,
  };
}

describe('interpret-group-utils', () => {
  test('consolidates same-asset movements with the same accounting role', () => {
    const consolidated = consolidateMovements([
      movement({ grossAmount: '1.25', netAmount: '1.25', sourceEventIds: ['evt-1'] }),
      movement({ grossAmount: '2.75', netAmount: '2.70', sourceEventIds: ['evt-2'] }),
    ]);

    expect(consolidated).toEqual([
      expect.objectContaining({
        assetId: 'exchange:coinbase:usdc',
        grossAmount: '4',
        netAmount: '3.95',
        sourceEventIds: ['evt-1', 'evt-2'],
      }),
    ]);
  });

  test('does not consolidate same-asset movements with different accounting roles', () => {
    const consolidated = consolidateMovements([
      movement({ grossAmount: '10', netAmount: '10', sourceEventIds: ['principal-evt'] }),
      movement({
        grossAmount: '0.5',
        movementRole: 'staking_reward',
        netAmount: '0.5',
        sourceEventIds: ['reward-evt'],
      }),
    ]);

    expect(consolidated).toEqual([
      expect.objectContaining({
        assetId: 'exchange:coinbase:usdc',
        grossAmount: '10',
        sourceEventIds: ['principal-evt'],
      }),
      expect.objectContaining({
        assetId: 'exchange:coinbase:usdc',
        grossAmount: '0.5',
        movementRole: 'staking_reward',
        sourceEventIds: ['reward-evt'],
      }),
    ]);
  });
});
