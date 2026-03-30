import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildCliAccountLifecycleService,
  mockBuildAccountQueryPorts,
  mockCtx,
  mockDisplayCliError,
  mockGetByName,
  mockList,
  mockOutputAccountStaticDetail,
  mockOutputAccountsStaticList,
  mockOutputSuccess,
  mockRenderApp,
  mockResolveCommandProfile,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockBuildCliAccountLifecycleService: vi.fn(),
  mockBuildAccountQueryPorts: vi.fn(),
  mockCtx: {
    activeProfileKey: 'default',
    closeDatabase: vi.fn(),
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockGetByName: vi.fn(),
  mockList: vi.fn(),
  mockOutputAccountStaticDetail: vi.fn(),
  mockOutputAccountsStaticList: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
}));

const originalStdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalStdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
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

vi.mock('../../query/build-account-query-ports.js', () => ({
  buildAccountQueryPorts: mockBuildAccountQueryPorts,
}));

vi.mock('../../account-service.js', () => ({
  buildCliAccountLifecycleService: mockBuildCliAccountLifecycleService,
}));

vi.mock('../../query/account-query.js', () => ({
  AccountQuery: vi.fn().mockImplementation(function MockAccountQuery() {
    return {
      list: mockList,
    };
  }),
}));

vi.mock('../../view/accounts-view-components.jsx', () => ({
  AccountsViewApp: 'AccountsViewApp',
}));

vi.mock('../../view/accounts-static-renderer.js', () => ({
  outputAccountStaticDetail: mockOutputAccountStaticDetail,
  outputAccountsStaticList: mockOutputAccountsStaticList,
}));

import { registerAccountsCommand } from '../accounts.js';

function createAccountsProgram(): Command {
  const program = new Command();
  registerAccountsCommand(program, {} as CliAppRuntime);
  return program;
}

function createAccountSummary(overrides: Partial<ReturnType<typeof createBaseAccountSummary>> = {}) {
  return {
    ...createBaseAccountSummary(),
    ...overrides,
    childAccounts: overrides.childAccounts ?? createBaseAccountSummary().childAccounts,
  };
}

