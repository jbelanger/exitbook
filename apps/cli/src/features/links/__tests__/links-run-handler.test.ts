import type { LinkingRunResult, LinkingRunParams } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinksRunHandler } from '../links-run-handler.js';

describe('LinksRunHandler', () => {
  let mockOrchestrator: { execute: Mock };
  let mockOverrideStore: { exists: Mock; readAll: Mock };
  let mockController: { abort: Mock; complete: Mock; fail: Mock; start: Mock; stop: Mock };
  let handler: LinksRunHandler;

  const params: LinkingRunParams = {
    dryRun: false,
    minConfidenceScore: parseDecimal('0.7'),
    autoConfirmThreshold: parseDecimal('0.95'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      execute: vi.fn(),
    };

    mockOverrideStore = {
      exists: vi.fn(),
      readAll: vi.fn(),
    };

    mockController = {
      abort: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    handler = new LinksRunHandler(
      mockOrchestrator as never,
      mockOverrideStore as unknown as OverrideStore,
      mockController as never
    );
  });

  it('should not start the controller when reading overrides fails', async () => {
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readAll.mockResolvedValue(err(new Error('Overrides file is invalid')));

    const result = await handler.execute(params);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Overrides file is invalid');
    expect(mockController.start).not.toHaveBeenCalled();
    expect(mockController.fail).not.toHaveBeenCalled();
    expect(mockController.stop).not.toHaveBeenCalled();
    expect(mockOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('should load overrides before starting the controller', async () => {
    const linkingResult: LinkingRunResult = {
      dryRun: false,
      existingLinksCleared: 2,
      internalLinksCount: 1,
      confirmedLinksCount: 3,
      suggestedLinksCount: 1,
      totalSourceTransactions: 5,
      totalTargetTransactions: 5,
      unmatchedSourceCount: 0,
      unmatchedTargetCount: 0,
      totalSaved: 4,
    };

    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readAll.mockResolvedValue(
      ok([
        {
          id: 'evt-1',
          created_at: '2026-03-01T00:00:00.000Z',
          actor: 'cli-user',
          source: 'cli',
          scope: 'unlink',
          payload: {
            type: 'unlink_override',
            link_fingerprint: 'link:a:b:BTC',
          },
        },
      ])
    );
    mockOrchestrator.execute.mockResolvedValue(ok(linkingResult));

    const result = await handler.execute(params);

    expect(result.isOk()).toBe(true);
    expect(mockOverrideStore.readAll).toHaveBeenCalledOnce();
    expect(mockController.start).toHaveBeenCalledOnce();
    expect(mockOrchestrator.execute).toHaveBeenCalledWith(params, [expect.objectContaining({ scope: 'unlink' })]);
    const readOverridesCallOrder = mockOverrideStore.readAll.mock.invocationCallOrder.at(0);
    const controllerStartCallOrder = mockController.start.mock.invocationCallOrder.at(0);

    expect(readOverridesCallOrder).toBeDefined();
    expect(controllerStartCallOrder).toBeDefined();
    expect(readOverridesCallOrder!).toBeLessThan(controllerStartCallOrder!);
  });
});
