import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildCliAccountLifecycleService,
  mockBuildNamedAccountDraft,
  mockBuildUpdatedAccountDraft,
  mockCollectHierarchy,
  mockCreateAccountRemoveHandler,
  mockCreateNamed,
  mockCtx,
  mockDisplayCliError,
  mockExecuteRemove,
  mockGetByName,
  mockOutputSuccess,
  mockPreviewRemove,
  mockPromptConfirm,
  mockRename,
  mockResolveCommandProfile,
  mockRunCommand,
  mockUpdateNamed,
} = vi.hoisted(() => ({
  mockBuildCliAccountLifecycleService: vi.fn(),
  mockBuildNamedAccountDraft: vi.fn(),
  mockBuildUpdatedAccountDraft: vi.fn(),
  mockCollectHierarchy: vi.fn(),
  mockCreateAccountRemoveHandler: vi.fn(),
  mockCreateNamed: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockDisplayCliError: vi.fn(),
  mockExecuteRemove: vi.fn(),
  mockGetByName: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPreviewRemove: vi.fn(),
  mockPromptConfirm: vi.fn(),
  mockRename: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockUpdateNamed: vi.fn(),
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

vi.mock('../../account-service.js', () => ({
  buildCliAccountLifecycleService: mockBuildCliAccountLifecycleService,
}));

vi.mock('../account-draft-utils.js', () => ({
  buildNamedAccountDraft: mockBuildNamedAccountDraft,
  buildUpdatedAccountDraft: mockBuildUpdatedAccountDraft,
}));

vi.mock('../accounts-remove-handler.js', () => ({
  createAccountRemoveHandler: mockCreateAccountRemoveHandler,
  flattenAccountRemovePreview: (preview: {
    deleted: {
      accounts: number;
      assetReview: { assets: number };
      balances: { assetRows: number; scopes: number };
      costBasisSnapshots: { snapshots: number };
      links: { links: number };
      processedTransactions: { transactions: number };
      rawData: number;
      sessions: number;
    };
  }) => ({
    accounts: preview.deleted.accounts,
    rawData: preview.deleted.rawData,
    sessions: preview.deleted.sessions,
    transactions: preview.deleted.processedTransactions.transactions,
    links: preview.deleted.links.links,
    assetReviewStates: preview.deleted.assetReview.assets,
    balanceSnapshots: preview.deleted.balances.scopes,
    balanceSnapshotAssets: preview.deleted.balances.assetRows,
    costBasisSnapshots: preview.deleted.costBasisSnapshots.snapshots,
  }),
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
    createNamed: mockCreateNamed,
    rename: mockRename,
    getByName: mockGetByName,
    collectHierarchy: mockCollectHierarchy,
    updateNamed: mockUpdateNamed,
  });
  mockCreateAccountRemoveHandler.mockReturnValue({
    preview: mockPreviewRemove,
    execute: mockExecuteRemove,
  });
  mockPromptConfirm.mockResolvedValue(true);
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('accounts lifecycle commands', () => {
  it('adds a named account in JSON mode', async () => {
    const program = createAccountsProgram();

    mockBuildNamedAccountDraft.mockReturnValue(
      ok({
        profileId: 1,
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'apikey1',
      })
    );
    mockCreateNamed.mockResolvedValue(
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

    expect(mockBuildNamedAccountDraft).toHaveBeenCalledWith(
      'kraken-main',
      1,
      expect.objectContaining({
        exchange: 'kraken',
        apiKey: 'apikey1',
        apiSecret: 'secret',
      }),
      {}
    );
    expect(mockCreateNamed).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'kraken-main',
        profileId: 1,
      })
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-add', {
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
    });
  });

  it('renames a named account in JSON mode', async () => {
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
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-rename', {
      account: {
        id: 7,
        name: 'kraken-primary',
        platformKey: 'kraken',
      },
      profile: 'default',
    });
  });

  it('updates a named account config in JSON mode', async () => {
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
    mockBuildUpdatedAccountDraft.mockReturnValue(
      ok({
        identifier: 'new-key',
        credentials: {
          apiKey: 'new-key',
          apiSecret: 'new-secret',
        },
        resetCursor: true,
      })
    );
    mockUpdateNamed.mockResolvedValue(
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
    expect(mockBuildUpdatedAccountDraft).toHaveBeenCalledWith(
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
    expect(mockUpdateNamed).toHaveBeenCalledWith(
      1,
      'kraken-main',
      expect.objectContaining({
        identifier: 'new-key',
        resetCursor: true,
      })
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-update', {
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
    });
  });

  it('requires --confirm for JSON account removal', async () => {
    const program = createAccountsProgram();

    await expect(program.parseAsync(['accounts', 'remove', 'kraken-main', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:accounts-remove:json:--confirm is required when using --json for destructive account removal'
    );

    expect(mockRunCommand).toHaveBeenCalledOnce();
  });

  it('removes a named account in JSON mode when confirmed', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(
      ok({
        id: 7,
        profileId: 1,
        name: 'kraken-main',
        parentAccountId: undefined,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'api-key-1',
        providerName: undefined,
        credentials: undefined,
        lastCursor: undefined,
        metadata: undefined,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: undefined,
      })
    );
    mockCollectHierarchy.mockResolvedValue(
      ok([
        {
          id: 7,
          profileId: 1,
          name: 'kraken-main',
          parentAccountId: undefined,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'api-key-1',
          providerName: undefined,
          credentials: undefined,
          lastCursor: undefined,
          metadata: undefined,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          updatedAt: undefined,
        },
      ])
    );
    mockPreviewRemove.mockResolvedValue(
      ok({
        accountIds: [7],
        deleted: {
          accounts: 1,
          rawData: 4,
          sessions: 2,
          processedTransactions: { transactions: 8 },
          links: { links: 3 },
          assetReview: { assets: 1 },
          balances: { scopes: 1, assetRows: 5 },
          costBasisSnapshots: { snapshots: 6 },
        },
      })
    );
    mockExecuteRemove.mockResolvedValue(
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

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockCollectHierarchy).toHaveBeenCalledWith(7);
    expect(mockPreviewRemove).toHaveBeenCalledWith([7]);
    expect(mockExecuteRemove).toHaveBeenCalledWith([7]);
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-remove', {
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
    });
  });
});
