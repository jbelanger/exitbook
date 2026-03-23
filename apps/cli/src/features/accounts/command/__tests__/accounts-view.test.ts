import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildAccountQueryPorts,
  mockCtx,
  mockDisplayCliError,
  mockList,
  mockOutputSuccess,
  mockRenderApp,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockBuildAccountQueryPorts: vi.fn(),
  mockCtx: {
    closeDatabase: vi.fn(),
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockList: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunCommand: vi.fn(),
}));

vi.mock('../../../../runtime/command-scope.js', () => ({
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../query/build-account-query-ports.js', () => ({
  buildAccountQueryPorts: mockBuildAccountQueryPorts,
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

import { registerAccountsViewCommand } from '../accounts-view.js';

function createAccountsProgram(): Command {
  const program = new Command();
  registerAccountsViewCommand(program.command('accounts'));
  return program;
}

function createAccountSummary() {
  return {
    id: 1,
    accountType: 'exchange-api' as const,
    sourceName: 'kraken',
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
        sourceName: 'kraken',
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
  mockCtx.database.mockResolvedValue({ tag: 'db' });
  mockCtx.closeDatabase.mockResolvedValue(undefined);
  mockCtx.exitCode = 0;
  mockBuildAccountQueryPorts.mockReturnValue({ tag: 'ports' });
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('registerAccountsViewCommand', () => {
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
        '--source',
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
      accountId: 1,
      accountType: 'exchange-api',
      source: 'kraken',
      showSessions: true,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('view-accounts', {
      data: [
        {
          id: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
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
          source: 'kraken',
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

    await program.parseAsync(['accounts', 'view', '--source', 'kraken'], { from: 'user' });

    expect(mockCtx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('AccountsViewApp');
    expect((renderedElement?.props as Record<string, unknown>)['initialState']).toEqual({
      accounts: [
        {
          id: 1,
          accountType: 'exchange-api',
          sourceName: 'kraken',
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
        sourceFilter: 'kraken',
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

  it('routes invalid CLI options through the text error path', async () => {
    const program = createAccountsProgram();

    await expect(program.parseAsync(['accounts', 'view', '--account-id', '0'], { from: 'user' })).rejects.toThrow(
      'CLI:accounts-view:text:Too small: expected number to be >0'
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('accounts-view', expect.any(Error), 2, 'text');
    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});
