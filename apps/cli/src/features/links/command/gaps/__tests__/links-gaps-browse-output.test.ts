import { describe, expect, it } from 'vitest';

import { createMockGapAnalysis } from '../../../__tests__/test-utils.js';
import type { CliJsonOutput } from '../../../../../cli/command.js';
import { formatTransactionFingerprintRef } from '../../../../transactions/transaction-selector.js';
import { buildLinkGapRef } from '../../../link-selector.js';
import { createGapsViewState } from '../../../view/links-view-state.js';
import { buildLinksGapsBrowseCompletion } from '../links-gaps-browse-output.js';

describe('links-gaps-browse-output', () => {
  it('includes resolution override visibility in json list meta', () => {
    const analysis = createMockGapAnalysis();
    const state = createGapsViewState(analysis, {
      hiddenResolvedIssueCount: 2,
    });
    const firstIssue = analysis.issues[0]!;
    const gap = {
      crossProfileCandidates: [
        {
          amount: '1.5',
          direction: 'outflow' as const,
          platformKey: 'solana',
          profileDisplayName: 'maely',
          profileKey: 'maely',
          secondsDeltaFromGap: -15,
          timestamp: '2024-03-18T09:12:19Z',
          transactionRef: 'other-prof',
          txFingerprint: 'other-profile-inflow-1',
        },
      ],
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
          platformKey: 'bitcoin',
        },
      },
      suggestedProposalRefs: ['abc123def0'],
      transactionSnapshot: {
        blockchainTransactionHash: 'shared-hash',
        from: 'bc1qtracked',
        fromOwnership: 'owned' as const,
        openSameHashGapRowCount: 2,
        openSameHashTransactionRefs: ['abc123def0', 'def456abc1'],
        to: '3J11external',
        toOwnership: 'unknown' as const,
      },
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(firstIssue.txFingerprint),
    };
    const result = buildLinksGapsBrowseCompletion(
      {
        gaps: [gap],
        selectedGap: undefined,
        state,
      },
      'list',
      'json',
      {}
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const output = result.value.output as CliJsonOutput;
    const payload = output.data as {
      data: [
        {
          crossProfileCandidates?: { profileKey?: string }[];
          crossProfileCue?: string;
          exactOtherProfileCounterpartProfileKey?: string;
          exactOtherProfileCounterpartTransactionRef?: string;
          gapCueCounterpartTransactionRef?: string;
          operationGroup?: string;
          operationLabel?: string;
          relatedContext?: { fromAccount?: { accountRef?: string } };
          suggestedProposalRefs?: string[];
          transactionSnapshot?: { openSameHashGapRowCount?: number };
        },
      ];
      meta: {
        filters: {
          gapsWithOtherProfileCounterparts: number;
          hiddenByResolutionOverrides: number;
        };
      };
    };

    expect(payload.meta.filters.hiddenByResolutionOverrides).toBe(2);
    expect(payload.meta.filters.gapsWithOtherProfileCounterparts).toBe(1);
    expect(payload.data[0]?.suggestedProposalRefs).toEqual(['abc123def0']);
    expect(payload.data[0]?.relatedContext?.fromAccount?.accountRef).toBe('acctref1234');
    expect(payload.data[0]?.transactionSnapshot?.openSameHashGapRowCount).toBe(2);
    expect(payload.data[0]?.crossProfileCue).toBe('exact_other_profile_counterpart');
    expect(payload.data[0]?.crossProfileCandidates?.[0]?.profileKey).toBe('maely');
    expect(payload.data[0]?.exactOtherProfileCounterpartProfileKey).toBe('maely');
    expect(payload.data[0]?.exactOtherProfileCounterpartTransactionRef).toBe('other-prof');
    expect(payload.data[0]?.operationGroup).toBe('transfer');
    expect(payload.data[0]?.operationLabel).toBe('transfer/deposit');
  });

  it('includes cue counterpart transaction refs in json detail', () => {
    const analysis = createMockGapAnalysis();
    const gapIssue = {
      ...analysis.issues[0]!,
      gapCue: 'likely_cross_chain_bridge' as const,
      gapCueCounterpartTxFingerprint: 'arb-bridge-counterpart',
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
    const gap = {
      gapRef: buildLinkGapRef({
        txFingerprint: gapIssue.txFingerprint,
        assetId: gapIssue.assetId,
        direction: gapIssue.direction,
      }),
      gapIssue,
      transactionGapCount: 1,
      transactionRef: formatTransactionFingerprintRef(gapIssue.txFingerprint),
    };

    const result = buildLinksGapsBrowseCompletion(
      {
        gaps: [gap],
        selectedGap: gap,
        state,
      },
      'detail',
      'json',
      { selector: gap.transactionRef }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const output = result.value.output as CliJsonOutput;
    const payload = output.data as {
      data: {
        gapCueCounterpartTransactionRef?: string;
        gapCueCounterpartTxFingerprint?: string;
      };
    };

    expect(payload.data.gapCueCounterpartTxFingerprint).toBe('arb-bridge-counterpart');
    expect(payload.data.gapCueCounterpartTransactionRef).toBe(
      formatTransactionFingerprintRef('arb-bridge-counterpart')
    );
  });
});
