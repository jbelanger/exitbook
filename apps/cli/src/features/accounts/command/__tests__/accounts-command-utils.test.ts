import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPorts } from '../../query/__tests__/account-test-utils.js';
import { AccountQuery } from '../../query/account-query.js';
import type { AccountSummary, SessionSummary } from '../../query/account-query.js';
import { AccountsViewHandler } from '../accounts-view-handler.js';
import { toAccountViewItem } from '../accounts-view-utils.js';
import { registerAccountsCommand } from '../accounts.js';

function createAccountSummary(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: overrides.id ?? 1,
    accountType: overrides.accountType ?? 'exchange-api',
    sourceName: overrides.sourceName ?? 'kraken',
    identifier: overrides.identifier ?? 'acct-1',
    parentAccountId: overrides.parentAccountId,
    providerName: overrides.providerName,
    balanceProjectionStatus: overrides.balanceProjectionStatus ?? 'fresh',
    balanceProjectionReason: overrides.balanceProjectionReason,
    lastCalculatedAt: overrides.lastCalculatedAt ?? '2026-03-12T12:00:00.000Z',
    lastRefreshAt: overrides.lastRefreshAt ?? '2026-03-12T12:30:00.000Z',
    verificationStatus: overrides.verificationStatus ?? 'match',
    sessionCount: overrides.sessionCount ?? 2,
    childAccounts: overrides.childAccounts,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function createSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? 10,
    status: overrides.status ?? 'completed',
    startedAt: overrides.startedAt ?? '2026-03-12T10:00:00.000Z',
    completedAt: overrides.completedAt ?? '2026-03-12T10:05:00.000Z',
  };
}

describe('AccountsViewHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates execute to AccountQuery.list', async () => {
    const ctx = createMockPorts();
    const expected = {
      accounts: [createAccountSummary()],
      count: 1,
      sessions: undefined,
    };
    const listSpy = vi.spyOn(AccountQuery.prototype, 'list').mockResolvedValue(ok(expected));

    const handler = new AccountsViewHandler(ctx.ports);
    const result = await handler.execute({ accountId: 7, showSessions: true });

    expect(listSpy).toHaveBeenCalledWith({ accountId: 7, showSessions: true });
    expect(assertOk(result)).toEqual(expected);
  });

  it('passes query errors through unchanged', async () => {
    const ctx = createMockPorts();
    vi.spyOn(AccountQuery.prototype, 'list').mockResolvedValue(err(new Error('query failed')));

    const handler = new AccountsViewHandler(ctx.ports);
    const result = await handler.execute({});

    expect(assertErr(result).message).toBe('query failed');
  });
});

describe('toAccountViewItem', () => {
  it('maps nested child accounts and optional session details for the TUI', () => {
    const child = createAccountSummary({
      id: 2,
      identifier: 'child-2',
      sessionCount: 1,
      childAccounts: undefined,
      verificationStatus: 'warning',
    });
    const parent = createAccountSummary({
      childAccounts: [child],
      sessionCount: 3,
    });
    const sessions = new Map<number, SessionSummary[]>([[parent.id, [createSessionSummary()]]]);

    const result = toAccountViewItem(parent, sessions);

    expect(result).toEqual({
      id: 1,
      accountType: 'exchange-api',
      sourceName: 'kraken',
      identifier: 'acct-1',
      parentAccountId: undefined,
      providerName: undefined,
      balanceProjectionStatus: 'fresh',
      balanceProjectionReason: undefined,
      lastCalculatedAt: '2026-03-12T12:00:00.000Z',
      lastRefreshAt: '2026-03-12T12:30:00.000Z',
      verificationStatus: 'match',
      sessionCount: 3,
      childAccounts: [
        {
          id: 2,
          identifier: 'child-2',
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
    });
  });

  it('omits optional child and session arrays when no data is present', () => {
    const result = toAccountViewItem(createAccountSummary({ childAccounts: undefined }), undefined);

    expect(result.childAccounts).toBeUndefined();
    expect(result.sessions).toBeUndefined();
  });
});

describe('registerAccountsCommand', () => {
  it('registers the accounts namespace with the view subcommand', () => {
    const program = new Command();

    registerAccountsCommand(program);

    const accountsCommand = program.commands.find((command) => command.name() === 'accounts');
    expect(accountsCommand).toBeDefined();
    expect(accountsCommand?.description()).toBe('Manage accounts (view account information)');
    expect(accountsCommand?.commands.map((command) => command.name())).toContain('view');
  });
});
