import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import {
  createFeeMovement,
  createPriceAtTxTime,
  createTransactionFromMovements,
  seedTxFingerprint,
} from '../../__tests__/test-utils.js';
import { buildMatchingConfig } from '../../linking/matching/matching-config.js';
import { SameHashExternalOutflowStrategy } from '../../linking/strategies/same-hash-external-outflow-strategy.js';
import {
  createExplainedMultiSourceAdaHashPartialTransactions,
  createLinkableMovementsFromTransactions,
} from '../../linking/strategies/test-utils.js';
import type { AccountingTransactionView } from '../accounting-layer-types.js';
import { buildAccountingLayerFromTransactions } from '../build-accounting-layer-from-transactions.js';
import { validateTransferLinks } from '../validated-transfer-links.js';

function reseedTxFingerprint(transaction: Transaction, identityReference: string): void {
  transaction.txFingerprint = seedTxFingerprint(
    transaction.platformKey,
    transaction.platformKind,
    transaction.accountId,
    identityReference
  );
}

function requireTransactionView(
  accountingTransactionViews: readonly AccountingTransactionView[],
  transactionId: number
): AccountingTransactionView {
  const transactionView = accountingTransactionViews.find(
    (candidate) => candidate.processedTransaction.id === transactionId
  );
  expect(transactionView).toBeDefined();
  return transactionView!;
}

