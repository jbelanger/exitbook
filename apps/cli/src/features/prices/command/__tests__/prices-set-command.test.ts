/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-boundary mocks intentionally use partial test doubles and matcher objects. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPricesSetExecute,
  mockPricesSetFxExecute,
  mockResolveCommandProfile,
  mockRunCommand,
  mockWithCommandPriceProviderRuntime,
} = vi.hoisted(() => ({
  mockCtx: {
    dataDir: '/tmp/exitbook-test',
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPricesSetExecute: vi.fn(),
  mockPricesSetFxExecute: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockWithCommandPriceProviderRuntime: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
  withCommandPriceProviderRuntime: mockWithCommandPriceProviderRuntime,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../prices-set-handler.js', () => ({
  PricesSetHandler: class {
    execute = mockPricesSetExecute;
  },
}));

vi.mock('../prices-set-fx-handler.js', () => ({
  PricesSetFxHandler: class {
    execute = mockPricesSetFxExecute;
  },
}));

import { registerPricesSetFxCommand } from '../prices-set-fx.js';
import { registerPricesSetCommand } from '../prices-set.js';

function createProgram(): Command {
  const program = new Command();
  const prices = program.command('prices');
  registerPricesSetCommand(prices);
  registerPricesSetFxCommand(prices);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockWithCommandPriceProviderRuntime.mockImplementation(async (_ctx, _options, operation) =>
    operation({ tag: 'price-runtime' })
  );
  mockResolveCommandProfile.mockResolvedValue(
    ok({
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  );
  mockPricesSetExecute.mockResolvedValue(
    ok({
      asset: 'BTC',
      timestamp: new Date('2024-01-15T10:30:00.000Z'),
      price: '45000.5',
      currency: 'USD',
      source: 'manual-cli',
    })
  );
  mockPricesSetFxExecute.mockResolvedValue(
    ok({
      from: 'CAD',
      to: 'USD',
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      rate: '0.75',
      source: 'user-provided',
    })
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('prices set commands', () => {
  it('outputs JSON results for prices set through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(
      ['prices', 'set', '--asset', 'BTC', '--date', '2024-01-15T10:30:00Z', '--price', '45000.5', '--json'],
      { from: 'user' }
    );

    expect(mockPricesSetExecute).toHaveBeenCalledWith({
      asset: 'BTC',
      date: '2024-01-15T10:30:00Z',
      price: '45000.5',
      currency: 'USD',
      source: 'manual-cli',
      profileKey: 'default',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'prices-set',
      expect.objectContaining({
        asset: 'BTC',
        currency: 'USD',
      }),
      undefined
    );
  });

  it('routes prices set failures through the shared boundary', async () => {
    const program = createProgram();

    mockPricesSetExecute.mockResolvedValue(err(new Error('Invalid price value. Must be a valid number.')));

    await expect(
      program.parseAsync(
        ['prices', 'set', '--asset', 'BTC', '--date', '2024-01-15T10:30:00Z', '--price', 'oops', '--json'],
        { from: 'user' }
      )
    ).rejects.toThrow('CLI:prices-set:json:Invalid price value. Must be a valid number.:1');
  });

  it('outputs JSON results for prices set-fx through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(
      [
        'prices',
        'set-fx',
        '--from',
        'CAD',
        '--to',
        'USD',
        '--date',
        '2024-01-15T00:00:00Z',
        '--rate',
        '0.75',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockPricesSetFxExecute).toHaveBeenCalledWith({
      from: 'CAD',
      to: 'USD',
      date: '2024-01-15T00:00:00Z',
      rate: '0.75',
      source: 'user-provided',
      profileKey: 'default',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'prices-set-fx',
      expect.objectContaining({
        from: 'CAD',
        to: 'USD',
      }),
      undefined
    );
  });

  it('routes prices set-fx failures through the shared boundary', async () => {
    const program = createProgram();

    mockPricesSetFxExecute.mockResolvedValue(err(new Error('Source and target currencies must be different')));

    await expect(
      program.parseAsync(
        ['prices', 'set-fx', '--from', 'USD', '--to', 'USD', '--date', '2024-01-15T00:00:00Z', '--rate', '1', '--json'],
        { from: 'user' }
      )
    ).rejects.toThrow('CLI:prices-set-fx:json:Source and target currencies must be different:1');
  });
});
