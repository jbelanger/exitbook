/**
 * Tests for price enrichment utility functions
 *
 * These tests verify the core business logic for:
 * - Multi-pass price inference (exchange-execution, derived ratios, swap recalculation)
 * - Link-based price rederive across platforms
 * - Fee price enrichment from movement prices
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import type { FeeMovement } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  createMovement,
  createPriceAtTxTime,
  createTransaction,
  createTransactionFromMovements,
  createFee,
} from '../../__tests__/test-utils.js';
import { enrichFeePricesFromMovements, inferMultiPass, propagatePricesAcrossLinks } from '../price-enrichment-utils.js';
import type { TransactionGroup } from '../types.js';

describe('inferMultiPass', () => {
  describe('Pass 0: Exchange execution prices', () => {
    it('should extract execution price from USD trade', () => {
      const tx = createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '1.0', assetSymbol: 'BTC', price: '50000' }],
        [{ amount: '50000', assetSymbol: 'USD', price: '1' }],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      const btcMovement = result.transactions[0]?.movements.inflows?.[0];
      expect(btcMovement?.priceAtTxTime?.source).toBe('exchange-execution');
      expect(btcMovement?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
      expect(btcMovement?.priceAtTxTime?.granularity).toBe('exact');
    });

    it('should extract execution price from EUR trade (in native EUR, normalized to USD later)', () => {
      const tx = createTransactionFromMovements(
        1,
        '2024-01-15T10:00:00Z',
        {
          inflows: [createMovement('BTC', '1.0')],
          outflows: [createMovement('EUR', '40000')],
        },
        [],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      // BTC should get price in EUR with tentative source (upgraded to derived-ratio after normalization)
      const btcMovement = result.transactions[0]?.movements.inflows?.[0];
      expect(btcMovement?.priceAtTxTime?.source).toBe('fiat-execution-tentative');
      expect(btcMovement?.priceAtTxTime?.price.amount.toFixed()).toBe('40000');
      expect(btcMovement?.priceAtTxTime?.price.currency.toString()).toBe('EUR');
      expect(btcMovement?.priceAtTxTime?.granularity).toBe('exact');

      // EUR should get identity price (1 EUR = 1 EUR) with tentative source
      const eurMovement = result.transactions[0]?.movements.outflows?.[0];
      expect(eurMovement?.priceAtTxTime?.source).toBe('fiat-execution-tentative');
      expect(eurMovement?.priceAtTxTime?.price.amount.toFixed()).toBe('1');
      expect(eurMovement?.priceAtTxTime?.price.currency.toString()).toBe('EUR');
    });

    it('should NOT extract price from USDC trade (fetched separately)', () => {
      const tx = createTransactionFromMovements(
        1,
        '2024-01-15T10:00:00Z',
        {
          inflows: [createMovement('BTC', '1.0')],
          outflows: [createMovement('USDC', '50000')],
        },
        [],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      const btcMovement = result.transactions[0]?.movements.inflows?.[0];
      expect(btcMovement?.priceAtTxTime).toBeUndefined();
    });
  });

  describe('Pass 1: Derive inflow from outflow', () => {
    it('should derive inflow price when only outflow has price', () => {
      const tx = createTransactionFromMovements(
        1,
        '2024-01-15T10:00:00Z',
        {
          inflows: [createMovement('RARE_TOKEN', '1000')],
          outflows: [createMovement('ETH', '10', '3000')],
        },
        [],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('derived-ratio');
      // Price = outflow price * outflow amount / inflow amount = 3000 * 10 / 1000 = 30
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('30');
    });

    it('should recalculate crypto-crypto swap when both have prices (Pass N+2 behavior)', () => {
      const tx = createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '10', assetSymbol: 'ETH', price: '3000' }],
        [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      // Pass N+2 should recalculate inflow price from outflow using swap ratio
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('derived-ratio');
      // Price = BTC price * BTC amount / ETH amount = 50000 * 1 / 10 = 5000
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('5000');
    });

    it('should NOT derive when neither has prices', () => {
      const tx = createTransactionFromMovements(
        1,
        '2024-01-15T10:00:00Z',
        {
          inflows: [createMovement('TOKEN_A', '100')],
          outflows: [createMovement('TOKEN_B', '50')],
        },
        [],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime).toBeUndefined();
    });
  });

  describe('Pass N+2: Recalculate crypto-crypto swap ratios', () => {
    it('should recalculate inflow price from outflow in crypto-crypto swap', () => {
      const tx = createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '10', assetSymbol: 'ETH', price: '2900' }],
        [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      // Should recalculate ETH price from BTC using swap ratio
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('derived-ratio');
      // Price = BTC price * BTC amount / ETH amount = 50000 * 1 / 10 = 5000
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('5000');
    });

    it('should NOT recalculate when outflow is USD (already execution price)', () => {
      const tx = createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
        [{ amount: '50000', assetSymbol: 'USD', price: '1' }],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      // Should NOT recalculate (USD trade is already execution price)
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('exchange-execution');
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
    });

    it('should NOT recalculate when inflow is stablecoin', () => {
      const tx = createTransactionFromMovements(
        1,
        '2024-01-15T10:00:00Z',
        {
          inflows: [
            {
              assetId: 'test:usdc',
              assetSymbol: 'USDC' as Currency,
              grossAmount: parseDecimal('50000'),
              priceAtTxTime: createPriceAtTxTime('1', 'USD', { source: 'coingecko' }),
            },
          ],
          outflows: [
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1'),
              priceAtTxTime: createPriceAtTxTime('50000', 'USD', { source: 'binance' }),
            },
          ],
        },
        [],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      // Should NOT recalculate (USDC is stablecoin)
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('coingecko');
    });

    it('should track modified transaction IDs', () => {
      const tx = createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '10', assetSymbol: 'ETH', price: '2900' }],
        [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
        { category: 'transfer', type: 'transfer' }
      );

      const result = inferMultiPass([tx]);

      expect(result.modifiedIds.has(1)).toBe(true);
    });
  });

  describe('Multi-transaction processing', () => {
    it('should process multiple transactions independently', () => {
      const transactions = [
        createTransaction(
          1,
          '2024-01-15T10:00:00Z',
          [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
          [{ amount: '50000', assetSymbol: 'USD', price: '1' }],
          { category: 'transfer', type: 'transfer' }
        ),
        createTransaction(
          2,
          '2024-01-15T10:00:00Z',
          [{ amount: '10', assetSymbol: 'ETH', price: '30000' }],
          [{ amount: '30000', assetSymbol: 'USD', price: '1' }],
          { category: 'transfer', type: 'transfer' }
        ),
      ];

      const result = inferMultiPass(transactions);

      // Both should have exchange-execution prices
      expect(result.transactions[0]?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('exchange-execution');
      expect(result.transactions[1]?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('exchange-execution');
    });
  });
});

describe('propagatePricesAcrossLinks', () => {
  it('should propagate price from source outflow to target inflow', () => {
    const sourceTx = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [],
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    const targetTx = createTransactionFromMovements(
      2,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '1')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1'),
          targetAmount: parseDecimal('1'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [sourceTx, targetTx]);

    const targetInflow = result.enrichedTransactions[1]?.movements.inflows?.[0];
    expect(targetInflow?.priceAtTxTime?.source).toBe('link-propagated');
    expect(targetInflow?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should handle amount tolerance for fee differences', () => {
    const sourceTx = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [],
      [{ amount: '1.0', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    // Target has slightly less due to network fee
    const targetTx = createTransactionFromMovements(
      2,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '0.9999')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.9999'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9999'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [sourceTx, targetTx]);

    const targetInflow = result.enrichedTransactions[1]?.movements.inflows?.[0];
    expect(targetInflow?.priceAtTxTime?.source).toBe('link-propagated');
  });

  it('should NOT propagate when amounts differ by more than 10%', () => {
    const sourceTx = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [],
      [{ amount: '1.0', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    // Target has significantly different amount
    const targetTx = createTransactionFromMovements(
      2,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '0.8')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('0.8'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.8'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [sourceTx, targetTx]);

    const targetInflow = result.enrichedTransactions[1]?.movements.inflows?.[0];
    expect(targetInflow?.priceAtTxTime).toBeUndefined();
  });

  it('should NOT propagate when source has no price', () => {
    const sourceTx = createTransactionFromMovements(
      1,
      '2024-01-15T10:00:00Z',
      {
        inflows: [],
        outflows: [createMovement('BTC', '1.0')],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const targetTx = createTransactionFromMovements(
      2,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '1.0')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('1.0'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [sourceTx, targetTx]);

    const targetInflow = result.enrichedTransactions[1]?.movements.inflows?.[0];
    expect(targetInflow?.priceAtTxTime).toBeUndefined();
  });

  it('should track modified transaction IDs', () => {
    const sourceTx = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [],
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    const targetTx = createTransactionFromMovements(
      2,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '1')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1'),
          targetAmount: parseDecimal('1'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [sourceTx, targetTx]);

    expect(result.modifiedIds.has(2)).toBe(true);
    expect(result.modifiedIds.has(1)).toBe(false); // Source not modified
  });

  it('should handle multiple links in chain when intermediate has prices on both sides', () => {
    const tx1 = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [],
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    // tx2 has price on BOTH inflow and outflow (from a previous enrichment pass)
    const tx2 = createTransaction(
      2,
      '2024-01-15T10:00:00Z',
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      { category: 'transfer', type: 'withdrawal' }
    );

    const tx3 = createTransactionFromMovements(
      3,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '1')],
        outflows: [],
      },
      [],
      { category: 'transfer', type: 'withdrawal' }
    );

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [tx1, tx2, tx3],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 1,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1'),
          targetAmount: parseDecimal('1'),
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          sourceTransactionId: 2,
          targetTransactionId: 3,
          assetSymbol: 'BTC' as Currency,
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceAmount: parseDecimal('1'),
          targetAmount: parseDecimal('1'),
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0.5,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const result = propagatePricesAcrossLinks(group, [tx1, tx2, tx3]);

    // Price should propagate from tx1 to tx2, and from tx2 to tx3
    expect(result.enrichedTransactions[1]?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.enrichedTransactions[2]?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('link-propagated');
  });
});

describe('enrichFeePricesFromMovements', () => {
  it('should enrich platform fee with price from matching movement', () => {
    const tx = createTransactionFromMovements(
      1,
      '2024-01-15T10:00:00Z',
      {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000', 'USD', { source: 'exchange-execution' }),
          },
        ],
        outflows: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('50000'),
            priceAtTxTime: createPriceAtTxTime('1', 'USD', { source: 'exchange-execution' }),
          },
        ],
      },
      [],
      { category: 'transfer', type: 'swap' }
    );

    // Add platform fee
    tx.fees = [createFee('BTC', '0.001')];

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees[0]?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result[0]?.fees[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should enrich network fee with price from matching movement', () => {
    const tx = createTransactionFromMovements(
      1,
      '2024-01-15T10:00:00Z',
      {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000', 'USD', { source: 'exchange-execution' }),
          },
        ],
        outflows: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('50000'),
            priceAtTxTime: createPriceAtTxTime('1', 'USD', { source: 'exchange-execution' }),
          },
        ],
      },
      [],
      { category: 'transfer', type: 'swap' }
    );

    // Add network fee
    tx.fees = [createFee('BTC', '0.0001', { scope: 'platform', settlement: 'balance' })];

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees[0]?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result[0]?.fees[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite existing fee prices', () => {
    const tx = createTransaction(
      1,
      '2024-01-15T10:00:00Z',
      [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
      [{ amount: '50000', assetSymbol: 'USD', price: '1' }],
      { category: 'transfer', type: 'swap' }
    );

    // Add fee with existing price
    const fee: FeeMovement = {
      assetId: 'test:btc',
      assetSymbol: 'BTC' as Currency,
      amount: parseDecimal('0.001'),
      scope: 'platform',
      settlement: 'balance',
      priceAtTxTime: createPriceAtTxTime('49000', 'USD', { source: 'coingecko' }),
    };
    tx.fees = [fee];

    const result = enrichFeePricesFromMovements([tx]);

    // Fee already has price - should NOT overwrite
    expect(result[0]?.fees[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(result[0]?.fees[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('49000');
  });

  it('should NOT enrich fee when no matching movement price', () => {
    const tx = createTransactionFromMovements(
      1,
      '2024-01-15T10:00:00Z',
      {
        inflows: [createMovement('BTC', '1')],
        outflows: [createMovement('USD', '50000', '1')],
      },
      [],
      { category: 'transfer', type: 'swap' }
    );

    // Add ETH fee (no matching movement)
    tx.fees = [createFee('ETH', '0.01')];

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees[0]?.priceAtTxTime).toBeUndefined();
  });

  it('should use first matching asset price', () => {
    const tx = createTransactionFromMovements(
      1,
      '2024-01-15T10:00:00Z',
      {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000', 'USD', { source: 'exchange-execution' }),
          },
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.5'),
            priceAtTxTime: createPriceAtTxTime('49000', 'USD', { source: 'coingecko' }),
          },
        ],
        outflows: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('75000'),
            priceAtTxTime: createPriceAtTxTime('1', 'USD', { source: 'exchange-execution' }),
          },
        ],
      },
      [],
      { category: 'transfer', type: 'swap' }
    );

    // Add BTC fee
    tx.fees = [createFee('BTC', '0.001')];

    const result = enrichFeePricesFromMovements([tx]);

    // Should use first BTC price found
    expect(result[0]?.fees[0]?.priceAtTxTime?.source).toBe('exchange-execution');
  });

  it('should handle multiple transactions', () => {
    const transactions = [
      createTransaction(
        1,
        '2024-01-15T10:00:00Z',
        [{ amount: '1', assetSymbol: 'BTC', price: '50000' }],
        [{ amount: '50000', assetSymbol: 'USD', price: '1' }],
        { category: 'transfer', type: 'swap' }
      ),
      createTransaction(
        2,
        '2024-01-15T10:00:00Z',
        [{ amount: '10', assetSymbol: 'ETH', price: '3000' }],
        [{ amount: '30000', assetSymbol: 'USD', price: '1' }],
        { category: 'transfer', type: 'swap' }
      ),
    ];

    // Add fees to both transactions
    if (transactions[0]) transactions[0].fees = [createFee('BTC', '0.001')];
    if (transactions[1]) transactions[1].fees = [createFee('ETH', '0.01')];

    const result = enrichFeePricesFromMovements(transactions);

    expect(result[0]?.fees[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
    expect(result[1]?.fees[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('3000');
  });
});
