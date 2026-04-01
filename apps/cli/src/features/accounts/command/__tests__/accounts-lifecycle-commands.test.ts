import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCodes } from '../../../../cli/exit-codes.js';
import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { AccountSelectorResolutionError } from '../../account-selector.js';

const {
  mockcreateCliAccountLifecycleService,
  mockBuildCreateAccountInput,
  mockBuildUpdateAccountInput,
  mockCreate,
  mockCtx,
  mockExitCliFailure,
  mockGetByFingerprintRef,
  mockGetByName,
  mockOutputSuccess,
  mockPrepareAccountRemoval,
  mockPromptConfirmDecision,
  mockResolveCommandProfile,
  mockRunAccountRemoval,
  mockRunCommand,
  mockUpdateOwned,
  mockWithAccountsRemoveCommandScope,
} = vi.hoisted(() => ({
  mockcreateCliAccountLifecycleService: vi.fn(),
  mockBuildCreateAccountInput: vi.fn(),
  mockBuildUpdateAccountInput: vi.fn(),
  mockCreate: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockGetByFingerprintRef: vi.fn(),
  mockGetByName: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPrepareAccountRemoval: vi.fn(),
  mockPromptConfirmDecision: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunAccountRemoval: vi.fn(),
  mockRunCommand: vi.fn(),
  mockUpdateOwned: vi.fn(),
  mockWithAccountsRemoveCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../../account-service.js', () => ({
  createCliAccountLifecycleService: mockcreateCliAccountLifecycleService,
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

vi.mock('../../../../cli/prompts.js', () => ({
  promptConfirmDecision: mockPromptConfirmDecision,
}));

import { registerAccountsAddCommand } from '../accounts-add.js';
import { registerAccountsRemoveCommand } from '../accounts-remove.js';
import { registerAccountsUpdateCommand } from '../accounts-update.js';

const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

function createAccountFingerprint(id: number): string {
  return `${id}`.padStart(64, '0');
}

function createAccountsProgram(): Command {
  const program = new Command();
  const accounts = program.command('accounts');
  const appRuntime = { adapterRegistry: {} } as CliAppRuntime;

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsUpdateCommand(accounts, appRuntime);
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
  mockcreateCliAccountLifecycleService.mockReturnValue({
    create: mockCreate,
    getByFingerprintRef: mockGetByFingerprintRef,
    getByName: mockGetByName,
    updateOwned: mockUpdateOwned,
  });
  mockGetByName.mockResolvedValue(ok(undefined));
  mockGetByFingerprintRef.mockResolvedValue(ok(undefined));
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
  mockPromptConfirmDecision.mockResolvedValue('confirmed');
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
        accountFingerprint: createAccountFingerprint(7),
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
          accountFingerprint: createAccountFingerprint(7),
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

  it('prints a one-line confirmation for text-mode account adds', async () => {
    const program = createAccountsProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mockBuildCreateAccountInput.mockReturnValue(
      ok({
        profileId: 1,
        name: 'theta-wallet',
        accountType: 'blockchain',
        platformKey: 'theta',
        identifier: '0xabc',
      })
    );
    mockCreate.mockResolvedValue(
      ok({
        id: 7,
        accountFingerprint: createAccountFingerprint(7),
        name: 'theta-wallet',
        accountType: 'blockchain',
        platformKey: 'theta',
        identifier: '0xabc',
        providerName: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(['accounts', 'add', 'theta-wallet', '--blockchain', 'theta', '--address', '0xabc'], {
      from: 'user',
    });

    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLog.mock.calls[0]?.[0]).toContain('Added account theta-wallet (theta)');
    consoleLog.mockRestore();
  });

  it('updates account properties in JSON mode', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(
      ok({
        id: 7,
        profileId: 1,
        accountFingerprint: createAccountFingerprint(7),
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
        name: 'kraken-primary',
        identifier: 'new-key',
        credentials: {
          apiKey: 'new-key',
          apiSecret: 'new-secret',
        },
        resetCursor: true,
      })
    );
    mockUpdateOwned.mockResolvedValue(
      ok({
        id: 7,
        accountFingerprint: createAccountFingerprint(7),
        name: 'kraken-primary',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'new-key',
        providerName: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(
      [
        'accounts',
        'update',
        'kraken-main',
        '--name',
        'kraken-primary',
        '--api-key',
        'new-key',
        '--api-secret',
        'new-secret',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockBuildUpdateAccountInput).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        name: 'kraken-main',
      }),
      expect.objectContaining({
        name: 'kraken-primary',
        apiKey: 'new-key',
        apiSecret: 'new-secret',
      }),
      {}
    );
    expect(mockUpdateOwned).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({
        name: 'kraken-primary',
        identifier: 'new-key',
        resetCursor: true,
      })
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-update',
      {
        account: {
          id: 7,
          accountFingerprint: createAccountFingerprint(7),
          name: 'kraken-primary',
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

  it('prints the specific property changes during a text-mode update', async () => {
    const program = createAccountsProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mockGetByName.mockResolvedValue(
      ok({
        id: 7,
        profileId: 1,
        accountFingerprint: createAccountFingerprint(7),
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
        name: 'ethereum-primary',
        providerName: 'alchemy',
      })
    );
    mockUpdateOwned.mockResolvedValue(
      ok({
        id: 7,
        accountFingerprint: createAccountFingerprint(7),
        name: 'ethereum-primary',
        accountType: 'blockchain',
        platformKey: 'ethereum',
        identifier: '0xabc',
        providerName: 'alchemy',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      })
    );

    await program.parseAsync(
      ['accounts', 'update', 'ethereum-main', '--name', 'ethereum-primary', '--provider', 'alchemy'],
      {
        from: 'user',
      }
    );

    expect(consoleLog.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLog.mock.calls[0]?.[0]).toContain('Updated account ethereum-primary');
    expect(consoleLog).toHaveBeenNthCalledWith(2, 'Changes: renamed to ethereum-primary · provider set to alchemy');
    consoleLog.mockRestore();
  });

  it('routes missing accounts through the not-found update error path', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(ok(undefined));

    await expect(
      program.parseAsync(['accounts', 'update', 'ghost-wallet', '--provider', 'alchemy'], { from: 'user' })
    ).rejects.toThrow("CLI:accounts-update:text:Account selector 'ghost-wallet' not found:4");
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
      err(new AccountSelectorResolutionError('not-found', "Account selector 'ghost-wallet' not found"))
    );

    await expect(
      program.parseAsync(['accounts', 'remove', 'ghost-wallet', '--confirm'], { from: 'user' })
    ).rejects.toThrow("CLI:accounts-remove:text:Account selector 'ghost-wallet' not found:4");

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
        accountLabel: 'kraken-main',
        accountIds: [7],
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
        accountLabel: 'kraken-main',
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

  it('maps interrupted account removal prompts to cancelled exit semantics', async () => {
    const program = createAccountsProgram();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrepareAccountRemoval.mockResolvedValue(
      ok({
        accountLabel: 'kraken-main',
        accountIds: [7],
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
    mockPromptConfirmDecision.mockResolvedValue('cancelled');

    await program.parseAsync(['accounts', 'remove', 'kraken-main'], { from: 'user' });

    expect(mockRunAccountRemoval).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Account removal cancelled');
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCodes.CANCELLED);

    consoleError.mockRestore();
  });

  it('renders user-facing removal preview copy for a single-account scope', async () => {
    const program = createAccountsProgram();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrepareAccountRemoval.mockResolvedValue(
      ok({
        accountLabel: 'injective-wallet',
        accountIds: [7],
        preview: {
          accounts: 1,
          rawData: 0,
          sessions: 0,
          transactions: 0,
          links: 0,
          assetReviewStates: 0,
          balanceSnapshots: 0,
          balanceSnapshotAssets: 0,
          costBasisSnapshots: 0,
        },
      })
    );
    mockPromptConfirmDecision.mockResolvedValue('declined');

    await program.parseAsync(['accounts', 'remove', 'injective-wallet'], { from: 'user' });

    expect(consoleError).toHaveBeenCalledWith('Deleting account injective-wallet will remove:');
    expect(consoleError).toHaveBeenCalledWith('  - 1 account');
    expect(consoleError).toHaveBeenCalledWith('Account removal cancelled');
    expect(mockPromptConfirmDecision).toHaveBeenCalledWith(
      'Delete account injective-wallet and the data shown above?',
      false
    );
    expect(consoleError).not.toHaveBeenCalledWith('  - 1 account rows');
    expect(consoleError).not.toHaveBeenCalledWith('Imported data:');
    expect(consoleError).not.toHaveBeenCalledWith('Derived data to reset:');
    consoleError.mockRestore();
  });

  it('groups imported and derived removal preview details under user-facing headings', async () => {
    const program = createAccountsProgram();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrepareAccountRemoval.mockResolvedValue(
      ok({
        accountLabel: 'kraken-main',
        accountIds: [7],
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
    mockPromptConfirmDecision.mockResolvedValue('declined');

    await program.parseAsync(['accounts', 'remove', 'kraken-main'], { from: 'user' });

    expect(consoleError).toHaveBeenCalledWith('Imported data:');
    expect(consoleError).toHaveBeenCalledWith('  - 2 import sessions');
    expect(consoleError).toHaveBeenCalledWith('  - 4 raw import data items');
    expect(consoleError).toHaveBeenCalledWith('Derived data:');
    expect(consoleError).toHaveBeenCalledWith('  - 8 transactions');
    expect(consoleError).toHaveBeenCalledWith('  - 3 transaction links');
    expect(consoleError).toHaveBeenCalledWith('  - 1 review item');
    expect(consoleError).toHaveBeenCalledWith('  - 6 balances');
    expect(consoleError).toHaveBeenCalledWith('  - 6 cost basis snapshots');
    expect(consoleError).not.toHaveBeenCalledWith('  - 1 balance snapshot');
    expect(consoleError).not.toHaveBeenCalledWith('  - 5 balance snapshot assets');
    consoleError.mockRestore();
  });
});
