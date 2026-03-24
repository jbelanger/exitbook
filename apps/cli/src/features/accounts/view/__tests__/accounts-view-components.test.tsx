import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

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
    sourceName: overrides.sourceName ?? 'bitcoin',
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

    expect(frame).toContain('0 sess ✓proj !ver');
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

    expect(frame).toContain('0 sess ✓proj ?ver');
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

    expect(frame).toContain('0 sess !proj ✓ver');
    expect(frame).not.toContain('unknown');
  });
});
