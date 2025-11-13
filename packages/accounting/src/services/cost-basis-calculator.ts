import { Currency, type UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { CostBasisConfig } from '../config/cost-basis-config.js';
import type { CostBasisCalculation } from '../domain/schemas.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import type { CostBasisRepository } from '../persistence/cost-basis-repository.js';
import type { LotTransferRepository } from '../persistence/lot-transfer-repository.js';
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
}

/**
 * Cost Basis Calculator - Orchestrates the entire cost basis calculation workflow
 *
 * This service:
 * 1. Validates transactions have prices
 * 2. Creates lot matcher with chosen strategy (FIFO/LIFO)
 * 3. Matches disposals to acquisition lots
 * 4. Applies jurisdiction-specific tax rules
 * 5. Stores results in database
 * 6. Returns comprehensive summary
 */
export class CostBasisCalculator {
  private readonly lotMatcher: LotMatcher;
  private readonly logger = getLogger('CostBasisCalculator');

  constructor(
    private readonly repository: CostBasisRepository,
    private readonly lotTransferRepository: LotTransferRepository,
    transactionRepository?: TransactionRepository,
    linkRepository?: TransactionLinkRepository
  ) {
    this.lotMatcher = new LotMatcher(transactionRepository, linkRepository);
  }

  /**
   * Calculate cost basis for a set of transactions
   *
   * @param transactions - Transactions to process (must have priceAtTxTime populated)
   * @param config - Cost basis configuration
   * @param rules - Jurisdiction-specific tax rules
   * @returns Result containing calculation summary
   */
  async calculate(
    transactions: UniversalTransaction[],
    config: CostBasisConfig,
    rules: IJurisdictionRules
  ): Promise<Result<CostBasisSummary, Error>> {
    // PHASE 5: Validate price data quality before calculating
    const validationResult = validateTransactionPrices(transactions);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const calculationId = uuidv4();
    const calculationDate = new Date();

    try {
      // Create pending calculation record
      const pendingCalculation: CostBasisCalculation = {
        id: calculationId,
        calculationDate,
        config,
        startDate: config.startDate,
        endDate: config.endDate,
        totalProceeds: new Decimal(0),
        totalCostBasis: new Decimal(0),
        totalGainLoss: new Decimal(0),
        totalTaxableGainLoss: new Decimal(0),
        assetsProcessed: [],
        transactionsProcessed: transactions.length,
        lotsCreated: 0,
        disposalsProcessed: 0,
        status: 'pending',
        createdAt: calculationDate,
      };

      const createResult = await this.repository.createCalculation(pendingCalculation);
      if (createResult.isErr()) {
        return err(createResult.error);
      }

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
        // Update calculation status to failed
        await this.updateCalculationStatus(calculationId, 'failed', matchResult.error.message);
        return err(matchResult.error);
      }

      const lotMatchResult = matchResult.value;

      // Apply jurisdiction-specific tax rules to calculate gains/losses
      const gainLossResult = calculateGainLoss(lotMatchResult.assetResults, rules);

      if (gainLossResult.isErr()) {
        await this.updateCalculationStatus(calculationId, 'failed', gainLossResult.error.message);
        return err(gainLossResult.error);
      }

      const gainLoss = gainLossResult.value;

      // Store lots, disposals, and lot transfers in database
      const lots = lotMatchResult.assetResults.flatMap((r) => r.lots);
      const disposals = lotMatchResult.assetResults.flatMap((r) => r.disposals);
      const lotTransfers = lotMatchResult.assetResults.flatMap((r) => r.lotTransfers);

      const storeLotResult = await this.repository.createLotsBulk(lots);
      if (storeLotResult.isErr()) {
        await this.updateCalculationStatus(calculationId, 'failed', storeLotResult.error.message);
        return err(storeLotResult.error);
      }

      const storeDisposalResult = await this.repository.createDisposalsBulk(disposals);
      if (storeDisposalResult.isErr()) {
        await this.updateCalculationStatus(calculationId, 'failed', storeDisposalResult.error.message);
        return err(storeDisposalResult.error);
      }

      // Store lot transfers (Phase 2)
      if (lotTransfers.length > 0) {
        const storeLotTransferResult = await this.lotTransferRepository.createBulk(lotTransfers);
        if (storeLotTransferResult.isErr()) {
          await this.updateCalculationStatus(calculationId, 'failed', storeLotTransferResult.error.message);
          return err(storeLotTransferResult.error);
        }
        this.logger.info({ count: lotTransfers.length }, 'Stored lot transfers');
      }

      // Create completed calculation record
      const completedCalculation: CostBasisCalculation = {
        ...pendingCalculation,
        totalProceeds: gainLoss.totalProceeds,
        totalCostBasis: gainLoss.totalCostBasis,
        totalGainLoss: gainLoss.totalCapitalGainLoss,
        totalTaxableGainLoss: gainLoss.totalTaxableGainLoss,
        assetsProcessed: Array.from(gainLoss.byAsset.keys()).map((asset) => Currency.create(asset)),
        lotsCreated: lotMatchResult.totalLotsCreated,
        disposalsProcessed: lotMatchResult.totalDisposalsProcessed,
        status: 'completed',
        completedAt: new Date(),
      };

      // Update calculation with final results
      await this.updateCalculationWithResults(completedCalculation);

      return ok({
        calculation: completedCalculation,
        lotsCreated: lotMatchResult.totalLotsCreated,
        disposalsProcessed: lotMatchResult.totalDisposalsProcessed,
        totalCapitalGainLoss: gainLoss.totalCapitalGainLoss,
        totalTaxableGainLoss: gainLoss.totalTaxableGainLoss,
        assetsProcessed: Array.from(gainLoss.byAsset.keys()),
      });
    } catch (error) {
      // Update calculation status to failed
      await this.updateCalculationStatus(
        calculationId,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Update calculation status
   */
  private async updateCalculationStatus(
    calculationId: string,
    status: 'pending' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updates: Partial<CostBasisCalculation> = {
      status,
      errorMessage,
    };

    if (status === 'completed' || status === 'failed') {
      updates.completedAt = new Date();
    }

    const result = await this.repository.updateCalculation(calculationId, updates);
    if (result.isErr()) {
      this.logger.error({ error: result.error, calculationId }, 'Failed to update calculation status');
    }
  }

  /**
   * Update calculation with final results
   */
  private async updateCalculationWithResults(calculation: CostBasisCalculation): Promise<void> {
    const result = await this.repository.updateCalculation(calculation.id, {
      status: calculation.status,
      completedAt: calculation.completedAt,
      totalProceeds: calculation.totalProceeds,
      totalCostBasis: calculation.totalCostBasis,
      totalGainLoss: calculation.totalGainLoss,
      totalTaxableGainLoss: calculation.totalTaxableGainLoss,
      assetsProcessed: calculation.assetsProcessed,
      lotsCreated: calculation.lotsCreated,
      disposalsProcessed: calculation.disposalsProcessed,
    });

    if (result.isErr()) {
      this.logger.error(
        { error: result.error, calculationId: calculation.id },
        'Failed to update calculation with results'
      );
    }
  }
}
