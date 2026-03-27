import type { LinkingRunResult, LinkingRunParams } from '@exitbook/accounting/linking';
import type { OverrideStore } from '@exitbook/data/overrides';
import { parseDecimal } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { assertErr } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { executeCliLinkingRuntime, type CliLinkingRuntime } from '../../../../../runtime/linking-runtime.js';

const PROFILE_KEY = 'default';

describe('links run runner helpers', () => {
  let mockOrchestrator: { execute: Mock };
  let mockOverrideStore: { exists: Mock; readByScopes: Mock };
  let mockController: { abort: Mock; complete: Mock; fail: Mock; start: Mock; stop: Mock };
  let runtime: CliLinkingRuntime;

  const params: LinkingRunParams = {
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
      readByScopes: vi.fn(),
    };

    mockController = {
      abort: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    runtime = {
      orchestrator: mockOrchestrator as never,
      overrideStore: mockOverrideStore as unknown as OverrideStore,
      controller: mockController as never,
    };
  });

  it('should not start the controller when reading overrides fails', async () => {
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockResolvedValue(err(new Error('Overrides file is invalid')));

    const result = await executeCliLinkingRuntime(runtime, PROFILE_KEY, params);

    const error = assertErr(result);
    expect(error.message).toContain('Overrides file is invalid');
    expect(mockController.start).not.toHaveBeenCalled();
    expect(mockController.fail).not.toHaveBeenCalled();
    expect(mockController.stop).not.toHaveBeenCalled();
    expect(mockOrchestrator.execute).not.toHaveBeenCalled();
  });

  it('should load overrides before starting the controller', async () => {
    const linkingResult: LinkingRunResult = {
      existingLinksCleared: 2,
      internalLinksCount: 1,
      confirmedLinksCount: 3,
      suggestedLinksCount: 1,
      totalSourceCandidates: 5,
      totalTargetCandidates: 5,
      unmatchedSourceCandidateCount: 0,
      unmatchedTargetCandidateCount: 0,
      totalSaved: 4,
    };

    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockResolvedValue(
      ok([
        {
          id: 'evt-1',
          created_at: '2026-03-01T00:00:00.000Z',
          profile_key: PROFILE_KEY,
          actor: 'cli-user',
          source: 'cli',
          scope: 'unlink',
          payload: {
            type: 'unlink_override',
            resolved_link_fingerprint: 'resolved-link:v1:a:b:c:d',
          },
        },
      ])
    );
    mockOrchestrator.execute.mockResolvedValue(ok(linkingResult));

    const result = await executeCliLinkingRuntime(runtime, PROFILE_KEY, params);

    expect(result.isOk()).toBe(true);
    expect(mockOverrideStore.readByScopes).toHaveBeenCalledWith(PROFILE_KEY, ['link', 'unlink']);
    expect(mockController.start).toHaveBeenCalledOnce();
    expect(mockOrchestrator.execute).toHaveBeenCalledWith(params, [expect.objectContaining({ scope: 'unlink' })]);
    const readOverridesCallOrder = mockOverrideStore.readByScopes.mock.invocationCallOrder.at(0);
    const controllerStartCallOrder = mockController.start.mock.invocationCallOrder.at(0);

    expect(readOverridesCallOrder).toBeDefined();
    expect(controllerStartCallOrder).toBeDefined();
    expect(readOverridesCallOrder!).toBeLessThan(controllerStartCallOrder!);
  });
});
