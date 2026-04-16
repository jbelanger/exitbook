import { assertOk } from '@exitbook/foundation/test-utils';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../linking/matching/matching-config.js';
import { SameHashExternalOutflowStrategy } from '../../linking/strategies/same-hash-external-outflow-strategy.js';
import {
  createExplainedMultiSourceAdaHashPartialTransactions,
  createLinkableMovementsFromTransactions,
} from '../../linking/strategies/test-utils.js';
import { buildAccountingModelFromTransactions } from '../build-accounting-model-from-transactions.js';
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
    const accountingModel = assertOk(buildAccountingModelFromTransactions(transactions, logger));

    const validated = assertOk(validateTransferLinks(accountingModel.accountingTransactionViews, links));

    expect(validated.links).toHaveLength(3);
    expect(validated.links.every((link) => link.isPartialMatch)).toBe(true);
    expect(validated.links.every((link) => link.link.metadata?.['explainedTargetResidualAmount'] === '10.524451')).toBe(
      true
    );
  });
});
