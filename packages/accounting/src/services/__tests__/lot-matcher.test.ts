import { Currency, parseDecimal, type UniversalTransaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { LotMatcher } from '../lot-matcher.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';

describe('LotMatcher - Fee Handling', () => {
  const matcher = new LotMatcher();
  const fifoStrategy = new FifoStrategy();

  const createPriceAtTxTime = (amount: string, currency = 'USD') => ({
    price: { amount: parseDecimal(amount), currency: Currency.create(currency) },
    source: 'manual' as const,
    fetchedAt: new Date('2024-01-01'),
  });

  describe('Acquisition lots with fees', () => {
    it('should include platform fee in cost basis for acquisitions', () => {
      // Buy 1 BTC for $50,000 with $100 platform fee
      // Expected: cost basis = $50,100, or $50,100 per BTC
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('100'),
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          },
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      if (result.isErr()) {
        console.error('Error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.asset === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(1);

        const lot = btcResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('1');
        // Cost basis should include the $100 fee: (1 * 50000 + 100) / 1 = 50100
        expect(lot.costBasisPerUnit.toString()).toBe('50100');
        expect(lot.totalCostBasis.toString()).toBe('50100');
      }
    });

    it('should include network fee in cost basis for acquisitions', () => {
      // Buy 1 ETH for $3,000 with 0.001 ETH network fee worth $3
      // Expected: cost basis = $3,003 total, or $3,003 per ETH
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'ethereum',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'ETH',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3000'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('3000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {
            network: {
              asset: 'ETH',
              amount: parseDecimal('0.001'),
              priceAtTxTime: createPriceAtTxTime('3000'),
            },
          },
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ethResult = result.value.assetResults.find((r) => r.asset === 'ETH');
        expect(ethResult).toBeDefined();
        expect(ethResult!.lots).toHaveLength(1);

        const lot = ethResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('1');
        // Cost basis should include the network fee: (1 * 3000 + 0.001 * 3000) / 1 = 3003
        expect(lot.costBasisPerUnit.toString()).toBe('3003');
        expect(lot.totalCostBasis.toString()).toBe('3003');
      }
    });

    it('should include both platform and network fees in cost basis', () => {
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('100'),
              priceAtTxTime: createPriceAtTxTime('1'),
            },
            network: {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              priceAtTxTime: createPriceAtTxTime('50000'),
            },
          },
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.asset === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(1);

        const lot = btcResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('1');
        // Cost basis: (1 * 50000 + 100 + 0.0001 * 50000) / 1 = 50105
        expect(lot.costBasisPerUnit.toString()).toBe('50105');
      }
    });
  });

  describe('Disposals with fees', () => {
    it('should subtract platform fee from proceeds on disposals', () => {
      // First, acquire 1 BTC for $50,000
      // Then sell 1 BTC for $60,000 with $150 platform fee
      // Expected proceeds: $60,000 - $150 = $59,850
      // Expected gain: $59,850 - $50,000 = $9,850
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {},
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          externalId: 'tx2',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'USD',
                amount: parseDecimal('60000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                asset: 'BTC',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
            ],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('150'),
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          },
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.asset === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.disposals).toHaveLength(1);

        const disposal = btcResult!.disposals[0]!;
        expect(disposal.quantityDisposed.toString()).toBe('1');
        // Proceeds per unit: (60000 - 150) / 1 = 59850
        expect(disposal.proceedsPerUnit.toString()).toBe('59850');
        expect(disposal.totalProceeds.toString()).toBe('59850');
        // Cost basis: 50000
        expect(disposal.totalCostBasis.toString()).toBe('50000');
        // Gain: 59850 - 50000 = 9850
        expect(disposal.gainLoss.toString()).toBe('9850');
      }
    });

    it('should subtract network fee from proceeds on disposals', () => {
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'ETH',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3000'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('3000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {},
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          externalId: 'tx2',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'ethereum',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'USD',
                amount: parseDecimal('3500'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                asset: 'ETH',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3500'),
              },
            ],
          },
          fees: {
            network: {
              asset: 'ETH',
              amount: parseDecimal('0.002'),
              priceAtTxTime: createPriceAtTxTime('3500'),
            },
          },
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ethResult = result.value.assetResults.find((r) => r.asset === 'ETH');
        expect(ethResult).toBeDefined();
        expect(ethResult!.disposals).toHaveLength(1);

        const disposal = ethResult!.disposals[0]!;
        // Proceeds: (1 * 3500 - 0.002 * 3500) / 1 = 3493
        expect(disposal.proceedsPerUnit.toString()).toBe('3493');
        expect(disposal.totalProceeds.toString()).toBe('3493');
        // Gain: 3493 - 3000 = 493
        expect(disposal.gainLoss.toString()).toBe('493');
      }
    });
  });

  describe('Multi-asset transactions with proportional fee allocation', () => {
    it('should allocate fees proportionally when multiple assets are involved', () => {
      // Buy both BTC ($50k) and ETH ($25k) in one transaction with $75 total fee
      // BTC should get 2/3 of fee ($50), ETH should get 1/3 of fee ($25)
      const transactions: UniversalTransaction[] = [
        {
          id: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                amount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
              {
                asset: 'ETH',
                amount: parseDecimal('10'),
                priceAtTxTime: createPriceAtTxTime('2500'),
              },
            ],
            outflows: [
              {
                asset: 'USD',
                amount: parseDecimal('75000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('75'),
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          },
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.asset === 'BTC');
        const ethResult = result.value.assetResults.find((r) => r.asset === 'ETH');

        expect(btcResult).toBeDefined();
        expect(ethResult).toBeDefined();

        // BTC gets 50000/75000 * 75 = 50 of the fee
        const btcLot = btcResult!.lots[0]!;
        expect(btcLot.quantity.toString()).toBe('1');
        // Cost basis: (1 * 50000 + 50) / 1 = 50050
        expect(btcLot.costBasisPerUnit.toString()).toBe('50050');

        // ETH gets 25000/75000 * 75 = 25 of the fee
        const ethLot = ethResult!.lots[0]!;
        expect(ethLot.quantity.toString()).toBe('10');
        // Cost basis: (10 * 2500 + 25) / 10 = 2502.5
        expect(ethLot.costBasisPerUnit.toString()).toBe('2502.5');
      }
    });
  });
});
