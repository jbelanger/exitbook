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
      gapRef: buildLinkGapRef({
        txFingerprint: firstIssue.txFingerprint,
        assetId: firstIssue.assetId,
        direction: firstIssue.direction,
      }),
      gapIssue: firstIssue,
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
      meta: {
        filters: {
          hiddenByResolutionOverrides: number;
        };
      };
    };

    expect(payload.meta.filters.hiddenByResolutionOverrides).toBe(2);
  });
});