describe('validateTransferLinks regressions', () => {
  const logger = getLogger('validated-transfer-links-regressions.test');

  it('fails closed when a confirmed link crosses the accounting transaction boundary', () => {
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
      { category: 'transfer', platformKey: 'kraken', type: 'withdrawal' }
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
      { category: 'transfer', platformKey: 'wallet', platformKind: 'blockchain', type: 'deposit' }
    );

    const accountingLayer = assertOk(buildAccountingLayerFromTransactions([sourceTx, targetTx], logger));
    const sourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 1);
    const targetTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 2);

    const sourceMovement = sourceTransactionView.outflows[0];
    const targetMovement = targetTransactionView.inflows[0];
    expect(sourceMovement).toBeDefined();
    expect(targetMovement).toBeDefined();

    const result = validateTransferLinks(
      [sourceTransactionView],
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
    expect(error.message).toContain('crosses the accounting transaction boundary');
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
      { category: 'transfer', platformKey: 'bitcoin', platformKind: 'blockchain', type: 'withdrawal' }
    );
    firstSourceTx.accountId = 8;
    firstSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96',
      is_confirmed: true,
    };
    reseedTxFingerprint(firstSourceTx, '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96');

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
      { category: 'transfer', platformKey: 'bitcoin', platformKind: 'blockchain', type: 'withdrawal' }
    );
    secondSourceTx.accountId = 10;
    secondSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96',
      is_confirmed: true,
    };
    reseedTxFingerprint(secondSourceTx, '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96');

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
      { category: 'transfer', platformKey: 'kucoin', platformKind: 'exchange', type: 'deposit' }
    );
    targetTx.accountId = 20;
    reseedTxFingerprint(targetTx, '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96');

    const accountingLayer = assertOk(
      buildAccountingLayerFromTransactions([firstSourceTx, secondSourceTx, targetTx], logger)
    );
    const firstSourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 10);
    const secondSourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 11);
    const targetTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 12);

    const sourceMovement = secondSourceTransactionView.outflows[0];
    const targetMovement = targetTransactionView.inflows[0];
    expect(sourceMovement).toBeDefined();
    expect(targetMovement).toBeDefined();
    expect(sourceMovement!.movementFingerprint).not.toBe(firstSourceTransactionView.outflows[0]!.movementFingerprint);

    const result = validateTransferLinks(accountingLayer.accountingTransactionViews, [
      {
        id: 201,
        sourceTransactionId: 11,
        targetTransactionId: 12,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: sourceMovement!.assetId,
        targetAssetId: targetMovement!.assetId,
        sourceAmount: parseDecimal('0.00404382'),
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

  it('accepts confirmed same-hash external partial links after same-hash fee deduplication', () => {
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
      { category: 'transfer', platformKey: 'bitcoin', platformKind: 'blockchain', type: 'withdrawal' }
    );
    firstSourceTx.accountId = 101;
    firstSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: hash,
      is_confirmed: true,
    };
    reseedTxFingerprint(firstSourceTx, hash);
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
      { category: 'transfer', platformKey: 'bitcoin', platformKind: 'blockchain', type: 'withdrawal' }
    );
    secondSourceTx.accountId = 102;
    secondSourceTx.blockchain = {
      name: 'bitcoin',
      transaction_hash: hash,
      is_confirmed: true,
    };
    reseedTxFingerprint(secondSourceTx, hash);
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
      { category: 'transfer', platformKey: 'kraken', platformKind: 'exchange', type: 'deposit' }
    );
    targetTx.accountId = 103;
    reseedTxFingerprint(targetTx, `deposit-${hash}`);

    const accountingLayer = assertOk(
      buildAccountingLayerFromTransactions([firstSourceTx, secondSourceTx, targetTx], logger)
    );
    const firstSourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 20);
    const secondSourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 21);
    const targetTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 22);

    expect(firstSourceTransactionView.outflows[0]!.netQuantity!.toFixed()).toBe('0.5');
    expect(secondSourceTransactionView.outflows[0]!.netQuantity!.toFixed()).toBe('0.5');

    const firstSourceMovement = firstSourceTransactionView.outflows[0]!;
    const secondSourceMovement = secondSourceTransactionView.outflows[0]!;
    const targetMovement = targetTransactionView.inflows[0]!;

    const result = validateTransferLinks(accountingLayer.accountingTransactionViews, [
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

  it('accepts confirmed same-hash external partial links when target excess is explained by an unattributed staking reward component', () => {
    const transactions = createExplainedMultiSourceAdaHashPartialTransactions();
    const linkableMovements = createLinkableMovementsFromTransactions(transactions);
    const strategy = new SameHashExternalOutflowStrategy();
    const strategyResult = strategy.execute(
      linkableMovements.filter((movement) => movement.direction === 'out'),
      linkableMovements.filter((movement) => movement.direction === 'in'),
      buildMatchingConfig()
    );
    const links = assertOk(strategyResult).links.map((link, index) => ({
      ...link,
      id: 9000 + index,
    }));

    const accountingLayer = assertOk(buildAccountingLayerFromTransactions(transactions, logger));

    const result = validateTransferLinks(accountingLayer.accountingTransactionViews, links);
    const validated = assertOk(result);

    expect(validated.links).toHaveLength(3);
    expect(validated.links.every((link) => link.isPartialMatch)).toBe(true);
    expect(validated.links.every((link) => link.link.metadata?.['explainedTargetResidualAmount'] === '10.524451')).toBe(
      true
    );
    expect(validated.links.reduce((sum, link) => sum.plus(link.link.targetAmount), parseDecimal('0')).toFixed()).toBe(
      '2669.193991'
    );
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
      { category: 'transfer', platformKey: 'kucoin', type: 'withdrawal' }
    );
    reseedTxFingerprint(sourceTx, '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b');

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
      { category: 'transfer', platformKey: 'ethereum', platformKind: 'blockchain', type: 'deposit' }
    );
    targetTx.blockchain = {
      name: 'ethereum',
      transaction_hash: '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b',
      is_confirmed: true,
    };
    reseedTxFingerprint(targetTx, '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b');

    const accountingLayer = assertOk(buildAccountingLayerFromTransactions([sourceTx, targetTx], logger));
    const sourceTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 50);
    const targetTransactionView = requireTransactionView(accountingLayer.accountingTransactionViews, 51);

    const sourceMovement = sourceTransactionView.outflows[0]!;
    const targetMovement = targetTransactionView.inflows[0]!;

    const result = validateTransferLinks(accountingLayer.accountingTransactionViews, [
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
