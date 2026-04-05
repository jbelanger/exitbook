import { render } from 'ink-testing-library';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AccountDetailViewItem, AccountViewItem } from '../../accounts-view-model.js';
import { AccountsViewApp } from '../accounts-view-components.jsx';
import { createAccountsAssetsViewState, createAccountsViewState } from '../accounts-view-state.js';

vi.mock('../../../../ui/shared/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../ui/shared/index.js')>(
    '../../../../ui/shared/index.js'
  );

  return {
    ...actual,
    FixedHeightDetail: ({ rows }: { rows: ReactNode[] }) => <>{rows}</>,
  };
});

const mockOnQuit = () => {
  /* empty */
};

function createAccountViewItem(overrides: Partial<AccountViewItem> = {}): AccountViewItem {
  const accountId = overrides.id ?? 1;
  return {
    id: accountId,
    accountFingerprint: overrides.accountFingerprint ?? `${accountId}`.padStart(64, '0'),
    accountType: overrides.accountType ?? 'blockchain',
    balanceProjectionStatus: overrides.balanceProjectionStatus,
    platformKey: overrides.platformKey ?? 'bitcoin',
    name: overrides.name,
    identifier: overrides.identifier ?? 'bc1qexampleaddress',
    providerName: overrides.providerName,
    lastRefreshAt: overrides.lastRefreshAt,
    verificationStatus: overrides.verificationStatus ?? 'never-checked',
    sessionCount: overrides.sessionCount ?? 0,
    childAccounts: overrides.childAccounts,
    sessions: overrides.sessions,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00.000Z',
  };
}

function createAccountDetailViewItem(overrides: Partial<AccountDetailViewItem> = {}): AccountDetailViewItem {
  const summary = createAccountViewItem(overrides);

  return {
    ...summary,
    balance: overrides.balance ?? {
      readable: true,
      scopeAccount: {
        id: summary.id,
        accountFingerprint: summary.accountFingerprint,
        accountType: summary.accountType,
        platformKey: summary.platformKey,
        identifier: summary.identifier,
        name: summary.name,
      },
      verificationStatus: 'match',
      statusReason: undefined,
      suggestion: undefined,
      lastRefreshAt: '2026-03-12T18:10:00.000Z',
      assets: [
        {
          assetId: 'btc',
          assetSymbol: 'BTC',
          calculatedBalance: '1.25',
          liveBalance: '1.25',
          comparisonStatus: 'match',
          isNegative: false,
          diagnostics: {
            txCount: 2,
            totals: {
              inflows: '1.5',
              outflows: '0.25',
              fees: '0',
              net: '1.25',
            },
          },
        },
      ],
    },
    requestedAccount: overrides.requestedAccount,
  };
}

