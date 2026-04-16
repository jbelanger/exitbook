import { describe, expect, it } from 'vitest';

import { createMockGapAnalysis, createMockLinksBatch } from '../../__tests__/test-utils.js';
import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import { buildLinkGapRef, buildLinkProposalRef } from '../../link-selector.js';
import {
  buildLinkGapStaticDetail,
  buildLinkGapsStaticList,
  buildLinkProposalStaticDetail,
  buildLinksStaticList,
} from '../links-static-renderer.js';
import { createGapsViewState, createLinksViewState } from '../links-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

describe('links static renderer', () => {
  it('labels proposal rows with LINK-REF and detail with Link ref', () => {
    const state = createLinksViewState(createMockLinksBatch());
    const items = state.proposals.map((proposal) => ({
      proposal,
      proposalRef: buildLinkProposalRef(proposal.proposalKey),
    }));

    const listOutput = buildLinksStaticList(state, items);
    const detailOutput = buildLinkProposalStaticDetail(items[0]!, false);

    expect(stripAnsi(listOutput)).toContain('LINK-REF');
    expect(stripAnsi(detailOutput)).toContain(`Link ref: ${items[0]!.proposalRef}`);
  });

  it('shows user provenance in detail output and summarizes single-status headers with proposal and leg counts', () => {
    const links = createMockLinksBatch(1).slice(0, 1);
    links[0] = {
      ...links[0]!,
      link: {
        ...links[0]!.link,
        metadata: {
          linkProvenance: 'user',
          overrideId: 'override-1',
          overrideLinkType: 'transfer',
        },
      },
    };

    const state = createLinksViewState(links);
    const items = state.proposals.map((proposal) => ({
      proposal,
      proposalRef: buildLinkProposalRef(proposal.proposalKey),
    }));

    const listOutput = buildLinksStaticList(state, items);
    const detailOutput = buildLinkProposalStaticDetail(items[0]!, false);

    expect(stripAnsi(listOutput)).not.toContain('ORIGIN');
    expect(stripAnsi(listOutput)).toContain('1 confirmed proposal (1 leg; 1 user)');
    expect(stripAnsi(detailOutput)).toContain('Provenance: user');
    expect(stripAnsi(detailOutput)).toContain('Provenance detail: 1 user-reviewed leg · 1 override · transfer type');
  });

  it('shows filtered headers with proposals as the primary unit and legs in parentheses', () => {
    const links = createMockLinksBatch(2).slice(0, 2);
    links[0] = {
      ...links[0]!,
      link: {
        ...links[0]!.link,
        metadata: {
          ...(links[0]!.link.metadata ?? {}),
          linkProvenance: 'system',
        },
      },
    };
    links[1] = {
      ...links[1]!,
      link: {
        ...links[1]!.link,
        metadata: {
          ...(links[1]!.link.metadata ?? {}),
          linkProvenance: 'user',
        },
      },
    };

    const state = createLinksViewState(links, 'confirmed');
    const items = state.proposals.map((proposal) => ({
      proposal,
      proposalRef: buildLinkProposalRef(proposal.proposalKey),
    }));

    const listOutput = buildLinksStaticList(state, items);

    expect(stripAnsi(listOutput)).toContain('2 confirmed proposals (2 legs; 1 system, 1 user)');
  });

  it('uses the same summary when the visible result set has a single status without an explicit filter', () => {
    const links = createMockLinksBatch(2).slice(0, 2);
    links[0] = {
      ...links[0]!,
      link: {
        ...links[0]!.link,
        metadata: {
          ...(links[0]!.link.metadata ?? {}),
          linkProvenance: 'system',
        },
      },
    };
    links[1] = {
      ...links[1]!,
      link: {
        ...links[1]!.link,
        metadata: {
          ...(links[1]!.link.metadata ?? {}),
          linkProvenance: 'user',
        },
      },
    };

    const state = createLinksViewState(links);
    const items = state.proposals.map((proposal) => ({
      proposal,
      proposalRef: buildLinkProposalRef(proposal.proposalKey),
    }));

    const listOutput = buildLinksStaticList(state, items);

    expect(stripAnsi(listOutput)).toContain('2 confirmed proposals (2 legs; 1 system, 1 user)');
    expect(stripAnsi(listOutput)).not.toContain('2 proposals · 2 links');
  });

  it('labels gap rows with GAP-REF and detail with Gap ref', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      gapCue: 'likely_correlated_service_swap' as const,
      contextHint: {
        kind: 'diagnostic' as const,
        code: 'classification_uncertain',
        label: 'staking withdrawal in same tx',
        message:
          'Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA that cannot be attributed to a single derived address in the current per-address projection.',
      },
    };
    const state = createGapsViewState({
      ...analysis,
      issues: [gapIssue],
    });
    const items = [
      {
        gapRef: buildLinkGapRef({
          txFingerprint: gapIssue.txFingerprint,
          assetId: gapIssue.assetId,
          direction: gapIssue.direction,
        }),
        gapIssue,
        suggestedProposalRefs: ['abc123def0'],
        transactionContext: {
          blockchainTransactionHash: 'shared-hash',
          from: 'bc1qtrackedsource',
          fromOwnership: 'tracked' as const,
          openSameHashGapRowCount: 4,
          openSameHashTransactionRefs: ['0436b78ccb', '029c7fa342', 'd7cf981709', 'efe42f1f51'],
          to: '3J11externaldest',
          toOwnership: 'untracked' as const,
        },
        transactionGapCount: 1,
        transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
      },
    ];

    const listOutput = buildLinkGapsStaticList(state, items);
    const detailOutput = buildLinkGapStaticDetail(items[0]!);

    expect(stripAnsi(listOutput)).toContain('GAP-REF');
    expect(stripAnsi(listOutput)).toContain('likely correlated service swap');
    expect(stripAnsi(listOutput)).toContain('staking withdrawal in same tx');
    expect(stripAnsi(detailOutput)).toContain(`Gap ref: ${items[0]!.gapRef}`);
    expect(stripAnsi(detailOutput)).toContain(`Transaction ref: ${items[0]!.transactionRef}`);
    expect(stripAnsi(detailOutput)).toContain('Blockchain hash: shared-hash');
    expect(stripAnsi(detailOutput)).toContain('From: bc1qtrackedsource');
    expect(stripAnsi(detailOutput)).toContain('To: 3J11externaldest');
    expect(stripAnsi(detailOutput)).toContain('Ownership: tracked source -> untracked destination');
    expect(stripAnsi(detailOutput)).toContain('Open same-hash gap rows: 4');
    expect(stripAnsi(detailOutput)).toContain('Open same-hash tx refs: 0436b78ccb, 029c7fa342, d7cf981709, efe42f1f51');
    expect(stripAnsi(detailOutput)).toContain('Cue: likely correlated service swap');
    expect(stripAnsi(detailOutput)).toContain(
      'Context: Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA'
    );
    expect(stripAnsi(detailOutput)).toContain('Confirm: exitbook links confirm abc123def0');
    expect(stripAnsi(detailOutput)).toContain('Next: exitbook links confirm abc123def0');
  });

  it('shows resolution overrides in the gaps empty state', () => {
    const analysis = createMockGapAnalysis();
    const state = createGapsViewState(
      {
        ...analysis,
        issues: [],
      },
      {
        hiddenResolvedIssueCount: 2,
      }
    );

    const output = buildLinkGapsStaticList(state, []);

    expect(stripAnsi(output)).toContain('2 resolved gap exceptions hidden');
    expect(stripAnsi(output)).toContain('No open gaps. 2 resolved gap exceptions are hidden.');
  });
});
