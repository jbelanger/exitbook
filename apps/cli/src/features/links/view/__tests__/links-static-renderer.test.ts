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
        relatedContext: {
          fromAccount: {
            accountName: 'wallet-main',
            accountRef: 'acctref1234',
            platformKey: 'bitcoin',
          },
          openGapRefs: ['gap11111111', 'gap22222222'],
          sameHashSiblingTransactionCount: 4,
          sameHashSiblingTransactionRefs: ['0436b78ccb', '029c7fa342', 'd7cf981709', 'efe42f1f51'],
          sharedToTransactionCount: 2,
          sharedToTransactionRefs: ['to11111111', 'to22222222'],
        },
        transactionSnapshot: {
          blockchainTransactionHash: 'shared-hash',
          from: 'bc1qtrackedsource',
          fromOwnership: 'owned' as const,
          openSameHashGapRowCount: 4,
          openSameHashTransactionRefs: ['0436b78ccb', '029c7fa342', 'd7cf981709', 'efe42f1f51'],
          to: '3J11externaldest',
          toOwnership: 'unknown' as const,
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
    expect(stripAnsi(detailOutput)).toContain('Ownership: owned source -> unknown destination');
    expect(stripAnsi(detailOutput)).toContain('Open same-hash gap rows: 4');
    expect(stripAnsi(detailOutput)).toContain('Open same-hash tx refs: 0436b78ccb, 029c7fa342, d7cf981709, efe42f1f51');
    expect(stripAnsi(detailOutput)).toContain('Related context');
    expect(stripAnsi(detailOutput)).toContain('From account: wallet-main (acctref1234) bitcoin');
    expect(stripAnsi(detailOutput)).toContain('Open gap refs: gap11111111, gap22222222');
    expect(stripAnsi(detailOutput)).toContain('Same to endpoint txs: to11111111, to22222222');
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

  it('shows cue counterpart guidance for likely bridge gaps', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      gapCue: 'likely_cross_chain_bridge' as const,
      gapCueCounterpartTxFingerprint: 'arb-bridge-counterpart',
      suggestedCount: 0,
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(detailOutput)).toContain('Cue: likely same-owner cross-chain bridge');
    expect(stripAnsi(detailOutput)).toContain(
      `Counterpart tx ref: ${formatTransactionFingerprintRef('arb-bridge-counterpart')}`
    );
    expect(stripAnsi(detailOutput)).toContain(
      `Inspect counterpart: exitbook transactions view ${formatTransactionFingerprintRef('arb-bridge-counterpart')}`
    );
    expect(stripAnsi(detailOutput)).toContain(
      `Next: exitbook transactions view ${formatTransactionFingerprintRef('arb-bridge-counterpart')}`
    );
  });

  it('shows cue counterpart guidance for likely asset migration gaps', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      direction: 'outflow' as const,
      assetId: 'exchange:kraken:rndr',
      assetSymbol: 'RNDR',
      gapCue: 'likely_asset_migration' as const,
      gapCueCounterpartTxFingerprint: 'kraken-render-counterpart',
      suggestedCount: 0,
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const state = createGapsViewState(
      {
        ...analysis,
        issues: [gapIssue],
      },
      {
        hiddenResolvedIssueCount: 0,
      },
      [item]
    );
    const listOutput = buildLinkGapsStaticList(state, [item]);
    const detailOutput = buildLinkGapStaticDetail(item);
    const normalizedOutput = stripAnsi(detailOutput);

    expect(stripAnsi(listOutput)).toContain(
      `no suggestions yet · likely internal asset migration · counterpart ${formatTransactionFingerprintRef('kraken-render-counterpart')}`
    );
    expect(stripAnsi(listOutput)).not.toContain('possible asset migration');
    expect(normalizedOutput).toContain('Cue: likely internal asset migration');
    expect(normalizedOutput).toContain(
      `Counterpart tx ref: ${formatTransactionFingerprintRef('kraken-render-counterpart')}`
    );
    expect(normalizedOutput).toContain(
      `Create manual link: exitbook links create ${item.transactionRef} ${formatTransactionFingerprintRef('kraken-render-counterpart')} --asset ${gapIssue.assetSymbol}`
    );
    expect(normalizedOutput).toContain(
      'Likely outcome: Likely internal asset migration; inspect the counterpart, then create a manual link if basis should carry between the old and new asset.'
    );
    expect(normalizedOutput).toContain(
      `Next: exitbook links create ${item.transactionRef} ${formatTransactionFingerprintRef('kraken-render-counterpart')} --asset ${gapIssue.assetSymbol}`
    );
  });

  it('builds the manual-link command from the counterpart when viewing the inflow side of a migration gap', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      direction: 'inflow' as const,
      assetId: 'exchange:kraken:render',
      assetSymbol: 'RENDER',
      gapCue: 'likely_asset_migration' as const,
      gapCueCounterpartTxFingerprint: 'kraken-rndr-counterpart',
      suggestedCount: 0,
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);
    const normalizedOutput = stripAnsi(detailOutput);

    expect(normalizedOutput).toContain(
      `Create manual link: exitbook links create ${formatTransactionFingerprintRef('kraken-rndr-counterpart')} ${item.transactionRef} --asset ${gapIssue.assetSymbol}`
    );
    expect(normalizedOutput).toContain(
      `Next: exitbook links create ${formatTransactionFingerprintRef('kraken-rndr-counterpart')} ${item.transactionRef} --asset ${gapIssue.assetSymbol}`
    );
  });

  it('shows unmatched CoinGecko reference guidance for review-heavy token gaps', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      gapCue: 'unmatched_reference' as const,
      suggestedCount: 0,
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);
    const normalizedOutput = stripAnsi(detailOutput);

    expect(normalizedOutput).toContain('Cue: unmatched CoinGecko reference');
    expect(normalizedOutput).toContain(
      'Likely outcome: CoinGecko could not match this token to a canonical asset; inspect asset review before treating this as a normal transfer gap.'
    );
  });

  it('shows other-profile counterpart cues in the list header, readiness, and detail', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      suggestedCount: 0,
    };
    const counterpartRef = formatTransactionFingerprintRef('other-profile-inflow-1');
    const state = createGapsViewState(
      {
        ...analysis,
        issues: [gapIssue],
      },
      {
        hiddenResolvedIssueCount: 0,
      }
    );
    const item = {
      crossProfileCandidates: [
        {
          amount: '1.5',
          direction: 'outflow' as const,
          platformKey: 'solana',
          profileDisplayName: 'maely',
          profileKey: 'maely',
          secondsDeltaFromGap: -15,
          timestamp: '2024-03-18T09:12:19Z',
          transactionRef: counterpartRef,
          txFingerprint: 'other-profile-inflow-1',
        },
      ],
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const listOutput = buildLinkGapsStaticList(state, [item]);
    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(listOutput)).toContain('1 with other-profile counterpart');
    expect(stripAnsi(listOutput)).toContain('no suggestions yet · exact other-profile counterpart (maely)');
    expect(stripAnsi(detailOutput)).toContain('Cue: exact other-profile counterpart (maely)');
    expect(stripAnsi(detailOutput)).toContain(
      'Likely outcome: Tracked counterpart exists on profile maely; inspect it before treating this as a generic same-profile gap.'
    );
    expect(stripAnsi(detailOutput)).toContain(`Next: inspect ${counterpartRef} on profile maely`);
    expect(stripAnsi(detailOutput)).toContain(
      `Other-profile counterpart: maely · solana · OUT 1.5 ETH · ${counterpartRef} · 15s earlier`
    );
  });

  it('shows profile names in the generic other-profile counterpart cue label', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      suggestedCount: 0,
    };
    const item = {
      crossProfileCandidates: [
        {
          amount: '1.5',
          direction: 'outflow' as const,
          platformKey: 'solana',
          profileDisplayName: 'maely',
          profileKey: 'maely',
          secondsDeltaFromGap: -15,
          timestamp: '2024-03-18T09:12:19Z',
          transactionRef: formatTransactionFingerprintRef('other-profile-inflow-1'),
          txFingerprint: 'other-profile-inflow-1',
        },
        {
          amount: '1.5',
          direction: 'outflow' as const,
          platformKey: 'ethereum',
          profileDisplayName: 'main',
          profileKey: 'main',
          secondsDeltaFromGap: -21,
          timestamp: '2024-03-18T09:12:13Z',
          transactionRef: formatTransactionFingerprintRef('other-profile-inflow-2'),
          txFingerprint: 'other-profile-inflow-2',
        },
      ],
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };
    const state = createGapsViewState(
      {
        ...analysis,
        issues: [gapIssue],
      },
      {
        hiddenResolvedIssueCount: 0,
      }
    );

    const listOutput = buildLinkGapsStaticList(state, [item]);
    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(listOutput)).toContain('no suggestions yet · other-profile counterpart (maely, main)');
    expect(stripAnsi(detailOutput)).toContain('Cue: other-profile counterpart (maely, main)');
  });

  it('treats bridge-transfer diagnostics as link-first guidance when no counterpart is known', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      suggestedCount: 0,
      contextHint: {
        kind: 'diagnostic' as const,
        code: 'bridge_transfer',
        label: 'bridge transfer',
        message: 'Processed transaction carries bridge_transfer diagnostics and likely reflects bridge activity.',
      },
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(detailOutput)).toContain(
      'Likely outcome: Bridge or migration evidence exists; inspect the counterpart and create or confirm a transfer link if this is same-owner movement.'
    );
    expect(stripAnsi(detailOutput)).toContain('Context: Processed transaction carries bridge_transfer diagnostics');
    expect(stripAnsi(detailOutput)).toContain(
      'Next: inspect the bridge counterpart, then create or confirm a transfer link'
    );
    expect(stripAnsi(detailOutput)).not.toContain('Inspect counterpart:');
  });

  it('shows exchange deposit address credit diagnostics as review guidance', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      suggestedCount: 0,
      contextHint: {
        kind: 'diagnostic' as const,
        code: 'exchange_deposit_address_credit',
        label: 'credit into exchange deposit address',
        message:
          'KuCoin export records an on-chain credit into the platform deposit address; raw exchange data does not prove whether the sender was external or exchange-managed.',
      },
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(detailOutput)).toContain(
      'Likely outcome: Exchange export only proves a credit into the platform deposit address; inspect the raw chain source before linking or resolving this gap.'
    );
    expect(stripAnsi(detailOutput)).toContain(
      'Context: KuCoin export records an on-chain credit into the platform deposit address'
    );
    expect(stripAnsi(detailOutput)).not.toContain('Next: inspect the bridge counterpart');
  });

  it('shows the likely dust cue label in gap detail', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      gapCue: 'likely_dust' as const,
      suggestedCount: 0,
    };
    const item = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const detailOutput = buildLinkGapStaticDetail(item);

    expect(stripAnsi(detailOutput)).toContain('Cue: likely low-value dust');
  });
});
