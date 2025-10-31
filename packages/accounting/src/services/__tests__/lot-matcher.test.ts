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

  describe('Multiple movements of same asset (regression test for fee double-counting)', () => {
    it('should allocate fees proportionally when multiple inflows of same asset exist', () => {
      // Single transaction with TWO BTC inflows (e.g., batch purchase split across wallets)
      // Inflow 1: 0.5 BTC @ $50,000 = $25,000 value
      // Inflow 2: 0.5 BTC @ $50,000 = $25,000 value
      // Total fee: $20
      // Each inflow should get $10 (50% of total fee based on equal value)
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
                amount: parseDecimal('0.5'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
              {
                asset: 'BTC',
                amount: parseDecimal('0.5'),
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
              amount: parseDecimal('20'),
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
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(2);

        // First lot: 0.5 BTC with $10 fee allocation
        const lot1 = btcResult!.lots[0]!;
        expect(lot1.quantity.toString()).toBe('0.5');
        // Cost basis: (0.5 * 50000 + 10) / 0.5 = 50020
        expect(lot1.costBasisPerUnit.toString()).toBe('50020');
        expect(lot1.totalCostBasis.toString()).toBe('25010');

        // Second lot: 0.5 BTC with $10 fee allocation
        const lot2 = btcResult!.lots[1]!;
        expect(lot2.quantity.toString()).toBe('0.5');
        // Cost basis: (0.5 * 50000 + 10) / 0.5 = 50020
        expect(lot2.costBasisPerUnit.toString()).toBe('50020');
        expect(lot2.totalCostBasis.toString()).toBe('25010');

        // Total cost basis should be $50,020 (not $50,040 which would indicate double-counting)
        const totalCostBasis = lot1.totalCostBasis.plus(lot2.totalCostBasis);
        expect(totalCostBasis.toString()).toBe('50020');
      }
    });

    it('should allocate fees proportionally when multiple outflows of same asset exist', () => {
      // Setup: Buy 1 BTC for $50,000 (no fees)
      // Then: Sell in two separate outflows with $30 total fee
      // Outflow 1: 0.6 BTC @ $60,000 = $36,000 gross proceeds
      // Outflow 2: 0.4 BTC @ $60,000 = $24,000 gross proceeds
      // Fee allocation: 0.6 should get $18 (60%), 0.4 should get $12 (40%)
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
                amount: parseDecimal('0.6'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
              {
                asset: 'BTC',
                amount: parseDecimal('0.4'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
            ],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('30'),
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
        expect(btcResult!.disposals).toHaveLength(2);

        // First disposal: 0.6 BTC with $18 fee deduction (60% of $30)
        const disposal1 = btcResult!.disposals[0]!;
        expect(disposal1.quantityDisposed.toString()).toBe('0.6');
        // Proceeds per unit: (0.6 * 60000 - 18) / 0.6 = 59970
        expect(disposal1.proceedsPerUnit.toString()).toBe('59970');
        expect(disposal1.totalProceeds.toString()).toBe('35982');

        // Second disposal: 0.4 BTC with $12 fee deduction (40% of $30)
        const disposal2 = btcResult!.disposals[1]!;
        expect(disposal2.quantityDisposed.toString()).toBe('0.4');
        // Proceeds per unit: (0.4 * 60000 - 12) / 0.4 = 59970
        expect(disposal2.proceedsPerUnit.toString()).toBe('59970');
        expect(disposal2.totalProceeds.toString()).toBe('23988');

        // Total net proceeds should be $59,970 ($60,000 - $30 fee, not $59,940 which would indicate double-counting)
        const totalProceeds = disposal1.totalProceeds.plus(disposal2.totalProceeds);
        expect(totalProceeds.toString()).toBe('59970');
      }
    });
  });

  describe('Fee handling edge cases', () => {
    it('should fail when crypto fee is missing price', () => {
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
            outflows: [],
          },
          fees: {
            network: {
              asset: 'ETH',
              amount: parseDecimal('0.001'),
              // Missing priceAtTxTime - this should cause an error
            },
          },
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        },
      ];

      const result = matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Fee in ETH missing priceAtTxTime');
        expect(result.error.message).toContain('Transaction: 1');
      }
    });

    it('should use 1:1 fallback for fiat fee in same currency as target movement', () => {
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
                priceAtTxTime: createPriceAtTxTime('50000', 'USD'),
              },
            ],
            outflows: [],
          },
          fees: {
            platform: {
              asset: 'USD',
              amount: parseDecimal('100'),
              // No priceAtTxTime - should use 1:1 fallback to USD
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
        // Cost basis should include the $100 USD fee using 1:1 conversion
        expect(lot.costBasisPerUnit.toString()).toBe('50100');
      }
    });

    it('should fail when fiat fee currency differs from target movement price currency', () => {
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
                priceAtTxTime: createPriceAtTxTime('50000', 'USD'),
              },
            ],
            outflows: [],
          },
          fees: {
            platform: {
              asset: 'CAD',
              amount: parseDecimal('100'),
              // No priceAtTxTime and different currency - should fail
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

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Fee in CAD cannot be converted to USD');
        expect(result.error.message).toContain('without exchange rate');
      }
    });
  });
});
