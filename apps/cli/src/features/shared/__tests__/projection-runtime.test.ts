import { ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildLinksFreshnessPorts,
  mockBuildLinksResetPorts,
  mockBuildPriceCoverageDataPorts,
  mockBuildPricingPorts,
  mockBuildProcessedTransactionsFreshnessPorts,
  mockBuildProcessedTransactionsResetPorts,
  mockCheckTransactionPriceCoverage,
  mockCreateDefaultPriceProviderManager,
  mockPipelineExecute,
} = vi.hoisted(() => ({
  mockBuildLinksFreshnessPorts: vi.fn(),
  mockBuildLinksResetPorts: vi.fn(),
  mockBuildPriceCoverageDataPorts: vi.fn(),
  mockBuildPricingPorts: vi.fn(),
  mockBuildProcessedTransactionsFreshnessPorts: vi.fn(),
  mockBuildProcessedTransactionsResetPorts: vi.fn(),
  mockCheckTransactionPriceCoverage: vi.fn(),
  mockCreateDefaultPriceProviderManager: vi.fn(),
  mockPipelineExecute: vi.fn(),
}));

vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual('@exitbook/data');
  return {
    ...actual,
    buildLinksFreshnessPorts: mockBuildLinksFreshnessPorts,
    buildLinksResetPorts: mockBuildLinksResetPorts,
    buildPriceCoverageDataPorts: mockBuildPriceCoverageDataPorts,
    buildPricingPorts: mockBuildPricingPorts,
    buildProcessedTransactionsFreshnessPorts: mockBuildProcessedTransactionsFreshnessPorts,
    buildProcessedTransactionsResetPorts: mockBuildProcessedTransactionsResetPorts,
  };
});

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  class MockPriceEnrichmentPipeline {
    execute = mockPipelineExecute;
  }
  class MockStandardFxRateProvider {}
  return {
    ...actual,
    checkTransactionPriceCoverage: mockCheckTransactionPriceCoverage,
    PriceEnrichmentPipeline: MockPriceEnrichmentPipeline,
    StandardFxRateProvider: MockStandardFxRateProvider,
  };
});

vi.mock('../../prices/prices-utils.js', () => ({
  createDefaultPriceProviderManager: mockCreateDefaultPriceProviderManager,
}));

import { ensureConsumerInputsReady, resetProjections } from '../projection-runtime.js';

describe('projection-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBuildProcessedTransactionsFreshnessPorts.mockReturnValue({
      checkFreshness: vi.fn().mockResolvedValue(ok({ status: 'fresh', reason: undefined })),
    });
    mockBuildLinksFreshnessPorts.mockReturnValue({
      checkFreshness: vi.fn().mockResolvedValue(ok({ status: 'fresh', reason: undefined })),
    });
    mockBuildPriceCoverageDataPorts.mockReturnValue({
      loadTransactions: vi.fn().mockResolvedValue(ok([])),
    });
    mockBuildPricingPorts.mockReturnValue({});
    mockCreateDefaultPriceProviderManager.mockResolvedValue(
      ok({
        destroy: vi.fn().mockResolvedValue(undefined),
      })
    );
    mockPipelineExecute.mockResolvedValue(ok({}));
  });

  it('wraps graph resets in one outer transaction', async () => {
    const txDb = { kind: 'tx' };
    const db = {
      executeInTransaction: vi.fn(async (fn: (dbArg: unknown) => Promise<unknown>) => fn(txDb)),
    };

    const resetLinks = vi.fn().mockResolvedValue(ok({ links: 1 }));
    const resetProcessed = vi.fn().mockResolvedValue(ok({ transactions: 2 }));
    mockBuildLinksResetPorts.mockReturnValue({ reset: resetLinks });
    mockBuildProcessedTransactionsResetPorts.mockReturnValue({ reset: resetProcessed });

    const result = await resetProjections(db as never, 'processed-transactions', [1]);

    assertOk(result);
    expect(db.executeInTransaction).toHaveBeenCalledOnce();
    expect(mockBuildLinksResetPorts).toHaveBeenCalledWith(txDb);
    expect(mockBuildProcessedTransactionsResetPorts).toHaveBeenCalledWith(txDb);
  });

  it('fails readiness if price coverage is still incomplete after enrichment', async () => {
    mockCheckTransactionPriceCoverage
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }))
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }));

    const result = await ensureConsumerInputsReady(
      'cost-basis',
      {
        db: {} as never,
        registry: {} as never,
        dataDir: '/tmp',
        isJsonMode: true,
      },
      {
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-12-31T23:59:59.999Z'),
      }
    );

    expect(assertErr(result).message).toContain('Price coverage remains incomplete after enrichment');
    expect(mockPipelineExecute).toHaveBeenCalledOnce();
    expect(mockCheckTransactionPriceCoverage).toHaveBeenCalledTimes(2);
  });
});
