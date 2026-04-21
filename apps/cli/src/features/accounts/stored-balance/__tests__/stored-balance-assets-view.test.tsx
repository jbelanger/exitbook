import { render } from 'ink-testing-library';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StoredBalanceAssetsView, type StoredBalanceAssetsExplorerState } from '../stored-balance-assets-view.jsx';

vi.mock('../../../../ui/shared/layout.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../ui/shared/layout.js')>(
    '../../../../ui/shared/layout.js'
  );

  return {
    ...actual,
    FixedHeightDetail: ({ rows }: { rows: ReactNode[] }) => <>{rows}</>,
  };
});

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createState(): StoredBalanceAssetsExplorerState {
  return {
    accountId: 42,
    accountType: 'exchange-api',
    assets: [
      {
        assetId: 'asset:btc',
        assetSymbol: 'BTC',
        calculatedBalance: '-0.25000000',
        liveBalance: '0.10000000',
        comparisonStatus: 'warning',
        isNegative: true,
        diagnostics: {
          txCount: 2,
          dateRange: {
            earliest: '2026-03-10T00:00:00.000Z',
            latest: '2026-03-12T00:00:00.000Z',
          },
          totals: {
            fees: '0.00100000',
            inflows: '0.20000000',
            net: '-0.25000000',
            outflows: '0.44900000',
          },
        },
      },
    ],
    lastRefreshAt: '2026-03-12T12:30:00.000Z',
    platformKey: 'kraken',
    scrollOffset: 0,
    selectedIndex: 0,
    statusReason: 'Provider coverage incomplete',
    suggestion: 'Run accounts refresh again',
    verificationStatus: 'warning',
  };
}

describe('StoredBalanceAssetsView', () => {
  it('renders the moved balance explorer directly with diagnostics and refresh guidance', () => {
    const { lastFrame } = render(
      <StoredBalanceAssetsView
        isDrilledDown
        state={createState()}
        terminalHeight={40}
        terminalWidth={120}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    const output = stripAnsi(frame);
    expect(output).toContain('Balance (stored snapshot)');
    expect(output).toContain('kraken #42');
    expect(output).toContain('last verification warned');
    expect(output).toContain('Transactions: 2 · 2026-03-10 to 2026-03-12');
    expect(output).toContain('Net from transactions: -0.25000000');
    expect(output).toContain('Provider coverage incomplete');
    expect(output).toContain('Suggestion: Run accounts refresh again');
    expect(output).toContain('Negative balance');
    expect(output).toContain('Last refresh:');
    expect(output).toContain('backspace back');
  });
});
