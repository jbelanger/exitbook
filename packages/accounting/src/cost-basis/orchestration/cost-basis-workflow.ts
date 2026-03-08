import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import { validateCostBasisInput, type CostBasisInput } from '../shared/cost-basis-utils.js';
import type { CostBasisReport } from '../shared/report-types.js';
import type { AcquisitionLot, CostBasisCalculation, LotDisposal, LotTransfer } from '../shared/types.js';

import type { CostBasisSummary } from './cost-basis-calculator.js';
import { runCostBasisPipeline } from './cost-basis-pipeline.js';
import { CostBasisReportGenerator } from './cost-basis-report-generator.js';

const logger = getLogger('CostBasisWorkflow');

/**
 * Result of the cost basis workflow.
 */
export interface CostBasisWorkflowResult {
  summary: CostBasisSummary;
  report?: CostBasisReport | undefined;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}

/**
 * Orchestrates cost basis calculation — validates params, fetches/filters
 * transactions, runs the pipeline, and optionally generates FX-converted reports.
 *
 * Caller provides persistence via ICostBasisPersistence port and transactions
 * pre-loaded from the database.
 */
export class CostBasisWorkflow {
  constructor(
    private readonly store: ICostBasisPersistence,
    private readonly fxRateProvider?: IFxRateProvider | undefined
  ) {}

  async execute(
    params: CostBasisInput,
    transactions: UniversalTransactionData[]
  ): Promise<Result<CostBasisWorkflowResult, Error>> {
    const validation = validateCostBasisInput(params);
    if (validation.isErr()) {
      return err(validation.error);
    }

    const { config } = params;
    logger.debug({ config }, 'Starting cost basis calculation');

    const filteredResult = this.filterTransactionsForWindow(transactions, config);
    if (filteredResult.isErr()) return err(filteredResult.error);

    const pipelineResult = await runCostBasisPipeline(filteredResult.value, config, this.store, {
      // Tax reporting must fail closed. Excluding a disposal or transfer because
      // it lacks prices would change realized gain/loss and silently understate
      // the report.
      missingPricePolicy: 'error',
    });
    if (pipelineResult.isErr()) {
      return err(pipelineResult.error);
    }

    const { summary } = pipelineResult.value;

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
    if (config.currency !== 'USD' && this.fxRateProvider) {
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
    } else if (config.currency !== 'USD' && !this.fxRateProvider) {
      return err(new Error('FX rate provider required for non-USD currency conversion'));
    }

    return ok({
      summary,
      report,
      lots,
      disposals,
      lotTransfers,
    });
  }

  /**
   * Filter transactions to the report window end date.
   * Pre-period acquisitions are included so the lot pool is complete.
   */
  private filterTransactionsForWindow(
    transactions: UniversalTransactionData[],
    config: CostBasisInput['config']
  ): Result<UniversalTransactionData[], Error> {
    if (!config.startDate || !config.endDate) {
      return err(new Error('Start date and end date must be defined'));
    }

    if (transactions.length === 0) {
      return err(
        new Error('No transactions found in database. Please import transactions using the import command first.')
      );
    }

    // Include all transactions up to end of reporting period.
    // Pre-period acquisitions are needed to build the lot pool — e.g. a 2023 buy
    // must exist so a 2024 transfer/disposal can match against it.
    // The calculator filters output disposals to [startDate, endDate] for reporting.
    const transactionsUpToEndDate = transactions.filter((tx) => new Date(tx.timestamp) <= config.endDate);

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
    logger.info({ displayCurrency }, 'Generating report with currency conversion');

    const reportGenerator = new CostBasisReportGenerator(this.fxRateProvider!);

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
