/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-boundary mocks intentionally use partial test doubles and matcher objects. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBenchmarkProgressBegin,
  mockBenchmarkProgressComplete,
  mockBenchmarkProgressDispose,
  mockBenchmarkProgressOnProgress,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPrepareProviderBenchmarkSession,
  mockRunCommand,
  mockRunProviderBenchmark,
  mockWithProviderBenchmarkCommandScope,
} = vi.hoisted(() => ({
  mockBenchmarkProgressBegin: vi.fn(),
  mockBenchmarkProgressComplete: vi.fn(),
  mockBenchmarkProgressDispose: vi.fn(),
  mockBenchmarkProgressOnProgress: vi.fn(),
  mockCtx: {
    onAbort: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPrepareProviderBenchmarkSession: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunProviderBenchmark: vi.fn(),
  mockWithProviderBenchmarkCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../providers-benchmark-command-scope.js', () => ({
  withProviderBenchmarkCommandScope: mockWithProviderBenchmarkCommandScope,
}));

vi.mock('../run-providers-benchmark.js', () => ({
  prepareProviderBenchmarkSession: mockPrepareProviderBenchmarkSession,
  runProviderBenchmark: mockRunProviderBenchmark,
}));

vi.mock('../providers-benchmark-text-progress.js', () => ({
  ProvidersBenchmarkTextProgress: class {
    begin = mockBenchmarkProgressBegin;
    complete = mockBenchmarkProgressComplete;
    dispose = mockBenchmarkProgressDispose;
    onProgress = mockBenchmarkProgressOnProgress;
  },
}));

import { registerProvidersBenchmarkCommand } from '../providers-benchmark.js';

function createProgram(): Command {
  const program = new Command();
  registerProvidersBenchmarkCommand(program.command('providers'), {} as CliAppRuntime);
  return program;
}

describe('providers benchmark command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      if (!fn) {
        throw new Error('Missing runCommand callback');
      }

      await fn(mockCtx);
    });
    mockWithProviderBenchmarkCommandScope.mockImplementation(async (_ctx, operation) => operation({ tag: 'scope' }));
    mockPrepareProviderBenchmarkSession.mockResolvedValue(
      ok({
        params: {
          blockchain: 'solana',
          provider: 'helius',
          maxRate: 5,
          numRequests: 10,
          skipBurst: false,
          customRates: undefined,
        },
        session: {
          provider: { name: 'helius-provider' },
        },
        providerInfo: {
          blockchain: 'solana',
          name: 'helius',
          rateLimit: { requestsPerSecond: 5 },
        },
      })
    );
    mockRunProviderBenchmark.mockResolvedValue({
      maxSafeRate: 4,
      recommended: { requestsPerSecond: 3 },
      testResults: [{ rate: 1, success: true }],
      burstLimits: [{ limit: 10, success: true }],
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('outputs JSON through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['providers', 'benchmark', '--blockchain', 'solana', '--provider', 'helius', '--json'], {
      from: 'user',
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'providers-benchmark',
      expect.objectContaining({
        blockchain: 'solana',
        provider: 'helius',
        maxSafeRate: 4,
        recommended: { requestsPerSecond: 3 },
      }),
      undefined
    );
  });

  it('runs the text-progress workflow in text mode', async () => {
    const program = createProgram();
    mockRunProviderBenchmark.mockImplementation(async (_scope, _provider, _params, onProgress) => {
      onProgress?.({ type: 'sustained-start', rate: 0.25 });
      onProgress?.({ type: 'sustained-complete', rate: 0.25, success: true, responseTimeMs: 70 });
      return {
        maxSafeRate: 4,
        recommended: { requestsPerSecond: 3 },
        testResults: [{ rate: 1, success: true }],
        burstLimits: [{ limit: 10, success: true }],
      };
    });

    await program.parseAsync(['providers', 'benchmark', '--blockchain', 'solana', '--provider', 'helius'], {
      from: 'user',
    });

    expect(mockBenchmarkProgressBegin).toHaveBeenCalledOnce();
    expect(mockBenchmarkProgressOnProgress).toHaveBeenCalledWith({ type: 'sustained-start', rate: 0.25 });
    expect(mockBenchmarkProgressOnProgress).toHaveBeenCalledWith({
      type: 'sustained-complete',
      rate: 0.25,
      success: true,
      responseTimeMs: 70,
    });
    expect(mockBenchmarkProgressComplete).toHaveBeenCalledWith({
      maxSafeRate: 4,
      recommended: { requestsPerSecond: 3 },
      testResults: [{ rate: 1, success: true }],
      burstLimits: [{ limit: 10, success: true }],
    });
    expect(mockRunProviderBenchmark).toHaveBeenCalledWith(
      { tag: 'scope' },
      { name: 'helius-provider' },
      expect.objectContaining({
        blockchain: 'solana',
        provider: 'helius',
      }),
      expect.any(Function)
    );
  });

  it('treats setup validation failures as invalid args', async () => {
    const program = createProgram();
    mockPrepareProviderBenchmarkSession.mockResolvedValue(
      err(new Error('Invalid max-rate value: "0". Must be a positive number.'))
    );

    await expect(
      program.parseAsync(
        ['providers', 'benchmark', '--blockchain', 'solana', '--provider', 'helius', '--max-rate', '0', '--json'],
        {
          from: 'user',
        }
      )
    ).rejects.toThrow('CLI:providers-benchmark:json:Invalid max-rate value: "0". Must be a positive number.:2');
  });

  it('treats benchmark execution failures as general errors in JSON mode', async () => {
    const program = createProgram();
    mockRunProviderBenchmark.mockRejectedValue(new Error('Benchmark request failed'));

    await expect(
      program.parseAsync(['providers', 'benchmark', '--blockchain', 'solana', '--provider', 'helius', '--json'], {
        from: 'user',
      })
    ).rejects.toThrow('CLI:providers-benchmark:json:Benchmark request failed:1');
  });

  it('disposes the text-progress reporter and surfaces text-mode failures', async () => {
    const program = createProgram();
    mockRunProviderBenchmark.mockRejectedValue(new Error('Benchmark request failed'));

    await expect(
      program.parseAsync(['providers', 'benchmark', '--blockchain', 'solana', '--provider', 'helius'], {
        from: 'user',
      })
    ).rejects.toThrow('CLI:providers-benchmark:text:Benchmark request failed:1');

    expect(mockBenchmarkProgressBegin).toHaveBeenCalledOnce();
    expect(mockBenchmarkProgressDispose).toHaveBeenCalledOnce();
  });
});
