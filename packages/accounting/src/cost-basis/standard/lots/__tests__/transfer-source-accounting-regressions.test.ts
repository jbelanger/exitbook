import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import {
  createLot,
  createTransactionFromMovements,
  createPriceAtTxTime,
  createFeeMovement,
} from '../../../../__tests__/test-utils.js';
import type { ResolvedInternalTransferCarryover } from '../../../../accounting-model/accounting-model-resolution.js';
import type {
  AccountingAssetEntryView,
  AccountingTransactionView,
} from '../../../../accounting-model/accounting-model-types.js';
import { buildAccountingModelFromTransactions } from '../../../../accounting-model/build-accounting-model-from-transactions.js';
import type { ValidatedTransferLink } from '../../../../accounting-model/validated-transfer-links.js';
import { FifoStrategy } from '../../strategies/fifo-strategy.js';
import {
  type InternalTransferCarryoverTargetBinding,
  processInternalTransferCarryoverSource,
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

  function prepareTransferSource(rawTransaction: Transaction) {
    const accountingModel = assertOk(buildAccountingModelFromTransactions([rawTransaction], logger));
    const transactionView = accountingModel.accountingTransactionViews[0];
    const outflow = transactionView?.outflows[0];

    expect(transactionView).toBeDefined();
    expect(outflow).toBeDefined();

    return {
      transactionView: transactionView as AccountingTransactionView,
      outflow: outflow as AccountingAssetEntryView,
    };
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
      { category: 'transfer', platformKey: 'kraken', type: 'withdrawal' }
    );

    const { transactionView, outflow } = prepareTransferSource(rawTransaction);

    const validatedLink: ValidatedTransferLink = {
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
        sourceMovementFingerprint: outflow.movementFingerprint,
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
      sourceMovementFingerprint: outflow.movementFingerprint,
      targetAssetId: 'test:btc',
      targetMovementAmount: parseDecimal('1.5'),
      targetMovementFingerprint: 'target:movement:0',
    };

    const result = processTransferSource(
      transactionView,
      outflow,
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
      { category: 'transfer', platformKey: 'kucoin', type: 'withdrawal' }
    );

    const { transactionView, outflow } = prepareTransferSource(rawTransaction);

    const validatedLink: ValidatedTransferLink = {
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
        sourceMovementFingerprint: outflow.movementFingerprint,
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
      sourceMovementFingerprint: outflow.movementFingerprint,
      targetAssetId: 'test:tfuel',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: 'target:movement:1',
    };

    const result = processTransferSource(
      transactionView,
      outflow,
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
      { category: 'transfer', platformKey: 'arbitrum', platformKind: 'blockchain', type: 'withdrawal' }
    );

    const { transactionView, outflow } = prepareTransferSource(rawTransaction);

    const validatedLink: ValidatedTransferLink = {
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
        sourceMovementFingerprint: outflow.movementFingerprint,
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
      sourceMovementFingerprint: outflow.movementFingerprint,
      targetAssetId: 'test:eth',
      targetMovementAmount: parseDecimal('0.038410276629335232'),
      targetMovementFingerprint: 'target:movement:2',
    };

    const result = processTransferSource(
      transactionView,
      outflow,
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
      { category: 'transfer', platformKey: 'kraken', type: 'withdrawal' }
    );

    const { transactionView, outflow } = prepareTransferSource(rawTransaction);

    const validatedLink: ValidatedTransferLink = {
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
        sourceMovementFingerprint: outflow.movementFingerprint,
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
      sourceMovementFingerprint: outflow.movementFingerprint,
      targetAssetId: 'test:btc',
      targetMovementAmount: parseDecimal('2.99998'),
      targetMovementFingerprint: 'target:movement:3',
    };

    const result = processTransferSource(
      transactionView,
      outflow,
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
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
      type: 'withdrawal',
    });

    const carryover: ResolvedInternalTransferCarryover = {
      carryover: {
        sourceEntryFingerprint: 'entry:source',
        targetBindings: [
          {
            quantity: parseDecimal('1.5'),
            targetEntryFingerprint: 'entry:target',
          },
        ],
        feeEntryFingerprint: 'entry:fee',
      },
      source: {
        entry: {
          entryFingerprint: 'entry:source',
          kind: 'asset_outflow',
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: parseDecimal('1.5'),
          role: 'principal',
          provenanceBindings: [
            {
              txFingerprint: rawSourceTransaction.txFingerprint,
              movementFingerprint: 'source:movement:0',
              quantity: parseDecimal('1.5'),
            },
          ],
        },
        movement: {
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          grossQuantity: parseDecimal('2'),
          movementFingerprint: 'source:movement:0',
          netQuantity: parseDecimal('1.5'),
          priceAtTxTime: createPriceAtTxTime('60000'),
          role: 'principal',
          sourceKind: 'processed_transaction',
        },
        provenanceBinding: {
          txFingerprint: rawSourceTransaction.txFingerprint,
          movementFingerprint: 'source:movement:0',
          quantity: parseDecimal('1.5'),
        },
        processedTransaction: rawSourceTransaction,
      },
      fee: {
        entry: {
          entryFingerprint: 'entry:fee',
          kind: 'fee',
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: parseDecimal('0.5'),
          feeScope: 'network',
          feeSettlement: 'on-chain',
          provenanceBindings: [
            {
              txFingerprint: rawSourceTransaction.txFingerprint,
              movementFingerprint: 'movement:test:btc:fee:carryover',
              quantity: parseDecimal('0.5'),
            },
          ],
        },
        fee: {
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          entryFingerprint: 'entry:fee',
          feeScope: 'network',
          feeSettlement: 'on-chain',
          movementFingerprint: 'movement:test:btc:fee:carryover',
          priceAtTxTime: createPriceAtTxTime('60000'),
          quantity: parseDecimal('0.5'),
        },
        provenanceBinding: {
          txFingerprint: rawSourceTransaction.txFingerprint,
          movementFingerprint: 'movement:test:btc:fee:carryover',
          quantity: parseDecimal('0.5'),
        },
        transactionView: {
          processedTransaction: rawSourceTransaction,
          inflows: [],
          outflows: [],
          fees: [],
        },
      },
      targets: [
        {
          binding: {
            quantity: parseDecimal('1.5'),
            targetEntryFingerprint: 'entry:target',
          },
          target: {
            entry: {
              entryFingerprint: 'entry:target',
              kind: 'asset_inflow',
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              quantity: parseDecimal('1.5'),
              role: 'principal',
              provenanceBindings: [
                {
                  txFingerprint: 'target:tx:fingerprint',
                  movementFingerprint: 'target:movement:0',
                  quantity: parseDecimal('1.5'),
                },
              ],
            },
            movement: {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossQuantity: parseDecimal('1.5'),
              movementFingerprint: 'target:movement:0',
              netQuantity: parseDecimal('1.5'),
              priceAtTxTime: createPriceAtTxTime('60000'),
              role: 'principal',
              sourceKind: 'accounting_transaction_view',
            },
            provenanceBinding: {
              txFingerprint: 'target:tx:fingerprint',
              movementFingerprint: 'target:movement:0',
              quantity: parseDecimal('1.5'),
            },
            processedTransaction: createTransactionFromMovements(21, '2024-03-02T00:30:00Z', {}, [], {
              category: 'transfer',
              platformKey: 'coinbase',
              type: 'deposit',
            }),
            transactionView: {
              processedTransaction: createTransactionFromMovements(21, '2024-03-02T00:30:00Z', {}, [], {
                category: 'transfer',
                platformKey: 'coinbase',
                type: 'deposit',
              }),
              inflows: [],
              outflows: [],
              fees: [],
            },
          },
        },
      ],
    };

    const targetBindings: InternalTransferCarryoverTargetBinding[] = [
      {
        bindingKey: 'carryover:source:movement:0:target:movement:0',
        target: carryover.targets[0]!,
      },
    ];

    const result = processInternalTransferCarryoverSource(
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
    expect(value.transfers.every((transfer) => transfer.provenance.kind === 'internal-transfer-carryover')).toBe(true);
    expect(value.transfers[0]?.provenance.targetMovementFingerprint).toBe('target:movement:0');
    expect(
      value.transfers.reduce((sum, transfer) => sum.plus(transfer.quantityTransferred), parseDecimal('0')).toFixed()
    ).toBe('1.5');
  });
});
