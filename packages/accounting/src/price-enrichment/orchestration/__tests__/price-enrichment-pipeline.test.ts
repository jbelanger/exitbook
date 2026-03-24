import type { EventBus } from '@exitbook/events';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PricingEvent } from '../../shared/price-events.js';
import { PriceEnrichmentPipeline } from '../price-enrichment-pipeline.js';
import type { PriceFetchService } from '../price-fetch-service.js';
import type { PriceInferenceService } from '../price-inference-service.js';

// --- Mocks for internal services ---

const mockDerivePrices = vi.fn();
const mockNormalize = vi.fn();
const mockFetchPrices = vi.fn();

vi.mock('../price-normalization-service.js', () => ({
  PriceNormalizationService: class {
    normalize = mockNormalize;
  },
}));

const mockInferenceService = { derivePrices: mockDerivePrices } as unknown as PriceInferenceService;
const mockFetchService = { fetchPrices: mockFetchPrices } as unknown as PriceFetchService;

// --- Test helpers ---

const mockStore = {
  loadPricingContext: vi.fn(),
  loadTransactionsNeedingPrices: vi.fn(),
  saveTransactionPrices: vi.fn(),
};

const mockPriceRuntime = {} as Parameters<PriceEnrichmentPipeline['execute']>[1];

function createEventBus(): EventBus<PricingEvent> & { emit: Mock; events: PricingEvent[] } {
  const events: PricingEvent[] = [];
  const emit = vi.fn((event: PricingEvent) => {
    events.push(event);
  });
  return { emit, events } as unknown as EventBus<PricingEvent> & { emit: Mock; events: PricingEvent[] };
}

function defaultDeriveResult() {
  return ok({ transactionsUpdated: 5 });
}

function defaultNormalizeResult() {
  return ok({
    movementsNormalized: 10,
    movementsSkipped: 2,
    failures: 0,
    errors: [] as string[],
  });
}

