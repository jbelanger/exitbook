import { type Currency, parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import type { TransactionLinkQueries, TransactionQueries } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import { LotMatcher } from '../lot-matcher.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';

const mockTransactionRepo = () => {
  const queries: Partial<TransactionQueries> = {
    findById: vi.fn().mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('Not found') }),
  };
  return queries as TransactionQueries;
};

const mockLinkRepo = () => {
  const queries: Partial<TransactionLinkQueries> = {
    findAll: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: [] }),
  };
  return queries as TransactionLinkQueries;
};

describe('LotMatcher - Fee Handling', () => {
  const matcher = new LotMatcher(mockTransactionRepo(), mockLinkRepo());
  const fifoStrategy = new FifoStrategy();

  const createPriceAtTxTime = (amount: string, currency = 'USD') => ({
    price: { amount: parseDecimal(amount), currency: currency as Currency },
    source: 'manual' as const,
    fetchedAt: new Date('2024-01-01'),
  });

  describe('Acquisition lots with fees', () => {
    it('should include platform fee in cost basis for acquisitions', async () => {
      // Buy 1 BTC for $50,000 with $100 platform fee
      // Expected: cost basis = $50,100, or $50,100 per BTC
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('100'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      if (result.isErr()) {
        console.error('Error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(1);

        const lot = btcResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('1');
        // Cost basis should include the $100 fee: (1 * 50000 + 100) / 1 = 50100
        expect(lot.costBasisPerUnit.toString()).toBe('50100');
        expect(lot.totalCostBasis.toString()).toBe('50100');
      }
    });

    it('should include network fee in cost basis for acquisitions', async () => {
      // Buy 1 ETH for $3,000 with 0.001 ETH network fee worth $3
      // Expected: cost basis = $3,003 total, or $3,003 per ETH
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'ethereum',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('3000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              amount: parseDecimal('0.001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: createPriceAtTxTime('3000'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ethResult = result.value.assetResults.find((r) => r.assetSymbol === 'ETH');
        expect(ethResult).toBeDefined();
        expect(ethResult!.lots).toHaveLength(1);

        const lot = ethResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('1');
        // Cost basis should include the network fee: (1 * 3000 + 0.001 * 3000) / 1 = 3003
        expect(lot.costBasisPerUnit.toString()).toBe('3003');
        expect(lot.totalCostBasis.toString()).toBe('3003');
      }
    });

    it('should include both platform and network fees in cost basis', async () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('100'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
            {
              assetId: 'test:btc',
              assetSymbol: 'BTC' as Currency,
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: createPriceAtTxTime('50000'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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
    it('should subtract platform fee from proceeds on disposals', async () => {
      // First, acquire 1 BTC for $50,000
      // Then sell 1 BTC for $60,000 with $150 platform fee
      // Expected proceeds: $60,000 - $150 = $59,850
      // Expected gain: $59,850 - $50,000 = $9,850
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          accountId: 1,
          externalId: 'tx2',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('60000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('150'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.disposals).toHaveLength(1);

        const disposal = btcResult!.disposals[0]!;
        expect(disposal.quantityDisposed.toString()).toBe('1');
        // Per ADR-005: Platform fees (settlement='balance') do NOT reduce disposal proceeds
        // Proceeds per unit: 60000 (no fee subtracted)
        expect(disposal.proceedsPerUnit.toString()).toBe('60000');
        expect(disposal.totalProceeds.toString()).toBe('60000');
        // Cost basis: 50000
        expect(disposal.totalCostBasis.toString()).toBe('50000');
        // Gain: 60000 - 50000 = 10000
        expect(disposal.gainLoss.toString()).toBe('10000');
      }
    });

    it('should subtract on-chain fees from disposal proceeds (ADR-005)', async () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('3000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          accountId: 1,
          externalId: 'tx2',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'ethereum',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('3500'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3500'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              amount: parseDecimal('0.002'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: createPriceAtTxTime('3500'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ethResult = result.value.assetResults.find((r) => r.assetSymbol === 'ETH');
        expect(ethResult).toBeDefined();
        expect(ethResult!.disposals).toHaveLength(1);

        const disposal = ethResult!.disposals[0]!;
        // Per ADR-005: Network fees (settlement='on-chain') DO reduce disposal proceeds
        // Proceeds: (1 * 3500 - 0.002 * 3500) / 1 = 3493
        expect(disposal.proceedsPerUnit.toString()).toBe('3493');
        expect(disposal.totalProceeds.toString()).toBe('3493');
        // Cost basis: 3000
        // Gain: 3493 - 3000 = 493
        expect(disposal.gainLoss.toString()).toBe('493');
      }
    });
  });

  describe('Multi-asset transactions with proportional fee allocation', () => {
    it('should allocate fees proportionally when multiple assets are involved', async () => {
      // Buy both BTC ($50k) and ETH ($25k) in one transaction with $75 total fee
      // BTC should get 2/3 of fee ($50), ETH should get 1/3 of fee ($25)
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('10'),
                priceAtTxTime: createPriceAtTxTime('2500'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('75000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('75'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        const ethResult = result.value.assetResults.find((r) => r.assetSymbol === 'ETH');

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
    it('should allocate fees proportionally when multiple inflows of same asset exist', async () => {
      // Single transaction with TWO BTC inflows (e.g., batch purchase split across wallets)
      // Inflow 1: 0.5 BTC @ $50,000 = $25,000 value
      // Inflow 2: 0.5 BTC @ $50,000 = $25,000 value
      // Total fee: $20
      // Each inflow should get $10 (50% of total fee based on equal value)
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('20'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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

    it('should allocate fees proportionally when multiple outflows of same asset exist', async () => {
      // Setup: Buy 1 BTC for $50,000 (no fees)
      // Then: Sell in two separate outflows with $30 total fee
      // Outflow 1: 0.6 BTC @ $60,000 = $36,000 gross proceeds
      // Outflow 2: 0.4 BTC @ $60,000 = $24,000 gross proceeds
      // Fee allocation: 0.6 should get $18 (60%), 0.4 should get $12 (40%)
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                netAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('50000'),
                netAmount: parseDecimal('50000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        {
          id: 2,
          accountId: 1,
          externalId: 'tx2',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('60000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.6'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.4'),
                priceAtTxTime: createPriceAtTxTime('60000'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('30'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'sell',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.disposals).toHaveLength(2);

        // Per ADR-005: Platform fees (settlement='balance') do NOT reduce disposal proceeds
        // First disposal: 0.6 BTC with NO fee deduction
        const disposal1 = btcResult!.disposals[0]!;
        expect(disposal1.quantityDisposed.toString()).toBe('0.6');
        // Proceeds per unit: 60000 (no fee subtracted)
        expect(disposal1.proceedsPerUnit.toString()).toBe('60000');
        expect(disposal1.totalProceeds.toString()).toBe('36000');

        // Second disposal: 0.4 BTC with NO fee deduction
        const disposal2 = btcResult!.disposals[1]!;
        expect(disposal2.quantityDisposed.toString()).toBe('0.4');
        // Proceeds per unit: 60000 (no fee subtracted)
        expect(disposal2.proceedsPerUnit.toString()).toBe('60000');
        expect(disposal2.totalProceeds.toString()).toBe('24000');

        // Total proceeds: $60,000 (platform fee NOT subtracted from proceeds)
        const totalProceeds = disposal1.totalProceeds.plus(disposal2.totalProceeds);
        expect(totalProceeds.toString()).toBe('60000');
      }
    });
  });

  describe('Fee handling edge cases', () => {
    it('should fail when crypto fee is missing price', async () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'ethereum',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:eth',
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('3000'),
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              amount: parseDecimal('0.001'),
              scope: 'network',
              settlement: 'on-chain',
              // Missing priceAtTxTime - this should cause an error
            },
          ],
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]!.error).toContain('Fee in ETH missing priceAtTxTime');
        expect(result.value.errors[0]!.error).toContain('Transaction: 1');
      }
    });

    it('should use 1:1 fallback for fiat fee in same currency as target movement', async () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000', 'USD'),
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('100'),
              scope: 'platform',
              settlement: 'balance',
              // No priceAtTxTime - should use 1:1 fallback to USD
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(1);

        const lot = btcResult!.lots[0]!;
        // Cost basis should include the $100 USD fee using 1:1 conversion
        expect(lot.costBasisPerUnit.toString()).toBe('50100');
      }
    });

    it('should fail when fiat fee currency differs from target movement price currency', async () => {
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000', 'USD'),
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:cad',
              assetSymbol: 'CAD' as Currency,
              amount: parseDecimal('100'),
              scope: 'platform',
              settlement: 'balance',
              // No priceAtTxTime and different currency - should fail
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]!.error).toContain('Fee in CAD cannot be converted to USD');
        expect(result.value.errors[0]!.error).toContain('without exchange rate');
      }
    });
  });

  describe('Zero-value fee allocation edge cases', () => {
    it('should split fees evenly when all crypto movements have zero value (airdrop)', async () => {
      // Airdrop: Receive 100 XYZ tokens with $0 value, $5 network fee
      // Fee should be split evenly among zero-value crypto movements
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'ethereum',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:xyz',
                assetSymbol: 'XYZ' as Currency,
                grossAmount: parseDecimal('100'),
                priceAtTxTime: createPriceAtTxTime('0'), // Zero value airdrop
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:eth',
              assetSymbol: 'ETH' as Currency,
              amount: parseDecimal('0.001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: createPriceAtTxTime('5000'), // $5 fee
            },
          ],
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const xyzResult = result.value.assetResults.find((r) => r.assetSymbol === 'XYZ');
        expect(xyzResult).toBeDefined();
        expect(xyzResult!.lots).toHaveLength(1);

        const lot = xyzResult!.lots[0]!;
        expect(lot.quantity.toString()).toBe('100');
        // Cost basis: $5 fee / 1 non-fiat movement = $5 total, or $0.05 per token
        expect(lot.costBasisPerUnit.toString()).toBe('0.05');
        expect(lot.totalCostBasis.toString()).toBe('5');
      }
    });

    it('should split fees evenly among multiple zero-value crypto movements', async () => {
      // Receive 2 different airdrops in one transaction, both with $0 value
      // $10 fee should be split evenly: $5 each
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'ethereum',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:token_a',
                assetSymbol: 'TOKEN_A' as Currency,
                grossAmount: parseDecimal('100'),
                priceAtTxTime: createPriceAtTxTime('0'), // Zero value
              },
              {
                assetId: 'test:token_b',
                assetSymbol: 'TOKEN_B' as Currency,
                grossAmount: parseDecimal('50'),
                priceAtTxTime: createPriceAtTxTime('0'), // Zero value
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('10'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tokenAResult = result.value.assetResults.find((r) => r.assetSymbol === 'TOKEN_A');
        const tokenBResult = result.value.assetResults.find((r) => r.assetSymbol === 'TOKEN_B');

        expect(tokenAResult).toBeDefined();
        expect(tokenBResult).toBeDefined();

        // TOKEN_A: $10 / 2 movements = $5 fee allocation
        const lotA = tokenAResult!.lots[0]!;
        expect(lotA.quantity.toString()).toBe('100');
        expect(lotA.totalCostBasis.toString()).toBe('5');
        expect(lotA.costBasisPerUnit.toString()).toBe('0.05');

        // TOKEN_B: $10 / 2 movements = $5 fee allocation
        const lotB = tokenBResult!.lots[0]!;
        expect(lotB.quantity.toString()).toBe('50');
        expect(lotB.totalCostBasis.toString()).toBe('5');
        expect(lotB.costBasisPerUnit.toString()).toBe('0.1');
      }
    });

    it('should NOT allocate fee to fiat movements when all movements are zero-value', async () => {
      // Edge case: Zero-value crypto + fiat movement with $0 fee
      // Fiat should not receive fee allocation (we don't track cost basis for fiat)
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:xyz',
                assetSymbol: 'XYZ' as Currency,
                grossAmount: parseDecimal('100'),
                priceAtTxTime: createPriceAtTxTime('0'), // Zero value
              },
            ],
            outflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('0'), // Zero-value fiat
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('5'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'transfer',
            type: 'airdrop',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const xyzResult = result.value.assetResults.find((r) => r.assetSymbol === 'XYZ');
        expect(xyzResult).toBeDefined();

        // XYZ should get the full $5 fee (only non-fiat movement)
        const lot = xyzResult!.lots[0]!;
        expect(lot.totalCostBasis.toString()).toBe('5');

        // Fiat assets are excluded from assetResults entirely
        const usdResult = result.value.assetResults.find((r) => r.assetSymbol === 'USD');
        expect(usdResult).toBeUndefined();
      }
    });

    it('should return zero fee allocation when no crypto movements exist (fiat-only)', async () => {
      // All movements are fiat - no fee allocation needed
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'bank',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:usd',
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('1000'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
            outflows: [
              {
                assetId: 'test:cad',
                assetSymbol: 'CAD' as Currency,
                grossAmount: parseDecimal('1350'),
                priceAtTxTime: createPriceAtTxTime('1'),
              },
            ],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('5'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Fiat-only transactions produce no asset results (fiat is excluded from cost basis tracking)
        expect(result.value.assetResults).toHaveLength(0);
      }
    });

    it('should use proportional allocation when some movements have value and others are zero', async () => {
      // Mixed: One crypto with value, one with zero value
      // BTC: $50,000 value
      // XYZ: $0 value
      // Fee: $100
      // BTC should get all the fee (100% of non-zero value)
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'test-exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
              {
                assetId: 'test:xyz',
                assetSymbol: 'XYZ' as Currency,
                grossAmount: parseDecimal('100'),
                priceAtTxTime: createPriceAtTxTime('0'), // Zero value
              },
            ],
            outflows: [],
          },
          fees: [
            {
              assetId: 'test:usd',
              assetSymbol: 'USD' as Currency,
              amount: parseDecimal('100'),
              scope: 'platform',
              settlement: 'balance',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
      ];

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        const xyzResult = result.value.assetResults.find((r) => r.assetSymbol === 'XYZ');

        expect(btcResult).toBeDefined();
        expect(xyzResult).toBeDefined();

        // BTC gets all the fee ($100) since it has all the value
        const btcLot = btcResult!.lots[0]!;
        expect(btcLot.totalCostBasis.toString()).toBe('50100');

        // XYZ gets $0 fee allocation (has no value in proportional calculation)
        const xyzLot = xyzResult!.lots[0]!;
        expect(xyzLot.totalCostBasis.toString()).toBe('0');
      }
    });
  });

  describe('Blockchain internal links (UTXO change outputs)', () => {
    it('should exclude blockchain_internal links from disposals/acquisitions', async () => {
      // Setup: Buy 1 BTC at an exchange
      // Then: Bitcoin transaction with change output (blockchain_internal link)
      // The change output should NOT create a disposal or acquisition
      const transactions: UniversalTransactionData[] = [
        {
          id: 1,
          accountId: 1,
          externalId: 'tx1',
          datetime: '2024-01-01T00:00:00Z',
          timestamp: Date.parse('2024-01-01T00:00:00Z'),
          source: 'exchange',
          sourceType: 'exchange',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'test:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                priceAtTxTime: createPriceAtTxTime('50000'),
              },
            ],
            outflows: [],
          },
          fees: [],
          operation: {
            category: 'trade',
            type: 'buy',
          },
        },
        // UTXO change output (should be excluded)
        {
          id: 2,
          accountId: 2, // Different address in same wallet
          externalId: 'tx2-change',
          datetime: '2024-02-01T00:00:00Z',
          timestamp: Date.parse('2024-02-01T00:00:00Z'),
          source: 'bitcoin',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            outflows: [
              {
                assetId: 'bitcoin:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'), // Change output
                priceAtTxTime: createPriceAtTxTime('55000'),
              },
            ],
            inflows: [],
          },
          fees: [],
          operation: {
            category: 'transfer',
            type: 'withdrawal',
          },
        },
        // UTXO change input (should also be excluded)
        {
          id: 3,
          accountId: 3, // Different address in same wallet
          externalId: 'tx3-change',
          datetime: '2024-02-01T00:00:01Z',
          timestamp: Date.parse('2024-02-01T00:00:01Z'),
          source: 'bitcoin',
          sourceType: 'blockchain',
          status: 'success',
          movements: {
            inflows: [
              {
                assetId: 'bitcoin:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'), // Change input
                priceAtTxTime: createPriceAtTxTime('55000'),
              },
            ],
            outflows: [],
          },
          fees: [],
          operation: {
            category: 'transfer',
            type: 'deposit',
          },
        },
      ];

      // Mock blockchain_internal link between tx2 and tx3
      const link: import('../../linking/types.js').TransactionLink = {
        id: 'link1',
        sourceTransactionId: 2,
        targetTransactionId: 3,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'bitcoin:btc',
        targetAssetId: 'bitcoin:btc',
        sourceAmount: parseDecimal('0.5'),
        targetAmount: parseDecimal('0.5'),
        linkType: 'blockchain_internal', // This is the key - UTXO change
        confidenceScore: parseDecimal('100'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0.0002,
          hashMatch: true,
        },
        status: 'confirmed',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-01'),
      };

      const mockTransactionRepo = () => {
        const queries: Partial<import('@exitbook/data').TransactionQueries> = {
          findById: vi.fn().mockImplementation((id: number) => {
            const tx = transactions.find((t) => t.id === id);
            return tx
              ? { isOk: () => true, isErr: () => false, value: tx }
              : { isOk: () => false, isErr: () => true, error: new Error('Not found') };
          }),
        };
        return queries as import('@exitbook/data').TransactionQueries;
      };

      const mockLinkRepo = () => {
        const queries: Partial<TransactionLinkQueries> = {
          findAll: vi.fn().mockResolvedValue({
            isOk: () => true,
            isErr: () => false,
            value: [link],
          }),
        };
        return queries as TransactionLinkQueries;
      };

      const matcherWithLinks = new LotMatcher(mockTransactionRepo(), mockLinkRepo());

      const result = await matcherWithLinks.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        // Should have 1 acquisition lot from tx1 only
        expect(btcResult!.lots).toHaveLength(1);
        expect(btcResult!.lots[0]!.acquisitionTransactionId).toBe(1);
        expect(btcResult!.lots[0]!.quantity.toString()).toBe('1');

        // Should have 0 disposals (blockchain_internal links are excluded)
        expect(btcResult!.disposals).toHaveLength(0);

        // Should have 0 transfers (blockchain_internal links are excluded)
        expect(btcResult!.lotTransfers).toHaveLength(0);
      }
    });
  });
});
