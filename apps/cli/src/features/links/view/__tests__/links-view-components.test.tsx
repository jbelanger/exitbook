/**
 * Tests for links view components
 */

import type { LinkGapAnalysis } from '@exitbook/accounting/linking';
import type { Transaction, TransactionLink } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import { buildLinkGapRef } from '../../link-selector.js';
import type { LinkWithTransactions } from '../../links-view-model.js';
import { LinksViewApp } from '../links-view-components.jsx';
import { createGapsViewState, createLinksViewState } from '../links-view-state.js';

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

    expect(lastFrame()).toContain('No link proposals found');
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

    expect(lastFrame()).toContain('No suggested proposals found');
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
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('4 proposals');
    expect(normalizedFrame).toContain('4 links');
    expect(normalizedFrame).toContain('2 confirmed');
    expect(normalizedFrame).toContain('1 suggested');
    expect(normalizedFrame).toContain('rejected');
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

    expect(frame).toContain('Link Proposals (suggested)');
    expect(frame).toContain('1 suggested proposal (1 leg; 1 system)');
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

    expect(frame).toContain('✓');
    expect(frame).toContain('⚠');
    expect(frame).toContain('✗');

    expect(frame).toContain('2024-03-15');
    expect(frame).toContain('2024-03-16');
    expect(frame).toContain('ETH');
    expect(frame).toContain('BTC');
    expect(frame).not.toContain('algorithm');
  });

  it('sorts links from oldest to newest in the table', () => {
    const state = createLinksViewState([...createMockLinks()].reverse());

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame.indexOf('2024-03-15')).toBeLessThan(frame.indexOf('2024-03-16'));
    expect(frame.indexOf('2024-03-16')).toBeLessThan(frame.indexOf('2024-03-17'));
    expect(frame.indexOf('2024-03-17')).toBeLessThan(frame.indexOf('2024-03-18'));
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

  it('shows reject controls for confirmed links', () => {
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
    expect(frame).toContain('r reject');
  });

  it('hides confirm/reject controls for rejected links', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 3; // rejected link

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

  it('explains matched amount when internal link amounts differ', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'confirmed', 1, 'BTC', '0.04399', '0.03575945', 382, 389),
          linkType: 'blockchain_internal',
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: new Decimal(1),
            timingValid: true,
            timingHours: 0,
            addressMatch: undefined,
          },
        },
        sourceTransaction: createMockTransaction(382, 'bitcoin', '2023-03-15T19:56:36.000Z'),
        targetTransaction: createMockTransaction(389, 'bitcoin', '2023-03-15T19:56:36.000Z'),
      },
    ];
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('0.0358');
    expect(frame).not.toContain('matched');
    expect(frame).toContain('2023-03-15');
    expect(frame).toContain('Change: 0.00823055 BTC');
  });

  it('shows implied fee when the linker persisted fee metadata', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'confirmed', 1, 'BTC', '0.015765', '0.01563663', 839, 807),
          impliedFeeAmount: new Decimal('0.00012837'),
          metadata: {
            variance: '0.00012837',
            variancePct: '0.81',
          },
        },
        sourceTransaction: createMockTransaction(839, 'coinbase', '2024-03-05T22:13:31.000Z'),
        targetTransaction: createMockTransaction(807, 'bitcoin', '2024-03-05T22:19:54.000Z'),
      },
    ];
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Implied fee: 0.00012837 BTC');
    expect(frame).not.toContain('Change: 0.00012837 BTC');
  });

  it('explains mixed same-hash external groups with sibling inflows', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'suggested', 1, 'BTC', '0.01092189', '0.01092189', 3955, 4289),
          linkType: 'blockchain_to_exchange',
          metadata: {
            partialMatch: true,
            fullSourceAmount: '0.01092189',
            fullTargetAmount: '0.01479224',
            consumedAmount: '0.01092189',
            sameHashExternalGroup: true,
            sameHashMixedExternalGroup: true,
            dedupedSameHashFee: '0.00017347',
            sameHashExternalGroupAmount: '0.01479224',
            sameHashExternalGroupSize: 2,
            sameHashTrackedSiblingInflowAmount: '0.00625144',
            sameHashTrackedSiblingInflowCount: 1,
            sameHashResidualAllocationPolicy: 'transaction_id_prefix',
            feeBearingSourceTransactionId: 3955,
            sameHashExternalSourceAllocations: [
              {
                sourceTransactionId: 3955,
                grossAmount: '0.01109536',
                linkedAmount: '0.01092189',
                feeDeducted: '0.00017347',
              },
              {
                sourceTransactionId: 3959,
                grossAmount: '0.01012179',
                linkedAmount: '0.00387035',
                feeDeducted: '0',
                unlinkedAmount: '0.00625144',
              },
            ],
            blockchainTxHash: '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96',
            sharedToAddress: '3BxnrjbqTVyxfvc3DdoubqBw441VbPy6jo',
          },
        },
        sourceTransaction: createMockTransaction(3955, 'bitcoin', '2024-05-31T20:17:28.000Z'),
        targetTransaction: createMockTransaction(4289, 'kucoin', '2024-05-31T20:19:17.000Z'),
      },
    ];
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('same-hash mixed group');
    expect(normalizedFrame).toContain('0.01479224 BTC to exchange');
    expect(normalizedFrame).toContain('0.00625144 BTC to 1 tracked sibl');
  });

  it('renders user provenance for user-confirmed proposals', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'confirmed', 1, 'ETH', '1.5', '1.5', 1, 2),
          metadata: {
            linkProvenance: 'user',
            overrideId: 'override-1',
            overrideLinkType: 'transfer',
          },
        },
        sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
        targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
      },
    ];
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('1 confirmed proposal (1 leg; 1 user)');
    expect(normalizedFrame).toContain('Provenance:');
    expect(normalizedFrame).toContain('user');
    expect(normalizedFrame).toContain('Provenance detail: 1 user-reviewed leg · 1 override · transfer type');
  });

  it('renders filtered confirmed headers with proposal and leg counts plus provenance split', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'confirmed', 0.98, 'ETH', '1.5', '1.498', 1, 2),
          metadata: { linkProvenance: 'system' },
        },
        sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
        targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
      },
      {
        link: {
          ...createMockLink(2, 'confirmed', 0.96, 'BTC', '0.5', '0.4998', 3, 4),
          metadata: { linkProvenance: 'user' },
        },
        sourceTransaction: createMockTransaction(3, 'kraken', '2024-03-16T10:15:22Z'),
        targetTransaction: createMockTransaction(4, 'bitcoin', '2024-03-16T10:17:45Z'),
      },
    ];
    const state = createLinksViewState(links, 'confirmed');

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('2 confirmed proposals (2 legs; 1 system, 1 user)');
  });

  it('renders the same proposal-first summary when only one status is visible without an explicit filter', () => {
    const links: LinkWithTransactions[] = [
      {
        link: {
          ...createMockLink(1, 'confirmed', 0.98, 'ETH', '1.5', '1.498', 1, 2),
          metadata: { linkProvenance: 'system' },
        },
        sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
        targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
      },
      {
        link: {
          ...createMockLink(2, 'confirmed', 0.96, 'BTC', '0.5', '0.4998', 3, 4),
          metadata: { linkProvenance: 'user' },
        },
        sourceTransaction: createMockTransaction(3, 'kraken', '2024-03-16T10:15:22Z'),
        targetTransaction: createMockTransaction(4, 'bitcoin', '2024-03-16T10:17:45Z'),
      },
    ];
    const state = createLinksViewState(links);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('2 confirmed proposals (2 legs; 1 system, 1 user)');
    expect(frame).not.toContain('2 proposals · 2 links');
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
    expect(frame).toContain('3 gaps');
    expect(frame).toContain('2 uncovered inflows');
    expect(frame).toContain('1 unmatched outflow');
    expect(frame).toContain('2 with suggestions');
    expect(frame).toContain('1 without suggestions');
  });

  it('renders top assets summary', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Top Assets:');
    expect(frame).toContain('ETH');
    expect(frame).toContain('3');
  });

  it('renders gap rows with correct formatting', () => {
    const analysis = createMockGapAnalysis();
    analysis.issues[0] = {
      ...analysis.issues[0]!,
      gapCue: 'likely_correlated_service_swap',
      contextHint: {
        kind: 'diagnostic',
        code: 'classification_uncertain',
        label: 'staking withdrawal in same tx',
        message:
          'Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA that cannot be attributed to a single derived address in the current per-address projection.',
      },
    };
    const state = createGapsViewState(analysis);
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('#2041');
    expect(normalizedFrame).toContain('#2198');
    expect(normalizedFrame).toContain('⚠');
    expect(normalizedFrame).toContain('ETH');
    expect(normalizedFrame).toContain('IN');
    expect(normalizedFrame).toContain('likely correlated service swap');
    expect(normalizedFrame).toContain('staking withdrawal in same tx');
    expect(normalizedFrame).toContain('▼ 1 more below');
  });

  it('uses scientific notation for tiny non-zero gap amounts in the row summary', () => {
    const analysis = createMockGapAnalysis();
    analysis.issues[0] = {
      ...analysis.issues[0]!,
      assetSymbol: 'INJ',
      missingAmount: '0.000000000000000001',
      totalAmount: '0.000000000000000001',
    };

    const state = createGapsViewState(analysis);
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('1.00e-18');
    expect(frame).toContain('INJ');
  });

  it('renders detail panel for selected gap', () => {
    const analysis = createMockGapAnalysis();
    analysis.issues[0] = {
      ...analysis.issues[0]!,
      gapCue: 'likely_correlated_service_swap',
      gapCueCounterpartTxFingerprint: 'solana-inflow-2',
      contextHint: {
        kind: 'diagnostic',
        code: 'classification_uncertain',
        label: 'staking withdrawal in same tx',
        message:
          'Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA that cannot be attributed to a single derived address in the current per-address projection.',
      },
    };
    const state = createGapsViewState(analysis);
    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('Gap:');
    expect(normalizedFrame).toContain('1.5');
    expect(normalizedFrame).toContain('inflow');
    expect(normalizedFrame).toContain('Readiness:');
    expect(normalizedFrame).toContain('Cue:');
    expect(normalizedFrame).toContain('likely correlated service swap');
    expect(normalizedFrame).toContain('Likely outcome:');
    expect(normalizedFrame).toContain('No direct internal transfer; inspect the counterpart, then resolve this gap');
    expect(normalizedFrame).toContain('Inspect counterpart:');
    expect(normalizedFrame).toContain('Context:');
    expect(normalizedFrame).toContain('wallet-scoped staking withdrawal of 10.524451 ADA');
  });

  it('renders shared transaction investigation context in the gap detail panel', () => {
    const analysis = createMockGapAnalysis();
    const firstIssue = analysis.issues[0]!;
    const state = createGapsViewState(
      analysis,
      {
        hiddenResolvedIssueCount: 0,
      },
      [
        {
          gapRef: buildLinkGapRef({
            txFingerprint: firstIssue.txFingerprint,
            assetId: firstIssue.assetId,
            direction: firstIssue.direction,
          }),
          gapIssue: firstIssue,
          relatedContext: {
            fromAccount: {
              accountName: 'wallet-main',
              accountRef: 'acctref1234',
              platformKey: 'ethereum',
            },
            openGapRefs: ['gap11111111'],
            sharedToTransactionCount: 2,
            sharedToTransactionRefs: ['to11111111', 'to22222222'],
          },
          transactionSnapshot: {
            blockchainTransactionHash: 'shared-hash',
            from: '0xsource',
            fromOwnership: 'owned',
            to: '0xtarget',
            toOwnership: 'unknown',
          },
          transactionGapCount: 1,
          transactionRef: formatTransactionFingerprintRef(firstIssue.txFingerprint),
        },
        ...analysis.issues.slice(1).map((gapIssue) => ({
          gapRef: buildLinkGapRef({
            txFingerprint: gapIssue.txFingerprint,
            assetId: gapIssue.assetId,
            direction: gapIssue.direction,
          }),
          gapIssue,
          transactionGapCount: 1,
          transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
        })),
      ]
    );

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('Blockchain hash:');
    expect(normalizedFrame).toContain('shared-hash');
    expect(normalizedFrame).toContain('From account:');
    expect(normalizedFrame).toContain('wallet-main');
    expect(normalizedFrame).toContain('Open gap refs:');
    expect(normalizedFrame).toContain('gap11111111');
    expect(normalizedFrame).toContain('Same to endpoint txs:');
    expect(normalizedFrame).toContain('to11111111, to22222222');
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

  it('renders bridge counterpart guidance in the gap detail panel', () => {
    const analysis = createMockGapAnalysis();
    analysis.issues[0] = {
      ...analysis.issues[0]!,
      gapCue: 'likely_cross_chain_bridge',
      gapCueCounterpartTxFingerprint: 'arb-bridge-counterpart',
      suggestedCount: 0,
    };
    const state = createGapsViewState(analysis);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    const counterpartRef = formatTransactionFingerprintRef('arb-bridge-counterpart');

    expect(normalizedFrame).toContain('likely same-owner cross-chain bridge');
    expect(normalizedFrame).toContain('Counterpart tx ref:');
    expect(normalizedFrame).toContain(counterpartRef);
    expect(normalizedFrame).toContain('exitbook transactions view');
    expect(normalizedFrame).toContain('before resolving this gap');
  });

  it('renders bridge-transfer diagnostics as resolve guidance when no counterpart is known', () => {
    const analysis = createMockGapAnalysis();
    analysis.issues[0] = {
      ...analysis.issues[0]!,
      suggestedCount: 0,
      contextHint: {
        kind: 'diagnostic',
        code: 'bridge_transfer',
        label: 'bridge transfer',
        message: 'Processed transaction carries bridge_transfer diagnostics and likely reflects bridge activity.',
      },
    };
    const state = createGapsViewState(analysis);

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('Likely outcome:');
    expect(normalizedFrame).toContain('Likely bridge or adjacent non-link activity; resolve this gap');
    expect(normalizedFrame).toContain('Context:');
    expect(normalizedFrame).toContain('bridge_transfer diagnostics');
    expect(normalizedFrame).toContain('Next:');
    expect(normalizedFrame).toContain('exitbook links gaps resolve');
    expect(normalizedFrame).toContain('Review queue:');
    expect(normalizedFrame).toContain('if no direct internal transfer exists');
  });

  it('renders resolution override empty state when all open gaps are hidden', () => {
    const state = createGapsViewState(
      {
        ...createMockGapAnalysis(),
        issues: [],
      },
      {
        hiddenResolvedIssueCount: 2,
      }
    );

    const { lastFrame } = render(
      <LinksViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();
    const normalizedFrame = frame?.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    expect(normalizedFrame).toContain('2 resolved gap exceptions hidden');
    expect(normalizedFrame).toContain('No open gaps. 2 resolved gap exceptions are hidden.');
  });
});

/**
 * Create mock links for testing
 */
function createMockLinks(): LinkWithTransactions[] {
  return [
    {
      link: createMockLink(1, 'confirmed', 0.98, 'ETH', '1.5', '1.498', 1, 2),
      sourceTransaction: createMockTransaction(1, 'kraken', '2024-03-15T14:23:41Z'),
      targetTransaction: createMockTransaction(2, 'ethereum', '2024-03-15T14:25:12Z'),
    },
    {
      link: createMockLink(2, 'confirmed', 0.96, 'BTC', '0.5', '0.4998', 3, 4),
      sourceTransaction: createMockTransaction(3, 'kraken', '2024-03-16T10:15:22Z'),
      targetTransaction: createMockTransaction(4, 'bitcoin', '2024-03-16T10:17:45Z'),
    },
    {
      link: createMockLink(3, 'suggested', 0.82, 'ETH', '2.0', '1.997', 5, 6),
      sourceTransaction: createMockTransaction(5, 'coinbase', '2024-03-17T08:30:11Z'),
      targetTransaction: createMockTransaction(6, 'ethereum', '2024-03-17T08:32:05Z'),
    },
    {
      link: createMockLink(4, 'rejected', 0.52, 'ETH', '3.0', '2.85', 7, 8),
      sourceTransaction: createMockTransaction(7, 'kraken', '2024-03-18T16:45:33Z'),
      targetTransaction: createMockTransaction(8, 'ethereum', '2024-03-18T17:12:15Z'),
    },
  ];
}

function createMockLink(
  id: number,
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
    sourceAssetId: `exchange:source:${asset.toLowerCase()}`,
    targetAssetId: `blockchain:target:${asset.toLowerCase()}`,
    sourceAmount: new Decimal(sourceAmount),
    targetAmount: new Decimal(targetAmount),
    sourceMovementFingerprint: `movement:exchange:source:${sourceTxId}:${asset.toLowerCase()}:outflow:0`,
    targetMovementFingerprint: `movement:blockchain:target:${targetTxId}:${asset.toLowerCase()}:inflow:0`,
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

function createMockTransaction(id: number, platformKey: string, datetime: string): Transaction {
  return {
    id,
    platformKey: platformKey,
    platformKind: platformKey === 'kraken' || platformKey === 'coinbase' ? 'exchange' : 'blockchain',
    datetime,
    txFingerprint: `ext-${id}`,
    from:
      platformKey === 'kraken' || platformKey === 'coinbase' ? undefined : '0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234',
    to:
      platformKey === 'ethereum' || platformKey === 'bitcoin'
        ? '0x1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD'
        : undefined,
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
        txFingerprint: 'eth-inflow-1',
        platformKey: 'ethereum',
        blockchainName: 'ethereum',
        timestamp: '2024-03-18T09:12:34Z',
        assetId: 'blockchain:ethereum:native',
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
        txFingerprint: 'eth-inflow-2',
        platformKey: 'ethereum',
        blockchainName: 'ethereum',
        timestamp: '2024-04-02T14:45:00Z',
        assetId: 'blockchain:ethereum:native',
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
        txFingerprint: 'kraken-outflow-1',
        platformKey: 'kraken',
        timestamp: '2024-05-01T16:20:00Z',
        assetId: 'exchange:kraken:eth',
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
