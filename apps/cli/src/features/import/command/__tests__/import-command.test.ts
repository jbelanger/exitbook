/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import type { Account, ImportSession, Profile } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { ExitCodes } from '../../../shared/exit-codes.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPromptConfirmDecision,
  mockResolveImportAccount,
  mockRunCommand,
  mockRunImport,
  mockRunImportAll,
  mockWithImportCommandScope,
} = vi.hoisted(() => ({
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPromptConfirmDecision: vi.fn(),
  mockResolveImportAccount: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunImport: vi.fn(),
  mockRunImportAll: vi.fn(),
  mockWithImportCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../import-command-scope.js', () => ({
  withImportCommandScope: mockWithImportCommandScope,
}));

vi.mock('../run-import.js', async () => {
  const actual = await vi.importActual<typeof import('../run-import.js')>('../run-import.js');

  return {
    ...actual,
    resolveImportAccount: mockResolveImportAccount,
    runImport: mockRunImport,
    runImportAll: mockRunImportAll,
  };
});

vi.mock('../../../../cli/prompts.js', () => ({
  promptConfirmDecision: mockPromptConfirmDecision,
}));

import { ImportCommandOptionsSchema } from '../import-option-schemas.js';
import { registerImportCommand } from '../import.js';

const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

function createImportProgram(): Command {
  const program = new Command();
  registerImportCommand(program, {} as CliAppRuntime);
  return program;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 7,
    profileId: 1,
    name: 'kraken-main',
    accountType: 'exchange-api',
    platformKey: 'kraken',
    identifier: 'api-key-1',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    profileKey: 'default',
    displayName: 'default',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    id: 101,
    accountId: 7,
    startedAt: new Date('2026-01-03T00:00:00.000Z'),
    completedAt: new Date('2026-01-03T00:01:00.000Z'),
    status: 'completed',
    transactionsImported: 5,
    transactionsSkipped: 2,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
    const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
    await fn?.(mockCtx);
    if (!fn) {
      throw new Error('Missing runCommand callback');
    }
  });
  mockWithImportCommandScope.mockImplementation(async (_ctx, operation) =>
    operation({
      database: { tag: 'db' },
      profile: makeProfile(),
      registry: { tag: 'registry' },
      runtime: mockCtx,
    })
  );
  mockResolveImportAccount.mockResolvedValue(ok(makeAccount()));
  mockRunImport.mockResolvedValue(
    ok({
      kind: 'completed',
      result: {
        sessions: [makeSession()],
        runStats: { totalRequests: 0 },
      },
    })
  );
  mockRunImportAll.mockResolvedValue(
    ok({
      accounts: [],
      failedCount: 0,
      profileDisplayName: 'default',
      runStats: { totalRequests: 0 },
      totalCount: 0,
    })
  );
  mockPromptConfirmDecision.mockResolvedValue('confirmed');
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('ImportCommandOptionsSchema', () => {
  it('requires exactly one of --account, --account-id, or --all', () => {
    const result = ImportCommandOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Specify exactly one of --account, --account-id, or --all'
      );
    }
  });

  it('accepts --all by itself', () => {
    const result = ImportCommandOptionsSchema.safeParse({
      all: true,
    });

    expect(result.success).toBe(true);
  });

  it('rejects providing both --account and --all', () => {
    const result = ImportCommandOptionsSchema.safeParse({
      account: 'kraken-main',
      all: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Specify exactly one of --account, --account-id, or --all'
      );
    }
  });
});

