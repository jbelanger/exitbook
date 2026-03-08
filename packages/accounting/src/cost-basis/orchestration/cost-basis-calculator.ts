import { type TransactionLink, type UniversalTransactionData, wrapError } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import {
  buildAccountingScopedTransactions,
  type AccountingScopedBuildResult,
} from '../matching/build-accounting-scoped-transactions.js';
import type { LotMatcher } from '../matching/lot-matcher.js';
import { validateScopedTransferLinks } from '../matching/validated-scoped-transfer-links.js';
import type { CostBasisConfig } from '../shared/cost-basis-config.js';
import { assertScopedPriceDataQuality } from '../shared/cost-basis-validation-utils.js';
import { calculateGainLoss } from '../shared/gain-loss-utils.js';
import type { CostBasisCalculation } from '../shared/schemas.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../shared/schemas.js';
import { getStrategyForMethod } from '../strategies/strategy-factory.js';

/**
 * Summary of cost basis calculation results
 */
export interface CostBasisSummary {
  /** Calculation record */
  calculation: CostBasisCalculation;
  /** Number of lots created */
  lotsCreated: number;
  /** Number of disposals processed */
  disposalsProcessed: number;
  /** Total capital gains/losses */
  totalCapitalGainLoss: Decimal;
  /** Total taxable gains/losses */
  totalTaxableGainLoss: Decimal;
  /** Assets processed */
  assetsProcessed: string[];
  /** Acquisition lots created during calculation */
  lots: AcquisitionLot[];
  /** Disposals processed during calculation */
  disposals: LotDisposal[];
  /** Lot transfers (for same-asset transfers) */
  lotTransfers: LotTransfer[];
}

const logger = getLogger('calculateCostBasisFromValidatedTransactions');

/**
 * Calculate cost basis for a set of pre-validated transactions.
 *
 * Transactions must have priceAtTxTime populated for all non-fiat movements.
 * Use runCostBasisPipeline for the full flow, including explicit missing-price
 * policy handling at the scoped accounting boundary.
 *
 * @param transactions - Transactions to process (must have priceAtTxTime populated)
 * @param config - Cost basis configuration
 * @param rules - Jurisdiction-specific tax rules
 * @param lotMatcher - Lot matcher instance
 * @param confirmedLinks - Confirmed transaction links for transfer detection
 */
export async function calculateCostBasisFromValidatedTransactions(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  rules: IJurisdictionRules,
  lotMatcher: LotMatcher,
  confirmedLinks: TransactionLink[] = []
): Promise<Result<CostBasisSummary, Error>> {
  const scopedResult = buildAccountingScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  return calculateCostBasisFromScopedTransactions(scopedResult.value, config, rules, lotMatcher, confirmedLinks);
}

export async function calculateCostBasisFromScopedTransactions(
  scopedBuildResult: AccountingScopedBuildResult,
  config: CostBasisConfig,
  rules: IJurisdictionRules,
  lotMatcher: LotMatcher,
  confirmedLinks: TransactionLink[] = []
): Promise<Result<CostBasisSummary, Error>> {
  if (config.method === 'average-cost' && config.jurisdiction !== 'CA') {
    return err(new Error('Average Cost method is only supported for Canada (CA)'));
  }

  if (config.jurisdiction === 'CA' && config.method !== 'average-cost') {
    logger.warn(
      { jurisdiction: config.jurisdiction, method: config.method },
      'CRA generally requires Average Cost (ACB) for identical properties. Using FIFO/LIFO may not be compliant with Canadian tax regulations.'
    );
  }

  const validationResult = assertScopedPriceDataQuality(scopedBuildResult);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const validatedLinksResult = validateScopedTransferLinks(scopedBuildResult.transactions, confirmedLinks);
  if (validatedLinksResult.isErr()) {
    return err(validatedLinksResult.error);
  }

  const calculationId = globalThis.crypto.randomUUID();
  const calculationDate = new Date();

  try {
    const strategyResult = getStrategyForMethod(config.method);
    if (strategyResult.isErr()) {
      return err(strategyResult.error);
    }
    const strategy = strategyResult.value;

    const jurisdictionConfig = rules.getConfig();

    const matchResult = await lotMatcher.match(scopedBuildResult, validatedLinksResult.value, {
      calculationId,
      strategy,
      jurisdiction: { sameAssetTransferFeePolicy: jurisdictionConfig.sameAssetTransferFeePolicy },
    });

    if (matchResult.isErr()) {
      return err(matchResult.error);
    }

    const lotMatchResult = matchResult.value;

    // Filter disposals to reporting period. Lot matching processes the full
    // history so that pre-period acquisitions are available, but only
    // in-period disposals count for the tax report.
    if (config.startDate) {
      for (const assetResult of lotMatchResult.assetResults) {
        assetResult.disposals = assetResult.disposals.filter((d) => d.disposalDate >= config.startDate!);
      }
    }

    const gainLossResult = calculateGainLoss(lotMatchResult.assetResults, rules);

    if (gainLossResult.isErr()) {
      return err(gainLossResult.error);
    }

    const gainLoss = gainLossResult.value;

    const lots = lotMatchResult.assetResults.flatMap((r) => r.lots);
    const disposals = lotMatchResult.assetResults.flatMap((r) => r.disposals);
    const lotTransfers = lotMatchResult.assetResults.flatMap((r) => r.lotTransfers);

    if (lotTransfers.length > 0) {
      logger.info({ count: lotTransfers.length }, 'Processed lot transfers');
    }

    const assetsProcessed = [...new Set([...gainLoss.byAsset.values()].map((s) => s.assetSymbol))];

    const completedCalculation: CostBasisCalculation = {
      id: calculationId,
      calculationDate,
      config,
      startDate: config.startDate,
      endDate: config.endDate,
      totalProceeds: gainLoss.totalProceeds,
      totalCostBasis: gainLoss.totalCostBasis,
      totalGainLoss: gainLoss.totalCapitalGainLoss,
      totalTaxableGainLoss: gainLoss.totalTaxableGainLoss,
      assetsProcessed,
      transactionsProcessed: scopedBuildResult.transactions.length,
      lotsCreated: lotMatchResult.totalLotsCreated,
      disposalsProcessed: disposals.length,
      status: 'completed',
      createdAt: calculationDate,
      completedAt: new Date(),
    };

    return ok({
      calculation: completedCalculation,
      lotsCreated: lotMatchResult.totalLotsCreated,
      disposalsProcessed: disposals.length,
      totalCapitalGainLoss: gainLoss.totalCapitalGainLoss,
      totalTaxableGainLoss: gainLoss.totalTaxableGainLoss,
      assetsProcessed,
      lots,
      disposals,
      lotTransfers,
    });
  } catch (error) {
    return wrapError(error, 'Failed to calculate cost basis');
  }
}
