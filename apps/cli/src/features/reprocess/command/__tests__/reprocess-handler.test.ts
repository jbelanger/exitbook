import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { DataContext } from '@exitbook/data';
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

vi.mock('../../shared/projection-runtime.js', () => ({
  resetProjections: vi.fn().mockResolvedValue(ok(undefined)),
}));

describe('ProcessHandler', () => {
  let mockDatabase: DataContext;
  let mockProcessingWorkflow: { prepareReprocess: Mock; processImportedSessions: Mock };
  let mockIngestionMonitor: { abort: Mock; fail: Mock; stop: Mock };
  let mockInstrumentation: { getSummary: Mock };
  let handler: ProcessHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDatabase = {} as DataContext;

    mockProcessingWorkflow = {
      prepareReprocess: vi.fn().mockResolvedValue(ok({ accountIds: [1] })),
      processImportedSessions: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [], failed: 0 })),
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
      mockDatabase,
      mockProcessingWorkflow as unknown as ProcessingWorkflow,
      mockIngestionMonitor as never,
      mockInstrumentation as never
    );
  });

  test('should return result with metrics on success', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [1, 2] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(ok({ processed: 5, errors: [], failed: 0 }));

    const result = await handler.execute({});

    const summary = assertOk(result);
    expect(summary.processed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.runStats).toEqual({ totalRequests: 0 });
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should pass accountId to prepareReprocess', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [123] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(ok({ processed: 3, errors: [], failed: 0 }));

    await handler.execute({ accountId: 123 });

    expect(mockProcessingWorkflow.prepareReprocess).toHaveBeenCalledWith({ accountId: 123 });
  });

  test('should return processed: 0 when plan is empty', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok(undefined));

    const result = await handler.execute({});

    const summary = assertOk(result);
    expect(summary.processed).toBe(0);
    expect(mockProcessingWorkflow.processImportedSessions).not.toHaveBeenCalled();
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should fail monitor and return error on prepareReprocess failure', async () => {
    const error = new Error('Incomplete import');
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(err(error));

    const result = await handler.execute({});

    expect(assertErr(result)).toBe(error);
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith('Incomplete import');
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should fail monitor and return error on processImportedSessions failure', async () => {
    const error = new Error('Processing failed');
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [1] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(err(error));

    const result = await handler.execute({});

    expect(assertErr(result)).toBe(error);
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith('Processing failed');
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should fail monitor and return error when processing completes with failed accounts', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [1] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(
      ok({
        processed: 362,
        errors: ['Failed to process account 46: Kraken processing cannot proceed'],
        failed: 1,
      })
    );

    const result = await handler.execute({});

    const error = assertErr(result);
    expect(error.message).toContain('Reprocess failed: 1 account(s) failed during processing.');
    expect(error.message).toContain('Failed to process account 46');
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith(error.message);
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should delegate abort to monitor', () => {
    handler.abort();

    expect(mockIngestionMonitor.abort).toHaveBeenCalledOnce();
  });
});
