import { err, ok } from '@exitbook/core';
import type { ProcessingWorkflow } from '@exitbook/ingestion';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import { ProcessHandler } from '../reprocess-handler.js';

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('ProcessHandler', () => {
  let mockProcessingWorkflow: { reprocess: Mock };
  let mockIngestionMonitor: { abort: Mock; fail: Mock; stop: Mock };
  let mockInstrumentation: { getSummary: Mock };
  let handler: ProcessHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcessingWorkflow = {
      reprocess: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [] })),
    };

    mockIngestionMonitor = {
      fail: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    mockInstrumentation = {
      getSummary: vi.fn().mockReturnValue({ totalRequests: 0 }),
    };

    handler = new ProcessHandler(
      mockProcessingWorkflow as unknown as ProcessingWorkflow,
      mockIngestionMonitor as never,
      mockInstrumentation as never
    );
  });

  test('should return result with metrics on success', async () => {
    mockProcessingWorkflow.reprocess.mockResolvedValue(ok({ processed: 5, errors: [] }));

    const result = await handler.execute({});

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().processed).toBe(5);
    expect(result._unsafeUnwrap().runStats).toEqual({ totalRequests: 0 });
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should pass accountId to reprocess', async () => {
    mockProcessingWorkflow.reprocess.mockResolvedValue(ok({ processed: 3, errors: [] }));

    await handler.execute({ accountId: 123 });

    expect(mockProcessingWorkflow.reprocess).toHaveBeenCalledWith({ accountId: 123 });
  });

  test('should fail monitor and return error on reprocess failure', async () => {
    const error = new Error('Processing failed');
    mockProcessingWorkflow.reprocess.mockResolvedValue(err(error));

    const result = await handler.execute({});

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(error);
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith('Processing failed');
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should delegate abort to monitor', () => {
    handler.abort();

    expect(mockIngestionMonitor.abort).toHaveBeenCalledOnce();
  });
});
