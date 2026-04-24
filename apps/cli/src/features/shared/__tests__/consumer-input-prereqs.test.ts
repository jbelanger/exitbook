import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildAssetReviewFreshnessPorts,
  mockBuildAssetReviewResetPorts,
  mockBuildBalancesResetPorts,
  mockBuildLinksFreshnessPorts,
  mockBuildLinksResetPorts,
  mockBuildPriceCoverageDataPorts,
  mockBuildPricingPorts,
  mockBuildProcessedTransactionsFreshnessPorts,
  mockBuildProcessedTransactionsResetPorts,
  mockCheckTransactionPriceCoverage,
  mockPipelineExecute,
} = vi.hoisted(() => ({
  mockBuildAssetReviewFreshnessPorts: vi.fn(),
  mockBuildAssetReviewResetPorts: vi.fn(),
  mockBuildBalancesResetPorts: vi.fn(),
  mockBuildLinksFreshnessPorts: vi.fn(),
  mockBuildLinksResetPorts: vi.fn(),
  mockBuildPriceCoverageDataPorts: vi.fn(),
  mockBuildPricingPorts: vi.fn(),
  mockBuildProcessedTransactionsFreshnessPorts: vi.fn(),
  mockBuildProcessedTransactionsResetPorts: vi.fn(),
  mockCheckTransactionPriceCoverage: vi.fn(),
  mockPipelineExecute: vi.fn(),
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildPriceCoverageDataPorts: mockBuildPriceCoverageDataPorts,
  buildPricingPorts: mockBuildPricingPorts,
}));

vi.mock('@exitbook/data/projections', () => ({
  buildAssetReviewFreshnessPorts: mockBuildAssetReviewFreshnessPorts,
  buildAssetReviewResetPorts: mockBuildAssetReviewResetPorts,
  buildBalancesResetPorts: mockBuildBalancesResetPorts,
  buildLinksFreshnessPorts: mockBuildLinksFreshnessPorts,
  buildLinksResetPorts: mockBuildLinksResetPorts,
  buildProcessedTransactionsFreshnessPorts: mockBuildProcessedTransactionsFreshnessPorts,
  buildProcessedTransactionsResetPorts: mockBuildProcessedTransactionsResetPorts,
}));

vi.mock('@exitbook/accounting/cost-basis', async () => {
  const actual = await vi.importActual('@exitbook/accounting/cost-basis');
  return {
    ...actual,
    checkTransactionPriceCoverage: mockCheckTransactionPriceCoverage,
  };
});

vi.mock('@exitbook/accounting/price-enrichment', async () => {
  const actual = await vi.importActual('@exitbook/accounting/price-enrichment');
  class MockPriceEnrichmentPipeline {
    execute = mockPipelineExecute;
  }
  return {
    ...actual,
    PriceEnrichmentPipeline: MockPriceEnrichmentPipeline,
  };
});

import { ensureConsumerInputsReady } from '../../../runtime/consumer-input-readiness.js';
import { resetProjections } from '../../../runtime/projection-reset.js';

