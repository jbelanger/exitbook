/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest orchestration tests intentionally use focused test doubles for runtime-owned seams. */
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildPricingPorts,
  mockControllerAbort,
  mockControllerComplete,
  mockControllerFail,
  mockControllerStart,
  mockControllerStop,
  mockCreateEventDrivenController,
  mockLoggerError,
  mockLoggerWarn,
  mockPipelineExecute,
} = vi.hoisted(() => ({
  mockBuildPricingPorts: vi.fn(),
  mockControllerAbort: vi.fn(),
  mockControllerComplete: vi.fn(),
  mockControllerFail: vi.fn(),
  mockControllerStart: vi.fn().mockResolvedValue(undefined),
  mockControllerStop: vi.fn().mockResolvedValue(undefined),
  mockCreateEventDrivenController: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockPipelineExecute: vi.fn(),
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildPricingPorts: mockBuildPricingPorts,
}));

vi.mock('@exitbook/accounting/price-enrichment', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/accounting/price-enrichment')>(
    '@exitbook/accounting/price-enrichment'
  );

  class MockPriceEnrichmentPipeline {
    execute = mockPipelineExecute;
  }

  return {
    ...actual,
    PriceEnrichmentPipeline: MockPriceEnrichmentPipeline,
  };
});

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: mockLoggerError,
    info: vi.fn(),
    trace: vi.fn(),
    warn: mockLoggerWarn,
  }),
}));

vi.mock('../../../../ui/shared/controllers.js', () => ({
  createEventDrivenController: mockCreateEventDrivenController,
}));

import { executeCliPriceEnrichmentRuntime, withCliPriceEnrichmentRuntime } from '../prices-enrich-runtime.js';

function createController() {
  return {
    abort: mockControllerAbort,
    complete: mockControllerComplete,
    fail: mockControllerFail,
    start: mockControllerStart,
    stop: mockControllerStop,
  };
}

function createPriceRuntime(cleanupResult: ReturnType<typeof ok> | ReturnType<typeof err> = ok(undefined)) {
  return {
    cleanup: vi.fn().mockResolvedValue(cleanupResult),
    fetchPrice: vi.fn(),
    setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
    setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

describe('prices-enrich-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBuildPricingPorts.mockReturnValue({ ports: 'pricing' });
    mockCreateEventDrivenController.mockReturnValue(createController());
    mockPipelineExecute.mockResolvedValue(ok({ stages: [] }));
  });

  it('registers an abort handler for text-mode runtimes and always cleans up the price runtime', async () => {
    const priceRuntime = createPriceRuntime();
    const scope = {
      createManagedPriceProviderRuntime: vi.fn().mockResolvedValue(priceRuntime),
    };

    let abortRuntime: (() => void) | undefined;
    const onAbortReleased = vi.fn();

    const result = await withCliPriceEnrichmentRuntime(
      {
        database: { tag: 'db' } as never,
        format: 'text',
        profileId: 7,
        scope: scope as never,
        onAbortRegistered: (abort) => {
          abortRuntime = abort;
        },
        onAbortReleased,
      },
      async () => {
        abortRuntime?.();
        return ok('done');
      }
    );

    expect(assertOk(result)).toBe('done');
    expect(mockBuildPricingPorts).toHaveBeenCalledWith({ tag: 'db' }, 7);
    expect(scope.createManagedPriceProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        eventBus: expect.anything(),
        instrumentation: expect.anything(),
        registerCleanup: false,
      })
    );
    expect(mockControllerAbort).toHaveBeenCalledOnce();
    expect(mockControllerStop).toHaveBeenCalledOnce();
    expect(priceRuntime.cleanup).toHaveBeenCalledOnce();
    expect(onAbortReleased).toHaveBeenCalledOnce();
  });

  it('fails setup cleanly when text-mode runtime creation throws after the controller exists', async () => {
    const scope = {
      createManagedPriceProviderRuntime: vi.fn().mockRejectedValue(new Error('price runtime init failed')),
    };

    const result = await withCliPriceEnrichmentRuntime(
      {
        database: { tag: 'db' } as never,
        format: 'text',
        profileId: 7,
        scope: scope as never,
      },
      async () => ok('unreachable')
    );

    expect(assertErr(result).message).toBe('price runtime init failed');
    expect(mockControllerFail).toHaveBeenCalledWith('price runtime init failed');
    expect(mockControllerStop).toHaveBeenCalledOnce();
  });

  it('logs cleanup failures without overriding the operation result', async () => {
    const priceRuntime = createPriceRuntime(err(new Error('cleanup failed')));
    const scope = {
      createManagedPriceProviderRuntime: vi.fn().mockResolvedValue(priceRuntime),
    };

    const result = await withCliPriceEnrichmentRuntime(
      {
        database: { tag: 'db' } as never,
        format: 'json',
        profileId: 9,
        scope: scope as never,
      },
      async () => ok('done')
    );

    expect(assertOk(result)).toBe('done');
    expect(priceRuntime.cleanup).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupError: expect.any(Error),
      }),
      'Failed to clean up price runtime after price enrichment operation'
    );
    expect(mockCreateEventDrivenController).not.toHaveBeenCalled();
  });

  it('fails and stops the controller when the enrichment pipeline returns an error', async () => {
    const controller = createController();
    const pipeline = {
      execute: vi.fn().mockResolvedValue(err(new Error('pricing failed'))),
    };

    const result = await executeCliPriceEnrichmentRuntime(
      {
        controller: controller as never,
        instrumentation: {} as never,
        pipeline: pipeline as never,
        priceRuntime: {} as never,
      },
      {
        params: { deriveOnly: true } as never,
      }
    );

    expect(assertErr(result).message).toBe('pricing failed');
    expect(mockControllerStart).toHaveBeenCalledOnce();
    expect(mockControllerFail).toHaveBeenCalledWith('pricing failed');
    expect(mockControllerStop).toHaveBeenCalledOnce();
    expect(mockControllerComplete).not.toHaveBeenCalled();
  });

  it('treats afterSuccess failures like runtime failures and stops the controller', async () => {
    const controller = createController();
    const pipeline = {
      execute: vi.fn().mockResolvedValue(ok({ updated: 4 })),
    };

    const result = await executeCliPriceEnrichmentRuntime(
      {
        controller: controller as never,
        instrumentation: {} as never,
        pipeline: pipeline as never,
        priceRuntime: {} as never,
      },
      {
        params: { fetchOnly: true } as never,
        afterSuccess: async () => err(new Error('summary write failed')),
      }
    );

    expect(assertErr(result).message).toBe('summary write failed');
    expect(mockControllerStart).toHaveBeenCalledOnce();
    expect(mockControllerFail).toHaveBeenCalledWith('summary write failed');
    expect(mockControllerStop).toHaveBeenCalledOnce();
    expect(mockControllerComplete).not.toHaveBeenCalled();
  });
});
