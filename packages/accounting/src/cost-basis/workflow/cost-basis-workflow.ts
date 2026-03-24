import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { ICostBasisContextReader } from '../../ports/cost-basis-persistence.js';
import { getCostBasisJurisdictionModule } from '../jurisdictions/registry.js';
import type { CostBasisReport } from '../model/report-types.js';
import type { AcquisitionLot, CostBasisCalculation, LotDisposal, LotTransfer } from '../model/types.js';
import { runCostBasisPipeline } from '../standard/calculation/run-standard-cost-basis.js';
import { CostBasisReportGenerator } from '../standard/reporting/display-report-generator.js';

import { validateCostBasisInput, type ValidatedCostBasisConfig } from './cost-basis-input.js';
import type { CostBasisWorkflowExecutionOptions, CostBasisWorkflowResult } from './workflow-result-types.js';

export type {
  CanadaCostBasisWorkflowResult,
  CostBasisExecutionMeta,
  CostBasisWorkflowExecutionOptions,
  CostBasisWorkflowResult,
  StandardCostBasisWorkflowResult,
} from './workflow-result-types.js';

const logger = getLogger('cost-basis.workflow');

/**
 * Orchestrates cost basis calculation — validates params, fetches/filters
 * transactions, runs the pipeline, and optionally generates FX-converted reports.
 *
 * Caller provides persistence via ICostBasisContextReader port and transactions
 * pre-loaded from the database.
 */
export class CostBasisWorkflow {
  constructor(
    private readonly store: ICostBasisContextReader,
    private readonly priceRuntime?: IPriceProviderRuntime | undefined
  ) {}

  async execute(
    config: ValidatedCostBasisConfig,
    transactions: Transaction[],
    options: CostBasisWorkflowExecutionOptions
  ): Promise<Result<CostBasisWorkflowResult, Error>> {
    const validation = validateCostBasisInput(config);
    if (validation.isErr()) {
      return err(validation.error);
    }

    logger.debug({ config }, 'Starting cost basis calculation');

    const jurisdictionModuleResult = getCostBasisJurisdictionModule(config.jurisdiction);
    if (jurisdictionModuleResult.isErr()) {
      return err(jurisdictionModuleResult.error);
    }

    const jurisdictionModule = jurisdictionModuleResult.value;
    const filteredResult = this.filterTransactionsForWindow(transactions, config, {
      lookaheadDays: jurisdictionModule.workflow.lookaheadDays ?? undefined,
    });
    if (filteredResult.isErr()) return err(filteredResult.error);

    if (jurisdictionModule.workflow.kind === 'specialized') {
      const workflowResult = await jurisdictionModule.workflow.run({
        config,
        transactions: filteredResult.value,
        store: this.store,
        priceRuntime: this.priceRuntime,
        options,
      });
      if (workflowResult.isErr()) {
        return err(workflowResult.error);
      }

      this.logCompletedWorkflow(workflowResult.value);
      return ok(workflowResult.value);
    }

    if (config.currency !== 'USD' && !this.priceRuntime) {
      return err(new Error('Price provider runtime required for non-USD currency conversion'));
    }

    const pipelineResult = await runCostBasisPipeline(filteredResult.value, config, this.store, {
      accountingExclusionPolicy: options.accountingExclusionPolicy,
      assetReviewSummaries: options.assetReviewSummaries,
      missingPricePolicy: options.missingPricePolicy,
    });
    if (pipelineResult.isErr()) {
      return err(pipelineResult.error);
    }

    const { summary } = pipelineResult.value;

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

    const workflowResult: CostBasisWorkflowResult = {
      kind: 'standard-workflow',
      summary,
      report,
      lots,
      disposals,
      lotTransfers,
      executionMeta: {
        missingPricesCount: pipelineResult.value.missingPricesCount,
        retainedTransactionIds: pipelineResult.value.rebuildTransactions.map((transaction) => transaction.id),
      },
    };

    this.logCompletedWorkflow(workflowResult);
    return ok(workflowResult);
  }

  /**
   * Filter transactions to the report window end date.
   * Pre-period acquisitions are included so the lot pool is complete.
   */
  private filterTransactionsForWindow(
    transactions: Transaction[],
    config: ValidatedCostBasisConfig,
    options?: { lookaheadDays?: number | undefined }
  ): Result<Transaction[], Error> {
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
    const reportEndDate = new Date(config.endDate);
    const calculationEndDate = new Date(reportEndDate);
    calculationEndDate.setUTCDate(calculationEndDate.getUTCDate() + (options?.lookaheadDays ?? 0));

    const transactionsUpToEndDate = transactions.filter((tx) => new Date(tx.timestamp) <= calculationEndDate);

    if (transactionsUpToEndDate.length === 0) {
      return err(new Error(`No transactions found on or before ${calculationEndDate.toISOString().split('T')[0]}`));
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

    const reportGenerator = new CostBasisReportGenerator(this.priceRuntime!);

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

  private logCompletedWorkflow(result: CostBasisWorkflowResult): void {
    if (result.kind === 'canada-workflow') {
      logger.info(
        {
          calculationId: result.calculation.id,
          dispositionsProcessed: result.taxReport.dispositions.length,
          assetsProcessed: result.calculation.assetsProcessed.length,
        },
        'Canada cost basis calculation completed'
      );
      return;
    }

    logger.info(
      {
        calculationId: result.summary.calculation.id,
        lotsCreated: result.summary.lotsCreated,
        disposalsProcessed: result.summary.disposalsProcessed,
        assetsProcessed: result.summary.assetsProcessed.length,
      },
      'Cost basis calculation completed'
    );
  }
}
