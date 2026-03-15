import { type Currency, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import {
  createLot,
  createTransactionFromMovements,
  createPriceAtTxTime,
  createFeeMovement,
} from '../../../../__tests__/test-utils.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
} from '../../matching/build-cost-basis-scoped-transactions.js';
import { buildCostBasisScopedTransactions } from '../../matching/build-cost-basis-scoped-transactions.js';
import type { ValidatedScopedTransferLink } from '../../matching/validated-scoped-transfer-links.js';
import { FifoStrategy } from '../../strategies/fifo-strategy.js';
import {
  type CarryoverTargetBinding,
  processFeeOnlyInternalCarryoverSource,
} from '../internal-carryover-processing-utils.js';
import { processTransferSource } from '../lot-transfer-processing-utils.js';

describe('transfer source accounting regressions', () => {
  const logger = getLogger('transfer-source-accounting-regressions.test');

  function createSourceLots() {
    return [
      createLot('11111111-1111-4111-8111-111111111111', 'BTC', '1', '10000', new Date('2024-01-01T00:00:00Z')),
      createLot('22222222-2222-4222-8222-222222222222', 'BTC', '1', '20000', new Date('2024-01-02T00:00:00Z')),
    ];
  }

  it('matches same-asset transfer fee disposal against the post-transfer remaining lots', () => {
    const rawTransaction = createTransactionFromMovements(
      10,
      '2024-03-01T00:00:00Z',
      {
        outflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('2'),
            netAmount: parseDecimal('1.5'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
      },
      [createFeeMovement('network', 'on-chain', 'BTC', '0.5', '60000')],
      { category: 'transfer', source: 'kraken', type: 'withdrawal' }
    );

    const scopedResult = buildCostBasisScopedTransactions([rawTransaction], logger);
    const scopedTransaction = assertOk(scopedResult).transactions[0];
    const outflow = scopedTransaction?.movements.outflows[0];

    expect(scopedTransaction).toBeDefined();
    expect(outflow).toBeDefined();

    const validatedLink: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 501,
        sourceTransactionId: 10,
        targetTransactionId: 20,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('1.5'),
        targetAmount: parseDecimal('1.5'),
        sourceMovementFingerprint: outflow!.movementFingerprint,
        targetMovementFingerprint: 'target:movement:0',
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date('2024-03-01T00:00:00Z'),
        updatedAt: new Date('2024-03-01T00:00:00Z'),
      },
      sourceAssetId: 'test:btc',
      sourceMovementAmount: parseDecimal('1.5'),
      sourceMovementFingerprint: outflow!.movementFingerprint,
      targetAssetId: 'test:btc',
      targetMovementAmount: parseDecimal('1.5'),
      targetMovementFingerprint: 'target:movement:0',
    };

    const result = processTransferSource(
      scopedTransaction!,
      outflow!,
      [validatedLink],
      createSourceLots(),
      new FifoStrategy(),
      '33333333-3333-4333-8333-333333333333',
      { sameAssetTransferFeePolicy: 'disposal' }
    );

    const value = assertOk(result);

    expect(value.disposals).toHaveLength(1);
    expect(value.disposals[0]?.lotId).toBe('22222222-2222-4222-8222-222222222222');
    expect(value.disposals[0]?.quantityDisposed.toFixed()).toBe('0.5');
    expect(value.updatedLots.map((lot) => lot.remainingQuantity.toFixed())).toEqual(['0', '0']);
    expect(value.updatedLots.map((lot) => lot.status)).toEqual(['fully_disposed', 'fully_disposed']);
    expect(value.transfers).toHaveLength(2);
    expect(value.transfers.every((transfer) => transfer.provenance.kind === 'confirmed-link')).toBe(true);
    expect(
      value.transfers.reduce((sum, transfer) => sum.plus(transfer.quantityTransferred), parseDecimal('0')).toFixed()
    ).toBe('1.5');
  });

  it('uses the modeled transfer amount when same-asset fees are stored as separate movements', () => {
    const rawTransaction = createTransactionFromMovements(
      12,
      '2024-03-03T00:00:00Z',
      {
        outflows: [
          {
            assetId: 'test:tfuel',
            assetSymbol: 'TFUEL' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('0.08628'),
          },
        ],
      },
      [createFeeMovement('platform', 'balance', 'TFUEL', '11.5', '0.08628')],
      { category: 'transfer', source: 'kucoin', type: 'withdrawal' }
    );

    const scopedResult = buildCostBasisScopedTransactions([rawTransaction], logger);
    const scopedTransaction = assertOk(scopedResult).transactions[0];
    const outflow = scopedTransaction?.movements.outflows[0];

    expect(scopedTransaction).toBeDefined();
    expect(outflow).toBeDefined();

    const validatedLink: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 502,
        sourceTransactionId: 12,
        targetTransactionId: 22,
        assetSymbol: 'TFUEL' as Currency,
        sourceAssetId: 'test:tfuel',
        targetAssetId: 'test:tfuel',
        sourceAmount: parseDecimal('1'),
        targetAmount: parseDecimal('1'),
        sourceMovementFingerprint: outflow!.movementFingerprint,
        targetMovementFingerprint: 'target:movement:1',
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date('2024-03-03T00:00:00Z'),
        updatedAt: new Date('2024-03-03T00:00:00Z'),
      },
      sourceAssetId: 'test:tfuel',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint: outflow!.movementFingerprint,
      targetAssetId: 'test:tfuel',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: 'target:movement:1',
    };

    const result = processTransferSource(
      scopedTransaction!,
      outflow!,
      [validatedLink],
      [
        createLot('11111111-1111-4111-8111-111111111111', 'TFUEL', '10', '0.05', new Date('2024-01-01T00:00:00Z')),
        createLot('22222222-2222-4222-8222-222222222222', 'TFUEL', '10', '0.06', new Date('2024-01-02T00:00:00Z')),
      ],
      new FifoStrategy(),
      '55555555-5555-4555-8555-555555555555',
      { sameAssetTransferFeePolicy: 'disposal' }
    );

    const value = assertOk(result);

    expect(
      value.transfers.reduce((sum, transfer) => sum.plus(transfer.quantityTransferred), parseDecimal('0')).toFixed()
    ).toBe('1');
    expect(
      value.disposals.reduce((sum, disposal) => sum.plus(disposal.quantityDisposed), parseDecimal('0')).toFixed()
    ).toBe('11.5');
  });

  it('applies link implied fee amounts as same-asset transfer fees', () => {
    const rawTransaction = createTransactionFromMovements(
      14,
      '2024-03-04T00:00:00Z',
      {
        outflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.04'),
            netAmount: parseDecimal('0.04'),
            priceAtTxTime: createPriceAtTxTime('3500'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'arbitrum', sourceType: 'blockchain', type: 'withdrawal' }
    );

    const scopedResult = buildCostBasisScopedTransactions([rawTransaction], logger);
    const scopedTransaction = assertOk(scopedResult).transactions[0];
    const outflow = scopedTransaction?.movements.outflows[0];

    expect(scopedTransaction).toBeDefined();
    expect(outflow).toBeDefined();

    const validatedLink: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 503,
        sourceTransactionId: 14,
        targetTransactionId: 24,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'test:eth',
        targetAssetId: 'test:eth',
        sourceAmount: parseDecimal('0.04'),
        targetAmount: parseDecimal('0.038410276629335232'),
        impliedFeeAmount: parseDecimal('0.001589723370664768'),
        sourceMovementFingerprint: outflow!.movementFingerprint,
        targetMovementFingerprint: 'target:movement:2',
        linkType: 'blockchain_to_blockchain',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9602569157333808'),
          timingValid: true,
          timingHours: 0.01,
          addressMatch: true,
        },
        status: 'confirmed',
        createdAt: new Date('2024-03-04T00:00:00Z'),
        updatedAt: new Date('2024-03-04T00:00:00Z'),
      },
      sourceAssetId: 'test:eth',
      sourceMovementAmount: parseDecimal('0.04'),
      sourceMovementFingerprint: outflow!.movementFingerprint,
      targetAssetId: 'test:eth',
      targetMovementAmount: parseDecimal('0.038410276629335232'),
      targetMovementFingerprint: 'target:movement:2',
    };

    const result = processTransferSource(
      scopedTransaction!,
      outflow!,
      [validatedLink],
      [createLot('11111111-1111-4111-8111-111111111111', 'ETH', '1', '3000', new Date('2024-01-01T00:00:00Z'))],
      new FifoStrategy(),
      '66666666-6666-4666-8666-666666666666',
      { sameAssetTransferFeePolicy: 'disposal' }
    );

    const value = assertOk(result);

    expect(value.transfers).toHaveLength(1);
    expect(value.transfers[0]?.quantityTransferred.eq(parseDecimal('0.038410276629335232'))).toBe(true);
    expect(value.disposals).toHaveLength(1);
    expect(value.disposals[0]?.quantityDisposed.eq(parseDecimal('0.001589723370664768'))).toBe(true);
    expect(value.warnings).toEqual([]);
  });

  it('absorbs add-to-basis fee remainder on the final transfer slice', () => {
    const rawTransaction = createTransactionFromMovements(
      15,
      '2024-03-05T00:00:00Z',
      {
        outflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('3'),
            netAmount: parseDecimal('2.99998'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
      },
      [createFeeMovement('network', 'on-chain', 'BTC', '0.00002', '50000')],
      { category: 'transfer', source: 'kraken', type: 'withdrawal' }
    );

    const scopedResult = buildCostBasisScopedTransactions([rawTransaction], logger);
    const scopedTransaction = assertOk(scopedResult).transactions[0];
    const outflow = scopedTransaction?.movements.outflows[0];

    expect(scopedTransaction).toBeDefined();
    expect(outflow).toBeDefined();

    const validatedLink: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 504,
        sourceTransactionId: 15,
        targetTransactionId: 25,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceAmount: parseDecimal('2.99998'),
        targetAmount: parseDecimal('2.99998'),
        sourceMovementFingerprint: outflow!.movementFingerprint,
        targetMovementFingerprint: 'target:movement:3',
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'confirmed',
        createdAt: new Date('2024-03-05T00:00:00Z'),
        updatedAt: new Date('2024-03-05T00:00:00Z'),
      },
      sourceAssetId: 'test:btc',
      sourceMovementAmount: parseDecimal('2.99998'),
      sourceMovementFingerprint: outflow!.movementFingerprint,
      targetAssetId: 'test:btc',
      targetMovementAmount: parseDecimal('2.99998'),
      targetMovementFingerprint: 'target:movement:3',
    };

    const result = processTransferSource(
      scopedTransaction!,
      outflow!,
      [validatedLink],
      [
        createLot('11111111-1111-4111-8111-111111111111', 'BTC', '1', '45000', new Date('2024-01-01T00:00:00Z')),
        createLot('22222222-2222-4222-8222-222222222222', 'BTC', '1', '46000', new Date('2024-01-02T00:00:00Z')),
        createLot('33333333-3333-4333-8333-333333333333', 'BTC', '1', '47000', new Date('2024-01-03T00:00:00Z')),
      ],
      new FifoStrategy(),
      '77777777-7777-4777-8777-777777777777',
      { sameAssetTransferFeePolicy: 'add-to-basis' }
    );

    const value = assertOk(result);
    const allocatedFeeUsdValue = value.transfers.reduce(
      (sum, transfer) => sum.plus(transfer.metadata?.sameAssetFeeUsdValue ?? parseDecimal('0')),
      parseDecimal('0')
    );

    expect(value.transfers).toHaveLength(3);
    expect(allocatedFeeUsdValue.eq(parseDecimal('1'))).toBe(true);
    expect(value.warnings).toEqual([]);
  });

  it('keeps fee-only carryover fee disposal on the remaining lots after retained quantity matching', () => {
    const rawSourceTransaction = createTransactionFromMovements(11, '2024-03-02T00:00:00Z', {}, [], {
      category: 'transfer',
      source: 'bitcoin',
      sourceType: 'blockchain',
      type: 'withdrawal',
    });

    const sourceTransaction: AccountingScopedTransaction = {
      tx: rawSourceTransaction,
      rebuildDependencyTransactionIds: [],
      movements: { inflows: [], outflows: [] },
      fees: [],
    };

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0.5'),
        originalTransactionId: 11,
        rawPosition: 0,
        scope: 'network',
        settlement: 'on-chain',
        priceAtTxTime: createPriceAtTxTime('60000'),
      },
      retainedQuantity: parseDecimal('1.5'),
      sourceTransactionId: 11,
      sourceMovementFingerprint: 'source:movement:0',
      targets: [
        {
          targetTransactionId: 21,
          targetMovementFingerprint: 'target:movement:0',
          quantity: parseDecimal('1.5'),
        },
      ],
    };

    const targetBindings: CarryoverTargetBinding[] = [
      {
        bindingKey: 'carryover:source:movement:0:target:movement:0',
        target: carryover.targets[0]!,
      },
    ];

    const result = processFeeOnlyInternalCarryoverSource(
      sourceTransaction,
      carryover,
      targetBindings,
      createSourceLots(),
      new FifoStrategy(),
      '44444444-4444-4444-8444-444444444444',
      { sameAssetTransferFeePolicy: 'disposal' }
    );

    const value = assertOk(result);

    expect(value.disposals).toHaveLength(1);
    expect(value.disposals[0]?.lotId).toBe('22222222-2222-4222-8222-222222222222');
    expect(value.disposals[0]?.quantityDisposed.toFixed()).toBe('0.5');
    expect(value.updatedLots.map((lot) => lot.remainingQuantity.toFixed())).toEqual(['0', '0']);
    expect(value.updatedLots.map((lot) => lot.status)).toEqual(['fully_disposed', 'fully_disposed']);
    expect(value.transfers).toHaveLength(2);
    expect(value.transfers.every((transfer) => transfer.provenance.kind === 'fee-only-carryover')).toBe(true);
    expect(value.transfers[0]?.provenance.targetMovementFingerprint).toBe('target:movement:0');
    expect(
      value.transfers.reduce((sum, transfer) => sum.plus(transfer.quantityTransferred), parseDecimal('0')).toFixed()
    ).toBe('1.5');
  });
});
