import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal, type Result } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  createBlockchainTx,
  createExchangeTx,
  createFeeMovement,
  createMovement,
  createPriceAtTxTime,
  createTransaction,
  createTransactionFromMovements,
} from '../../../__tests__/test-utils.js';
import { createAccountingExclusionPolicy } from '../../../accounting-layer/accounting-exclusion-policy.js';
import type { IPriceCoverageData } from '../../../ports/transaction-price-coverage.js';
import { checkTransactionPriceCoverage, getCostBasisRebuildTransactions } from '../price-completeness.js';

function stubData(transactions: Transaction[]): IPriceCoverageData {
  return {
    loadTransactions: () => Promise.resolve(ok(transactions) as Result<Transaction[], Error>),
  };
}

const dateRange = {
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
};

describe('price-completeness', () => {
  describe('getCostBasisRebuildTransactions', () => {
    it('keeps same-hash internal dependencies needed to rebuild the scoped subset', () => {
      const hash = '45ec1d9a069424a0c969507f82300f9ef4102ebb0f1921d89b2d50390862c131';
      const networkFee = {
        ...createFeeMovement('network', 'on-chain', 'BTC', '0.00003821', '63074.01'),
        assetId: 'blockchain:bitcoin:native',
      };

      const acquisition = createExchangeTx({
        id: 10,
        accountId: 50,
        datetime: '2025-01-01T00:00:00.000Z',
        identityReference: 'acq-10',
        platformKey: 'kraken',
        type: 'buy',
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.05'),
            netAmount: parseDecimal('0.05'),
            priceAtTxTime: createPriceAtTxTime('63074.01'),
          },
        ],
      });

      const sender = createBlockchainTx({
        id: 11,
        accountId: 3,
        datetime: '2025-05-08T10:14:40.000Z',
        txHash: hash,
        outflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.01037'),
            netAmount: parseDecimal('0.01033179'),
            priceAtTxTime: createPriceAtTxTime('63074.01'),
          },
        ],
        fees: [networkFee],
      });

      const internalReceiver = createBlockchainTx({
        id: 12,
        accountId: 10,
        datetime: '2025-05-08T10:14:40.000Z',
        txHash: hash,
        inflows: [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.01012179'),
            netAmount: parseDecimal('0.01012179'),
            priceAtTxTime: createPriceAtTxTime('63074.01'),
          },
        ],
      });

      const exchangeDeposit = createExchangeTx({
        id: 13,
        accountId: 90,
        datetime: '2025-05-08T10:16:45.000Z',
        identityReference: hash,
        platformKey: 'kucoin',
        type: 'deposit',
        inflows: [
          {
            assetId: 'exchange:kucoin:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.00021'),
            netAmount: parseDecimal('0.00021'),
            priceAtTxTime: createPriceAtTxTime('63074.01'),
          },
        ],
      });

      const missingPriceTx = createExchangeTx({
        id: 99,
        accountId: 60,
        datetime: '2025-05-09T00:00:00.000Z',
        identityReference: 'missing-99',
        platformKey: 'kraken',
        type: 'buy',
        inflows: [createMovement('ETH', '2')],
      });

      const result = getCostBasisRebuildTransactions(
        [acquisition, sender, internalReceiver, exchangeDeposit, missingPriceTx],
        'USD'
      );

      const value = assertOk(result);
      expect(value.missingPricesCount).toBe(1);
      expect(value.rebuildTransactions.map((tx) => tx.id)).toEqual([10, 11, 12, 13]);
    });
  });

  describe('checkTransactionPriceCoverage', () => {
    it('returns complete when no transactions exist', async () => {
      const result = assertOk(await checkTransactionPriceCoverage(stubData([]), dateRange));

      expect(result.complete).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns complete when no transactions fall in date range', async () => {
      const tx = createTransaction(1, '2024-06-15T00:00:00.000Z', [
        { assetSymbol: 'BTC', amount: '1.0', price: '50000' },
      ]);

      const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

      expect(result.complete).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns complete when all transactions have prices', async () => {
      const tx = createTransaction(1, '2025-06-15T00:00:00.000Z', [
        { assetSymbol: 'BTC', amount: '1.0', price: '50000' },
      ]);

      const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

      expect(result.complete).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns incomplete when a transaction is missing prices', async () => {
      const tx = createTransactionFromMovements(1, '2025-06-15T00:00:00.000Z', {
        inflows: [createMovement('BTC', '1.0')],
      });

      const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

      expect(result.complete).toBe(false);
      expect(result.reason).toBe('1 of 1 transactions missing prices');
    });

    it('counts multiple transactions missing prices', async () => {
      const tx1 = createTransactionFromMovements(1, '2025-03-01T00:00:00.000Z', {
        inflows: [createMovement('BTC', '1.0')],
      });
      const tx2 = createTransactionFromMovements(2, '2025-06-01T00:00:00.000Z', {
        outflows: [createMovement('ETH', '10.0')],
      });
      const tx3 = createTransaction(3, '2025-09-01T00:00:00.000Z', [
        { assetSymbol: 'BTC', amount: '0.5', price: '60000' },
      ]);

      const result = assertOk(await checkTransactionPriceCoverage(stubData([tx1, tx2, tx3]), dateRange));

      expect(result.complete).toBe(false);
      expect(result.reason).toBe('2 of 3 transactions missing prices');
    });

    it('only considers transactions within the date range', async () => {
      const outsideRange = createTransactionFromMovements(1, '2024-06-15T00:00:00.000Z', {
        inflows: [createMovement('BTC', '1.0')],
      });
      const insideRange = createTransaction(2, '2025-06-15T00:00:00.000Z', [
        { assetSymbol: 'ETH', amount: '5.0', price: '3000' },
      ]);

      const result = assertOk(await checkTransactionPriceCoverage(stubData([outsideRange, insideRange]), dateRange));

      expect(result.complete).toBe(true);
    });

    it('ignores excluded assets inside mixed transactions when checking coverage', async () => {
      const mixedTransaction = createTransactionFromMovements(1, '2025-06-15T00:00:00.000Z', {
        inflows: [createMovement('ETH', '1.0', '3000'), createMovement('SCAM', '1000.0')],
      });

      const result = assertOk(
        await checkTransactionPriceCoverage(
          stubData([mixedTransaction]),
          dateRange,
          createAccountingExclusionPolicy(['test:scam'])
        )
      );

      expect(result.complete).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
