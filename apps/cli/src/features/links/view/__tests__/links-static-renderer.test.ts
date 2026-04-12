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
    expect(stripAnsi(detailOutput)).toContain('Cue: likely correlated service swap');
    expect(stripAnsi(detailOutput)).toContain(
      'Context: Cardano transaction includes wallet-scoped staking withdrawal of 10.524451 ADA'
    );
  });
});
