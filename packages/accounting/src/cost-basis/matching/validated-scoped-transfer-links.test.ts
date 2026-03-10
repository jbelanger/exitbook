import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { createFeeMovement, createPriceAtTxTime, createTransactionFromMovements } from '../../__tests__/test-utils.js';

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

  it('accepts confirmed same-hash external partial links after scoped fee deduplication', () => {
    const hash = '0xsamehash-external';

    const firstSourceTx = createTransactionFromMovements(
      20,
      '2024-06-01T12:00:00Z',
      {
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.5'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
      },
      [createFeeMovement('network', 'on-chain', 'BTC', '0.1', '65000')],
      { category: 'transfer', source: 'bitcoin', sourceType: 'blockchain', type: 'withdrawal' }
    );
    firstSourceTx.accountId = 101;
    firstSourceTx.externalId = hash;
    firstSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: hash,
      is_confirmed: true,
    };
    firstSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

    const secondSourceTx = createTransactionFromMovements(
      21,
      '2024-06-01T12:00:00Z',
      {
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.6'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
      },
      [createFeeMovement('network', 'on-chain', 'BTC', '0.1', '65000')],
      { category: 'transfer', source: 'bitcoin', sourceType: 'blockchain', type: 'withdrawal' }
    );
    secondSourceTx.accountId = 102;
    secondSourceTx.externalId = hash;
    secondSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: hash,
      is_confirmed: true,
    };
    secondSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

    const targetTx = createTransactionFromMovements(
      22,
      '2024-06-01T12:10:00Z',
      {
        inflows: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'kraken', sourceType: 'exchange', type: 'deposit' }
    );
    targetTx.accountId = 103;
    targetTx.externalId = `deposit-${hash}`;

    const scopedResult = buildCostBasisScopedTransactions([firstSourceTx, secondSourceTx, targetTx], logger);
    const scopedTransactions = assertOk(scopedResult).transactions;
    const scopedFirstSourceTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 20);
    const scopedSecondSourceTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 21);
    const scopedTargetTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 22);

    expect(scopedFirstSourceTx).toBeDefined();
    expect(scopedSecondSourceTx).toBeDefined();
    expect(scopedTargetTx).toBeDefined();
    expect(scopedFirstSourceTx!.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.5');
    expect(scopedSecondSourceTx!.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.5');

    const firstSourceMovement = scopedFirstSourceTx!.movements.outflows[0]!;
    const secondSourceMovement = scopedSecondSourceTx!.movements.outflows[0]!;
    const targetMovement = scopedTargetTx!.movements.inflows[0]!;

    const result = validateScopedTransferLinks(scopedTransactions, [
      {
        id: 301,
        sourceTransactionId: 20,
        targetTransactionId: 22,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: firstSourceMovement.assetId,
        targetAssetId: targetMovement.assetId,
        sourceAmount: parseDecimal('0.5'),
        targetAmount: parseDecimal('0.5'),
        sourceMovementFingerprint: firstSourceMovement.movementFingerprint,
        targetMovementFingerprint: targetMovement.movementFingerprint,
        linkType: 'blockchain_to_exchange',
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.1,
        },
        status: 'confirmed',
        createdAt: new Date('2024-06-01T12:11:00Z'),
        updatedAt: new Date('2024-06-01T12:11:00Z'),
        metadata: {
          partialMatch: true,
          fullSourceAmount: '0.5',
          fullTargetAmount: '1',
          consumedAmount: '0.5',
          sameHashExternalGroup: true,
          dedupedSameHashFee: '0.1',
          sameHashExternalGroupAmount: '1',
          sameHashExternalGroupSize: 2,
          feeBearingSourceTransactionId: 21,
          sameHashExternalSourceAllocations: [
            {
              sourceTransactionId: 20,
              grossAmount: '0.5',
              linkedAmount: '0.5',
              feeDeducted: '0',
            },
            {
              sourceTransactionId: 21,
              grossAmount: '0.6',
              linkedAmount: '0.5',
              feeDeducted: '0.1',
            },
          ],
          blockchainTxHash: hash,
          sharedToAddress: 'kraken-btc-address',
        },
      },
      {
        id: 302,
        sourceTransactionId: 21,
        targetTransactionId: 22,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: secondSourceMovement.assetId,
        targetAssetId: targetMovement.assetId,
        sourceAmount: parseDecimal('0.5'),
        targetAmount: parseDecimal('0.5'),
        sourceMovementFingerprint: secondSourceMovement.movementFingerprint,
        targetMovementFingerprint: targetMovement.movementFingerprint,
        linkType: 'blockchain_to_exchange',
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.1,
        },
        status: 'confirmed',
        createdAt: new Date('2024-06-01T12:11:00Z'),
        updatedAt: new Date('2024-06-01T12:11:00Z'),
        metadata: {
          partialMatch: true,
          fullSourceAmount: '0.5',
          fullTargetAmount: '1',
          consumedAmount: '0.5',
          sameHashExternalGroup: true,
          dedupedSameHashFee: '0.1',
          sameHashExternalGroupAmount: '1',
          sameHashExternalGroupSize: 2,
          feeBearingSourceTransactionId: 21,
          sameHashExternalSourceAllocations: [
            {
              sourceTransactionId: 20,
              grossAmount: '0.5',
              linkedAmount: '0.5',
              feeDeducted: '0',
            },
            {
              sourceTransactionId: 21,
              grossAmount: '0.6',
              linkedAmount: '0.5',
              feeDeducted: '0.1',
            },
          ],
          blockchainTxHash: hash,
          sharedToAddress: 'kraken-btc-address',
        },
      },
    ]);

    const validated = assertOk(result);
    expect(validated.links).toHaveLength(2);
    expect(validated.links.map((link) => link.sourceMovementAmount.toFixed())).toEqual(['0.5', '0.5']);
  });

  it('accepts confirmed links when source and target symbols differ but asset ids reconcile', () => {
    const sourceTx = createTransactionFromMovements(
      50,
      '2024-05-20T20:14:07Z',
      {
        outflows: [
          {
            assetId: 'exchange:kucoin:rndr',
            assetSymbol: 'RNDR' as Currency,
            grossAmount: parseDecimal('19.5536'),
            netAmount: parseDecimal('19.5536'),
            priceAtTxTime: createPriceAtTxTime('10'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'kucoin', type: 'withdrawal' }
    );
    sourceTx.externalId = '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b';

    const targetTx = createTransactionFromMovements(
      51,
      '2024-05-20T20:15:11Z',
      {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
            assetSymbol: 'RENDER' as Currency,
            grossAmount: parseDecimal('19.5536'),
            priceAtTxTime: createPriceAtTxTime('10'),
          },
        ],
      },
      [],
      { category: 'transfer', source: 'ethereum', sourceType: 'blockchain', type: 'deposit' }
    );
    targetTx.externalId = sourceTx.externalId;
    targetTx.blockchain = {
      name: 'ethereum',
      transaction_hash: sourceTx.externalId,
      is_confirmed: true,
    };

    const scopedResult = buildCostBasisScopedTransactions([sourceTx, targetTx], logger);
    const scopedTransactions = assertOk(scopedResult).transactions;
    const scopedSourceTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 50);
    const scopedTargetTx = scopedTransactions.find((scopedTransaction) => scopedTransaction.tx.id === 51);

    expect(scopedSourceTx).toBeDefined();
    expect(scopedTargetTx).toBeDefined();

    const sourceMovement = scopedSourceTx!.movements.outflows[0]!;
    const targetMovement = scopedTargetTx!.movements.inflows[0]!;

    const result = validateScopedTransferLinks(scopedTransactions, [
      {
        id: 401,
        sourceTransactionId: 50,
        targetTransactionId: 51,
        assetSymbol: 'RNDR' as Currency,
        sourceAssetId: sourceMovement.assetId,
        targetAssetId: targetMovement.assetId,
        sourceAmount: parseDecimal('19.5536'),
        targetAmount: parseDecimal('19.5536'),
        sourceMovementFingerprint: sourceMovement.movementFingerprint,
        targetMovementFingerprint: targetMovement.movementFingerprint,
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.94'),
        matchCriteria: {
          assetMatch: false,
          suspectedMigration: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.017777777777777778,
          hashMatch: true,
        },
        status: 'confirmed',
        createdAt: new Date('2024-05-20T20:16:00Z'),
        updatedAt: new Date('2024-05-20T20:16:00Z'),
      },
    ]);

    const validated = assertOk(result);
    expect(validated.links).toHaveLength(1);
    expect(validated.links[0]?.link.targetAssetId).toBe(
      'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24'
    );
  });
});
