import { type UniversalTransactionData } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { CostBasisConfig } from '../config/cost-basis-config.js';
import { getJurisdictionRules, validateTransactionPrices } from '../cost-basis/cost-basis-utils.js';
import type { TransactionLinkQueries } from '../persistence/transaction-link-queries.js';

import { calculateCostBasis, type CostBasisSummary } from './cost-basis-calculator.js';
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
 * Used by CostBasisHandler and PortfolioHandler to avoid duplicating the
 * "validate prices → get rules → run calculator" flow.
 */
export async function runCostBasisPipeline(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  transactionRepository: TransactionQueries,
  linkRepository: TransactionLinkQueries
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

  const rules = getJurisdictionRules(config.jurisdiction);
  const lotMatcher = new LotMatcher(transactionRepository, linkRepository);

  const calcResult = await calculateCostBasis(validTransactions, config, rules, lotMatcher);
  if (calcResult.isErr()) {
    return err(calcResult.error);
  }

  return ok({ summary: calcResult.value, missingPricesCount, validTransactions });
}
