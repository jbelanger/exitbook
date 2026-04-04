import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { toAccountViewItem } from '../../account-view-projection.js';
import type { AccountSummary, SessionSummary } from '../../query/account-query.js';
import { buildAccountsBrowseOptionsHelpText } from '../accounts-browse-command.js';
import { registerAccountsCommand } from '../accounts.js';

function createAccountSummary(overrides: Partial<AccountSummary> = {}): AccountSummary {
  const accountId = overrides.id ?? 1;
  return {
    id: accountId,
    accountFingerprint: overrides.accountFingerprint ?? `${accountId}`.padStart(64, '0'),
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
    storedAssetCount: overrides.storedAssetCount ?? 3,
    storedBalanceStatusReason: overrides.storedBalanceStatusReason,
    storedBalanceSuggestion: overrides.storedBalanceSuggestion,
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
      accountFingerprint: '0000000000000000000000000000000000000000000000000000000000000001',
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
      storedAssetCount: 3,
      storedBalanceStatusReason: undefined,
      storedBalanceSuggestion: undefined,
      verificationStatus: 'match',
      sessionCount: 3,
      childAccounts: [
        {
          id: 2,
          accountFingerprint: '0000000000000000000000000000000000000000000000000000000000000002',
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
  it('registers the accounts namespace with browse and mutation subcommands', () => {
    const program = new Command();
    const appRuntime = {} as CliAppRuntime;

    registerAccountsCommand(program, appRuntime);

    const accountsCommand = program.commands.find((command) => command.name() === 'accounts');
    expect(accountsCommand).toBeDefined();
    expect(accountsCommand?.description()).toBe('Browse and manage accounts');
    const subcommandNames = accountsCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommandNames).toEqual(expect.arrayContaining(['add', 'view', 'refresh', 'update', 'remove']));
    expect(subcommandNames).not.toContain('rename');
  });

  it('builds browse option help text from the same source used to register browse options', () => {
    const help = buildAccountsBrowseOptionsHelpText();

    expect(help).not.toContain('Browse Options:');
    expect(help).not.toContain('--account <selector>');
    expect(help).toContain('--show-sessions');
    expect(help).toContain('Include import session details for each account');
    expect(help).toContain('--json');
    expect(help).toContain('Output JSON format');
  });

  it('documents selector usage without the removed --account flag', () => {
    const program = new Command();
    const appRuntime = {} as CliAppRuntime;

    registerAccountsCommand(program, appRuntime);

    const accountsCommand = program.commands.find((command) => command.name() === 'accounts');
    const viewCommand = accountsCommand?.commands.find((command) => command.name() === 'view');
    const output: string[] = [];

    viewCommand?.configureOutput({
      writeOut: (str) => {
        output.push(str);
      },
      writeErr: () => undefined,
    });
    viewCommand?.outputHelp();
    const help = output.join('');

    expect(help).toContain('exitbook accounts view 1a2b3c4d');
    expect(help).not.toContain('exitbook accounts view --account');
  });
});
