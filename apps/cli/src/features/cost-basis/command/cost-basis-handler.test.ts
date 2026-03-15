import { CostBasisArtifactService, CostBasisWorkflow, persistCostBasisFailureSnapshot } from '@exitbook/accounting';
import { err, ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import {
  createDefaultPriceProviderManager,
  readPriceCacheFreshness,
  type PriceProviderManager,
} from '@exitbook/price-providers';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-runtime.js';

import { CostBasisHandler } from './cost-basis-handler.js';

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  return {
    ...actual,
    CostBasisArtifactService: vi.fn(),
    CostBasisWorkflow: vi.fn(),
    persistCostBasisFailureSnapshot: vi.fn(),
    StandardFxRateProvider: vi.fn(),
  };
});

vi.mock('@exitbook/price-providers', () => ({
  createDefaultPriceProviderManager: vi.fn(),
  readPriceCacheFreshness: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../shared/data-dir.js', () => ({
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

vi.mock('../../shared/asset-review-projection-runtime.js', () => ({
  readAssetReviewProjectionSummaries: vi.fn(),
}));

describe('CostBasisHandler', () => {
  let handler: CostBasisHandler;
  let mockPriceManager: PriceProviderManager;
  let mockArtifactServiceExecute: Mock;
  let mockTransactionsFindAll: Mock;
  let mockTransactionLinksFindAll: Mock;
  let mockAccountsFindAll: Mock;

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

    mockTransactionsFindAll = vi.fn().mockResolvedValue(ok([]));
    mockTransactionLinksFindAll = vi.fn().mockResolvedValue(ok([]));
    mockAccountsFindAll = vi.fn().mockResolvedValue(ok([]));

    const mockDb = {
      transactions: { findAll: mockTransactionsFindAll },
      transactionLinks: { findAll: mockTransactionLinksFindAll },
      accounts: { findAll: mockAccountsFindAll },
      costBasisFailureSnapshots: { replaceLatest: vi.fn() },
      costBasisSnapshots: { findLatest: vi.fn(), replaceLatest: vi.fn() },
      projectionState: {
        get: vi.fn().mockImplementation(async (projectionId: string) =>
          ok({
            projectionId,
            scopeKey: '__global__',
            status: 'fresh',
            lastBuiltAt: new Date('2026-03-14T12:00:00.000Z'),
            lastInvalidatedAt: undefined,
            invalidatedBy: undefined,
            metadata: undefined,
          })
        ),
      },
    } as unknown as DataContext;

    mockPriceManager = { destroy: vi.fn() } as unknown as PriceProviderManager;
    vi.mocked(createDefaultPriceProviderManager).mockResolvedValue(ok(mockPriceManager));
    vi.mocked(readPriceCacheFreshness).mockResolvedValue(ok(new Date('2026-03-14T12:00:02.000Z')));
    vi.mocked(persistCostBasisFailureSnapshot).mockResolvedValue(
      ok({ scopeKey: 'cost-basis:test', snapshotId: 'failure-snapshot-1' })
    );

    mockArtifactServiceExecute = vi.fn().mockResolvedValue(
      ok({
        artifact: { kind: 'standard-workflow', summary: {}, lots: [], disposals: [], lotTransfers: [] },
        debug: { kind: 'standard-workflow', scopedTransactionIds: [], appliedConfirmedLinkIds: [] },
        dependencyWatermark: {
          links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
          assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
          pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
          exclusionFingerprint: 'excluded-assets:none',
        },
        rebuilt: false,
        scopeKey: 'cost-basis:test',
        snapshotId: 'snapshot-1',
      })
    );

    vi.mocked(CostBasisWorkflow).mockImplementation(function () {
      return { execute: vi.fn() } as unknown as CostBasisWorkflow;
    } as unknown as typeof CostBasisWorkflow);
    vi.mocked(CostBasisArtifactService).mockImplementation(function () {
      return { execute: mockArtifactServiceExecute } as unknown as CostBasisArtifactService;
    } as unknown as typeof CostBasisArtifactService);

    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(ok(new Map()));

    handler = new CostBasisHandler(mockDb, '/tmp/test-data');
  });

  describe('execute', () => {
    it('returns error when price manager creation fails', async () => {
      vi.mocked(createDefaultPriceProviderManager).mockResolvedValue(err(new Error('DB init failed')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to create price provider manager');
      }
    });

    it('returns error when dependency watermark loading fails', async () => {
      const failingDb = {
        transactions: { findAll: vi.fn().mockResolvedValue(ok([])) },
        transactionLinks: { findAll: vi.fn().mockResolvedValue(ok([])) },
        costBasisFailureSnapshots: { replaceLatest: vi.fn() },
        costBasisSnapshots: { findLatest: vi.fn(), replaceLatest: vi.fn() },
        projectionState: {
          get: vi.fn().mockResolvedValue(err(new Error('projection read failed'))),
        },
      } as unknown as DataContext;
      handler = new CostBasisHandler(failingDb, '/tmp/test-data');

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('projection read failed');
      }
    });

    it('delegates artifact policy to CostBasisArtifactService and returns its artifact', async () => {
      const result = await handler.execute(validParams, { refresh: true });

      expect(result.isOk()).toBe(true);
      expect(mockArtifactServiceExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: validParams,
          refresh: true,
          accountingExclusionPolicy: { excludedAssetIds: new Set<string>() },
          assetReviewSummaries: new Map(),
        })
      );
    });

    it('does not load source context for the normal execute path', async () => {
      const result = await handler.execute(validParams);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionsFindAll).not.toHaveBeenCalled();
      expect(mockTransactionLinksFindAll).not.toHaveBeenCalled();
      expect(mockAccountsFindAll).not.toHaveBeenCalled();
    });

    it('destroys price manager even when artifact execution fails', async () => {
      mockArtifactServiceExecute.mockResolvedValue(err(new Error('artifact error')));

      await handler.execute(validParams);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- we just want to check that destroy was called, not its this context
      expect(mockPriceManager.destroy).toHaveBeenCalled();
    });

    it('persists a failure snapshot when artifact execution fails', async () => {
      mockArtifactServiceExecute.mockResolvedValue(err(new Error('artifact error')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      expect(persistCostBasisFailureSnapshot).toHaveBeenCalledTimes(1);
    });

    it('returns a combined error when failure snapshot persistence also fails', async () => {
      mockArtifactServiceExecute.mockResolvedValue(err(new Error('artifact error')));
      vi.mocked(persistCostBasisFailureSnapshot).mockResolvedValue(err(new Error('failure snapshot write failed')));

      const result = await handler.execute(validParams);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe(
          'Cost basis failed: artifact error. Additionally, failure snapshot persistence failed: failure snapshot write failed'
        );
      }
    });
  });

  describe('executeArtifactWithContext', () => {
    it('loads source context for export-aware callers', async () => {
      const result = await handler.executeArtifactWithContext(validParams);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionsFindAll).toHaveBeenCalledTimes(1);
      expect(mockTransactionLinksFindAll).toHaveBeenCalledTimes(1);
      expect(mockAccountsFindAll).toHaveBeenCalledTimes(1);
    });
  });
});