describe('AccountsViewApp', () => {
  it('renders a single tip line in the empty state', () => {
    vi.useFakeTimers();
    const onQuit = vi.fn();
    const state = createAccountsViewState([], { showSessions: false }, 0);

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={onQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('No accounts found.');
    expect(frame).toContain('Tip: exitbook accounts add my-wallet --blockchain ethereum --address 0x...');
    expect(frame).not.toContain('Create an account first');
    expect(frame).not.toContain('q quit');
    expect(onQuit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onQuit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('renders warning verification status without falling back to unknown', () => {
    const state = createAccountsViewState(
      [createAccountViewItem({ balanceProjectionStatus: 'fresh', verificationStatus: 'warning' })],
      { showSessions: false },
      1
    );

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('0 imports proj:fresh ver:warn');
    expect(frame).not.toContain('unknown');
  });

  it('renders unavailable verification status without falling back to unknown', () => {
    const state = createAccountsViewState(
      [
        createAccountViewItem({
          balanceProjectionStatus: 'fresh',
          verificationStatus: 'unavailable',
        }),
      ],
      { showSessions: false },
      1
    );

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('0 imports proj:fresh ver:n/a');
    expect(frame).not.toContain('unknown');
  });

  it('renders projection freshness directly in the list row', () => {
    const state = createAccountsViewState(
      [
        createAccountViewItem({
          balanceProjectionStatus: 'stale',
          verificationStatus: 'match',
        }),
      ],
      { showSessions: false },
      1
    );

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('0 imports proj:stale ver:ok');
    expect(frame).not.toContain('unknown');
  });

  it('renders the account name alongside the identifier when present', () => {
    const state = createAccountsViewState(
      [
        createAccountViewItem({
          accountType: 'exchange-api',
          platformKey: 'kraken',
          name: 'kraken-main',
          identifier: 'abcdefghijk123',
          balanceProjectionStatus: 'fresh',
          verificationStatus: 'match',
        }),
      ],
      { showSessions: false },
      1
    );

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('kraken-main');
    expect(frame).toContain('abcdefghijk123');
    expect(frame).toContain('Fingerprint:');
    expect(frame).toContain('Name: kraken-main');
  });

  it('does not emit duplicate key warnings when child and session ids overlap', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = createAccountsViewState(
      [
        createAccountViewItem({
          childAccounts: [
            {
              id: 2,
              accountFingerprint: '0000000000000000000000000000000000000000000000000000000000000002',
              identifier: 'bc1qchildaddress',
              sessionCount: 1,
              balanceProjectionStatus: 'fresh',
              verificationStatus: 'warning',
            },
          ],
          sessions: [
            {
              id: 2,
              status: 'completed',
              startedAt: '2026-03-12T10:00:00.000Z',
              completedAt: '2026-03-12T10:05:00.000Z',
            },
          ],
        }),
      ],
      { showSessions: true },
      1
    );

    render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Encountered two children with the same key');
    consoleError.mockRestore();
  });

  it('renders the shared stored-balance asset drilldown when the explorer is in assets mode', () => {
    const summary = createAccountViewItem({
      accountType: 'exchange-api',
      platformKey: 'kraken',
      name: 'kraken-main',
      identifier: 'acct-1',
      balanceProjectionStatus: 'fresh',
      verificationStatus: 'match',
    });
    const parentState = createAccountsViewState([summary], { showSessions: false }, 1);
    const detail = createAccountDetailViewItem(summary);
    if (!detail.balance.readable) {
      throw new Error('Expected readable stored balance detail for asset drilldown test');
    }

    const state = createAccountsAssetsViewState(detail.balance, { parentState });

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('Balance (stored snapshot)');
    expect(frame).toContain('BTC');
    expect(frame).toContain('last verified live');
    expect(frame).toContain('Transactions: 2');
  });

  it('labels stored snapshot preview amounts as last verified live in the accounts detail panel', () => {
    const summary = createAccountViewItem({
      accountType: 'exchange-api',
      platformKey: 'kraken',
      name: 'kraken-main',
      identifier: 'acct-1',
      balanceProjectionStatus: 'fresh',
      verificationStatus: 'match',
    });
    const detail = createAccountDetailViewItem(summary);
    const state = createAccountsViewState([summary], { showSessions: false }, 1, undefined, 0, {
      [summary.id]: detail,
    });

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('Balances (1)');
    expect(frame).toContain('last verified live');
  });

  it('uses import-first unreadable balance guidance and hides internal detail labels for a new account', () => {
    const summary = createAccountViewItem({
      accountType: 'blockchain',
      platformKey: 'ethereum',
      name: 'eth1',
      identifier: '0xabc',
      balanceProjectionStatus: 'never-built',
      verificationStatus: 'never-checked',
      sessionCount: 0,
    });
    const detail = createAccountDetailViewItem({
      ...summary,
      balance: {
        readable: false,
        scopeAccount: {
          id: summary.id,
          accountFingerprint: summary.accountFingerprint,
          accountType: summary.accountType,
          platformKey: summary.platformKey,
          identifier: summary.identifier,
          name: summary.name,
        },
        reason: 'No balance data yet.',
        hint: 'run "exitbook import" to import transaction data first',
      },
    });
    const state = createAccountsViewState([summary], { showSessions: false }, 1, undefined, 0, {
      [summary.id]: detail,
    });

    const { lastFrame } = render(
      <AccountsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('Import sessions: 0');
    expect(frame).toContain('No balance data yet.');
    expect(frame).toContain('Next: run "exitbook import" to import transaction data first.');
    expect(frame).not.toContain('Stored balance snapshot is not readable');
    expect(frame).not.toContain('Verification:');
    expect(frame).not.toContain('Projection:');
  });
});
