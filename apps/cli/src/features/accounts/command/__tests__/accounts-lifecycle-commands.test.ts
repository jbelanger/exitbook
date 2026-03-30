import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { CliCommandError } from '../../../shared/cli-command-error.js';
import { ExitCodes } from '../../../shared/exit-codes.js';

const {
  mockBuildCliAccountLifecycleService,
  mockBuildCreateAccountInput,
  mockBuildUpdateAccountInput,
  mockCreate,
  mockCtx,
  mockExitCliFailure,
  mockGetByName,
  mockOutputSuccess,
  mockPrepareAccountRemoval,
  mockPromptConfirm,
  mockRename,
  mockResolveCommandProfile,
  mockRunAccountRemoval,
  mockRunCommand,
  mockUpdate,
  mockWithAccountsRemoveCommandScope,
} = vi.hoisted(() => ({
  mockBuildCliAccountLifecycleService: vi.fn(),
  mockBuildCreateAccountInput: vi.fn(),
  mockBuildUpdateAccountInput: vi.fn(),
  mockCreate: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockGetByName: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPrepareAccountRemoval: vi.fn(),
  mockPromptConfirm: vi.fn(),
  mockRename: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunAccountRemoval: vi.fn(),
  mockRunCommand: vi.fn(),
  mockUpdate: vi.fn(),
  mockWithAccountsRemoveCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../../account-service.js', () => ({
  buildCliAccountLifecycleService: mockBuildCliAccountLifecycleService,
}));

vi.mock('../account-draft-utils.js', () => ({
  buildCreateAccountInput: mockBuildCreateAccountInput,
  buildUpdateAccountInput: mockBuildUpdateAccountInput,
}));

vi.mock('../accounts-remove-command-scope.js', () => ({
  withAccountsRemoveCommandScope: mockWithAccountsRemoveCommandScope,
}));

vi.mock('../run-accounts-remove.js', () => ({
  prepareAccountRemoval: mockPrepareAccountRemoval,
  runAccountRemoval: mockRunAccountRemoval,
}));

vi.mock('../../../shared/prompts.js', () => ({
  promptConfirm: mockPromptConfirm,
}));

import { registerAccountsAddCommand } from '../accounts-add.js';
import { registerAccountsRemoveCommand } from '../accounts-remove.js';
import { registerAccountsRenameCommand } from '../accounts-rename.js';
import { registerAccountsUpdateCommand } from '../accounts-update.js';