function defaultFetchResult() {
  return ok({
    stats: {
      transactionsFound: 10,
      pricesFetched: 8,
      movementsUpdated: 15,
      failures: 0,
      skipped: 2,
      manualEntries: 0,
      granularity: { day: 3, exact: 4, hour: 1, minute: 0 },
    },
    errors: [] as string[],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDerivePrices.mockResolvedValue(defaultDeriveResult());
  mockNormalize.mockResolvedValue(defaultNormalizeResult());
  mockFetchPrices.mockResolvedValue(defaultFetchResult());
});

describe('PriceEnrichmentPipeline', () => {
  describe('stage execution', () => {
    it('should run all four stages by default', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({}, mockPriceRuntime));

      expect(result.derive).toEqual({ transactionsUpdated: 5 });
      expect(result.normalize).toBeDefined();
      expect(result.fetch).toBeDefined();
      expect(result.rederive).toEqual({ transactionsUpdated: 5 });
      expect(mockDerivePrices).toHaveBeenCalledTimes(2); // derive + rederive
      expect(mockNormalize).toHaveBeenCalledTimes(1);
      expect(mockFetchPrices).toHaveBeenCalledTimes(1);
    });

    it('should run only derive when deriveOnly is true', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({ deriveOnly: true }, mockPriceRuntime));

      expect(result.derive).toBeDefined();
      expect(result.normalize).toBeUndefined();
      expect(result.fetch).toBeUndefined();
      expect(result.rederive).toBeUndefined();
      expect(mockDerivePrices).toHaveBeenCalledTimes(1);
    });

    it('should run only normalize when normalizeOnly is true', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({ normalizeOnly: true }, mockPriceRuntime));

      expect(result.derive).toBeUndefined();
      expect(result.normalize).toBeDefined();
      expect(result.fetch).toBeUndefined();
      expect(result.rederive).toBeUndefined();
    });

    it('should run only fetch when fetchOnly is true', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({ fetchOnly: true }, mockPriceRuntime));

      expect(result.derive).toBeUndefined();
      expect(result.normalize).toBeUndefined();
      expect(result.fetch).toBeDefined();
      expect(result.rederive).toBeUndefined();
    });

    it('should not rederive when derive runs alone', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      assertOk(await pipeline.execute({ deriveOnly: true }, mockPriceRuntime));

      // Only 1 call — no rederive pass
      expect(mockDerivePrices).toHaveBeenCalledTimes(1);
    });
  });

  describe('event bus', () => {
    it('should emit stage lifecycle events', async () => {
      const bus = createEventBus();
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        bus,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );

      assertOk(await pipeline.execute({}, mockPriceRuntime));

      const startedEvents = bus.events.filter((e) => e.type === 'stage.started');
      const completedEvents = bus.events.filter((e) => e.type === 'stage.completed');

      expect(startedEvents).toHaveLength(4);
      expect(completedEvents).toHaveLength(4);
    });

    it('should emit stage.failed on stage error', async () => {
      mockDerivePrices.mockResolvedValue(err(new Error('derive boom')));
      const bus = createEventBus();
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        bus,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );

      assertErr(await pipeline.execute({}, mockPriceRuntime));

      const failedEvents = bus.events.filter((e) => e.type === 'stage.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        type: 'stage.failed',
        stage: 'tradePrices',
        error: 'derive boom',
      });
    });
  });

  describe('error propagation', () => {
    it('should propagate derive stage error', async () => {
      mockDerivePrices.mockResolvedValue(err(new Error('derive failed')));
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );

      const error = assertErr(await pipeline.execute({}, mockPriceRuntime));

      expect(error.message).toBe('derive failed');
      expect(mockNormalize).not.toHaveBeenCalled();
    });

    it('should propagate normalize stage error', async () => {
      mockNormalize.mockResolvedValue(err(new Error('normalize failed')));
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );

      const error = assertErr(await pipeline.execute({}, mockPriceRuntime));

      expect(error.message).toBe('normalize failed');
      expect(mockFetchPrices).not.toHaveBeenCalled();
    });

    it('should propagate fetch stage error', async () => {
      mockFetchPrices.mockResolvedValue(err(new Error('fetch failed')));
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );

      const error = assertErr(await pipeline.execute({}, mockPriceRuntime));

      expect(error.message).toBe('fetch failed');
    });
  });

  describe('onMissing=fail behavior', () => {
    it('should abort when normalize has failures and onMissing is fail', async () => {
      mockNormalize.mockResolvedValue(
        ok({
          movementsNormalized: 5,
          movementsSkipped: 0,
          failures: 2,
          errors: ['Failed CAD->USD', 'Failed EUR->USD'],
        })
      );

      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const error = assertErr(await pipeline.execute({ onMissing: 'fail' }, mockPriceRuntime));

      expect(error.message).toContain('FX rate conversion failure');
      expect(error.name).toBe('NormalizeAbortError');
      expect(mockFetchPrices).not.toHaveBeenCalled();
    });

    it('should not abort normalize failures without onMissing=fail', async () => {
      mockNormalize.mockResolvedValue(
        ok({
          movementsNormalized: 5,
          movementsSkipped: 0,
          failures: 2,
          errors: ['Failed CAD->USD'],
        })
      );

      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({}, mockPriceRuntime));

      expect(result.normalize?.failures).toBe(2);
      expect(mockFetchPrices).toHaveBeenCalledTimes(1);
    });
  });

  describe('runStats', () => {
    it('should include aggregated run stats in result', async () => {
      const pipeline = new PriceEnrichmentPipeline(
        mockStore,
        undefined,
        undefined,
        undefined,
        mockInferenceService,
        mockFetchService
      );
      const result = assertOk(await pipeline.execute({}, mockPriceRuntime));

      expect(result.runStats).toBeDefined();
    });
  });
});
