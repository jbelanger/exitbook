import { type UniversalTransactionData, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { CostBasisConfig } from '../config/cost-basis-config.js';
import type { CostBasisCalculation } from '../domain/schemas.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';

import { assertPriceDataQuality } from './cost-basis-validation-utils.js';
import { calculateGainLoss } from './gain-loss-utils.js';
import type { AssetMatchError } from './lot-matcher.js';
import { LotMatcher } from './lot-matcher.js';
import { getStrategyForMethod } from './strategies/strategy-factory.js';

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
  /** Per-asset errors that didn't abort the entire calculation */
  errors: AssetMatchError[];
}

const logger = getLogger('calculateCostBasis');

/**
 * Calculate cost basis for a set of pre-validated transactions.
 *
 * Transactions must have priceAtTxTime populated for all non-fiat movements.
 * Use runCostBasisPipeline for the full flow including soft-fail price filtering.
 *
 * @param transactions - Transactions to process (must have priceAtTxTime populated)
 * @param config - Cost basis configuration
 * @param rules - Jurisdiction-specific tax rules
 * @param lotMatcher - Lot matcher instance with transaction repositories
 */
export async function calculateCostBasis(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  rules: IJurisdictionRules,
  lotMatcher: LotMatcher
): Promise<Result<CostBasisSummary, Error>> {
  // Validate method-jurisdiction compatibility (defense in depth)
  if (config.method === 'average-cost' && config.jurisdiction !== 'CA') {
    return err(new Error('Average Cost method is only supported for Canada (CA)'));
  }

  // Warn about CRA compliance for Canadian users using non-ACB methods
  if (config.jurisdiction === 'CA' && config.method !== 'average-cost') {
    logger.warn(
      { jurisdiction: config.jurisdiction, method: config.method },
      'CRA generally requires Average Cost (ACB) for identical properties. Using FIFO/LIFO may not be compliant with Canadian tax regulations.'
    );
  }

  // Assert price data quality before calculating (defense-in-depth)
  const validationResult = assertPriceDataQuality(transactions);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const calculationId = uuidv4();
  const calculationDate = new Date();

  try {
    const strategyResult = getStrategyForMethod(config.method);
    if (strategyResult.isErr()) {
      return err(strategyResult.error);
    }
    const strategy = strategyResult.value;

    const jurisdictionConfig = rules.getConfig();

    const matchResult = await lotMatcher.match(transactions, {
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
      assetsProcessed: Array.from(new Set(Array.from(gainLoss.byAsset.values()).map((s) => s.assetSymbol))),
      transactionsProcessed: transactions.length,
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
      assetsProcessed: Array.from(new Set(Array.from(gainLoss.byAsset.values()).map((s) => s.assetSymbol))),
      lots,
      disposals,
      lotTransfers,
      errors: lotMatchResult.errors,
    });
  } catch (error) {
    return wrapError(error, 'Failed to calculate cost basis');
  }
}
