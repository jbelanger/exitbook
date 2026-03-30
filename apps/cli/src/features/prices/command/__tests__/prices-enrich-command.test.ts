/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-boundary mocks intentionally use partial test doubles and matcher objects. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockRunCommand,
  mockRunPricesEnrich,
  mockWithPricesEnrichCommandScope,
} = vi.hoisted(() => ({
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunPricesEnrich: vi.fn(),
  mockWithPricesEnrichCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../prices-enrich-command-scope.js', () => ({
  withPricesEnrichCommandScope: mockWithPricesEnrichCommandScope,
}));

vi.mock('../run-prices-enrich.js', () => ({
  runPricesEnrich: mockRunPricesEnrich,
}));

import { registerPricesEnrichCommand } from '../prices-enrich.js';

function createProgram(): Command {
  const program = new Command();
  const prices = program.command('prices');
  registerPricesEnrichCommand(prices, {} as CliAppRuntime);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
    const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
    await fn?.(mockCtx);
    if (!fn) {
      throw new Error('Missing runCommand callback');
    }
  });
  mockWithPricesEnrichCommandScope.mockImplementation(async (_ctx, operation) =>
    operation({
      accountingExclusionPolicy: { tag: 'policy' },
      database: { tag: 'db' },
      profile: {
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      runtime: mockCtx,
    })
  );
  mockRunPricesEnrich.mockResolvedValue(
    ok({
      stageOrder: ['derive', 'normalize'],
      stageTotals: {
        derive: { processed: 2, updated: 1 },
        normalize: { processed: 1, updated: 1 },
      },
    })
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('prices enrich command', () => {
  it('outputs JSON results through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['prices', 'enrich', '--asset', 'BTC', '--json'], { from: 'user' });

    expect(mockRunPricesEnrich).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { format: 'json' },
      {
        asset: ['BTC'],
        deriveOnly: undefined,
        fetchOnly: undefined,
        normalizeOnly: undefined,
        onMissing: undefined,
      }
    );
    expect(mockOutputSuccess).toHaveBeenCalledOnce();
  });

  it('stays silent on successful text-mode execution', async () => {
    const program = createProgram();

    await program.parseAsync(['prices', 'enrich', '--derive-only'], { from: 'user' });

    expect(mockOutputSuccess).not.toHaveBeenCalled();
    expect(mockExitCliFailure).not.toHaveBeenCalled();
  });

  it('routes scope failures through the shared boundary', async () => {
    const program = createProgram();

    mockWithPricesEnrichCommandScope.mockResolvedValue(err(new Error('Missing accounting exclusion policy')));

    await expect(program.parseAsync(['prices', 'enrich', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:prices-enrich:json:Missing accounting exclusion policy:1'
    );
  });
});
