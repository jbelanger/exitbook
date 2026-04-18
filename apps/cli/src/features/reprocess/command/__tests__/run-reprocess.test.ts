import type { DataSession } from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { ProcessingWorkflow } from '@exitbook/ingestion/process';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import {
  abortReprocessRuntime,
  executeReprocessWithRuntime,
  type ReprocessExecutionRuntime,
} from '../run-reprocess.js';

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../../runtime/projection-reset.js', () => ({
  resetProjections: vi.fn().mockResolvedValue(ok(undefined)),
}));

describe('reprocess runner helpers', () => {
  let mockDatabase: DataSession;
  let mockProcessingWorkflow: { prepareReprocess: Mock; processImportedSessions: Mock };
  let mockIngestionMonitor: { abort: Mock; fail: Mock; stop: Mock };
  let mockInstrumentation: { getSummary: Mock };
  let runtime: ReprocessExecutionRuntime;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDatabase = {} as DataSession;

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

    runtime = {
      database: mockDatabase,
      processingWorkflow: mockProcessingWorkflow as unknown as ProcessingWorkflow,
      ingestionMonitor: mockIngestionMonitor as never,
      instrumentation: mockInstrumentation as never,
    };
  });

  test('should return result with metrics on success', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [1, 2] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(ok({ processed: 5, errors: [], failed: 0 }));

    const result = await executeReprocessWithRuntime(runtime, {});

    const summary = assertOk(result);
    expect(summary.processed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.runStats).toEqual({ totalRequests: 0 });
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should pass accountId to prepareReprocess', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [123] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(ok({ processed: 3, errors: [], failed: 0 }));

    await executeReprocessWithRuntime(runtime, { accountId: 123 });

    expect(mockProcessingWorkflow.prepareReprocess).toHaveBeenCalledWith({ accountId: 123 });
  });

  test('should pass profileId to prepareReprocess', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [77] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(ok({ processed: 2, errors: [], failed: 0 }));

    await executeReprocessWithRuntime(runtime, { profileId: 9 });

    expect(mockProcessingWorkflow.prepareReprocess).toHaveBeenCalledWith({ profileId: 9 });
  });

  test('should return processed: 0 when plan is empty', async () => {
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok(undefined));

    const result = await executeReprocessWithRuntime(runtime, {});

    const summary = assertOk(result);
    expect(summary.processed).toBe(0);
    expect(mockProcessingWorkflow.processImportedSessions).not.toHaveBeenCalled();
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should fail monitor and return error on prepareReprocess failure', async () => {
    const error = new Error('Incomplete import');
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(err(error));

    const result = await executeReprocessWithRuntime(runtime, {});

    expect(assertErr(result)).toBe(error);
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith('Incomplete import');
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should fail monitor and return error on processImportedSessions failure', async () => {
    const error = new Error('Processing failed');
    mockProcessingWorkflow.prepareReprocess.mockResolvedValue(ok({ accountIds: [1] }));
    mockProcessingWorkflow.processImportedSessions.mockResolvedValue(err(error));

    const result = await executeReprocessWithRuntime(runtime, {});

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

    const result = await executeReprocessWithRuntime(runtime, {});

    const error = assertErr(result);
    expect(error.message).toContain('Reprocess failed: 1 account(s) failed during processing.');
    expect(error.message).toContain('Failed to process account 46');
    expect(mockIngestionMonitor.fail).toHaveBeenCalledWith(error.message);
    expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
  });

  test('should delegate abort to monitor', () => {
    abortReprocessRuntime(runtime);

    expect(mockIngestionMonitor.abort).toHaveBeenCalledOnce();
  });
});
