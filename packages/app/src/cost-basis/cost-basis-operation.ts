import {
  CostBasisReportGenerator,
  StandardFxRateProvider,
  runCostBasisPipeline,
  validateCostBasisParams,
  type AcquisitionLot,
  type AssetMatchError,
  type CostBasisCalculation,
  type CostBasisInput,
  type CostBasisReport,
  type CostBasisSummary,
  type LotDisposal,
  type LotTransfer,
} from '@exitbook/accounting';
import { type Currency, type UniversalTransactionData } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { PriceProviderManager } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

import { CostBasisStoreAdapter } from './cost-basis-store-adapter.js';

export type { CostBasisInput };

const logger = getLogger('CostBasisOperation');

/**
 * Result of the cost basis calculation operation.
 */
export interface CostBasisResult {
  summary: CostBasisSummary;
  missingPricesWarning?: string | undefined;
  report?: CostBasisReport | undefined;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
  errors: AssetMatchError[];
}

/**
 * App-layer operation for cost basis calculation.
 * Constructs the adapter, fetches/filters transactions, and delegates to runCostBasisPipeline.
 */
export class CostBasisOperation {
  constructor(
    private readonly db: DataContext,
    private readonly priceManager?: PriceProviderManager | undefined
  ) {}

  async execute(params: CostBasisInput): Promise<Result<CostBasisResult, Error>> {
    const validation = validateCostBasisParams(params);
    if (validation.isErr()) {
      return err(validation.error);
    }

    const { config } = params;
    logger.debug({ config }, 'Starting cost basis calculation');

    const txResult = await this.fetchTransactionsForWindow(config);
    if (txResult.isErr()) {
      return err(txResult.error);
    }

    const store = new CostBasisStoreAdapter(this.db);
    const pipelineResult = await runCostBasisPipeline(txResult.value, config, store);
    if (pipelineResult.isErr()) {
      return err(pipelineResult.error);
    }

    const { summary, missingPricesCount } = pipelineResult.value;

    logger.info(
      {
        calculationId: summary.calculation.id,
        lotsCreated: summary.lotsCreated,
        disposalsProcessed: summary.disposalsProcessed,
        assetsProcessed: summary.assetsProcessed.length,
      },
      'Cost basis calculation completed'
    );

    const { lots, disposals, lotTransfers } = summary;

    let report: CostBasisReport | undefined;
    if (config.currency !== 'USD') {
      const reportResult = await this.generateReport(
        summary.calculation,
        disposals,
        lots,
        lotTransfers,
        config.currency as Currency
      );
      if (reportResult.isErr()) {
        return err(reportResult.error);
      }
      report = reportResult.value;
    }

    return ok({
      summary,
      missingPricesWarning:
        missingPricesCount > 0
          ? `${missingPricesCount} transactions were excluded due to missing prices. Run 'exitbook prices fetch' to populate missing prices.`
          : undefined,
      report,
      lots,
      disposals,
      lotTransfers,
      errors: summary.errors,
    });
  }

  /**
   * Fetch and filter transactions to the report window end date.
   * Pre-period acquisitions are included so the lot pool is complete.
   */
  private async fetchTransactionsForWindow(
    config: CostBasisInput['config']
  ): Promise<Result<UniversalTransactionData[], Error>> {
    if (!config.startDate || !config.endDate) {
      return err(new Error('Start date and end date must be defined'));
    }

    const transactionsResult = await this.db.transactions.findAll();
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const allTransactions = transactionsResult.value;
    if (allTransactions.length === 0) {
      return err(
        new Error('No transactions found in database. Please import transactions using the import command first.')
      );
    }

    // Include all transactions up to end of reporting period.
    // Pre-period acquisitions are needed to build the lot pool — e.g. a 2023 buy
    // must exist so a 2024 transfer/disposal can match against it.
    // The calculator filters output disposals to [startDate, endDate] for reporting.
    const transactionsUpToEndDate = allTransactions.filter((tx) => new Date(tx.timestamp) <= config.endDate);

    if (transactionsUpToEndDate.length === 0) {
      return err(new Error(`No transactions found on or before ${config.endDate.toISOString().split('T')[0]}`));
    }

    return ok(transactionsUpToEndDate);
  }

  private async generateReport(
    calculation: CostBasisCalculation,
    disposals: LotDisposal[],
    lots: AcquisitionLot[],
    lotTransfers: LotTransfer[],
    displayCurrency: Currency
  ): Promise<Result<CostBasisReport, Error>> {
    if (!this.priceManager) {
      return err(new Error('Price provider manager required for currency conversion'));
    }

    logger.info({ displayCurrency }, 'Generating report with currency conversion');

    const fxProvider = new StandardFxRateProvider(this.priceManager);
    const reportGenerator = new CostBasisReportGenerator(fxProvider);

    const reportResult = await reportGenerator.generateReport({
      calculation,
      disposals,
      lots,
      lotTransfers,
      displayCurrency,
    });
    if (reportResult.isErr()) {
      return err(reportResult.error);
    }

    const report = reportResult.value;
    logger.info(
      {
        calculationId: calculation.id,
        displayCurrency,
        disposalsConverted: report.disposals.length,
        lotsConverted: report.lots.length,
        transfersConverted: report.lotTransfers.length,
      },
      'Report generation completed'
    );

    return ok(report);
  }
}
