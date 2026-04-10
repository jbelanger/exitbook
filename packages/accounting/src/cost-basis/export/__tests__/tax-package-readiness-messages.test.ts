import { describe, expect, it } from 'vitest';

import {
  formatIncompleteTransferLinkingIssueSummary,
  formatIncompleteTransferLinkingNotice,
  formatUnresolvedAssetReviewIssueDetails,
  formatUnresolvedAssetReviewIssueSummary,
  formatUnresolvedAssetReviewNotice,
} from '../tax-package-readiness-messages.js';

describe('tax package readiness messages', () => {
  it('formats unresolved asset review copy consistently', () => {
    expect(formatUnresolvedAssetReviewIssueSummary()).toBe('Assets still require review before filing export.');
    expect(formatUnresolvedAssetReviewNotice(1)).toBe('1 asset still requires review before filing export.');
    expect(formatUnresolvedAssetReviewNotice(3)).toBe('3 assets still require review before filing export.');
    expect(
      formatUnresolvedAssetReviewIssueDetails({
        count: 2,
        jurisdiction: 'CA',
        taxYear: 2024,
      })
    ).toBe('Tax package export for CA 2024 is blocked because 2 assets still require review before filing export.');
  });

  it('formats incomplete transfer linking copy consistently', () => {
    expect(formatIncompleteTransferLinkingIssueSummary()).toBe('Some transfers were not fully linked.');
    expect(formatIncompleteTransferLinkingNotice(1)).toBe(
      '1 transfer requires manual review because linking is incomplete.'
    );
    expect(formatIncompleteTransferLinkingNotice(4)).toBe(
      '4 transfers require manual review because linking is incomplete.'
    );
  });
});
