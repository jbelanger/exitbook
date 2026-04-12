import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { createTransactionLink } from '../../../../linking/matching/link-construction.js';
import { allocateMatches } from '../../../../linking/matching/match-allocation.js';
import { buildMatchingConfig } from '../../../../linking/matching/matching-config.js';
import { scoreAndFilterMatches } from '../../../../linking/strategies/amount-timing-utils.js';
import { SameHashExternalOutflowStrategy } from '../../../../linking/strategies/same-hash-external-outflow-strategy.js';
import {
  createExplainedMultiSourceAdaHashPartialTransactions,
  createLinkableMovementsFromTransactions,
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
    const allMatches = sources.flatMap((source) => scoreAndFilterMatches(source, targets, buildMatchingConfig()));
    const { suggested, confirmed } = allocateMatches(allMatches, buildMatchingConfig());
    const candidateLinks = [...confirmed, ...suggested].map((match) =>
      assertOk(
        createTransactionLink(
          match,
          match.confidenceScore.greaterThanOrEqualTo(buildMatchingConfig().autoConfirmThreshold)
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

  it('keeps proposals that are partially target-linked when the residual is exactly explained by current diagnostics', () => {
    const transactions = createExplainedMultiSourceAdaHashPartialTransactions();
    const linkableMovements = createLinkableMovementsFromTransactions(transactions);
    const strategy = new SameHashExternalOutflowStrategy();
    const strategyResult = strategy.execute(
      linkableMovements.filter((movement) => movement.direction === 'out'),
      linkableMovements.filter((movement) => movement.direction === 'in'),
      buildMatchingConfig()
    );
    const candidateLinks = assertOk(strategyResult).links;

    const scopedTransactions = assertOk(buildCostBasisScopedTransactions(transactions, noopLogger)).transactions;

    const filteredLinks = filterConfirmableTransferProposals(scopedTransactions, [], candidateLinks);

    expect(filteredLinks).toHaveLength(3);
    expect(
      filteredLinks.every((link) => link.metadata?.['sameHashExplainedTargetResidualAmount'] === '10.524451')
    ).toBe(true);
  });
});
