import { type UniversalTransactionData } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { CostBasisConfig } from '../config/cost-basis-config.js';
import type { CostBasisCalculation } from '../domain/schemas.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import type { TransactionLinkRepository } from '../persistence/transaction-link-repository.js';

import { getStrategyForMethod } from './cost-basis-utils.js';
import { validateTransactionPrices } from './cost-basis-validation-utils.js';
import { calculateGainLoss } from './gain-loss-utils.js';
import { LotMatcher } from './lot-matcher.js';

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

/**
 * Cost Basis Calculator - Orchestrates the entire cost basis calculation workflow
 *
 * This service:
 * 1. Validates transactions have prices
 * 2. Creates lot matcher with chosen strategy (FIFO/LIFO)
 * 3. Matches disposals to acquisition lots
 * 4. Applies jurisdiction-specific tax rules
 * 5. Returns comprehensive summary with lots, disposals, and transfers in-memory
 */
export class CostBasisCalculator {
  private readonly lotMatcher: LotMatcher;
  private readonly logger = getLogger('CostBasisCalculator');

  constructor(transactionRepository?: TransactionRepository, linkRepository?: TransactionLinkRepository) {
    this.lotMatcher = new LotMatcher(transactionRepository, linkRepository);
  }

  /**
   * Calculate cost basis for a set of transactions
   *
   * @param transactions - Transactions to process (must have priceAtTxTime populated)
   * @param config - Cost basis configuration
   * @param rules - Jurisdiction-specific tax rules
   * @returns Result containing calculation summary with in-memory lots, disposals, and transfers
   */
  async calculate(
    transactions: UniversalTransactionData[],
    config: CostBasisConfig,
    rules: IJurisdictionRules
  ): Promise<Result<CostBasisSummary, Error>> {
    // Validate method-jurisdiction compatibility (defense in depth)
    if (config.method === 'average-cost' && config.jurisdiction !== 'CA') {
      return err(new Error('Average Cost method is only supported for Canada (CA)'));
    }

    // Warn about CRA compliance for Canadian users using non-ACB methods
    if (config.jurisdiction === 'CA' && config.method !== 'average-cost') {
      this.logger.warn(
        { jurisdiction: config.jurisdiction, method: config.method },
        'CRA generally requires Average Cost (ACB) for identical properties. Using FIFO/LIFO may not be compliant with Canadian tax regulations.'
      );
    }

    // PHASE 5: Validate price data quality before calculating
    const validationResult = validateTransactionPrices(transactions);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const calculationId = uuidv4();
    const calculationDate = new Date();

    try {
      // Get strategy based on config
      const strategy = getStrategyForMethod(config.method);

      // Get jurisdiction config for transfer fee policy
      const jurisdictionConfig = rules.getConfig();

      // Match transactions to lots using chosen strategy
      const matchResult = await this.lotMatcher.match(transactions, {
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

      // Apply jurisdiction-specific tax rules to calculate gains/losses
      const gainLossResult = calculateGainLoss(lotMatchResult.assetResults, rules);

      if (gainLossResult.isErr()) {
        return err(gainLossResult.error);
      }

      const gainLoss = gainLossResult.value;

      // Extract lots, disposals, and lot transfers from results
      const lots = lotMatchResult.assetResults.flatMap((r) => r.lots);
      const disposals = lotMatchResult.assetResults.flatMap((r) => r.disposals);
      const lotTransfers = lotMatchResult.assetResults.flatMap((r) => r.lotTransfers);

      if (lotTransfers.length > 0) {
        this.logger.info({ count: lotTransfers.length }, 'Processed lot transfers');
      }

      // Build completed calculation record in-memory
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
        assetsProcessed: Array.from(gainLoss.byAsset.keys()),
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
        assetsProcessed: Array.from(gainLoss.byAsset.keys()),
        lots,
        disposals,
        lotTransfers,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
