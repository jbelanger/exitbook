import { type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type { ICostBasisPersistence } from '../ports/cost-basis-persistence.js';

import { calculateCostBasisFromValidatedTransactions, type CostBasisSummary } from './cost-basis-calculator.js';
import type { CostBasisConfig } from './cost-basis-config.js';
import { getJurisdictionRules, validateTransactionPrices } from './cost-basis-utils.js';
import { LotMatcher } from './lot-matcher.js';

export interface CostBasisPipelineResult {
  summary: CostBasisSummary;
  missingPricesCount: number;
  /** Transactions that passed strict price validation. */
  validTransactions: UniversalTransactionData[];
}

/**
 * Shared cost-basis pipeline: strict price validation → jurisdiction rules → lot matching → gain/loss.
 *
 * Used by CostBasisWorkflow and PortfolioHandler to avoid duplicating the
 * "validate prices → get rules → run calculator" flow.
 */
export async function runCostBasisPipeline(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  store: ICostBasisPersistence
): Promise<Result<CostBasisPipelineResult, Error>> {
  const validationResult = validateTransactionPrices(transactions, config.currency);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const { validTransactions, missingPricesCount } = validationResult.value;
  if (missingPricesCount > 0) {
    return err(
      new Error(
        `${missingPricesCount} transactions are missing required price data. ` +
          `Run 'exitbook prices enrich' and retry cost basis.`
      )
    );
  }

  const rulesResult = getJurisdictionRules(config.jurisdiction);
  if (rulesResult.isErr()) {
    return err(rulesResult.error);
  }

  const rules = rulesResult.value;

  // Load confirmed links from persistence
  const contextResult = await store.loadCostBasisContext();
  if (contextResult.isErr()) {
    return err(contextResult.error);
  }

  const lotMatcher = new LotMatcher();

  const costBasisResult = await calculateCostBasisFromValidatedTransactions(
    validTransactions,
    config,
    rules,
    lotMatcher,
    contextResult.value.confirmedLinks
  );
  if (costBasisResult.isErr()) {
    return err(costBasisResult.error);
  }

  return ok({ summary: costBasisResult.value, missingPricesCount, validTransactions });
}
