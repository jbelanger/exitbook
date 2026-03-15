import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createTransactionLink } from '../../../../linking/matching/link-construction.js';
import { allocateMatches } from '../../../../linking/matching/match-allocation.js';
import { DEFAULT_MATCHING_CONFIG } from '../../../../linking/matching/matching-config.js';
import { scoreAndFilterMatches } from '../../../../linking/strategies/amount-timing-utils.js';
import {
  createImpossibleMultiSourceAdaHashPartialScenario,
  createImpossibleMultiSourceAdaHashPartialTransactions,
} from '../../../../linking/strategies/test-utils.js';
import { buildCostBasisScopedTransactions } from '../build-cost-basis-scoped-transactions.js';
import { filterConfirmableTransferProposals } from '../transfer-proposal-confirmability.js';

const noopLogger = {
  child: () => noopLogger,
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  trace: () => undefined,
  warn: () => undefined,
};

describe('filterConfirmableTransferProposals', () => {
  it('drops proposals that would fail scoped transfer confirmation', () => {
    const { sources, targets } = createImpossibleMultiSourceAdaHashPartialScenario();
    const allMatches = sources.flatMap((source) => scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG));
    const { suggested, confirmed } = allocateMatches(allMatches, DEFAULT_MATCHING_CONFIG);
    const candidateLinks = [...confirmed, ...suggested].map((match) =>
      assertOk(
        createTransactionLink(
          match,
          match.confidenceScore.greaterThanOrEqualTo(DEFAULT_MATCHING_CONFIG.autoConfirmThreshold)
            ? 'confirmed'
            : 'suggested',
          new Date()
        )
      )
    );

    const scopedTransactions = assertOk(
      buildCostBasisScopedTransactions(createImpossibleMultiSourceAdaHashPartialTransactions(), noopLogger)
    ).transactions;

    const filteredLinks = filterConfirmableTransferProposals(scopedTransactions, [], candidateLinks);

    expect(filteredLinks).toHaveLength(0);
  });
});
