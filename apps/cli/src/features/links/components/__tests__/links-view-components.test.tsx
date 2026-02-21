/**
 * Tests for links view components
 */

import type { TransactionLink } from '@exitbook/accounting';
import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import type { LinkGapAnalysis } from '../../links-gap-utils.js';
import { LinksViewApp } from '../links-view-components.js';
import { createGapsViewState, createLinksViewState, type LinkWithTransactions } from '../links-view-state.js';

describe('LinksViewApp - links mode', () => {
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
    state.counts = { confirmed: 3, suggested: 0, rejected: 1 };
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

    expect(frame).toContain('link-001');
    expect(frame).toContain('link-002');

    expect(frame).toContain('✓');
    expect(frame).toContain('⚠');
    expect(frame).toContain('✗');

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

    expect(frame).toContain('to:');
    expect(frame).toContain('0x1234ABCD');
  });
});

describe('LinksViewApp - gaps mode', () => {
  const mockOnQuit = () => {
    /* empty */
  };

  it('renders gaps header with inflow/outflow counts', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Transaction Links (gaps)');
    expect(frame).toContain('2 uncovered inflows');
    expect(frame).toContain('1 unmatched outflow');
  });

  it('renders asset breakdown', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Asset Breakdown');
    expect(frame).toContain('2 inflows missing');
    expect(frame).toContain('3.5');
    expect(frame).toContain('1 outflow unmatched for');
    expect(frame).toContain('1.2');
  });

  it('renders gap rows with correct formatting', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('#2041');
    expect(frame).toContain('#2198');
    expect(frame).toContain('#2456');
    expect(frame).toContain('⚠');
    expect(frame).toContain('ETH');
    expect(frame).toContain('IN');
    expect(frame).toContain('OUT');
  });

  it('renders detail panel for selected gap', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Missing:');
    expect(frame).toContain('1.5');
    expect(frame).toContain('inflow');
    expect(frame).toContain('Suggested matches:');
    expect(frame).toContain('Action:');
    expect(frame).toContain('exitbook links run');
  });

  it('shows "All movements have confirmed counterparties" empty state', () => {
    const emptyAnalysis: LinkGapAnalysis = {
      issues: [],
      summary: {
        total_issues: 0,
        uncovered_inflows: 0,
        unmatched_outflows: 0,
        affected_assets: 0,
        assets: [],
      },
    };
    const state = createGapsViewState(emptyAnalysis);
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('All movements have confirmed counterparties');
    expect(frame).toContain('0 uncovered inflows');
    expect(frame).toContain('0 unmatched outflows');
  });

  it('controls bar omits c/r', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).not.toContain('c confirm');
    expect(frame).not.toContain('r reject');
    expect(frame).toContain('q/esc quit');
  });

  it('renders outflow detail panel with gift action text', () => {
    const analysis = createMockGapAnalysis();
    const state = createGapsViewState(analysis);
    // Select the outflow issue (index 2)
    state.selectedIndex = 2;

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();

    // Normalize to handle text wrapping across lines
    const normalizedFrame = frame!.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    expect(normalizedFrame).toContain('may be treated as a gift');
  });
});

/**
 * Create mock links for testing
 */
function createMockLinks(): LinkWithTransactions[] {
  return [
    {
      link: createMockLink('link-001-confirmed', 'confirmed', 0.98, 'ETH', '1.5', '1.498', 1, 2),
      sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
      targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
    },
    {
      link: createMockLink('link-002-confirmed', 'confirmed', 0.96, 'BTC', '0.5', '0.4998', 3, 4),
      sourceTransaction: createMockTransaction(3, 'kraken', '2024-03-16T10:15:22Z'),
      targetTransaction: createMockTransaction(4, 'bitcoin', '2024-03-16T10:17:45Z'),
    },
    {
      link: createMockLink('link-003-suggested', 'suggested', 0.82, 'ETH', '2.0', '1.997', 5, 6),
      sourceTransaction: createMockTransaction(5, 'coinbase', '2024-03-17T08:30:11Z'),
      targetTransaction: createMockTransaction(6, 'ethereum', '2024-03-17T08:32:05Z'),
    },
    {
      link: createMockLink('link-004-rejected', 'rejected', 0.52, 'ETH', '3.0', '2.85', 7, 8),
      sourceTransaction: createMockTransaction(7, 'kraken', '2024-03-18T16:45:33Z'),
      targetTransaction: createMockTransaction(8, 'ethereum', '2024-03-18T17:12:15Z'),
    },
  ];
}

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
    assetSymbol: asset as Currency,
    sourceAssetId: `test:${asset.toLowerCase()}`,
    targetAssetId: `test:${asset.toLowerCase()}`,
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

function createMockGapAnalysis(): LinkGapAnalysis {
  return {
    issues: [
      {
        transactionId: 2041,
        externalId: 'eth-inflow-1',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-03-18T09:12:34Z',
        assetSymbol: 'ETH',
        missingAmount: '1.5',
        totalAmount: '1.5',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 2,
        highestSuggestedConfidencePercent: '82.4',
        direction: 'inflow',
      },
      {
        transactionId: 2198,
        externalId: 'eth-inflow-2',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-04-02T14:45:00Z',
        assetSymbol: 'ETH',
        missingAmount: '2.0',
        totalAmount: '2.0',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 0,
        direction: 'inflow',
      },
      {
        transactionId: 2456,
        externalId: 'kraken-outflow-1',
        source: 'kraken',
        timestamp: '2024-05-01T16:20:00Z',
        assetSymbol: 'ETH',
        missingAmount: '1.2',
        totalAmount: '1.2',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'withdrawal',
        suggestedCount: 1,
        highestSuggestedConfidencePercent: '74.8',
        direction: 'outflow',
      },
    ],
    summary: {
      total_issues: 3,
      uncovered_inflows: 2,
      unmatched_outflows: 1,
      affected_assets: 1,
      assets: [
        {
          assetSymbol: 'ETH',
          inflowOccurrences: 2,
          inflowMissingAmount: '3.5',
          outflowOccurrences: 1,
          outflowMissingAmount: '1.2',
        },
      ],
    },
  };
}
