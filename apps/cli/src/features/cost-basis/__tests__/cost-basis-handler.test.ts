import { CostBasisWorkflow } from '@exitbook/accounting';
import { err, ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { createPriceProviderManager, type PriceProviderManager } from '@exitbook/price-providers';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { CostBasisHandler } from '../cost-basis-handler.js';

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  return { ...actual, CostBasisWorkflow: vi.fn(), StandardFxRateProvider: vi.fn() };
});

vi.mock('@exitbook/price-providers', () => ({
  createPriceProviderManager: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../shared/data-dir.js', () => ({
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

describe('CostBasisHandler', () => {
  let handler: CostBasisHandler;
  let mockTransactionRepo: { findAll: Mock };
  let mockTransactionLinkRepo: { findAll: Mock };
  let mockPriceManager: PriceProviderManager;
  let mockWorkflowExecute: Mock;

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

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransactionRepo = { findAll: vi.fn().mockResolvedValue(ok([])) };
    mockTransactionLinkRepo = { findAll: vi.fn().mockResolvedValue(ok([])) };

    const mockDb = {
      transactions: mockTransactionRepo,
      transactionLinks: mockTransactionLinkRepo,
    } as unknown as DataContext;

    mockPriceManager = { destroy: vi.fn() } as unknown as PriceProviderManager;
    vi.mocked(createPriceProviderManager).mockResolvedValue(ok(mockPriceManager));

    mockWorkflowExecute = vi.fn().mockResolvedValue(ok({ summary: {}, lots: [], disposals: [], lotTransfers: [] }));
    vi.mocked(CostBasisWorkflow).mockImplementation(function () {
      return { execute: mockWorkflowExecute } as unknown as CostBasisWorkflow;
    } as unknown as typeof CostBasisWorkflow);

    handler = new CostBasisHandler(mockDb);
  });

  describe('execute', () => {
    it('returns error when price manager creation fails', async () => {
      vi.mocked(createPriceProviderManager).mockResolvedValue(err(new Error('DB init failed')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to create price provider manager');
      }
    });

    it('returns error when transaction fetch fails', async () => {
      vi.mocked(mockTransactionRepo.findAll).mockResolvedValue(err(new Error('DB Error')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('DB Error');
      }
    });

    it('delegates to CostBasisWorkflow and returns its result', async () => {
      const workflowResult = {
        summary: { calculation: { id: 'calc-123' } },
        lots: [],
        disposals: [],
        lotTransfers: [],
      };
      mockWorkflowExecute.mockResolvedValue(ok(workflowResult));

      const result = await handler.execute(validParams);

      expect(result.isOk()).toBe(true);
      expect(mockWorkflowExecute).toHaveBeenCalledWith(validParams, []);
    });

    it('destroys price manager even when workflow fails', async () => {
      mockWorkflowExecute.mockResolvedValue(err(new Error('workflow error')));

      await handler.execute(validParams);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- we just want to check that destroy was called, not its this context
      expect(mockPriceManager.destroy).toHaveBeenCalled();
    });
  });
});
