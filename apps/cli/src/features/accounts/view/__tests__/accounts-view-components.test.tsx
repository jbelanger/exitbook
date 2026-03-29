import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { AccountViewItem } from '../../accounts-view-model.js';
import { AccountsViewApp } from '../accounts-view-components.jsx';
import { createAccountsViewState } from '../accounts-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

function createAccountViewItem(overrides: Partial<AccountViewItem> = {}): AccountViewItem {
  return {
    id: overrides.id ?? 1,
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
});
