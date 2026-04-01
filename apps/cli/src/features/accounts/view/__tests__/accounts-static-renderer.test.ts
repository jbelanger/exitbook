import { describe, expect, it } from 'vitest';

import { buildAccountStaticDetail, buildAccountsStaticList } from '../accounts-static-renderer.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');
const parentFingerprint = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const childFingerprint = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

describe('buildAccountsStaticList', () => {
  it('renders the header and list rows without TUI chrome', () => {
    const output = buildAccountsStaticList({
      accounts: [
        {
          id: 1,
          accountFingerprint: parentFingerprint,
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
              accountFingerprint: childFingerprint,
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

    expect(stripAnsi(output)).toContain('Accounts (kraken) 1 total · 1 exchange-api\n');
    expect(stripAnsi(output)).toContain('\nREF         NAME');
    expect(stripAnsi(output)).toContain('PLATFORM');
    expect(stripAnsi(output)).toContain('TYPE');
    expect(stripAnsi(output)).toContain('\n1234567890  kraken-main');
    expect(stripAnsi(output)).toContain('1234567890  kraken-main');
    expect(stripAnsi(output)).toContain('kraken');
    expect(stripAnsi(output)).not.toContain('imports');
    expect(stripAnsi(output)).not.toContain('proj:');
    expect(stripAnsi(output)).not.toContain('ver:');
    expect(stripAnsi(output)).not.toContain('derived');
    expect(stripAnsi(output).startsWith('\n')).toBe(false);
    expect(stripAnsi(output).endsWith('\n\n')).toBe(false);
    expect(stripAnsi(output)).not.toContain('↑↓/j/k');
    expect(stripAnsi(output)).not.toContain('Identifier:');
  });

  it('renders the filtered empty state as a compact static list', () => {
    const output = buildAccountsStaticList({
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

    expect(stripAnsi(output)).toContain('Accounts (kraken) 0 total\n');
    expect(stripAnsi(output)).toContain('No accounts found for kraken.');
    expect(stripAnsi(output)).not.toContain('REF');
    expect(stripAnsi(output).startsWith('\n')).toBe(false);
    expect(stripAnsi(output).endsWith('\n\n')).toBe(false);
    expect(stripAnsi(output)).not.toContain('Tip:');
  });
});

describe('buildAccountStaticDetail', () => {
  it('renders a compact detail card without TUI chrome', () => {
    const output = buildAccountStaticDetail({
      id: 1,
      accountFingerprint: parentFingerprint,
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
          accountFingerprint: childFingerprint,
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
    });

    expect(stripAnsi(output)).toContain('kraken-main 1234567890 kraken exchange-api\n');
    expect(stripAnsi(output)).toContain('Name: kraken-main');
    expect(stripAnsi(output)).toContain(`Fingerprint: ${parentFingerprint}`);
    expect(stripAnsi(output)).toContain('Identifier: acct-1');
    expect(stripAnsi(output)).toContain('Provider: kraken-api');
    expect(stripAnsi(output)).toContain('Verification: ✓ verified · Projection: ✓ fresh');
    expect(stripAnsi(output)).toContain('Derived addresses (1)');
    expect(stripAnsi(output)).toContain('abcdef1234 acct-child');
    expect(stripAnsi(output)).toContain('Recent sessions');
    expect(stripAnsi(output).startsWith('\n')).toBe(false);
    expect(stripAnsi(output).endsWith('\n\n')).toBe(false);
    expect(stripAnsi(output)).not.toContain('↑↓/j/k');
    expect(stripAnsi(output)).not.toContain('q quit');
  });
});
