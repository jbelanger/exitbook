import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../../runtime/app-runtime.js';

const { mockExitCliFailure, mockOutputSuccess, mockRender, mockResolveCommandProfile, mockRunCommand, mockRunLinks } =
  vi.hoisted(() => ({
    mockExitCliFailure: vi.fn(),
    mockOutputSuccess: vi.fn(),
    mockRender: vi.fn(),
    mockResolveCommandProfile: vi.fn(),
    mockRunCommand: vi.fn(),
    mockRunLinks: vi.fn(),
  }));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../run-links.js', () => ({
  runLinks: mockRunLinks,
}));

vi.mock('../../../../../ui/shared/prompt-flow.jsx', () => ({
  PromptFlow: 'PromptFlow',
}));

vi.mock('ink', () => ({
  render: mockRender,
}));

import { registerLinksRunCommand } from '../links-run.js';

interface MockCtx {
  dataDir: string;
  database: ReturnType<typeof vi.fn>;
  onAbort: ReturnType<typeof vi.fn>;
}

function createProgram(): Command {
  const program = new Command();
  registerLinksRunCommand(program.command('links'), {
    blockchainExplorersConfig: {},
  } as CliAppRuntime);
  return program;
}

describe('links run command', () => {
  const ctx: MockCtx = {
    dataDir: '/tmp/exitbook-links-run',
    database: vi.fn(),
    onAbort: vi.fn(),
  };
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (runtime: MockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      await fn?.(ctx);
    });
    ctx.database.mockResolvedValue({ tag: 'links-db' });
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 7,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      })
    );
    mockRunLinks.mockResolvedValue(
      ok({
        confirmedLinksCount: 2,
        existingLinksCleared: 1,
        internalLinksCount: 1,
        suggestedLinksCount: 3,
        totalSaved: 5,
        totalSourceCandidates: 8,
        totalTargetCandidates: 8,
        unmatchedSourceCandidateCount: 1,
        unmatchedTargetCandidateCount: 2,
      })
    );
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockRender.mockReturnValue({ unmount: vi.fn() });
    consoleLogSpy.mockClear();
  });

  it('outputs JSON through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(
      ['links', 'run', '--min-confidence', '0.8', '--auto-confirm-threshold', '0.98', '--json'],
      { from: 'user' }
    );

    expect(mockResolveCommandProfile).toHaveBeenCalledWith(ctx, { tag: 'links-db' });
    expect(mockRunLinks).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        format: 'json',
        profileId: 7,
        profileKey: 'default',
      }),
      expect.any(Object)
    );
    const runLinksParams = mockRunLinks.mock.calls[0]?.[2] as
      | { autoConfirmThreshold: unknown; minConfidenceScore: unknown }
      | undefined;
    expect(runLinksParams?.autoConfirmThreshold).toBeDefined();
    expect(runLinksParams?.minConfidenceScore).toBeDefined();
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'links-run',
      expect.objectContaining({
        totalSaved: 5,
        suggestedLinksCount: 3,
      }),
      expect.any(Object)
    );
    const metadata = mockOutputSuccess.mock.calls[0]?.[2] as { duration_ms: number } | undefined;
    expect(metadata?.duration_ms).toEqual(expect.any(Number));
  });

  it('prints a cancellation message when the interactive prompt is cancelled', async () => {
    const program = createProgram();

    mockRender.mockImplementation((element: { props: { onCancel: () => void } }) => {
      const result = { unmount: vi.fn() };
      queueMicrotask(() => {
        element.props.onCancel();
      });
      return result;
    });

    await program.parseAsync(['links', 'run'], { from: 'user' });

    expect(mockRunLinks).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Transaction linking cancelled.');
  });

  it('routes invalid prompted thresholds through the CLI error boundary', async () => {
    const program = createProgram();

    mockRender.mockImplementation(
      (element: { props: { onComplete: (answers: [string, string, boolean]) => void } }) => {
        const result = { unmount: vi.fn() };
        queueMicrotask(() => {
          element.props.onComplete(['0.9', '0.8', true]);
        });
        return result;
      }
    );

    await expect(program.parseAsync(['links', 'run'], { from: 'user' })).rejects.toThrow(
      'CLI:links-run:text:Auto-confirm threshold must be >= minimum confidence score:2'
    );

    expect(mockRunLinks).not.toHaveBeenCalled();
    expect(mockExitCliFailure).toHaveBeenCalledWith('links-run', expect.objectContaining({ exitCode: 2 }), 'text');
  });

  it('routes runtime failures through the shared boundary', async () => {
    const program = createProgram();
    const failure = new Error('linking failed');
    mockRunLinks.mockResolvedValue(err(failure));

    await expect(program.parseAsync(['links', 'run', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:links-run:json:linking failed:1'
    );

    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'links-run',
      expect.objectContaining({ error: failure, exitCode: 1 }),
      'json'
    );
  });
});
