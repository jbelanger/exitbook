import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { toAccountViewItem } from '../../account-view-projection.js';
import type { AccountSummary, SessionSummary } from '../../query/account-query.js';
import { registerAccountsCommand } from '../accounts.js';

function createAccountSummary(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: overrides.id ?? 1,
    accountType: overrides.accountType ?? 'exchange-api',
    platformKey: overrides.platformKey ?? 'kraken',
    name: overrides.name,
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
      platformKey: 'kraken',
      name: undefined,
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
    const appRuntime = {} as CliAppRuntime;

    registerAccountsCommand(program, appRuntime);

    const accountsCommand = program.commands.find((command) => command.name() === 'accounts');
    expect(accountsCommand).toBeDefined();
    expect(accountsCommand?.description()).toBe('Manage named accounts');
    expect(accountsCommand?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['add', 'view', 'update', 'rename', 'remove'])
    );
  });
});
