import type { AssetMovement, Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createPriceAtTxTime, createTransactionFromMovements } from '../../__tests__/test-utils.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';

import {
  assertNoAmbiguousScopedBlockchainSymbols,
  collectAmbiguousScopedBlockchainSymbols,
} from './ambiguous-asset-review.js';

const noopLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  trace: () => undefined,
  warn: () => undefined,
} as const;

function createBlockchainTokenMovement(assetId: string, assetSymbol: string, amount: string): AssetMovement {
  return {
    assetId,
    assetSymbol: assetSymbol as Currency,
    grossAmount: parseDecimal(amount),
    priceAtTxTime: createPriceAtTxTime('1'),
  };
}

describe('ambiguous-asset-review', () => {
  it('collects same-chain same-symbol blockchain token collisions', () => {
    const first = createTransactionFromMovements(
      1,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xaaa', 'USDC', '10')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );
    const second = createTransactionFromMovements(
      2,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xbbb', 'USDC', '5')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );

    const scoped = assertOk(buildCostBasisScopedTransactions([first, second], noopLogger));
    const groups = assertOk(collectAmbiguousScopedBlockchainSymbols(scoped.transactions));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.chain).toBe('arbitrum');
    expect(groups[0]?.displaySymbol).toBe('USDC');
    expect(groups[0]?.assets.map((asset) => asset.assetId)).toEqual([
      'blockchain:arbitrum:0xaaa',
      'blockchain:arbitrum:0xbbb',
    ]);
  });

  it('ignores native assets and non-blockchain assets', () => {
    const exchange = createTransactionFromMovements(1, '2025-01-10T00:00:00.000Z', {
      inflows: [
        {
          assetId: 'exchange:kraken:usdc',
          assetSymbol: 'USDC' as Currency,
          grossAmount: parseDecimal('10'),
          priceAtTxTime: createPriceAtTxTime('1'),
        },
      ],
    });
    const native = createTransactionFromMovements(
      2,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [
          {
            assetId: 'blockchain:arbitrum:native',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('3000'),
          },
        ],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );

    const scoped = assertOk(buildCostBasisScopedTransactions([exchange, native], noopLogger));
    const reviewResult = assertNoAmbiguousScopedBlockchainSymbols(scoped.transactions);

    expect(reviewResult.isOk()).toBe(true);
  });

  it('fails closed with an actionable review message', () => {
    const first = createTransactionFromMovements(
      1,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xaaa', 'USDC', '10')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );
    const second = createTransactionFromMovements(
      2,
      '2025-01-11T00:00:00.000Z',
      {
        outflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xbbb', 'USDC', '5')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'withdrawal' }
    );

    const scoped = assertOk(buildCostBasisScopedTransactions([first, second], noopLogger));
    const reviewResult = assertNoAmbiguousScopedBlockchainSymbols(scoped.transactions);
    const error = assertErr(reviewResult);

    expect(error.message).toContain('Ambiguous on-chain asset symbols require review');
    expect(error.message).toContain('arbitrum / USDC');
    expect(error.message).toContain('exitbook assets exclude --asset-id <assetId>');
  });
});
