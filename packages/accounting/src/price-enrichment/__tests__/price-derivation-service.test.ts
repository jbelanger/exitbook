import type { Currency, TransactionLink, UniversalTransactionData } from '@exitbook/core';
import { ok } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPricingPersistence } from '../../ports/pricing-persistence.js';
import { PriceDerivationService } from '../price-derivation-service.js';

// ── Fixtures ──

let nextId = 1;

function makeTx(
  overrides: Partial<UniversalTransactionData> & {
    fees?: UniversalTransactionData['fees'];
    movements: UniversalTransactionData['movements'];
  }
): UniversalTransactionData {
  const id = nextId++;
  return {
    id,
    accountId: 1,
    externalId: `tx-${id}`,
    datetime: '2024-01-01T10:00:00.000Z',
    timestamp: new Date('2024-01-01T10:00:00.000Z').getTime(),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'buy' },
    fees: [],
    ...overrides,
  };
}

function makeLink(sourceId: number, targetId: number, overrides?: Partial<TransactionLink>): TransactionLink {
  return {
    id: nextId++,
    sourceTransactionId: sourceId,
    targetTransactionId: targetId,
    assetSymbol: 'BTC' as Currency,
    sourceAssetId: 'exchange:kraken:btc',
    targetAssetId: 'blockchain:bitcoin:native',
    sourceAmount: new Decimal('1'),
    targetAmount: new Decimal('0.999'),
    linkType: 'exchange_to_blockchain',
    confidenceScore: new Decimal('0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: new Decimal('0.999'),
      timingValid: true,
      timingHours: 0.033,
    },
    status: 'confirmed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Mock store ──

function createMockStore(
  transactions: UniversalTransactionData[],
  links: TransactionLink[] = []
): { getUpdatedTx: (id: number) => UniversalTransactionData | undefined; store: IPricingPersistence } {
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));
  const store: IPricingPersistence = {
    loadPricingContext: vi.fn().mockResolvedValue(ok({ transactions: [...txMap.values()], confirmedLinks: links })),
    loadTransactionsNeedingPrices: vi.fn().mockResolvedValue(ok([])),
    saveTransactionPrices: vi.fn().mockImplementation((tx: UniversalTransactionData) => {
      txMap.set(tx.id, tx);
      return ok(undefined);
    }),
  };
  return { store, getUpdatedTx: (id) => txMap.get(id) };
}

// ── Tests ──

describe('PriceDerivationService', () => {
  beforeEach(() => {
    nextId = 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Stats and Reporting', () => {
    it('should return 0 when database is empty', async () => {
      const { store } = createMockStore([]);
      const result = await new PriceDerivationService(store).derivePrices();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsUpdated).toBe(0);
      }
    });

    it('should only count transactions that actually got prices (not just attempted)', async () => {
      // tx1: BTC/USD trade — BTC price CAN be derived from USD outflow
      const tx1 = makeTx({
        movements: {
          inflows: [{ assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('1') }],
          outflows: [{ assetId: 'fiat:usd', assetSymbol: 'USD' as Currency, grossAmount: new Decimal('50000') }],
        },
      });

      // tx2: SOL/ADA crypto-crypto trade — no price can be derived
      const tx2 = makeTx({
        datetime: '2024-01-01T11:00:00.000Z',
        timestamp: new Date('2024-01-01T11:00:00.000Z').getTime(),
        operation: { category: 'trade', type: 'swap' },
        movements: {
          inflows: [
            { assetId: 'exchange:kraken:sol', assetSymbol: 'SOL' as Currency, grossAmount: new Decimal('100') },
          ],
          outflows: [
            { assetId: 'exchange:kraken:ada', assetSymbol: 'ADA' as Currency, grossAmount: new Decimal('1000') },
          ],
        },
      });

      const { store } = createMockStore([tx1, tx2]);
      const result = await new PriceDerivationService(store).derivePrices();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsUpdated).toBe(1);
      }
    });
  });

  describe('Price Propagation Across Links', () => {
    it('should propagate prices from exchange withdrawal to blockchain deposit', async () => {
      const baseTime = new Date('2024-01-01T10:00:00.000Z');

      // BTC withdrawal from Kraken — already has a priced outflow
      const withdrawal = makeTx({
        datetime: new Date(baseTime.getTime() + 60_000).toISOString(),
        timestamp: baseTime.getTime() + 60_000,
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {
          outflows: [
            {
              assetId: 'exchange:kraken:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1'),
              priceAtTxTime: {
                price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                source: 'derived-trade',
                fetchedAt: baseTime,
                granularity: 'exact',
              },
            },
          ],
        },
      });

      // BTC deposit on Bitcoin blockchain — no price yet
      const deposit = makeTx({
        accountId: 2,
        datetime: new Date(baseTime.getTime() + 120_000).toISOString(),
        timestamp: baseTime.getTime() + 120_000,
        source: 'bitcoin',
        sourceType: 'blockchain',
        operation: { category: 'transfer', type: 'deposit' },
        movements: {
          inflows: [
            { assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('0.999') },
          ],
        },
      });

      const link = makeLink(withdrawal.id, deposit.id);
      const { store, getUpdatedTx } = createMockStore([withdrawal, deposit], [link]);
      const result = await new PriceDerivationService(store).derivePrices();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsUpdated).toBeGreaterThanOrEqual(1);
      }

      const updatedDeposit = getUpdatedTx(deposit.id);
      expect(updatedDeposit?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('link-propagated');
    });

    it('should not propagate prices from suggested (unconfirmed) links', async () => {
      const baseTime = new Date('2024-01-01T10:00:00.000Z');

      // tx1: BTC withdrawal — priced outflow
      const tx1 = makeTx({
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {
          outflows: [
            {
              assetId: 'exchange:kraken:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: new Decimal('1'),
              priceAtTxTime: {
                price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                source: 'derived-trade',
                fetchedAt: baseTime,
                granularity: 'exact',
              },
            },
          ],
        },
      });

      // tx2: BTC deposit — no price
      const tx2 = makeTx({
        datetime: new Date(baseTime.getTime() + 60_000).toISOString(),
        timestamp: baseTime.getTime() + 60_000,
        operation: { category: 'transfer', type: 'deposit' },
        movements: {
          inflows: [
            { assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('0.999') },
          ],
        },
      });

      // Suggested link (should NOT trigger price propagation)
      // Note: Link is not passed to store since suggested links aren't confirmed
      makeLink(tx1.id, tx2.id, {
        status: 'suggested',
        linkType: 'exchange_to_exchange',
        confidenceScore: new Decimal('0.85'),
      });

      // findConfirmedLinks should return empty — suggested links aren't confirmed
      const { store, getUpdatedTx } = createMockStore([tx1, tx2], []);
      // The store only returns confirmed links, so this suggested link is excluded
      await new PriceDerivationService(store).derivePrices();

      const updatedTx2 = getUpdatedTx(tx2.id);
      expect(updatedTx2?.movements.inflows?.[0]?.priceAtTxTime).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with no movements', async () => {
      const tx = makeTx({
        operation: { category: 'transfer', type: 'deposit' },
        movements: { inflows: [], outflows: [] },
      });

      const { store } = createMockStore([tx]);
      const result = await new PriceDerivationService(store).derivePrices();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsUpdated).toBe(0);
      }
    });
  });
});
