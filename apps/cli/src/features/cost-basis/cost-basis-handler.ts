import type { CostBasisReport, CostBasisSummary } from '@exitbook/accounting';
import {
  CostBasisCalculator,
  CostBasisReportGenerator,
  StandardFxRateProvider,
  type CostBasisRepository,
  type LotTransferRepository,
  type TransactionLinkRepository,
} from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { createPriceProviderManager } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

import type { CostBasisHandlerParams } from './cost-basis-utils.js';
import {
  filterTransactionsByDateRange,
  getJurisdictionRules,
  validateCostBasisParams,
  validateTransactionPrices,
} from './cost-basis-utils.js';

// Re-export for convenience
export type { CostBasisHandlerParams };

const logger = getLogger('CostBasisHandler');

/**
 * Result of the cost basis calculation operation.
 */
export interface CostBasisResult {
  /** Calculation summary */
  summary: CostBasisSummary;
  /** Warning if any transactions are missing prices */
  missingPricesWarning?: string | undefined;
  /** Report with display currency conversion (if displayCurrency != USD) */
  report?: CostBasisReport | undefined;
}

/**
 * Cost Basis Handler - Encapsulates all cost basis calculation business logic.
 * Reusable by both CLI command and other contexts.
 */
export class CostBasisHandler {
  constructor(
    private transactionRepository: TransactionRepository,
    private transactionLinkRepository: TransactionLinkRepository,
    private costBasisRepository: CostBasisRepository,
    private lotTransferRepository: LotTransferRepository
  ) {}

  /**
   * Execute the cost basis calculation.
   */
  async execute(params: CostBasisHandlerParams): Promise<Result<CostBasisResult, Error>> {
    try {
      // Validate parameters
      const validation = validateCostBasisParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      const { config } = params;
      logger.debug({ config }, 'Starting cost basis calculation');

      // 1. Fetch and filter transactions
      const txResult = await this.validateAndGetTransactions(config);
      if (txResult.isErr()) {
        return err(txResult.error);
      }
      const { validTransactions, missingPricesCount } = txResult.value;

      // 2. Run calculation
      const rules = getJurisdictionRules(config.jurisdiction);
      const calculator = new CostBasisCalculator(
        this.costBasisRepository,
        this.lotTransferRepository,
        this.transactionRepository,
        this.transactionLinkRepository
      );

      const calcResult = await calculator.calculate(validTransactions, config, rules);
      if (calcResult.isErr()) {
        return err(calcResult.error);
      }
      const summary = calcResult.value;

      logger.info(
        {
          calculationId: summary.calculation.id,
          lotsCreated: summary.lotsCreated,
          disposalsProcessed: summary.disposalsProcessed,
          assetsProcessed: summary.assetsProcessed.length,
        },
        'Cost basis calculation completed'
      );

      // 3. Generate optional report with currency conversion
      let report: CostBasisReport | undefined;
      if (config.currency !== 'USD') {
        const reportResult = await this.generateReport(summary.calculation.id, config.currency);
        if (reportResult.isErr()) {
          return err(reportResult.error);
        }
        report = reportResult.value;
      }

      // 4. Build result
      return ok({
        summary,
        missingPricesWarning:
          missingPricesCount > 0
            ? `${missingPricesCount} transactions were excluded due to missing prices. Run 'exitbook prices fetch' to populate missing prices.`
            : undefined,
        report,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Fetch, filter, and validate transactions for cost basis
   */
  private async validateAndGetTransactions(
    config: CostBasisHandlerParams['config']
  ): Promise<Result<{ missingPricesCount: number; validTransactions: UniversalTransactionData[] }, Error>> {
    // Guard against any non-CLI callers that bypass validation.
    if (!config.startDate || !config.endDate) {
      return err(new Error('Start date and end date must be defined'));
    }

    // Fetch all transactions
    const transactionsResult = await this.transactionRepository.getTransactions();
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const allTransactions = transactionsResult.value;
    if (allTransactions.length === 0) {
      return err(
        new Error('No transactions found in database. Please import transactions using the import command first.')
      );
    }

    // Filter by date range (dates are enforced by type + upstream validation)
    const filteredTransactions = filterTransactionsByDateRange(allTransactions, config.startDate, config.endDate);

    if (filteredTransactions.length === 0) {
      return err(
        new Error(
          `No transactions found in the date range ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}`
        )
      );
    }

    // Validate prices
    const validationResult = validateTransactionPrices(filteredTransactions, config.currency);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const { validTransactions, missingPricesCount } = validationResult.value;
    if (missingPricesCount > 0) {
      logger.warn(
        { missingPricesCount, validCount: validTransactions.length },
        'Some transactions missing prices will be excluded'
      );
    }

    return ok({ validTransactions, missingPricesCount });
  }

  /**
   * Generate cost basis report with currency conversion
   */
  private async generateReport(
    calculationId: string,
    displayCurrency: string
  ): Promise<Result<CostBasisReport, Error>> {
    logger.info({ displayCurrency }, 'Generating report with currency conversion');

    const priceManagerResult = await createPriceProviderManager();
    if (priceManagerResult.isErr()) {
      return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
    }

    const priceManager = priceManagerResult.value;
    try {
      const fxProvider = new StandardFxRateProvider(priceManager);
      const reportGenerator = new CostBasisReportGenerator(this.costBasisRepository, fxProvider);

      const reportResult = await reportGenerator.generateReport({
        calculationId,
        displayCurrency,
      });
      if (reportResult.isErr()) {
        return err(reportResult.error);
      }

      const report = reportResult.value;
      logger.info(
        {
          calculationId,
          displayCurrency,
          disposalsConverted: report.disposals.length,
        },
        'Report generation completed'
      );

      return ok(report);
    } finally {
      priceManager.destroy();
    }
  }
}
