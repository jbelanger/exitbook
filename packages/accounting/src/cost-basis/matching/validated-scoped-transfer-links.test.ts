import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { createPriceAtTxTime, createTransactionFromMovements } from '../../__tests__/test-utils.js';

import { buildAccountingScopedTransactions } from './build-accounting-scoped-transactions.js';
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

    const scopedResult = buildAccountingScopedTransactions([sourceTx, targetTx], logger);
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
});