describe('import command', () => {
  it('resolves an account name and outputs JSON results', async () => {
    const program = createImportProgram();

    await program.parseAsync(['import', '--account', 'kraken-main', '--json'], { from: 'user' });

    expect(mockResolveImportAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { account: 'kraken-main', json: true }
    );
    expect(mockRunImport).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { format: 'json' },
      { accountId: 7 }
    );
    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockProcessExit).not.toHaveBeenCalled();

    const [, payload] = mockOutputSuccess.mock.calls[0] as [
      string,
      {
        import: {
          account: {
            accountType: string;
            id: number;
            name?: string | undefined;
            platformKey: string;
          };
          counts: {
            imported: number;
            skipped: number;
          };
        };
      },
    ];

    expect(payload.import.account).toEqual({
      id: 7,
      name: 'kraken-main',
      accountType: 'exchange-api',
      platformKey: 'kraken',
    });
    expect(payload.import.counts).toEqual({
      imported: 5,
      skipped: 2,
    });
  });

  it('rejects an account id that belongs to another profile', async () => {
    const program = createImportProgram();
    mockResolveImportAccount.mockResolvedValue(err(new Error('Account 42 does not belong to the selected profile')));

    await expect(program.parseAsync(['import', '--account-id', '42', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:import:json:Account 42 does not belong to the selected profile:1'
    );

    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it('runs batch import for --all in JSON mode and returns partial failure status', async () => {
    const program = createImportProgram();
    mockWithImportCommandScope.mockImplementation(async (_ctx, operation) =>
      operation({
        database: { tag: 'db' },
        profile: makeProfile({ id: 3, displayName: 'business' }),
        registry: { tag: 'registry' },
        runtime: mockCtx,
      })
    );
    mockRunImportAll.mockResolvedValue(
      ok({
        accounts: [
          {
            account: {
              id: 7,
              name: 'kraken-main',
              accountType: 'exchange-api',
              platformKey: 'kraken',
            },
            counts: {
              imported: 5,
              skipped: 2,
            },
            status: 'completed',
            syncMode: 'incremental',
          },
          {
            account: {
              id: 8,
              name: 'wallet-main',
              accountType: 'blockchain',
              platformKey: 'bitcoin',
            },
            counts: {
              imported: 0,
              skipped: 0,
            },
            errorMessage: 'RPC timeout',
            status: 'failed',
            syncMode: 'resuming',
          },
        ],
        failedCount: 1,
        profileDisplayName: 'business',
        runStats: { totalRequests: 4 },
        totalCount: 2,
      })
    );

    await program.parseAsync(['import', '--all', '--json'], { from: 'user' });

    expect(mockRunImportAll).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 3, displayName: 'business' }),
      }),
      { format: 'json' }
    );
    expect(mockRunImport).not.toHaveBeenCalled();
    expect(mockResolveImportAccount).not.toHaveBeenCalled();
    expect(mockOutputSuccess).toHaveBeenCalledOnce();
    expect(mockProcessExit).toHaveBeenCalledWith(1);

    const [, payload] = mockOutputSuccess.mock.calls[0] as [
      string,
      {
        import: {
          accounts: {
            account: {
              accountType: string;
              id: number;
              name: string;
              platformKey: string;
            };
            errorMessage?: string | undefined;
            status: string;
            syncMode: string;
          }[];
          failedCount: number;
          mode: string;
          profile: string;
          totalCount: number;
        };
        status: string;
      },
    ];

    expect(payload.status).toBe('partial-failure');
    expect(payload.import.mode).toBe('batch');
    expect(payload.import.profile).toBe('business');
    expect(payload.import.failedCount).toBe(1);
    expect(payload.import.totalCount).toBe(2);
    expect(payload.import.accounts).toEqual([
      {
        account: {
          id: 7,
          name: 'kraken-main',
          accountType: 'exchange-api',
          platformKey: 'kraken',
        },
        counts: {
          imported: 5,
          skipped: 2,
        },
        errorMessage: undefined,
        status: 'completed',
        syncMode: 'incremental',
      },
      {
        account: {
          id: 8,
          name: 'wallet-main',
          accountType: 'blockchain',
          platformKey: 'bitcoin',
        },
        counts: {
          imported: 0,
          skipped: 0,
        },
        errorMessage: 'RPC timeout',
        status: 'failed',
        syncMode: 'resuming',
      },
    ]);
  });

  it('maps import cancellation to the shared cancelled exit code', async () => {
    const program = createImportProgram();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRunImport.mockResolvedValue(ok({ kind: 'cancelled' }));

    await program.parseAsync(['import', '--account', 'kraken-main'], { from: 'user' });

    expect(mockExitCliFailure).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Import cancelled by user');
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCodes.CANCELLED);

    consoleError.mockRestore();
  });
});