function createAccountsProgram(): Command {
  const program = new Command();
  const accounts = program.command('accounts');
  const appRuntime = { adapterRegistry: {} } as CliAppRuntime;

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsUpdateCommand(accounts, appRuntime);
  registerAccountsRenameCommand(accounts);
  registerAccountsRemoveCommand(accounts);

  return program;
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
  mockResolveCommandProfile.mockResolvedValue(
    ok({ id: 1, profileKey: 'default', displayName: 'default', createdAt: new Date('2026-01-01T00:00:00.000Z') })
  );
  mockBuildCliAccountLifecycleService.mockReturnValue({
    create: mockCreate,
    rename: mockRename,
    getByName: mockGetByName,
    update: mockUpdate,
  });
  mockWithAccountsRemoveCommandScope.mockImplementation(
    async (
      _ctx: unknown,
      operation: (scope: {
        accountRemovalService: object;
        accountService: object;
        profile: {
          createdAt: Date;
          displayName: string;
          id: number;
          profileKey: string;
        };
      }) => Promise<unknown>
    ) =>
      operation({
        accountService: {},
        accountRemovalService: {},
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      })
  );
  mockPromptConfirm.mockResolvedValue(true);
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('accounts lifecycle commands', () => {
  it('adds an account in JSON mode', async () => {
    const program = createAccountsProgram();

    mockBuildCreateAccountInput.mockReturnValue(
      ok({
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'apikey1',
      })
    );
    mockCreate.mockResolvedValue(
      ok({
        id: 7,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'apikey1',
        providerName: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(
      [
        'accounts',
        'add',
        'kraken-main',
        '--exchange',
        'kraken',
        '--api-key',
        'apikey1',
        '--api-secret',
        'secret',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockBuildCreateAccountInput).toHaveBeenCalledWith(
      'kraken-main',
      1,
      expect.objectContaining({
        exchange: 'kraken',
        apiKey: 'apikey1',
        apiSecret: 'secret',
      }),
      {}
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'kraken-main',
        profileId: 1,
      })
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-add',
      {
        account: {
          id: 7,
          name: 'kraken-main',
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: '***',
          providerName: undefined,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        profile: 'default',
      },
      undefined
    );
  });

  it('renames an account in JSON mode', async () => {
    const program = createAccountsProgram();

    mockRename.mockResolvedValue(
      ok({
        id: 7,
        name: 'kraken-primary',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(['accounts', 'rename', 'kraken-main', 'kraken-primary', '--json'], { from: 'user' });

    expect(mockRename).toHaveBeenCalledWith(1, 'kraken-main', 'kraken-primary');
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-rename',
      {
        account: {
          id: 7,
          name: 'kraken-primary',
          platformKey: 'kraken',
        },
        profile: 'default',
      },
      undefined
    );
  });

  it('updates an account config in JSON mode', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(
      ok({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        parentAccountId: undefined,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'old-key',
        providerName: undefined,
        credentials: { apiKey: 'old-key', apiSecret: 'old-secret' },
        lastCursor: undefined,
        metadata: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: undefined,
      })
    );
    mockBuildUpdateAccountInput.mockReturnValue(
      ok({
        identifier: 'new-key',
        credentials: {
          apiKey: 'new-key',
          apiSecret: 'new-secret',
        },
        resetCursor: true,
      })
    );
    mockUpdate.mockResolvedValue(
      ok({
        id: 7,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'new-key',
        providerName: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(
      ['accounts', 'update', 'kraken-main', '--api-key', 'new-key', '--api-secret', 'new-secret', '--json'],
      { from: 'user' }
    );

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockBuildUpdateAccountInput).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        name: 'kraken-main',
      }),
      expect.objectContaining({
        apiKey: 'new-key',
        apiSecret: 'new-secret',
      }),
      {}
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      1,
      'kraken-main',
      expect.objectContaining({
        identifier: 'new-key',
        resetCursor: true,
      })
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-update',
      {
        account: {
          id: 7,
          name: 'kraken-main',
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: '***',
          providerName: undefined,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        profile: 'default',
      },
      undefined
    );
  });

  it('prints the specific fields changed during a text-mode update', async () => {
    const program = createAccountsProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mockGetByName.mockResolvedValue(
      ok({
        id: 7,
        profileId: 1,
        name: 'ethereum-main',
        parentAccountId: undefined,
        accountType: 'blockchain',
        platformKey: 'ethereum',
        identifier: '0xabc',
        providerName: undefined,
        credentials: undefined,
        lastCursor: undefined,
        metadata: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: undefined,
      })
    );
    mockBuildUpdateAccountInput.mockReturnValue(
      ok({
        providerName: 'alchemy',
      })
    );
    mockUpdate.mockResolvedValue(
      ok({
        id: 7,
        name: 'ethereum-main',
        accountType: 'blockchain',
        platformKey: 'ethereum',
        identifier: '0xabc',
        providerName: 'alchemy',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(['accounts', 'update', 'ethereum-main', '--provider', 'alchemy'], { from: 'user' });

    expect(consoleLog).toHaveBeenNthCalledWith(1, 'Updated account ethereum-main');
    expect(consoleLog).toHaveBeenNthCalledWith(2, '  Provider set to: alchemy');
    consoleLog.mockRestore();
  });

  it('routes missing accounts through the not-found update error path', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(ok(undefined));

    await expect(
      program.parseAsync(['accounts', 'update', 'ghost-wallet', '--provider', 'alchemy'], { from: 'user' })
    ).rejects.toThrow("CLI:accounts-update:text:Account 'ghost-wallet' not found:4");
    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'accounts-update',
      expect.objectContaining({ exitCode: 4 }),
      'text'
    );
  });

  it('requires --confirm for JSON account removal', async () => {
    const program = createAccountsProgram();

    await expect(program.parseAsync(['accounts', 'remove', 'kraken-main', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:accounts-remove:json:--confirm is required when using --json for destructive account removal:2'
    );

    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('preserves not-found semantics for account removal', async () => {
    const program = createAccountsProgram();

    mockPrepareAccountRemoval.mockResolvedValue(
      err(new CliCommandError("Account 'ghost-wallet' not found", ExitCodes.NOT_FOUND))
    );

    await expect(
      program.parseAsync(['accounts', 'remove', 'ghost-wallet', '--confirm'], { from: 'user' })
    ).rejects.toThrow("CLI:accounts-remove:text:Account 'ghost-wallet' not found:4");

    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'accounts-remove',
      expect.objectContaining({ exitCode: 4 }),
      'text'
    );
    expect(mockRunAccountRemoval).not.toHaveBeenCalled();
  });

  it('removes an account in JSON mode when confirmed', async () => {
    const program = createAccountsProgram();

    mockPrepareAccountRemoval.mockResolvedValue(
      ok({
        accountIds: [7],
        accountName: 'kraken-main',
        preview: {
          accounts: 1,
          rawData: 4,
          sessions: 2,
          transactions: 8,
          links: 3,
          assetReviewStates: 1,
          balanceSnapshots: 1,
          balanceSnapshotAssets: 5,
          costBasisSnapshots: 6,
        },
      })
    );
    mockRunAccountRemoval.mockResolvedValue(
      ok({
        deleted: {
          accounts: 1,
          rawData: 4,
          sessions: 2,
          transactions: 8,
          links: 3,
          assetReviewStates: 1,
          balanceSnapshots: 1,
          balanceSnapshotAssets: 5,
          costBasisSnapshots: 6,
        },
      })
    );

    await program.parseAsync(['accounts', 'remove', 'kraken-main', '--json', '--confirm'], { from: 'user' });

    expect(mockWithAccountsRemoveCommandScope).toHaveBeenCalledWith(mockCtx, expect.any(Function));
    const [prepareScope, prepareName] = mockPrepareAccountRemoval.mock.calls[0] as [
      { profile: { id: number; profileKey: string } },
      string,
    ];
    expect(prepareScope.profile).toMatchObject({ id: 1, profileKey: 'default' });
    expect(prepareName).toBe('kraken-main');

    const [removeScope, removeAccountIds] = mockRunAccountRemoval.mock.calls[0] as [
      { profile: { id: number; profileKey: string } },
      number[],
    ];
    expect(removeScope.profile).toMatchObject({ id: 1, profileKey: 'default' });
    expect(removeAccountIds).toEqual([7]);
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-remove',
      {
        accountName: 'kraken-main',
        deleted: {
          accounts: 1,
          rawData: 4,
          sessions: 2,
          transactions: 8,
          links: 3,
          assetReviewStates: 1,
          balanceSnapshots: 1,
          balanceSnapshotAssets: 5,
          costBasisSnapshots: 6,
        },
        profile: 'default',
      },
      undefined
    );
  });
});
