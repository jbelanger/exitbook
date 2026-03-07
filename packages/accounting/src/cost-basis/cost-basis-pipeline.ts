import { type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ICostBasisPersistence } from '../ports/cost-basis-persistence.js';

import { calculateCostBasisFromValidatedTransactions, type CostBasisSummary } from './cost-basis-calculator.js';
import type { CostBasisConfig } from './cost-basis-config.js';
import { getJurisdictionRules, validateTransactionPrices } from './cost-basis-utils.js';
import { LotMatcher } from './lot-matcher.js';

const logger = getLogger('cost-basis-pipeline');

export interface CostBasisPipelineResult {
  summary: CostBasisSummary;
  missingPricesCount: number;
  /** Transactions that passed price validation — available for callers that need to build richer exclusion warnings */
  validTransactions: UniversalTransactionData[];
}

/**
 * Shared cost-basis pipeline: soft-fail price validation → jurisdiction rules → lot matching → gain/loss.
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
    logger.warn(
      { missingPricesCount, validCount: validTransactions.length },
      'Some transactions missing prices will be excluded from cost basis'
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
