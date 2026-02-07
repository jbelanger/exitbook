/**
 * Tests for links view components
 */

import type { TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { LinksViewApp } from '../links-view-components.js';
import { createLinksViewState, type LinkWithTransactions } from '../links-view-state.js';

describe('LinksViewApp', () => {
  const mockOnQuit = () => {
    /* empty */
  };

  it('renders empty state when no links', () => {
    const state = createLinksViewState([]);
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    expect(lastFrame()).toContain('No transaction links found');
    expect(lastFrame()).toContain('exitbook links run');
  });

  it('renders empty state with filter when no matching links', () => {
    const state = createLinksViewState([], 'suggested');
    state.counts = { confirmed: 3, suggested: 0, rejected: 1 }; // Simulate having other links
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    expect(lastFrame()).toContain('No suggested links found');
  });

  it('renders header with counts for all statuses', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Transaction Links');
    expect(frame).toContain('2 confirmed');
    expect(frame).toContain('1 suggested');
    expect(frame).toContain('1 rejected');
  });

  it('renders filtered header when status filter applied', () => {
    const links = createMockLinks().filter((l) => l.link.status === 'suggested');
    const state = createLinksViewState(links, 'suggested');

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Transaction Links (suggested)');
  });

  it('renders link list with proper formatting', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    // Check for link IDs (first 8 chars)
    expect(frame).toContain('link-001');
    expect(frame).toContain('link-002');

    // Check for status icons
    expect(frame).toContain('✓');
    expect(frame).toContain('⚠');
    expect(frame).toContain('✗');

    // Check for assets
    expect(frame).toContain('ETH');
    expect(frame).toContain('BTC');
  });

  it('highlights selected link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 1;

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    // Selected row should have cursor
    expect(frame).toContain('▸');
  });

  it('renders detail panel for selected link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    // Check detail panel elements
    expect(frame).toContain('Source:');
    expect(frame).toContain('Target:');
    expect(frame).toContain('Match:');
  });

  it('shows confirm/reject controls for suggested links', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 2; // suggested link

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('c confirm');
    expect(frame).toContain('r reject');
  });

  it('hides confirm/reject controls for non-suggested links', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0; // confirmed link

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).not.toContain('c confirm');
    expect(frame).not.toContain('r reject');
  });

  it('displays error message when present', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.error = 'Failed to update link status';

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Failed to update link status');
  });

  it('renders verbose address details when enabled', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links, undefined, true);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    // Should show "to" address for blockchain target
    expect(frame).toContain('to:');
    expect(frame).toContain('0x1234ABCD');
  });
});

/**
 * Create mock links for testing
 */
function createMockLinks(): LinkWithTransactions[] {
  return [
    // Confirmed link
    {
      link: createMockLink('link-001-confirmed', 'confirmed', 0.98, 'ETH', '1.5', '1.498', 1, 2),
      sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
      targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
    },
    // Another confirmed link
    {
      link: createMockLink('link-002-confirmed', 'confirmed', 0.96, 'BTC', '0.5', '0.4998', 3, 4),
      sourceTransaction: createMockTransaction(3, 'kraken', '2024-03-16T10:15:22Z'),
      targetTransaction: createMockTransaction(4, 'bitcoin', '2024-03-16T10:17:45Z'),
    },
    // Suggested link
    {
      link: createMockLink('link-003-suggested', 'suggested', 0.82, 'ETH', '2.0', '1.997', 5, 6),
      sourceTransaction: createMockTransaction(5, 'coinbase', '2024-03-17T08:30:11Z'),
      targetTransaction: createMockTransaction(6, 'ethereum', '2024-03-17T08:32:05Z'),
    },
    // Rejected link
    {
      link: createMockLink('link-004-rejected', 'rejected', 0.52, 'ETH', '3.0', '2.85', 7, 8),
      sourceTransaction: createMockTransaction(7, 'kraken', '2024-03-18T16:45:33Z'),
      targetTransaction: createMockTransaction(8, 'ethereum', '2024-03-18T17:12:15Z'),
    },
  ];
}

/**
 * Create a mock TransactionLink
 */
function createMockLink(
  id: string,
  status: 'confirmed' | 'suggested' | 'rejected',
  confidence: number,
  asset: string,
  sourceAmount: string,
  targetAmount: string,
  sourceTxId: number,
  targetTxId: number
): TransactionLink {
  return {
    id,
    sourceTransactionId: sourceTxId,
    targetTransactionId: targetTxId,
    linkType: 'exchange_to_blockchain',
    assetSymbol: asset,
    sourceAmount: new Decimal(sourceAmount),
    targetAmount: new Decimal(targetAmount),
    confidenceScore: new Decimal(confidence),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: new Decimal(0.998),
      timingValid: true,
      timingHours: 0.03,
      addressMatch: false,
    },
    status,
    reviewedBy: status !== 'suggested' ? 'user@example.com' : undefined,
    reviewedAt: status !== 'suggested' ? new Date('2024-03-20T12:00:00Z') : undefined,
    createdAt: new Date('2024-03-15T10:00:00Z'),
    updatedAt: new Date('2024-03-20T12:00:00Z'),
  };
}

/**
 * Create a mock UniversalTransactionData
 */
function createMockTransaction(id: number, source: string, datetime: string): UniversalTransactionData {
  return {
    id,
    source,
    sourceType: source === 'kraken' || source === 'coinbase' ? 'exchange' : 'blockchain',
    datetime,
    externalId: `ext-${id}`,
    from: source === 'kraken' || source === 'coinbase' ? undefined : '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234',
    to: source === 'ethereum' || source === 'bitcoin' ? '0x1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD' : undefined,
    movements: {
      inflows: [],
      outflows: [],
    },
    timestamp: 0,
    status: 'success',
    fees: [],
    operation: { type: 'transfer', category: 'transfer' },
    accountId: 0,
  };
}
