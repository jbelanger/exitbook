import type { CostBasisReport, CostBasisSummary } from '@exitbook/accounting';
import {
  CostBasisCalculator,
  CostBasisReportGenerator,
  CostBasisRepository,
  LotTransferRepository,
  StandardFxRateProvider,
  TransactionLinkRepository,
} from '@exitbook/accounting';
import type { KyselyDB } from '@exitbook/data';
import { TransactionRepository } from '@exitbook/data';
import { createPriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
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
  private transactionRepository: TransactionRepository;
  private transactionLinkRepository: TransactionLinkRepository;
  private costBasisRepository: CostBasisRepository;
  private lotTransferRepository: LotTransferRepository;

  constructor(private database: KyselyDB) {
    this.transactionRepository = new TransactionRepository(this.database);
    this.transactionLinkRepository = new TransactionLinkRepository(this.database);
    this.costBasisRepository = new CostBasisRepository(this.database);
    this.lotTransferRepository = new LotTransferRepository(this.database);
  }

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

      logger.info(
        {
          method: config.method,
          jurisdiction: config.jurisdiction,
          taxYear: config.taxYear,
          currency: config.currency,
          startDate: config.startDate?.toISOString(),
          endDate: config.endDate?.toISOString(),
        },
        'Starting cost basis calculation'
      );

      // Fetch all transactions
      const transactionsResult = await this.transactionRepository.getTransactions();
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const allTransactions = transactionsResult.value;
      logger.info({ totalCount: allTransactions.length }, 'Fetched all transactions');

      if (allTransactions.length === 0) {
        return err(
          new Error('No transactions found in database. Please import transactions using the import command first.')
        );
      }

      // Ensure dates are defined (should be set by validation/default range)
      if (!config.startDate || !config.endDate) {
        return err(new Error('Start date and end date must be defined'));
      }

      // Filter transactions by date range
      const filteredTransactions = filterTransactionsByDateRange(allTransactions, config.startDate, config.endDate);

      logger.info(
        { filteredCount: filteredTransactions.length, totalCount: allTransactions.length },
        'Filtered transactions by date range'
      );

      if (filteredTransactions.length === 0) {
        return err(
          new Error(
            `No transactions found in the date range ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}`
          )
        );
      }

      // Validate all transactions have prices
      const validationResult = validateTransactionPrices(filteredTransactions, config.currency);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const { validTransactions, missingPricesCount } = validationResult.value;

      // Log warning if some transactions were excluded
      if (missingPricesCount > 0) {
        logger.warn(
          { missingPricesCount, validCount: validTransactions.length },
          'Some transactions missing prices will be excluded from calculation'
        );
      }

      // Get jurisdiction rules
      const rules = getJurisdictionRules(config.jurisdiction);

      // Create calculator and execute
      const calculator = new CostBasisCalculator(
        this.costBasisRepository,
        this.lotTransferRepository,
        this.transactionRepository,
        this.transactionLinkRepository
      );
      const calculationResult = await calculator.calculate(validTransactions, config, rules);

      if (calculationResult.isErr()) {
        return err(calculationResult.error);
      }

      const summary = calculationResult.value;

      logger.info(
        {
          calculationId: summary.calculation.id,
          lotsCreated: summary.lotsCreated,
          disposalsProcessed: summary.disposalsProcessed,
          assetsProcessed: summary.assetsProcessed.length,
        },
        'Cost basis calculation completed'
      );

      // Generate report with display currency conversion if needed
      let report: CostBasisReport | undefined;
      if (config.currency !== 'USD') {
        logger.info({ displayCurrency: config.currency }, 'Generating report with currency conversion');

        // Create price provider manager and FX rate provider
        const priceManagerResult = await createPriceProviderManager();
        if (priceManagerResult.isErr()) {
          return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
        }

        const priceManager = priceManagerResult.value;
        const fxProvider = new StandardFxRateProvider(priceManager);

        // Generate report
        const reportGenerator = new CostBasisReportGenerator(this.costBasisRepository, fxProvider);
        const reportResult = await reportGenerator.generateReport({
          calculationId: summary.calculation.id,
          displayCurrency: config.currency,
        });

        if (reportResult.isErr()) {
          return err(reportResult.error);
        }

        report = reportResult.value;

        logger.info(
          {
            calculationId: summary.calculation.id,
            displayCurrency: config.currency,
            disposalsConverted: report.disposals.length,
          },
          'Report generation completed'
        );
      }

      // Build result with optional warning and report
      const result: CostBasisResult = {
        summary,
        missingPricesWarning:
          missingPricesCount > 0
            ? `${missingPricesCount} transactions were excluded due to missing prices. Run 'exitbook prices fetch' to populate missing prices.`
            : undefined,
        report,
      };

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources (none needed for CostBasisHandler, but included for consistency).
   */
  destroy(): void {
    // No resources to cleanup
  }
}
