import { assertOk } from '@exitbook/foundation/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { buildCostBasisScopedTransactions } from '../../cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';
import { validateScopedTransferLinks } from '../../cost-basis/standard/matching/validated-scoped-transfer-links.js';
import { buildMatchingConfig } from '../../linking/matching/matching-config.js';
import { SameHashExternalOutflowStrategy } from '../../linking/strategies/same-hash-external-outflow-strategy.js';
import {
  createExplainedMultiSourceAdaHashPartialTransactions,
  createLinkableMovementsFromTransactions,
} from '../../linking/strategies/test-utils.js';
import { buildAccountingLayerFromTransactions } from '../build-accounting-layer-from-transactions.js';
import { validateTransferLinks } from '../validated-transfer-links.js';

const logger = getLogger('validated-transfer-links.test');

function createExplainedResidualLinks() {
  const transactions = createExplainedMultiSourceAdaHashPartialTransactions();
  const linkableMovements = createLinkableMovementsFromTransactions(transactions);
  const strategy = new SameHashExternalOutflowStrategy();
  const strategyResult = strategy.execute(
    linkableMovements.filter((movement) => movement.direction === 'out'),
    linkableMovements.filter((movement) => movement.direction === 'in'),
    buildMatchingConfig()
  );
  const links = assertOk(strategyResult).links.map((link, index) => ({
    ...link,
    id: 9500 + index,
  }));

  return { links, transactions };
}

describe('validateTransferLinks', () => {
  it('accepts explained target residual links directly from accounting transaction views', () => {
    const { links, transactions } = createExplainedResidualLinks();
    const accountingLayer = assertOk(buildAccountingLayerFromTransactions(transactions, logger));

    const validated = assertOk(validateTransferLinks(accountingLayer.accountingTransactionViews, links));

    expect(validated.links).toHaveLength(3);
    expect(validated.links.every((link) => link.isPartialMatch)).toBe(true);
    expect(validated.links.every((link) => link.link.metadata?.['explainedTargetResidualAmount'] === '10.524451')).toBe(
      true
    );
  });

  it('matches the scoped compatibility wrapper for explained residual links', () => {
    const { links, transactions } = createExplainedResidualLinks();
    const accountingLayer = assertOk(buildAccountingLayerFromTransactions(transactions, logger));
    const scopedTransactions = assertOk(buildCostBasisScopedTransactions(transactions, logger)).transactions;

    const canonical = assertOk(validateTransferLinks(accountingLayer.accountingTransactionViews, links));
    const scoped = assertOk(validateScopedTransferLinks(scopedTransactions, links));

    expect(
      canonical.links.map((link) => ({
        isPartialMatch: link.isPartialMatch,
        sourceAmount: link.sourceMovementAmount.toFixed(),
        sourceMovementFingerprint: link.sourceMovementFingerprint,
        targetAmount: link.targetMovementAmount.toFixed(),
        targetMovementFingerprint: link.targetMovementFingerprint,
      }))
    ).toEqual(
      scoped.links.map((link) => ({
        isPartialMatch: link.isPartialMatch,
        sourceAmount: link.sourceMovementAmount.toFixed(),
        sourceMovementFingerprint: link.sourceMovementFingerprint,
        targetAmount: link.targetMovementAmount.toFixed(),
        targetMovementFingerprint: link.targetMovementFingerprint,
      }))
    );
  });
});
