import type { TransactionLink } from '@exitbook/core';
import { err, randomUUID, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { AccountingLayerBuildResult } from '../../../accounting-layer/accounting-layer-types.js';
import { validateTransferLinks } from '../../../accounting-layer/validated-transfer-links.js';
import type { IJurisdictionRules } from '../../jurisdictions/jurisdiction-rules.js';
import type { CostBasisConfig } from '../../model/cost-basis-config.js';
import type { CostBasisCalculation } from '../../model/schemas.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../../model/schemas.js';
import type { LotMatcher } from '../matching/lot-matcher.js';
import { getStrategyForMethod } from '../strategies/strategy-factory.js';
import { assertAccountingLayerPriceDataQuality } from '../validation/price-validation.js';

import { calculateGainLoss } from './gain-loss-utils.js';

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

const logger = getLogger('calculateStandardCostBasis');

export async function calculateCostBasisFromAccountingLayer(
  accountingLayer: AccountingLayerBuildResult,
  config: CostBasisConfig,
  rules: IJurisdictionRules,
  lotMatcher: LotMatcher,
  confirmedLinks: TransactionLink[] = []
): Promise<Result<CostBasisSummary, Error>> {
  return resultDoAsync(async function* () {
    if (config.jurisdiction === 'CA') {
      return yield* err(new Error('Canada (CA) cost basis must run through the specialized Canada workflow'));
    }

    if (config.method === 'average-cost') {
      return yield* err(new Error('average-cost is handled by the Canada workflow, not the standard calculator'));
    }

    yield* assertAccountingLayerPriceDataQuality(accountingLayer);
    const validatedLinks = yield* validateTransferLinks(accountingLayer.accountingTransactionViews, confirmedLinks);

    const calculationId = randomUUID();
    const calculationDate = new Date();
    const strategy = yield* getStrategyForMethod(config.method);
    const jurisdictionConfig = rules.getConfig();
    const lotMatchResult = yield* await lotMatcher.match(accountingLayer, validatedLinks, {
      calculationId,
      strategy,
      jurisdiction: { sameAssetTransferFeePolicy: jurisdictionConfig.sameAssetTransferFeePolicy },
    });

    if (config.startDate) {
      for (const assetResult of lotMatchResult.assetResults) {
        assetResult.disposals = assetResult.disposals.filter((d) => d.disposalDate >= config.startDate!);
      }
    }

    const gainLoss = yield* calculateGainLoss(lotMatchResult.assetResults, rules);
    const lots = lotMatchResult.assetResults.flatMap((result) => result.lots);
    const disposals = lotMatchResult.assetResults.flatMap((result) => result.disposals);
    const lotTransfers = lotMatchResult.assetResults.flatMap((result) => result.lotTransfers);

    if (lotTransfers.length > 0) {
      logger.info({ count: lotTransfers.length }, 'Processed lot transfers');
    }

    const assetsProcessed = [...new Set([...gainLoss.byAsset.values()].map((summary) => summary.assetSymbol))];
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
      transactionsProcessed: accountingLayer.accountingTransactionViews.length,
      lotsCreated: lotMatchResult.totalLotsCreated,
      disposalsProcessed: disposals.length,
      status: 'completed',
      createdAt: calculationDate,
      completedAt: new Date(),
    };

    return {
      calculation: completedCalculation,
      lotsCreated: lotMatchResult.totalLotsCreated,
      disposalsProcessed: disposals.length,
      totalCapitalGainLoss: gainLoss.totalCapitalGainLoss,
      totalTaxableGainLoss: gainLoss.totalTaxableGainLoss,
      assetsProcessed,
      lots,
      disposals,
      lotTransfers,
    };
  });
}
