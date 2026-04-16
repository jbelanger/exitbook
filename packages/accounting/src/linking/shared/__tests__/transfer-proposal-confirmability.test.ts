import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildAccountingModelFromTransactions } from '../../../accounting-model/build-accounting-model-from-transactions.js';
import { createTransactionLink } from '../../matching/link-construction.js';
import { allocateMatches } from '../../matching/match-allocation.js';
import { buildMatchingConfig } from '../../matching/matching-config.js';
import { scoreAndFilterMatches } from '../../strategies/amount-timing-utils.js';
import { SameHashExternalOutflowStrategy } from '../../strategies/same-hash-external-outflow-strategy.js';
import {
  createExplainedMultiSourceAdaHashPartialTransactions,
  createLinkableMovementsFromTransactions,
  createImpossibleMultiSourceAdaHashPartialScenario,
  createImpossibleMultiSourceAdaHashPartialTransactions,
} from '../../strategies/test-utils.js';
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
  it('drops proposals that would fail accounting-model transfer confirmation', () => {
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

    const accountingModel = assertOk(
      buildAccountingModelFromTransactions(createImpossibleMultiSourceAdaHashPartialTransactions(), noopLogger)
    );

    const filteredLinks = filterConfirmableTransferProposals(
      accountingModel.accountingTransactionViews,
      [],
      candidateLinks
    );

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

    const accountingModel = assertOk(buildAccountingModelFromTransactions(transactions, noopLogger));

    const filteredLinks = filterConfirmableTransferProposals(
      accountingModel.accountingTransactionViews,
      [],
      candidateLinks
    );

    expect(filteredLinks).toHaveLength(3);
    expect(filteredLinks.every((link) => link.metadata?.['explainedTargetResidualAmount'] === '10.524451')).toBe(true);
  });
});