describe('consumer-input-readiness', () => {
  const mockDatabase = {
    profiles: {
      list: vi.fn().mockResolvedValue(
        ok([
          {
            id: 1,
            profileKey: 'default',
            displayName: 'default',
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        ])
      ),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBuildProcessedTransactionsFreshnessPorts.mockReturnValue({
      checkFreshness: vi.fn().mockResolvedValue(ok({ status: 'fresh', reason: undefined })),
    });
    mockBuildAssetReviewFreshnessPorts.mockReturnValue({
      checkFreshness: vi.fn().mockResolvedValue(ok({ status: 'fresh', reason: undefined })),
    });
    mockBuildLinksFreshnessPorts.mockReturnValue({
      checkFreshness: vi.fn().mockResolvedValue(ok({ status: 'fresh', reason: undefined })),
    });
    mockBuildPriceCoverageDataPorts.mockReturnValue({
      loadTransactions: vi.fn().mockResolvedValue(ok([])),
    });
    mockBuildPricingPorts.mockReturnValue({});
    mockPipelineExecute.mockResolvedValue(ok({}));
  });

  it('wraps graph resets in one outer transaction', async () => {
    const txDb = { kind: 'tx' };
    const db = {
      executeInTransaction: vi.fn(async (fn: (dbArg: unknown) => Promise<unknown>) => fn(txDb)),
    };

    const resetLinks = vi.fn().mockResolvedValue(ok({ links: 1 }));
    const resetAssetReview = vi.fn().mockResolvedValue(ok({ assets: 1 }));
    const resetBalances = vi.fn().mockResolvedValue(ok({ balances: 1 }));
    const resetProcessed = vi.fn().mockResolvedValue(ok({ transactions: 2 }));
    mockBuildLinksResetPorts.mockReturnValue({ reset: resetLinks });
    mockBuildAssetReviewResetPorts.mockReturnValue({ reset: resetAssetReview });
    mockBuildBalancesResetPorts.mockReturnValue({ reset: resetBalances });
    mockBuildProcessedTransactionsResetPorts.mockReturnValue({ reset: resetProcessed });

    const result = await resetProjections(db as never, 'processed-transactions', [1]);

    assertOk(result);
    expect(db.executeInTransaction).toHaveBeenCalledOnce();
    expect(mockBuildLinksResetPorts).toHaveBeenCalledWith(txDb);
    expect(mockBuildAssetReviewResetPorts).toHaveBeenCalledWith(txDb);
    expect(mockBuildBalancesResetPorts).toHaveBeenCalledWith(txDb);
    expect(mockBuildProcessedTransactionsResetPorts).toHaveBeenCalledWith(txDb);
  });

  it('fails readiness if price coverage is still incomplete after enrichment', async () => {
    mockCheckTransactionPriceCoverage
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }))
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }));

    const ctx = {
      dataDir: '/tmp',
      database: vi.fn().mockResolvedValue(mockDatabase),
      openDatabaseSession: vi.fn().mockResolvedValue(mockDatabase),
      closeDatabaseSession: vi.fn().mockResolvedValue(undefined),
      createManagedPriceProviderRuntime: vi.fn().mockResolvedValue({
        cleanup: vi.fn().mockResolvedValue(ok(undefined)),
        fetchPrice: vi.fn(),
        setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
        setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
      }),
      requireAppRuntime: vi.fn().mockReturnValue({
        adapterRegistry: {},
        blockchainExplorersConfig: undefined,
        dataDir: '/tmp',
        databasePath: '/tmp/transactions.db',
        priceProviderConfig: {},
      }),
    };

    const result = await ensureConsumerInputsReady(ctx as never, 'cost-basis', {
      format: 'json',
      profileId: 1,
      priceConfig: {
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-12-31T23:59:59.999Z'),
      },
    });

    expect(assertErr(result).message).toContain('Price coverage remains incomplete after enrichment');
    expect(mockPipelineExecute).toHaveBeenCalledOnce();
    expect(mockCheckTransactionPriceCoverage).toHaveBeenCalledTimes(2);
    expect(mockBuildPriceCoverageDataPorts).toHaveBeenCalledWith(mockDatabase, 1);
  });

  it('allows portfolio readiness to continue when price coverage remains incomplete after enrichment', async () => {
    mockCheckTransactionPriceCoverage
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }))
      .mockResolvedValueOnce(ok({ complete: false, reason: '1 of 1 transactions missing prices' }));

    const ctx = {
      dataDir: '/tmp',
      database: vi.fn().mockResolvedValue(mockDatabase),
      openDatabaseSession: vi.fn().mockResolvedValue(mockDatabase),
      closeDatabaseSession: vi.fn().mockResolvedValue(undefined),
      createManagedPriceProviderRuntime: vi.fn().mockResolvedValue({
        cleanup: vi.fn().mockResolvedValue(ok(undefined)),
        fetchPrice: vi.fn(),
        setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
        setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
      }),
      requireAppRuntime: vi.fn().mockReturnValue({
        adapterRegistry: {},
        blockchainExplorersConfig: undefined,
        dataDir: '/tmp',
        databasePath: '/tmp/transactions.db',
        priceProviderConfig: {},
      }),
    };

    const result = await ensureConsumerInputsReady(ctx as never, 'portfolio', {
      format: 'json',
      profileId: 1,
      priceConfig: {
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-12-31T23:59:59.999Z'),
      },
    });

    assertOk(result);
    expect(mockPipelineExecute).toHaveBeenCalledOnce();
    expect(mockCheckTransactionPriceCoverage).toHaveBeenCalledTimes(2);
    expect(mockBuildPriceCoverageDataPorts).toHaveBeenCalledWith(mockDatabase, 1);
  });
});
