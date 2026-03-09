import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { createPriceAtTxTime, createTransactionFromMovements } from '../../__tests__/test-utils.js';

import { buildCostBasisScopedTransactions } from './build-cost-basis-scoped-transactions.js';
import { validateScopedTransferLinks } from './validated-scoped-transfer-links.js';

describe('validateScopedTransferLinks', () => {
  const logger = getLogger('validated-scoped-transfer-links.test');

  it('fails closed when a confirmed link crosses the scoped transaction boundary', () => {
    const sourceTx = createTransactionFromMovements(
      1,
      '2024-02-01T12:00:00Z',
      {
        outflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'kraken', type: 'withdrawal' }
    );

    const targetTx = createTransactionFromMovements(
      2,
      '2024-02-01T12:30:00Z',
      {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'wallet', sourceType: 'blockchain', type: 'deposit' }
    );

    const scopedResult = buildCostBasisScopedTransactions([sourceTx, targetTx], logger);
    const scopedTransactions = assertOk(scopedResult).transactions;
    const scopedSourceTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 1);
    const scopedTargetTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 2);

    expect(scopedSourceTx).toBeDefined();
    expect(scopedTargetTx).toBeDefined();

    const sourceMovement = scopedSourceTx!.movements.outflows[0];
    const targetMovement = scopedTargetTx!.movements.inflows[0];

    expect(sourceMovement).toBeDefined();
    expect(targetMovement).toBeDefined();

    const result = validateScopedTransferLinks(
      [scopedSourceTx!],
      [
        {
          id: 101,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: sourceMovement!.assetId,
          targetAssetId: targetMovement!.assetId,
          sourceAmount: parseDecimal('1'),
          targetAmount: parseDecimal('1'),
          sourceMovementFingerprint: sourceMovement!.movementFingerprint,
          targetMovementFingerprint: targetMovement!.movementFingerprint,
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('99'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1'),
            timingValid: true,
            timingHours: 0.5,
          },
          status: 'confirmed',
          createdAt: new Date('2024-02-01T13:00:00Z'),
          updatedAt: new Date('2024-02-01T13:00:00Z'),
        },
      ]
    );

    const error = assertErr(result);
    expect(error.message).toContain('crosses the scoped transaction boundary');
    expect(error.message).toContain('source tx 1 in scope=true');
    expect(error.message).toContain('target tx 2 in scope=false');
  });

  it('accepts same-hash blockchain movements from different accounts when fingerprints are account-scoped', () => {
    const firstSourceTx = createTransactionFromMovements(
      10,
      '2024-05-31T20:17:28Z',
      {
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.01109536'),
            netAmount: parseDecimal('0.01092189'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'bitcoin', sourceType: 'blockchain', type: 'withdrawal' }
    );
    firstSourceTx.accountId = 8;
    firstSourceTx.externalId = '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96';

    const secondSourceTx = createTransactionFromMovements(
      11,
      '2024-05-31T20:17:28Z',
      {
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.00404382'),
            netAmount: parseDecimal('0.00387035'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'bitcoin', sourceType: 'blockchain', type: 'withdrawal' }
    );
    secondSourceTx.accountId = 10;
    secondSourceTx.externalId = firstSourceTx.externalId;

    const targetTx = createTransactionFromMovements(
      12,
      '2024-05-31T21:05:00Z',
      {
        inflows: [
          {
            assetId: 'exchange:kucoin:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.00387035'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'kucoin', sourceType: 'exchange', type: 'deposit' }
    );
    targetTx.accountId = 20;
    targetTx.externalId = firstSourceTx.externalId;

    const scopedResult = buildCostBasisScopedTransactions([firstSourceTx, secondSourceTx, targetTx], logger);
    const scopedTransactions = assertOk(scopedResult).transactions;
    const scopedSecondSourceTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 11);
    const scopedTargetTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 12);

    expect(scopedSecondSourceTx).toBeDefined();
    expect(scopedTargetTx).toBeDefined();

    const sourceMovement = scopedSecondSourceTx!.movements.outflows[0];
    const targetMovement = scopedTargetTx!.movements.inflows[0];

    expect(sourceMovement).toBeDefined();
    expect(targetMovement).toBeDefined();
    expect(sourceMovement!.movementFingerprint).not.toBe(
      scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 10)!.movements.outflows[0]!
        .movementFingerprint
    );

    const result = validateScopedTransferLinks(scopedTransactions, [
      {
        id: 201,
        sourceTransactionId: 11,
        targetTransactionId: 12,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: sourceMovement!.assetId,
        targetAssetId: targetMovement!.assetId,
        sourceAmount: parseDecimal('0.00387035'),
        targetAmount: parseDecimal('0.00387035'),
        sourceMovementFingerprint: sourceMovement!.movementFingerprint,
        targetMovementFingerprint: targetMovement!.movementFingerprint,
        linkType: 'blockchain_to_exchange',
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.8,
        },
        status: 'confirmed',
        createdAt: new Date('2024-05-31T21:06:00Z'),
        updatedAt: new Date('2024-05-31T21:06:00Z'),
      },
    ]);

    const validated = assertOk(result);
    expect(validated.links).toHaveLength(1);
    expect(validated.links[0]?.link.sourceTransactionId).toBe(11);
  });
});