function createBaseAccountSummary() {
  return {
    id: 1,
    accountType: 'exchange-api' as const,
    platformKey: 'kraken',
    name: 'kraken-main',
    identifier: 'acct-1',
    parentAccountId: undefined,
    providerName: 'kraken-api',
    balanceProjectionStatus: 'fresh' as const,
    balanceProjectionReason: undefined,
    lastCalculatedAt: '2026-03-12T12:00:00.000Z',
    lastRefreshAt: '2026-03-12T12:30:00.000Z',
    verificationStatus: 'match' as const,
    sessionCount: 2,
    childAccounts: [
      {
        id: 2,
        accountType: 'exchange-api' as const,
        platformKey: 'kraken',
        identifier: 'acct-child',
        parentAccountId: 1,
        providerName: undefined,
        balanceProjectionStatus: 'fresh' as const,
        balanceProjectionReason: undefined,
        lastCalculatedAt: undefined,
        lastRefreshAt: undefined,
        verificationStatus: 'warning' as const,
        sessionCount: 1,
        childAccounts: undefined,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CI', '');
  setTTYFlags(true, true);
  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockCtx.closeDatabase.mockResolvedValue(undefined);
  mockCtx.exitCode = 0;
  mockBuildAccountQueryPorts.mockReturnValue({ tag: 'ports' });
  mockBuildCliAccountLifecycleService.mockReturnValue({
    getByName: mockGetByName,
  });
  mockGetByName.mockResolvedValue(
    ok({
      id: 1,
      profileId: 1,
      name: 'kraken-main',
      parentAccountId: undefined,
      accountType: 'exchange-api',
      platformKey: 'kraken',
      identifier: 'acct-1',
      providerName: 'kraken-api',
      credentials: { apiKey: 'acct-1', apiSecret: 'secret' },
      lastCursor: undefined,
      metadata: undefined,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: undefined,
    })
  );
  mockResolveCommandProfile.mockResolvedValue(
    ok({ id: 1, profileKey: 'default', displayName: 'default', createdAt: new Date('2025-01-01T00:00:00.000Z') })
  );
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

afterAll(() => {
  vi.unstubAllEnvs();
  if (originalStdinTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinTTYDescriptor);
  }

  if (originalStdoutTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutTTYDescriptor);
  }
});

describe('accounts browse commands', () => {
  it('renders the static list for the bare accounts command', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts'], {
      from: 'user',
    });

    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: undefined,
      accountType: undefined,
      platformKey: undefined,
      showSessions: undefined,
    });
    expect(mockOutputAccountsStaticList).toHaveBeenCalledOnce();
    expect(mockOutputAccountStaticDetail).not.toHaveBeenCalled();
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });

  it('renders the static detail card for the bare selector form', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'kraken-main'], {
      from: 'user',
    });

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: 1,
      accountType: undefined,
      platformKey: undefined,
      showSessions: undefined,
    });
    expect(mockOutputAccountStaticDetail).toHaveBeenCalledOnce();
    expect(mockOutputAccountsStaticList).not.toHaveBeenCalled();
    expect(mockRenderApp).not.toHaveBeenCalled();
  });

  it('outputs list JSON for the bare accounts command', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', '--json'], {
      from: 'user',
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts', {
      data: [
        {
          id: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          name: 'kraken-main',
          identifier: 'acct-1',
          parentAccountId: undefined,
          providerName: 'kraken-api',
          balanceProjectionStatus: 'fresh',
          balanceProjectionReason: undefined,
          lastCalculatedAt: '2026-03-12T12:00:00.000Z',
          lastRefreshAt: '2026-03-12T12:30:00.000Z',
          verificationStatus: 'match',
          sessionCount: 2,
          childAccounts: [
            {
              id: 2,
              identifier: 'acct-child',
              sessionCount: 1,
              balanceProjectionStatus: 'fresh',
              verificationStatus: 'warning',
            },
          ],
          sessions: undefined,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      meta: {
        count: 1,
        offset: 0,
        limit: 1,
        hasMore: false,
        filters: undefined,
      },
    });
  });

  it('outputs detail JSON for the bare selector form', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'kraken-main', '--json'], {
      from: 'user',
    });

    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts', {
      data: {
        id: 1,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        name: 'kraken-main',
        identifier: 'acct-1',
        parentAccountId: undefined,
        providerName: 'kraken-api',
        balanceProjectionStatus: 'fresh',
        balanceProjectionReason: undefined,
        lastCalculatedAt: '2026-03-12T12:00:00.000Z',
        lastRefreshAt: '2026-03-12T12:30:00.000Z',
        verificationStatus: 'match',
        sessionCount: 2,
        childAccounts: [
          {
            id: 2,
            identifier: 'acct-child',
            sessionCount: 1,
            balanceProjectionStatus: 'fresh',
            verificationStatus: 'warning',
          },
        ],
        sessions: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      meta: {
        count: 1,
        offset: 0,
        limit: 1,
        hasMore: false,
        filters: {
          accountName: 'kraken-main',
          accountId: 1,
        },
      },
    });
  });

  it('keeps the legacy list alias on the static list surface', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'list'], {
      from: 'user',
    });

    expect(mockGetByName).not.toHaveBeenCalled();
    expect(mockOutputAccountsStaticList).toHaveBeenCalledOnce();
    expect(mockOutputAccountStaticDetail).not.toHaveBeenCalled();
  });

  it('routes bare selector misses through the not-found error path', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(ok(undefined));

    await expect(program.parseAsync(['accounts', 'ghost-wallet'], { from: 'user' })).rejects.toThrow(
      "CLI:accounts:text:Account 'ghost-wallet' not found"
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('accounts', expect.any(Error), 4, 'text');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('outputs JSON results using transformed account view items', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: new Map([
          [
            1,
            [
              {
                id: 10,
                status: 'completed',
                startedAt: '2026-03-12T10:00:00.000Z',
                completedAt: '2026-03-12T10:05:00.000Z',
              },
            ],
          ],
        ]),
      })
    );

    await program.parseAsync(
      [
        'accounts',
        'view',
        '--account-id',
        '1',
        '--platform',
        'kraken',
        '--type',
        'exchange-api',
        '--show-sessions',
        '--json',
      ],
      {
        from: 'user',
      }
    );

    expect(mockBuildAccountQueryPorts).toHaveBeenCalledWith({ tag: 'db' });
    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: 1,
      accountType: 'exchange-api',
      platformKey: 'kraken',
      showSessions: true,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-view', {
      data: [
        {
          id: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          name: 'kraken-main',
          identifier: 'acct-1',
          parentAccountId: undefined,
          providerName: 'kraken-api',
          balanceProjectionStatus: 'fresh',
          balanceProjectionReason: undefined,
          lastCalculatedAt: '2026-03-12T12:00:00.000Z',
          lastRefreshAt: '2026-03-12T12:30:00.000Z',
          verificationStatus: 'match',
          sessionCount: 2,
          childAccounts: [
            {
              id: 2,
              identifier: 'acct-child',
              sessionCount: 1,
              balanceProjectionStatus: 'fresh',
              verificationStatus: 'warning',
            },
          ],
          sessions: [
            {
              id: 10,
              status: 'completed',
              startedAt: '2026-03-12T10:00:00.000Z',
              completedAt: '2026-03-12T10:05:00.000Z',
            },
          ],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      meta: {
        count: 1,
        offset: 0,
        limit: 1,
        hasMore: false,
        filters: {
          accountId: 1,
          platform: 'kraken',
          accountType: 'exchange-api',
        },
      },
    });
  });

  it('renders the TUI with computed initial state after closing the database', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();
    let renderedElement: ReactElement | undefined;

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['accounts', 'view', '--platform', 'kraken'], { from: 'user' });

    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: undefined,
      accountType: undefined,
      platformKey: 'kraken',
      showSessions: undefined,
    });
    expect(mockCtx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('AccountsViewApp');
    expect((renderedElement?.props as Record<string, unknown>)['initialState']).toEqual({
      accounts: [
        {
          id: 1,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          name: 'kraken-main',
          identifier: 'acct-1',
          parentAccountId: undefined,
          providerName: 'kraken-api',
          balanceProjectionStatus: 'fresh',
          balanceProjectionReason: undefined,
          lastCalculatedAt: '2026-03-12T12:00:00.000Z',
          lastRefreshAt: '2026-03-12T12:30:00.000Z',
          verificationStatus: 'match',
          sessionCount: 2,
          childAccounts: [
            {
              id: 2,
              identifier: 'acct-child',
              sessionCount: 1,
              balanceProjectionStatus: 'fresh',
              verificationStatus: 'warning',
            },
          ],
          sessions: undefined,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      filters: {
        platformFilter: 'kraken',
        typeFilter: undefined,
        showSessions: false,
      },
      selectedIndex: 0,
      scrollOffset: 0,
      totalCount: 1,
      typeCounts: {
        blockchain: 0,
        exchangeApi: 1,
        exchangeCsv: 0,
      },
    });
  });

  it('preselects the requested account inside the full explorer list on a tty', async () => {
    const program = createAccountsProgram();
    const firstAccount = createAccountSummary();
    const selectedAccount = createAccountSummary({
      id: 2,
      name: 'wallet-main',
      platformKey: 'bitcoin',
      identifier: 'bc1qwalletmainaddress',
    });
    let renderedElement: ReactElement | undefined;

    mockGetByName.mockResolvedValue(
      ok({
        id: 2,
        profileId: 1,
        name: 'wallet-main',
        parentAccountId: undefined,
        accountType: 'exchange-api',
        platformKey: 'bitcoin',
        identifier: 'bc1qwalletmainaddress',
        providerName: undefined,
        credentials: { apiKey: 'acct-2', apiSecret: 'secret' },
        lastCursor: undefined,
        metadata: undefined,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: undefined,
      })
    );
    mockList.mockResolvedValue(
      ok({
        accounts: [firstAccount, selectedAccount],
        count: 2,
        sessions: undefined,
      })
    );
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['accounts', 'view', 'wallet-main'], { from: 'user' });

    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: undefined,
      accountType: undefined,
      platformKey: undefined,
      showSessions: undefined,
    });
    expect(mockCtx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('AccountsViewApp');
    expect((renderedElement?.props as Record<string, unknown>)['initialState']).toMatchObject({
      selectedIndex: 1,
      scrollOffset: 1,
      totalCount: 2,
    });
  });

  it('short-circuits empty explorer state to the static renderer', async () => {
    const program = createAccountsProgram();

    mockList.mockResolvedValue(
      ok({
        accounts: [],
        count: 0,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'view'], { from: 'user' });

    expect(mockOutputAccountsStaticList).toHaveBeenCalledWith({
      accounts: [],
      filters: {
        platformFilter: undefined,
        typeFilter: undefined,
        showSessions: false,
      },
      selectedIndex: 0,
      scrollOffset: 0,
      totalCount: 0,
      typeCounts: {
        blockchain: 0,
        exchangeApi: 0,
        exchangeCsv: 0,
      },
    });
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });

  it('falls back to the static list renderer off-terminal without mounting Ink', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    setTTYFlags(true, false);
    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'view'], { from: 'user' });

    expect(mockOutputAccountsStaticList).toHaveBeenCalledOnce();
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });

  it('falls back to the static detail renderer for selector views off-terminal', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    setTTYFlags(true, false);
    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 1,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'view', 'kraken-main'], { from: 'user' });

    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: 1,
      accountType: undefined,
      platformKey: undefined,
      showSessions: undefined,
    });
    expect(mockOutputAccountStaticDetail).toHaveBeenCalledWith({
      id: 1,
      accountType: 'exchange-api',
      platformKey: 'kraken',
      name: 'kraken-main',
      identifier: 'acct-1',
      parentAccountId: undefined,
      providerName: 'kraken-api',
      balanceProjectionStatus: 'fresh',
      balanceProjectionReason: undefined,
      lastCalculatedAt: '2026-03-12T12:00:00.000Z',
      lastRefreshAt: '2026-03-12T12:30:00.000Z',
      verificationStatus: 'match',
      sessionCount: 2,
      childAccounts: [
        {
          id: 2,
          identifier: 'acct-child',
          sessionCount: 1,
          balanceProjectionStatus: 'fresh',
          verificationStatus: 'warning',
        },
      ],
      sessions: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mockOutputAccountsStaticList).not.toHaveBeenCalled();
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });

  it('resolves an account name before querying', async () => {
    const program = createAccountsProgram();
    const account = createAccountSummary();

    mockList.mockResolvedValue(
      ok({
        accounts: [account],
        count: 2,
        sessions: undefined,
      })
    );

    await program.parseAsync(['accounts', 'view', 'kraken-main', '--json'], {
      from: 'user',
    });

    expect(mockGetByName).toHaveBeenCalledWith(1, 'kraken-main');
    expect(mockList).toHaveBeenCalledWith({
      profileId: 1,
      accountId: 1,
      accountType: undefined,
      platformKey: undefined,
      showSessions: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('accounts-view', {
      data: {
        id: 1,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        name: 'kraken-main',
        identifier: 'acct-1',
        parentAccountId: undefined,
        providerName: 'kraken-api',
        balanceProjectionStatus: 'fresh',
        balanceProjectionReason: undefined,
        lastCalculatedAt: '2026-03-12T12:00:00.000Z',
        lastRefreshAt: '2026-03-12T12:30:00.000Z',
        verificationStatus: 'match',
        sessionCount: 2,
        childAccounts: [
          {
            id: 2,
            identifier: 'acct-child',
            sessionCount: 1,
            balanceProjectionStatus: 'fresh',
            verificationStatus: 'warning',
          },
        ],
        sessions: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      meta: {
        count: 1,
        offset: 0,
        limit: 1,
        hasMore: false,
        filters: {
          accountName: 'kraken-main',
          accountId: 1,
        },
      },
    });

    const payload: unknown = mockOutputSuccess.mock.calls[0]?.[1];
    expect(payload).toBeDefined();
    expect((payload as { meta?: { filters?: Record<string, unknown> } }).meta?.filters).toEqual({
      accountName: 'kraken-main',
      accountId: 1,
    });
  });

  it('routes missing accounts through the not-found error path', async () => {
    const program = createAccountsProgram();

    mockGetByName.mockResolvedValue(ok(undefined));

    await expect(program.parseAsync(['accounts', 'view', 'ghost-wallet'], { from: 'user' })).rejects.toThrow(
      "CLI:accounts-view:text:Account 'ghost-wallet' not found"
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('accounts-view', expect.any(Error), 4, 'text');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('routes conflicting account-name filters through the text error path', async () => {
    const program = createAccountsProgram();

    await expect(
      program.parseAsync(['accounts', 'view', 'kraken-main', '--platform', 'kraken'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:accounts-view:text:Account name lookup cannot be combined with --account-id, --platform, or --type'
    );

    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('routes invalid CLI options through the text error path', async () => {
    const program = createAccountsProgram();

    await expect(program.parseAsync(['accounts', 'view', '--account-id', '0'], { from: 'user' })).rejects.toThrow(
      'CLI:accounts-view:text:Too small: expected number to be >0'
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('accounts-view', expect.any(Error), 2, 'text');
    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});

function setTTYFlags(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: stdinIsTTY,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: stdoutIsTTY,
  });
}
