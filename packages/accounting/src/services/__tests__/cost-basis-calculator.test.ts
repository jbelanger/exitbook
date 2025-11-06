/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { UniversalTransaction } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockCostBasisRepository,
  createMockLotTransferRepository,
  createTransaction,
  createTransactionWithFee,
} from '../../../__tests__/test-utils.js';
import type { CostBasisConfig } from '../../config/cost-basis-config.js';
import type { LotDisposal } from '../../domain/schemas.js';
import { CanadaRules } from '../../jurisdictions/canada-rules.js';
import { USRules } from '../../jurisdictions/us-rules.js';
import type { CostBasisRepository } from '../../persistence/cost-basis-repository.js';
import type { LotTransferRepository } from '../../persistence/lot-transfer-repository.js';
import { CostBasisCalculator } from '../cost-basis-calculator.js';

describe('CostBasisCalculator', () => {
  let mockRepository: CostBasisRepository;
  let mockLotTransferRepository: LotTransferRepository;
  let calculator: CostBasisCalculator;

  beforeEach(() => {
    mockRepository = createMockCostBasisRepository();
    mockLotTransferRepository = createMockLotTransferRepository();
    calculator = new CostBasisCalculator(mockRepository, mockLotTransferRepository);
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
              grossAmount: new Decimal('1'),
              // Missing priceAtTxTime
            },
          ],
          outflows: [],
        },
        operation: { category: 'transfer', type: 'deposit' },
        fees: [],
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
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('price(s) missing');
        expect(result.error.message).toContain('prices enrich');
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
              grossAmount: new Decimal('1'),
              priceAtTxTime: {
                price: { amount: new Decimal('30000'), currency: Currency.create('USD') },
                source: 'test',
                fetchedAt: new Date('2023-01-01'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [
            {
              asset: 'USD',
              grossAmount: new Decimal('30000'),
              // Missing priceAtTxTime - but should be OK since USD is fiat
            },
          ],
        },
        operation: { category: 'trade', type: 'buy' },
        fees: [],
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

      const failingCalculator = new CostBasisCalculator(failingRepository, mockLotTransferRepository);

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

      const trackingCalculator = new CostBasisCalculator(trackingRepository, mockLotTransferRepository);

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

    it('should persist assetsProcessed to database (Issue #2 fix)', async () => {
      const transactions: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        createTransaction(2, '2023-01-01T00:00:00Z', [{ asset: 'ETH', amount: '10', price: '2000' }]),
        createTransaction(3, '2023-06-01T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
        createTransaction(4, '2023-06-01T00:00:00Z', [], [{ asset: 'ETH', amount: '5', price: '2500' }]),
      ];

      const trackingRepository = {
        ...mockRepository,
        updateCalculation: vi.fn().mockResolvedValue(ok(true)),
      } as unknown as CostBasisRepository;

      const trackingCalculator = new CostBasisCalculator(trackingRepository, mockLotTransferRepository);

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await trackingCalculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);

      // Verify updateCalculation was called with assetsProcessed
      expect(trackingRepository.updateCalculation).toHaveBeenCalledWith(
        expect.any(String) as string,
        expect.objectContaining({
          assetsProcessed: expect.arrayContaining(['BTC', 'ETH']) as string[],
        })
      );

      // Verify the call includes the array
      const updateCall = (trackingRepository.updateCalculation as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(updateCall).toBeDefined();
      const updates = updateCall?.[1] as { assetsProcessed?: string[] };
      expect(updates.assetsProcessed).toHaveLength(2);
      expect(updates.assetsProcessed).toContain('BTC');
      expect(updates.assetsProcessed).toContain('ETH');
    });

    it('should save tax classifications to lot_disposals (Issue #3 fix)', async () => {
      const transactions: UniversalTransaction[] = [
        // Buy 1 BTC
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        // Sell 0.5 BTC after 180 days (short-term for US)
        createTransaction(2, '2023-06-30T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '40000' }]),
        // Sell 0.5 BTC after 400 days (long-term for US)
        createTransaction(3, '2024-02-05T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '45000' }]),
      ];

      const disposalsSaved: LotDisposal[] = [];
      const trackingRepository = {
        ...mockRepository,
        createDisposalsBulk: vi.fn().mockImplementation((disposals: LotDisposal[]) => {
          disposalsSaved.push(...disposals);
          return Promise.resolve(ok(disposals.length));
        }),
      } as unknown as CostBasisRepository;

      const trackingCalculator = new CostBasisCalculator(trackingRepository, mockLotTransferRepository);

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await trackingCalculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      expect(disposalsSaved).toHaveLength(2);

      // Check first disposal (short-term)
      const shortTermDisposal = disposalsSaved[0];
      expect(shortTermDisposal).toBeDefined();
      expect(shortTermDisposal!.taxTreatmentCategory).toBe('short_term');
      expect(shortTermDisposal!.holdingPeriodDays).toBeLessThan(365);

      // Check second disposal (long-term)
      const longTermDisposal = disposalsSaved[1];
      expect(longTermDisposal).toBeDefined();
      expect(longTermDisposal!.taxTreatmentCategory).toBe('long_term');
      expect(longTermDisposal!.holdingPeriodDays).toBeGreaterThanOrEqual(365);
    });

    it('should disallow wash sale loss with fee allocation (US)', async () => {
      const transactions: UniversalTransaction[] = [
        // Buy 1 BTC @ $50k (Jan 1)
        createTransactionWithFee(1, '2024-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '50000' }], []),
        // Sell 1 BTC @ $30k with $100 fee (Feb 1) - creates loss
        createTransactionWithFee(2, '2024-02-01T00:00:00Z', [], [{ asset: 'BTC', amount: '1', price: '30000' }], {
          asset: 'USD',
          amount: '100',
          price: '1',
        }),
        // Buy 0.5 BTC @ $32k with $50 fee (Feb 15) - triggers wash sale
        createTransactionWithFee(3, '2024-02-15T00:00:00Z', [{ asset: 'BTC', amount: '0.5', price: '32000' }], [], {
          asset: 'USD',
          amount: '50',
          price: '1',
        }),
      ];

      const disposalsSaved: LotDisposal[] = [];
      const trackingRepository = {
        ...mockRepository,
        createDisposalsBulk: vi.fn().mockImplementation((disposals: LotDisposal[]) => {
          disposalsSaved.push(...disposals);
          return Promise.resolve(ok(disposals.length));
        }),
      } as unknown as CostBasisRepository;

      const trackingCalculator = new CostBasisCalculator(trackingRepository, mockLotTransferRepository);

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2024,
      };

      const result = await trackingCalculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;

        // Loss should be disallowed due to wash sale (taxable gain/loss = 0)
        expect(summary.totalTaxableGainLoss.toString()).toBe('0');

        // Verify fee was allocated correctly per ADR-005:
        // - Acquisitions: ALL fees increase cost basis
        // - Disposals: ONLY on-chain fees reduce proceeds (platform fees don't)
        expect(disposalsSaved).toHaveLength(1);
        const disposal = disposalsSaved[0];
        expect(disposal).toBeDefined();

        // Proceeds: $30,000 (platform fee NOT subtracted per ADR-005)
        expect(disposal!.totalProceeds.toString()).toBe('30000');
        // Cost basis: $50,000 (no fee on first acquisition)
        expect(disposal!.totalCostBasis.toString()).toBe('50000');
        // Capital loss: $30,000 - $50,000 = -$20,000
        expect(disposal!.gainLoss.toString()).toBe('-20000');
      }
    });

    it('should handle superficial loss with multi-asset fees (Canada)', async () => {
      const transactions: UniversalTransaction[] = [
        // Buy BTC ($40k) + ETH ($20k) with $60 fee (Jan 1)
        createTransactionWithFee(
          1,
          '2024-01-01T00:00:00Z',
          [
            { asset: 'BTC', amount: '1', price: '40000' },
            { asset: 'ETH', amount: '10', price: '2000' },
          ],
          [],
          { asset: 'USD', amount: '60', price: '1' }
        ),
        // Sell BTC at loss (Feb 1)
        createTransaction(2, '2024-02-01T00:00:00Z', [], [{ asset: 'BTC', amount: '1', price: '30000' }]),
        // Reacquire BTC (Feb 15) - triggers superficial loss
        createTransaction(3, '2024-02-15T00:00:00Z', [{ asset: 'BTC', amount: '0.5', price: '32000' }], []),
        // Sell ETH at gain (no superficial loss)
        createTransaction(4, '2024-03-01T00:00:00Z', [], [{ asset: 'ETH', amount: '10', price: '2500' }]),
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'CA',
        taxYear: 2024,
      };

      const result = await calculator.calculate(transactions, config, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;

        // Fee allocation: BTC gets $40 (2/3), ETH gets $20 (1/3)
        // BTC cost basis: $40,000 + $40 = $40,040
        // ETH cost basis: $20,000 + $20 = $20,020

        // BTC loss should be disallowed (superficial loss), no taxable loss
        // ETH gain should still be taxable (not affected by BTC superficial loss)
        // ETH proceeds: $25,000
        // ETH cost basis: $20,020
        // ETH gain: $4,980
        // Canada 50% inclusion: $2,490
        expect(summary.totalTaxableGainLoss.toNumber()).toBeCloseTo(2490, 0);
      }
    });

    it('should reject transactions with non-USD prices (EUR)', async () => {
      const transactionsWithEUR: UniversalTransaction[] = [
        createTransaction(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }]),
        // This transaction has EUR price instead of USD
        {
          id: 2,
          externalId: 'ext-2',
          datetime: '2023-06-01T00:00:00Z',
          timestamp: new Date('2023-06-01').getTime(),
          source: 'test',
          status: 'success',
          movements: {
            inflows: [],
            outflows: [
              {
                asset: 'BTC',
                grossAmount: new Decimal('0.5'),
                priceAtTxTime: {
                  price: { amount: new Decimal('35000'), currency: Currency.create('EUR') },
                  source: 'test',
                  fetchedAt: new Date('2023-06-01'),
                  granularity: 'exact',
                },
              },
            ],
          },
          operation: { category: 'trade', type: 'sell' },
          fees: [],
          metadata: {},
        },
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactionsWithEUR, config, new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('price(s) not in USD');
        expect(result.error.message).toContain('prices enrich');
        expect(result.error.message).toContain('EUR');
        // Transaction ID is shown as numeric ID (2) rather than external ID (ext-2)
        expect(result.error.message).toContain('Tx 2');
      }
    });

    it('should reject transactions with non-USD prices in fees', async () => {
      const transactionWithEURFee: UniversalTransaction = {
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
              grossAmount: new Decimal('1'),
              priceAtTxTime: {
                price: { amount: new Decimal('30000'), currency: Currency.create('USD') },
                source: 'test',
                fetchedAt: new Date('2023-01-01'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [],
        },
        operation: { category: 'trade', type: 'buy' },
        fees: [
          {
            scope: 'platform',
            settlement: 'balance',
            asset: 'EUR',
            amount: new Decimal('10'),
            priceAtTxTime: {
              price: { amount: new Decimal('10'), currency: Currency.create('EUR') },
              source: 'test',
              fetchedAt: new Date('2023-01-01'),
              granularity: 'exact',
            },
          },
        ],
        metadata: {},
      };

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate([transactionWithEURFee], config, new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('price(s) not in USD');
        expect(result.error.message).toContain('EUR');
      }
    });

    it('should accept transactions with all USD prices', async () => {
      const transactionsWithUSD: UniversalTransaction[] = [
        {
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
                grossAmount: new Decimal('1'),
                priceAtTxTime: {
                  price: { amount: new Decimal('30000'), currency: Currency.create('USD') },
                  source: 'test',
                  fetchedAt: new Date('2023-01-01'),
                  granularity: 'exact',
                },
              },
            ],
            outflows: [],
          },
          operation: { category: 'trade', type: 'buy' },
          fees: [],
          metadata: {},
        },
        {
          id: 2,
          externalId: 'ext-2',
          datetime: '2023-06-01T00:00:00Z',
          timestamp: new Date('2023-06-01').getTime(),
          source: 'test',
          status: 'success',
          movements: {
            inflows: [],
            outflows: [
              {
                asset: 'BTC',
                grossAmount: new Decimal('0.5'),
                priceAtTxTime: {
                  price: { amount: new Decimal('40000'), currency: Currency.create('USD') },
                  source: 'test',
                  fetchedAt: new Date('2023-06-01'),
                  granularity: 'exact',
                },
              },
            ],
          },
          operation: { category: 'trade', type: 'sell' },
          fees: [],
          metadata: {},
        },
      ];

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactionsWithUSD, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.lotsCreated).toBe(1);
        expect(result.value.disposalsProcessed).toBe(1);
      }
    });

    it('should list up to 5 examples of non-USD movements', async () => {
      // Create 7 transactions with non-USD prices
      const transactionsWithMultipleEUR: UniversalTransaction[] = [];
      for (let i = 1; i <= 7; i++) {
        transactionsWithMultipleEUR.push({
          id: i,
          externalId: `ext-${i}`,
          datetime: '2023-01-01T00:00:00Z',
          timestamp: new Date('2023-01-01').getTime(),
          source: 'test',
          status: 'success',
          movements: {
            inflows: [
              {
                asset: 'BTC',
                grossAmount: new Decimal('1'),
                priceAtTxTime: {
                  price: { amount: new Decimal('30000'), currency: Currency.create('EUR') },
                  source: 'test',
                  fetchedAt: new Date('2023-01-01'),
                  granularity: 'exact',
                },
              },
            ],
            outflows: [],
          },
          operation: { category: 'trade', type: 'buy' },
          fees: [],
          metadata: {},
        });
      }

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2023,
      };

      const result = await calculator.calculate(transactionsWithMultipleEUR, config, new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Price preflight validation failed');
        expect(result.error.message).toContain('7 price(s) not in USD');
        expect(result.error.message).toContain('Examples of issues found');
        // Should show 5 examples, not all 7
        // Transaction IDs are shown as "Tx 1", "Tx 2", etc. in error messages
        const examples = result.error.message.match(/Tx \d+/g);
        expect(examples).toHaveLength(5);
      }
    });

    it('should correctly classify long-term gains with complex fee scenarios', async () => {
      const transactions: UniversalTransaction[] = [
        // Buy 1 BTC @ $30k with $100 fee (Jan 1, 2023)
        createTransactionWithFee(1, '2023-01-01T00:00:00Z', [{ asset: 'BTC', amount: '1', price: '30000' }], [], {
          asset: 'USD',
          amount: '100',
          price: '1',
        }),
        // Sell 0.5 BTC @ $50k with $200 fee (Jan 2, 2024) - 366 days = long-term
        createTransactionWithFee(2, '2024-01-02T00:00:00Z', [], [{ asset: 'BTC', amount: '0.5', price: '50000' }], {
          asset: 'USD',
          amount: '200',
          price: '1',
        }),
      ];

      const disposalsSaved: LotDisposal[] = [];
      const trackingRepository = {
        ...mockRepository,
        createDisposalsBulk: vi.fn().mockImplementation((disposals: LotDisposal[]) => {
          disposalsSaved.push(...disposals);
          return Promise.resolve(ok(disposals.length));
        }),
      } as unknown as CostBasisRepository;

      const trackingCalculator = new CostBasisCalculator(trackingRepository, mockLotTransferRepository);

      const config: CostBasisConfig = {
        method: 'fifo',
        currency: 'CAD',
        jurisdiction: 'US',
        taxYear: 2024,
      };

      const result = await trackingCalculator.calculate(transactions, config, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;

        // Verify long-term classification
        expect(disposalsSaved).toHaveLength(1);
        const disposal = disposalsSaved[0];
        expect(disposal).toBeDefined();
        expect(disposal!.taxTreatmentCategory).toBe('long_term');
        expect(disposal!.holdingPeriodDays).toBeGreaterThanOrEqual(365);

        // Verify fee allocation per ADR-005
        // Cost basis per unit: ($30,000 + $100 acquisition fee) / 1 = $30,100
        // Cost basis for 0.5 BTC: $30,100 * 0.5 = $15,050
        expect(disposal!.costBasisPerUnit.toString()).toBe('30100');
        expect(disposal!.totalCostBasis.toString()).toBe('15050');

        // Proceeds: 0.5 * $50,000 = $25,000 (platform fee NOT subtracted per ADR-005)
        expect(disposal!.totalProceeds.toString()).toBe('25000');

        // Gain: $25,000 - $15,050 = $9,950
        expect(disposal!.gainLoss.toString()).toBe('9950');
        expect(summary.totalCapitalGainLoss.toString()).toBe('9950');
        // US: 100% taxable
        expect(summary.totalTaxableGainLoss.toString()).toBe('9950');
      }
    });
  });
});
