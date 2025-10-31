/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { UniversalTransaction } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostBasisConfig } from '../../config/cost-basis-config.js';
import { CanadaRules } from '../../jurisdictions/canada-rules.js';
import { USRules } from '../../jurisdictions/us-rules.js';
import type { CostBasisRepository } from '../../persistence/cost-basis-repository.js';
import { CostBasisCalculator } from '../cost-basis-calculator.js';

describe('CostBasisCalculator', () => {
  let mockRepository: CostBasisRepository;
  let calculator: CostBasisCalculator;

  beforeEach(() => {
    // Create a minimal mock repository
    mockRepository = {
      createCalculation: vi.fn().mockResolvedValue(ok('calc-id')),
      createLotsBulk: vi.fn().mockResolvedValue(ok(1)),
      createDisposalsBulk: vi.fn().mockResolvedValue(ok(1)),
      updateCalculation: vi.fn().mockResolvedValue(ok(true)),
    } as unknown as CostBasisRepository;

    calculator = new CostBasisCalculator(mockRepository);
  });

  const createTransaction = (
    id: number,
    datetime: string,
    inflows: { amount: string; asset: string; price: string }[],
    outflows: { amount: string; asset: string; price: string }[] = []
  ): UniversalTransaction => ({
    id,
    externalId: `ext-${id}`,
    datetime,
    timestamp: new Date(datetime).getTime(),
    source: 'test',
    status: 'success',
    movements: {
      inflows: inflows.map((i) => ({
        asset: i.asset,
        amount: new Decimal(i.amount),
        priceAtTxTime: {
          price: { amount: new Decimal(i.price), currency: Currency.create('CAD') },
          source: 'test',
          fetchedAt: new Date(datetime),
          granularity: 'exact',
        },
      })),
      outflows: outflows.map((o) => ({
        asset: o.asset,
        amount: new Decimal(o.amount),
        priceAtTxTime: {
          price: { amount: new Decimal(o.price), currency: Currency.create('CAD') },
          source: 'test',
          fetchedAt: new Date(datetime),
          granularity: 'exact',
        },
      })),
    },
    operation: { category: 'trade', type: inflows.length > 0 ? 'buy' : 'sell' },
    fees: {},
    metadata: {},
  });

  describe('calculate', () => {
    it('should successfully calculate cost basis with FIFO method', async () => {
      const transactions: UniversalTransaction[] = [
        // Buy 1 BTC at $30,000
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        // Sell 0.5 BTC at $40,000
        createTransaction(2, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.lotsCreated).toBe(1);
        expect(summary.disposalsProcessed).toBe(1);
        expect(summary.totalCapitalGainLoss.toString()).toBe('5000'); // (40000 - 30000) * 0.5
        expect(summary.totalTaxableGainLoss.toString()).toBe('5000'); // US: 100% taxable
        expect(summary.assetsProcessed).toEqual(['BTC']);
        expect(summary.calculation.status).toBe('completed');
      }
    });

    it('should apply Canadian 50% inclusion rate', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'ETH', amount: '10', price: '2000' }]),
        createTransaction(2, '2023-06-01T00:00:00Z', [], [{ asset: 'ETH', amount: '10', price: '2500' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'CA',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactions, config, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.totalCapitalGainLoss.toString()).toBe('5000'); // (2500 - 2000) * 10
        expect(summary.totalTaxableGainLoss.toString()).toBe('2500'); // Canada: 50% inclusion
      }
    });

    it('should work with LIFO method', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        createTransaction(2, '2023-03-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '35000' }]),
        createTransaction(3, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'lifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.lotsCreated).toBe(2);
        expect(summary.disposalsProcessed).toBe(1);
        // LIFO: Sells from lot 2 (purchased at 35000)
        // Gain: (40000 - 35000) * 0.5 = 2500
        expect(summary.totalCapitalGainLoss.toString()).toBe('2500');
      }
    });

    it('should handle multiple assets', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        createTransaction(2, '2023-01-01T00:00:00Z', [{ asset: 'ETH', amount: '10', price: '2000' }]),
        createTransaction(3, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
        createTransaction(4, '2023-06-01T00:00:00Z', [], [{ asset: 'ETH', amount: '5', price: '2500' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.lotsCreated).toBe(2);
        expect(summary.disposalsProcessed).toBe(2);
        expect(summary.assetsProcessed.sort()).toEqual(['BTC', 'ETH']);
        // BTC gain: (40000 - 30000) * 0.5 = 5000
        // ETH gain: (2500 - 2000) * 5 = 2500
        // Total: 7500
        expect(summary.totalCapitalGainLoss.toString()).toBe('7500');
      }
    });

    it('should return error for crypto transactions missing prices', async () => {
      const transactionWithoutPrice: UniversalTransaction = {
        id: 1,
        externalId: 'ext-1',
        datetime: '2023-01-01T00:00:00Z',
        timestamp: new Date('2023-01-01').getTime(),
        source: 'test',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: new Decimal('1'),
              // Missing priceAtTxTime
            },
          ],
          outflows: [],
        },
        operation: { category: 'transfer', type: 'deposit' },
        fees: {},
        metadata: {},
      };

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate([transactionWithoutPrice], config, new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('missing price data');
      }
    });

    it('should allow fiat movements without prices', async () => {
      // Transaction with BTC inflow (with price) and USD outflow (without price)
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'ext-1',
        datetime: '2023-01-01T00:00:00Z',
        timestamp: new Date('2023-01-01').getTime(),
        source: 'test',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              amount: new Decimal('1'),
              priceAtTxTime: {
                price: { amount: new Decimal('30000'), currency: Currency.create('CAD') },
                source: 'test',
                fetchedAt: new Date('2023-01-01'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [
            {
              asset: 'USD',
              amount: new Decimal('30000'),
              // Missing priceAtTxTime - but should be OK since USD is fiat
            },
          ],
        },
        operation: { category: 'trade', type: 'buy' },
        fees: {},
        metadata: {},
      };

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate([transaction], config, new USRules());

      // Should succeed - fiat movements without prices are ignored
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.lotsCreated).toBe(1); // BTC lot created
        expect(summary.assetsProcessed).toEqual(['BTC']); // Only BTC processed
      }
    });

    it('should throw error for unimplemented methods', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'average-cost',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactions, config, new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not yet implemented');
      }
    });

    it('should call repository methods in correct order', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        createTransaction(2, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      await calculator.calculate(transactions, config, new USRules());

      // Verify repository was called
      expect(mockRepository.createCalculation).toHaveBeenCalled();
      expect(mockRepository.createLotsBulk).toHaveBeenCalled();
      expect(mockRepository.createDisposalsBulk).toHaveBeenCalled();
      expect(mockRepository.updateCalculation).toHaveBeenCalled();
    });

    it('should update calculation status on failure', async () => {
      // Mock repository to fail on lot creation
      const failingRepository = {
        createCalculation: vi.fn().mockResolvedValue(ok('calc-id')),
        createLotsBulk: vi.fn().mockResolvedValue(err(new Error('Database error'))),
        createDisposalsBulk: vi.fn().mockResolvedValue(ok(1)),
        updateCalculation: vi.fn().mockResolvedValue(ok(true)),
      } as unknown as CostBasisRepository;

      const failingCalculator = new CostBasisCalculator(failingRepository);

      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await failingCalculator.calculate(transactions, config, new USRules());

      // Should fail
      expect(result.isErr()).toBe(true);

      // Verify updateCalculation was called to mark as failed
      expect(failingRepository.updateCalculation).toHaveBeenCalledWith(
        expect.any(String) as string,
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('Database error') as string,
        })
      );
    });

    it('should update calculation with final results on success', async () => {
      const trackingRepository = {
        createCalculation: vi.fn().mockResolvedValue(ok('calc-id')),
        createLotsBulk: vi.fn().mockResolvedValue(ok(1)),
        createDisposalsBulk: vi.fn().mockResolvedValue(ok(1)),
        updateCalculation: vi.fn().mockResolvedValue(ok(true)),
      } as unknown as CostBasisRepository;

      const trackingCalculator = new CostBasisCalculator(trackingRepository);

      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        createTransaction(2, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await trackingCalculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);

      // Verify updateCalculation was called with final results
      expect(trackingRepository.updateCalculation).toHaveBeenCalledWith(
        expect.any(String) as string,
        expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(Date) as Date,
          totalProceeds: expect.any(Decimal) as Decimal,
          totalCostBasis: expect.any(Decimal) as Decimal,
          totalGainLoss: expect.any(Decimal) as Decimal,
          totalTaxableGainLoss: expect.any(Decimal) as Decimal,
          lotsCreated: 1,
          disposalsProcessed: 1,
        })
      );
    });
  });
});
