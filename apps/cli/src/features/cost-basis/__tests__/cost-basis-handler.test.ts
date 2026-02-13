/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import {
  CostBasisCalculator,
  CostBasisReportGenerator,
  type CostBasisReport,
  type CostBasisSummary,
  type TransactionLinkRepository,
} from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { createPriceProviderManager, type PriceProviderManager } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CostBasisHandler } from '../cost-basis-handler.js';

// Mock dependencies
vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  return {
    ...actual,
    CostBasisCalculator: vi.fn(),
    CostBasisReportGenerator: vi.fn(),
    StandardFxRateProvider: vi.fn(),
    getDefaultDateRange: vi.fn().mockReturnValue({
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    }),
    CanadaRules: vi.fn(),
    USRules: vi.fn(),
  };
});

vi.mock('@exitbook/price-providers', () => ({
  createPriceProviderManager: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CostBasisHandler', () => {
  let handler: CostBasisHandler;
  let mockTransactionRepo: TransactionRepository;
  let mockLinkRepo: TransactionLinkRepository;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock repos
    mockTransactionRepo = {
      getTransactions: vi.fn(),
    } as unknown as TransactionRepository;

    mockLinkRepo = {} as unknown as TransactionLinkRepository;

    handler = new CostBasisHandler(mockTransactionRepo, mockLinkRepo);
  });

  describe('execute', () => {
    const validParams = {
      config: {
        method: 'fifo' as const,
        jurisdiction: 'US' as const,
        taxYear: 2024,
        currency: 'USD' as const,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      },
    };

    it('should return error if validation fails (start date after end date)', async () => {
      const invalidParams = {
        config: {
          ...validParams.config,
          startDate: new Date('2024-12-31'),
          endDate: new Date('2024-01-01'),
        },
      };

      const result = await handler.execute(invalidParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Start date must be before end date');
      }
    });

    it('should return error if fetching transactions fails', async () => {
      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(err(new Error('DB Error')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('DB Error');
      }
    });

    it('should return error if no transactions found in DB', async () => {
      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([]));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('No transactions found in database');
      }
    });

    it('should return error if all transactions are after endDate', async () => {
      const dbTransactions = [
        { timestamp: new Date('2025-06-01').getTime(), movements: { inflows: [], outflows: [] } },
      ] as unknown as UniversalTransactionData[];

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok(dbTransactions));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('No transactions found on or before');
      }
    });

    it('should calculate cost basis successfully for USD', async () => {
      const transactions = [
        {
          timestamp: new Date('2024-06-01').getTime(),
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1', priceAtTxTime: '50000' }],
            outflows: [],
          },
        },
      ] as unknown as UniversalTransactionData[];

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok(transactions));

      // Mock Calculator
      const mockCalculate = vi.fn().mockResolvedValue(
        ok({
          calculation: { id: 'calc-123', config: validParams.config, transactionsProcessed: 1 },
          lotsCreated: 1,
          disposalsProcessed: 0,
          assetsProcessed: ['BTC'],
        } as CostBasisSummary)
      );
      vi.mocked(CostBasisCalculator).mockImplementation(function () {
        return {
          calculate: mockCalculate,
          calculateCostBasis: vi.fn(),
        } as unknown as CostBasisCalculator;
      });

      const result = await handler.execute(validParams);

      expect(result.isOk()).toBe(true);
      expect(mockCalculate).toHaveBeenCalled();
      if (result.isOk()) {
        expect(result.value.summary.calculation.id).toBe('calc-123');
        expect(result.value.report).toBeUndefined();
      }
    });

    it('should generate report if currency is not USD', async () => {
      const cadParams = {
        config: {
          ...validParams.config,
          currency: 'CAD' as const,
        },
      };

      const transactions = [
        {
          timestamp: new Date('2024-06-01').getTime(),
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1', priceAtTxTime: '50000' }],
            outflows: [],
          },
        },
      ] as unknown as UniversalTransactionData[];

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok(transactions));

      // Mock Calculator
      const mockCalculate = vi.fn().mockResolvedValue(
        ok({
          calculation: { id: 'calc-123', config: cadParams.config, transactionsProcessed: 1 },
          lotsCreated: 1,
          disposalsProcessed: 0,
          assetsProcessed: ['BTC'],
        } as CostBasisSummary)
      );
      vi.mocked(CostBasisCalculator).mockImplementation(function () {
        return {
          calculate: mockCalculate,
          calculateCostBasis: vi.fn(),
        } as unknown as CostBasisCalculator;
      });

      // Mock Price Provider
      vi.mocked(createPriceProviderManager).mockResolvedValue(
        ok({
          destroy: vi.fn(),
        } as unknown as PriceProviderManager)
      );

      // Mock Report Generator
      const mockGenerateReport = vi.fn().mockResolvedValue(
        ok({
          calculationId: 'calc-123',
          displayCurrency: 'CAD',
          originalCurrency: 'USD',
          summary: {
            totalProceeds: new Decimal('100'),
            totalCostBasis: new Decimal('50'),
            totalGainLoss: new Decimal('50'),
            totalTaxableGainLoss: new Decimal('25'),
          },
          originalSummary: {
            totalProceeds: new Decimal('100'),
            totalCostBasis: new Decimal('50'),
            totalGainLoss: new Decimal('50'),
            totalTaxableGainLoss: new Decimal('25'),
          },
          disposals: [],
          lots: [],
          lotTransfers: [],
        } as CostBasisReport)
      );
      vi.mocked(CostBasisReportGenerator).mockImplementation(function () {
        return {
          generateReport: mockGenerateReport,
        } as unknown as CostBasisReportGenerator;
      });

      const result = await handler.execute(cadParams);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.report).toBeDefined();
        expect(createPriceProviderManager).toHaveBeenCalled();
      }
    });

    it('should warn about missing prices but proceed', async () => {
      const transactions = [
        {
          timestamp: new Date('2024-06-01').getTime(),
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1', priceAtTxTime: '50000' }],
            outflows: [],
          },
        },
        {
          timestamp: new Date('2024-06-02').getTime(),
          movements: {
            inflows: [{ assetSymbol: 'ETH', amount: '10', priceAtTxTime: undefined }], // Missing price
            outflows: [],
          },
        },
      ] as unknown as UniversalTransactionData[];

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok(transactions));

      // Mock Calculator
      const mockCalculate = vi.fn().mockResolvedValue(
        ok({
          calculation: { id: 'calc-123', config: validParams.config, transactionsProcessed: 1 },
          lotsCreated: 1,
          disposalsProcessed: 0,
          assetsProcessed: ['BTC'],
        } as CostBasisSummary)
      );
      vi.mocked(CostBasisCalculator).mockImplementation(function () {
        return {
          calculate: mockCalculate,
          calculateCostBasis: vi.fn(),
        } as unknown as CostBasisCalculator;
      });

      const result = await handler.execute(validParams);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.missingPricesWarning).toBeDefined();
        expect(result.value.missingPricesWarning).toContain('1 transactions were excluded');
        // Check that valid transactions were passed to calculator
        expect(mockCalculate).toHaveBeenCalledWith(
          expect.arrayContaining([expect.objectContaining({ timestamp: transactions[0]!.timestamp })]),
          expect.anything(),
          expect.anything()
        );
      }
    });
  });
});
