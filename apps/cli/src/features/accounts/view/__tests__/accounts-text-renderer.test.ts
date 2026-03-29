import { describe, expect, it } from 'vitest';

import { buildAccountsTextSnapshot } from '../accounts-text-renderer.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

describe('buildAccountsTextSnapshot', () => {
  it('renders the header and list rows without TUI chrome', () => {
    const output = buildAccountsTextSnapshot({
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

    expect(stripAnsi(output)).toContain('\nAccounts (kraken) 1 total · 1 exchange-api\n');
    expect(stripAnsi(output)).toContain('#1 kraken');
    expect(stripAnsi(output)).toContain('kraken-main');
    expect(stripAnsi(output)).toContain('2 imports +1 derived');
    expect(stripAnsi(output)).toContain('proj:fresh');
    expect(stripAnsi(output)).toContain('ver:ok');
    expect(stripAnsi(output)).not.toContain('↑↓/j/k');
    expect(stripAnsi(output)).not.toContain('Identifier:');
  });

  it('renders the filtered empty state as a compact snapshot', () => {
    const output = buildAccountsTextSnapshot({
      accounts: [],
      filters: {
        platformFilter: 'kraken',
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

    expect(stripAnsi(output)).toContain('\nAccounts (kraken) 0 total\n');
    expect(stripAnsi(output)).toContain('No accounts found for kraken.');
    expect(stripAnsi(output)).not.toContain('Tip:');
  });
});
