/**
 * Tests for price enrichment utility functions
 *
 * These tests verify the core business logic for:
 * - Multi-pass price inference (exchange-execution, derived ratios, swap recalculation)
 * - Link-based price propagation across platforms
 * - Fee price enrichment from movement prices
 */

import { Currency, parseDecimal } from '@exitbook/core';
import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { enrichFeePricesFromMovements, inferMultiPass, propagatePricesAcrossLinks } from '../price-enrichment-utils.ts';
import type { TransactionGroup } from '../types.js';

describe('inferMultiPass', () => {
  const createTransaction = (
    id: number,
    inflows: AssetMovement[],
    outflows: AssetMovement[],
    datetime = '2024-01-15T10:00:00Z'
  ): UniversalTransaction => ({
    id,
    externalId: `tx-${id}`,
    source: 'kraken',
    datetime,
    timestamp: new Date(datetime).getTime(),
    status: 'success',
    operation: { category: 'transfer', type: 'transfer' },
    movements: { inflows, outflows },
    fees: {},
    metadata: {},
  });

  const createPrice = (source: string, amount: string): PriceAtTxTime => ({
    price: {
      amount: parseDecimal(amount),
      currency: Currency.create('USD'),
    },
    source,
    fetchedAt: new Date(),
    granularity: 'exact',
  });

  describe('Pass 0: Exchange execution prices', () => {
    it('should extract execution price from USD trade', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'BTC', amount: parseDecimal('1.0') }],
        [{ asset: 'USD', amount: parseDecimal('50000') }]
      );

      const result = inferMultiPass([tx]);

      const btcMovement = result.transactions[0]?.movements.inflows?.[0];
      expect(btcMovement?.priceAtTxTime?.source).toBe('exchange-execution');
      expect(btcMovement?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
      expect(btcMovement?.priceAtTxTime?.granularity).toBe('exact');
    });

    it('should extract execution price from EUR trade (in native EUR, normalized to USD later)', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'BTC', amount: parseDecimal('1.0') }],
        [{ asset: 'EUR', amount: parseDecimal('40000') }]
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
      const tx = createTransaction(
        1,
        [{ asset: 'BTC', amount: parseDecimal('1.0') }],
        [{ asset: 'USDC', amount: parseDecimal('50000') }]
      );

      const result = inferMultiPass([tx]);

      const btcMovement = result.transactions[0]?.movements.inflows?.[0];
      expect(btcMovement?.priceAtTxTime).toBeUndefined();
    });
  });

  describe('Pass 1: Derive inflow from outflow', () => {
    it('should derive inflow price when only outflow has price', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'RARE_TOKEN', amount: parseDecimal('1000') }],
        [{ asset: 'ETH', amount: parseDecimal('10'), priceAtTxTime: createPrice('coingecko', '3000') }]
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
        [{ asset: 'ETH', amount: parseDecimal('10'), priceAtTxTime: createPrice('binance', '3000') }],
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('coingecko', '50000') }]
      );

      const result = inferMultiPass([tx]);

      // Pass N+2 should recalculate inflow price from outflow using swap ratio
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('derived-ratio');
      // Price = BTC price * BTC amount / ETH amount = 50000 * 1 / 10 = 5000
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('5000');
    });

    it('should NOT derive when neither has prices', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'TOKEN_A', amount: parseDecimal('100') }],
        [{ asset: 'TOKEN_B', amount: parseDecimal('50') }]
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
        [{ asset: 'ETH', amount: parseDecimal('10'), priceAtTxTime: createPrice('coingecko', '2900') }],
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('binance', '50000') }]
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
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }],
        [{ asset: 'USD', amount: parseDecimal('50000'), priceAtTxTime: createPrice('exchange-execution', '1') }]
      );

      const result = inferMultiPass([tx]);

      // Should NOT recalculate (USD trade is already execution price)
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('exchange-execution');
      expect(inflow?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
    });

    it('should NOT recalculate when inflow is stablecoin', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'USDC', amount: parseDecimal('50000'), priceAtTxTime: createPrice('coingecko', '1') }],
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('binance', '50000') }]
      );

      const result = inferMultiPass([tx]);

      // Should NOT recalculate (USDC is stablecoin)
      const inflow = result.transactions[0]?.movements.inflows?.[0];
      expect(inflow?.priceAtTxTime?.source).toBe('coingecko');
    });

    it('should track modified transaction IDs', () => {
      const tx = createTransaction(
        1,
        [{ asset: 'ETH', amount: parseDecimal('10'), priceAtTxTime: createPrice('coingecko', '2900') }],
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('binance', '50000') }]
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
          [{ asset: 'BTC', amount: parseDecimal('1') }],
          [{ asset: 'USD', amount: parseDecimal('50000') }]
        ),
        createTransaction(
          2,
          [{ asset: 'ETH', amount: parseDecimal('10') }],
          [{ asset: 'USD', amount: parseDecimal('30000') }]
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
  const createTransaction = (
    id: number,
    inflows: AssetMovement[],
    outflows: AssetMovement[]
  ): UniversalTransaction => ({
    id,
    externalId: `tx-${id}`,
    source: 'kraken',
    datetime: '2024-01-15T10:00:00Z',
    timestamp: new Date('2024-01-15T10:00:00Z').getTime(),
    status: 'success',
    operation: { category: 'transfer', type: 'withdrawal' },
    movements: { inflows, outflows },
    fees: {},
    metadata: {},
  });

  const createPrice = (source: string, amount: string): PriceAtTxTime => ({
    price: {
      amount: parseDecimal(amount),
      currency: Currency.create('USD'),
    },
    source,
    fetchedAt: new Date(),
    granularity: 'exact',
  });

  it('should propagate price from source outflow to target inflow', () => {
    const sourceTx = createTransaction(
      1,
      [],
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }]
    );

    const targetTx = createTransaction(2, [{ asset: 'BTC', amount: parseDecimal('1') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
      [],
      [{ asset: 'BTC', amount: parseDecimal('1.0'), priceAtTxTime: createPrice('exchange-execution', '50000') }]
    );

    // Target has slightly less due to network fee
    const targetTx = createTransaction(2, [{ asset: 'BTC', amount: parseDecimal('0.9999') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: '1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
      [],
      [{ asset: 'BTC', amount: parseDecimal('1.0'), priceAtTxTime: createPrice('exchange-execution', '50000') }]
    );

    // Target has significantly different amount
    const targetTx = createTransaction(2, [{ asset: 'BTC', amount: parseDecimal('0.8') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
    const sourceTx = createTransaction(1, [], [{ asset: 'BTC', amount: parseDecimal('1.0') }]);

    const targetTx = createTransaction(2, [{ asset: 'BTC', amount: parseDecimal('1.0') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
      [],
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }]
    );

    const targetTx = createTransaction(2, [{ asset: 'BTC', amount: parseDecimal('1') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [sourceTx, targetTx],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
      [],
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }]
    );

    // tx2 has price on BOTH inflow and outflow (from a previous enrichment pass)
    const tx2 = createTransaction(
      2,
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('link-propagated', '50000') }],
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('link-propagated', '50000') }]
    );

    const tx3 = createTransaction(3, [{ asset: 'BTC', amount: parseDecimal('1') }], []);

    const group: TransactionGroup = {
      groupId: 'group-1',
      transactions: [tx1, tx2, tx3],
      sources: new Set(['kraken', 'bitcoin']),
      linkChain: [
        {
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          asset: 'BTC',
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
          id: 'link-2',
          sourceTransactionId: 2,
          targetTransactionId: 3,
          asset: 'BTC',
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
  const createTransaction = (
    id: number,
    inflows: AssetMovement[],
    outflows: AssetMovement[],
    platformFee?: AssetMovement,
    networkFee?: AssetMovement
  ): UniversalTransaction => ({
    id,
    externalId: `tx-${id}`,
    source: 'kraken',
    datetime: '2024-01-15T10:00:00Z',
    timestamp: new Date('2024-01-15T10:00:00Z').getTime(),
    status: 'success',
    operation: { category: 'transfer', type: 'swap' },
    movements: { inflows, outflows },
    fees: {
      platform: platformFee,
      network: networkFee,
    },
    metadata: {},
  });

  const createPrice = (source: string, amount: string): PriceAtTxTime => ({
    price: {
      amount: parseDecimal(amount),
      currency: Currency.create('USD'),
    },
    source,
    fetchedAt: new Date(),
    granularity: 'exact',
  });

  it('should enrich platform fee with price from matching movement', () => {
    const tx = createTransaction(
      1,
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }],
      [{ asset: 'USD', amount: parseDecimal('50000') }],
      { asset: 'BTC', amount: parseDecimal('0.001') }
    );

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees.platform?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result[0]?.fees.platform?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should enrich network fee with price from matching movement', () => {
    const tx = createTransaction(
      1,
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }],
      [{ asset: 'USD', amount: parseDecimal('50000') }],
      undefined,
      { asset: 'BTC', amount: parseDecimal('0.0001') }
    );

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees.network?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result[0]?.fees.network?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite existing fee prices', () => {
    const tx = createTransaction(
      1,
      [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }],
      [{ asset: 'USD', amount: parseDecimal('50000') }],
      { asset: 'BTC', amount: parseDecimal('0.001'), priceAtTxTime: createPrice('coingecko', '49000') }
    );

    const result = enrichFeePricesFromMovements([tx]);

    // Fee already has price - should NOT overwrite
    expect(result[0]?.fees.platform?.priceAtTxTime?.source).toBe('coingecko');
    expect(result[0]?.fees.platform?.priceAtTxTime?.price.amount.toFixed()).toBe('49000');
  });

  it('should NOT enrich fee when no matching movement price', () => {
    const tx = createTransaction(
      1,
      [{ asset: 'BTC', amount: parseDecimal('1') }],
      [{ asset: 'USD', amount: parseDecimal('50000') }],
      { asset: 'ETH', amount: parseDecimal('0.01') }
    );

    const result = enrichFeePricesFromMovements([tx]);

    expect(result[0]?.fees.platform?.priceAtTxTime).toBeUndefined();
  });

  it('should use first matching asset price', () => {
    const tx = createTransaction(
      1,
      [
        { asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') },
        { asset: 'BTC', amount: parseDecimal('0.5'), priceAtTxTime: createPrice('coingecko', '49000') },
      ],
      [{ asset: 'USD', amount: parseDecimal('75000') }],
      { asset: 'BTC', amount: parseDecimal('0.001') }
    );

    const result = enrichFeePricesFromMovements([tx]);

    // Should use first BTC price found
    expect(result[0]?.fees.platform?.priceAtTxTime?.source).toBe('exchange-execution');
  });

  it('should handle multiple transactions', () => {
    const transactions = [
      createTransaction(
        1,
        [{ asset: 'BTC', amount: parseDecimal('1'), priceAtTxTime: createPrice('exchange-execution', '50000') }],
        [{ asset: 'USD', amount: parseDecimal('50000') }],
        { asset: 'BTC', amount: parseDecimal('0.001') }
      ),
      createTransaction(
        2,
        [{ asset: 'ETH', amount: parseDecimal('10'), priceAtTxTime: createPrice('exchange-execution', '3000') }],
        [{ asset: 'USD', amount: parseDecimal('30000') }],
        { asset: 'ETH', amount: parseDecimal('0.01') }
      ),
    ];

    const result = enrichFeePricesFromMovements(transactions);

    expect(result[0]?.fees.platform?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
    expect(result[1]?.fees.platform?.priceAtTxTime?.price.amount.toFixed()).toBe('3000');
  });
});
