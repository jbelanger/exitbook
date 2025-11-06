import type { CostBasisReport, CostBasisSummary } from '@exitbook/accounting';
import {
  CanadaRules,
  CostBasisCalculator,
  CostBasisReportGenerator,
  CostBasisRepository,
  LotTransferRepository,
  StandardFxRateProvider,
  TransactionLinkRepository,
  USRules,
} from '@exitbook/accounting';
import { Currency, type UniversalTransaction } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { TransactionRepository } from '@exitbook/data';
import { createPriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { CostBasisHandlerParams } from './cost-basis-utils.js';
import { validateCostBasisParams } from './cost-basis-utils.js';

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
      const filteredTransactions = this.filterTransactionsByDateRange(
        allTransactions,
        config.startDate,
        config.endDate
      );

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
      const validationResult = this.validateTransactionPrices(filteredTransactions, config.currency);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const { validTransactions, missingPricesCount } = validationResult.value;

      // Get jurisdiction rules
      const rules = this.getJurisdictionRules(config.jurisdiction);

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

  /**
   * Filter transactions by date range
   */
  private filterTransactionsByDateRange(
    transactions: UniversalTransaction[],
    startDate: Date,
    endDate: Date
  ): UniversalTransaction[] {
    return transactions.filter((tx) => {
      const txDate = new Date(tx.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  /**
   * Validate that transactions have prices in the required currency
   */
  private validateTransactionPrices(
    transactions: UniversalTransaction[],
    requiredCurrency: string
  ): Result<{ missingPricesCount: number; validTransactions: UniversalTransaction[] }, Error> {
    const validTransactions: UniversalTransaction[] = [];
    let missingPricesCount = 0;

    for (const tx of transactions) {
      // Check if any movements are missing prices
      const hasAllPrices = this.transactionHasAllPrices(tx, requiredCurrency);

      if (hasAllPrices) {
        validTransactions.push(tx);
      } else {
        missingPricesCount++;
      }
    }

    // If ALL transactions are missing prices, this is a critical error
    if (validTransactions.length === 0) {
      return err(
        new Error(
          `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
        )
      );
    }

    // If some are missing, we'll continue but warn the user
    if (missingPricesCount > 0) {
      logger.warn(
        { missingPricesCount, validCount: validTransactions.length },
        'Some transactions missing prices will be excluded from calculation'
      );
    }

    return ok({ validTransactions, missingPricesCount });
  }

  /**
   * Check if a transaction has all required prices
   *
   * Only non-fiat crypto movements need prices. Fiat movements don't need prices
   * since we don't track cost basis for fiat currencies.
   */
  private transactionHasAllPrices(tx: UniversalTransaction, _requiredCurrency: string): boolean {
    // Check all non-fiat inflows
    const inflows = tx.movements.inflows || [];
    for (const inflow of inflows) {
      try {
        const currency = Currency.create(inflow.asset);
        if (!currency.isFiat() && !inflow.priceAtTxTime) {
          return false;
        }
      } catch {
        // If we can't create a Currency, assume it's crypto and needs a price
        if (!inflow.priceAtTxTime) {
          return false;
        }
      }
    }

    // Check all non-fiat outflows
    const outflows = tx.movements.outflows || [];
    for (const outflow of outflows) {
      try {
        const currency = Currency.create(outflow.asset);
        if (!currency.isFiat() && !outflow.priceAtTxTime) {
          return false;
        }
      } catch {
        // If we can't create a Currency, assume it's crypto and needs a price
        if (!outflow.priceAtTxTime) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get jurisdiction-specific tax rules
   */
  private getJurisdictionRules(jurisdiction: 'CA' | 'US' | 'UK' | 'EU') {
    switch (jurisdiction) {
      case 'CA':
        return new CanadaRules();
      case 'US':
        return new USRules();
      case 'UK':
      case 'EU':
        throw new Error(`${jurisdiction} jurisdiction rules not yet implemented`);
    }
  }
}
