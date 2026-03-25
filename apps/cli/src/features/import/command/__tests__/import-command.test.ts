import type { Account, ImportSession, Profile } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildCliAccountLifecycleService,
  mockCtx,
  mockDisplayCliError,
  mockGetById,
  mockGetByName,
  mockOutputSuccess,
  mockPromptConfirm,
  mockResolveCommandProfile,
  mockRunCommand,
  mockRunImport,
} = vi.hoisted(() => ({
  mockBuildCliAccountLifecycleService: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockDisplayCliError: vi.fn(),
  mockGetById: vi.fn(),
  mockGetByName: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPromptConfirm: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunImport: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../../../accounts/account-service.js', () => ({
  buildCliAccountLifecycleService: mockBuildCliAccountLifecycleService,
}));

vi.mock('../run-import.js', () => ({
  runImport: mockRunImport,
}));

vi.mock('../../../shared/prompts.js', () => ({
  promptConfirm: mockPromptConfirm,
}));

import { ImportCommandOptionsSchema } from '../import-option-schemas.js';
import { registerImportCommand } from '../import.js';

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
    name: 'default',
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
  mockResolveCommandProfile.mockResolvedValue(ok(makeProfile()));
  mockBuildCliAccountLifecycleService.mockReturnValue({
    getById: mockGetById,
    getByName: mockGetByName,
  });
  mockRunImport.mockResolvedValue(ok({ sessions: [makeSession()], runStats: { totalRequests: 0 } }));
  mockPromptConfirm.mockResolvedValue(true);
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      if (error.message.startsWith('CLI:')) {
        throw error;
      }
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('ImportCommandOptionsSchema', () => {
  it('requires either --account or --account-id', () => {
    const result = ImportCommandOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Either --account or --account-id is required'
      );
    }
  });

  it('rejects providing both --account and --account-id', () => {
    const result = ImportCommandOptionsSchema.safeParse({
      account: 'kraken-main',
      accountId: 42,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Cannot specify both --account and --account-id'
      );
    }
  });
});

describe('import command', () => {
  it('resolves a named account and outputs JSON results', async () => {
    const program = createImportProgram();
    mockGetByName.mockResolvedValue(ok(makeAccount()));

    await program.parseAsync(['import', '--account', 'kraken-main', '--json'], { from: 'user' });

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockRunImport).toHaveBeenCalledWith(mockCtx, { isJsonMode: true }, { accountId: 7 });
    expect(mockOutputSuccess).toHaveBeenCalledOnce();

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
    mockGetById.mockResolvedValue(ok(makeAccount({ id: 42, profileId: 2, name: 'other-profile' })));

    await expect(program.parseAsync(['import', '--account-id', '42', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:import:json:Account 42 does not belong to the selected profile'
    );

    expect(mockRunImport).not.toHaveBeenCalled();
  });
});
