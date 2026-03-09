import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import { runCanadaAcbEngine } from '../canada/canada-acb-engine.js';
import { runCanadaAcbWorkflow } from '../canada/canada-acb-workflow.js';
import { runCanadaSuperficialLossEngine } from '../canada/canada-superficial-loss-engine.js';
import { buildCanadaDisplayCostBasisReport, buildCanadaTaxReport } from '../canada/canada-tax-report-builder.js';
import type {
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../canada/canada-tax-types.js';
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
export interface GenericCostBasisWorkflowResult {
  kind: 'generic-pipeline';
  summary: CostBasisSummary;
  report?: CostBasisReport | undefined;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}

export interface CanadaCostBasisWorkflowResult {
  kind: 'canada-workflow';
  calculation: CanadaCostBasisCalculation;
  taxReport: CanadaTaxReport;
  displayReport?: CanadaDisplayCostBasisReport | undefined;
}

export type CostBasisWorkflowResult = GenericCostBasisWorkflowResult | CanadaCostBasisWorkflowResult;

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

    if (config.jurisdiction === 'CA' && config.method === 'average-cost') {
      const filteredResult = this.filterTransactionsForWindow(transactions, config, { lookaheadDays: 30 });
      if (filteredResult.isErr()) return err(filteredResult.error);
      return this.executeCanadaWorkflow(params, filteredResult.value);
    }

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
      kind: 'generic-pipeline',
      summary,
      report,
      lots,
      disposals,
      lotTransfers,
    });
  }

  private async executeCanadaWorkflow(
    params: CostBasisInput,
    transactions: UniversalTransactionData[]
  ): Promise<Result<CanadaCostBasisWorkflowResult, Error>> {
    if (!this.fxRateProvider) {
      return err(new Error('FX rate provider required for Canada tax valuation'));
    }

    const contextResult = await this.store.loadCostBasisContext();
    if (contextResult.isErr()) {
      return err(contextResult.error);
    }

    const acbWorkflowResult = await runCanadaAcbWorkflow(
      transactions,
      contextResult.value.confirmedLinks,
      this.fxRateProvider,
      {
        taxAssetIdentityPolicy: params.config.taxAssetIdentityPolicy,
      }
    );
    if (acbWorkflowResult.isErr()) {
      return err(acbWorkflowResult.error);
    }

    const calculation = this.buildCanadaCalculation(params, acbWorkflowResult.value.inputContext);
    const superficialLossResult = runCanadaSuperficialLossEngine({
      inputContext: acbWorkflowResult.value.inputContext,
      acbEngineResult: acbWorkflowResult.value.acbEngineResult,
    });
    if (superficialLossResult.isErr()) {
      return err(superficialLossResult.error);
    }

    const augmentedInputContext = this.appendCanadaAdjustmentEvents(
      acbWorkflowResult.value.inputContext,
      superficialLossResult.value.adjustmentEvents
    );
    const adjustedAcbEngineResult = runCanadaAcbEngine(augmentedInputContext);
    if (adjustedAcbEngineResult.isErr()) {
      return err(adjustedAcbEngineResult.error);
    }

    const poolSnapshotContext = this.filterCanadaInputContextToReportEnd(augmentedInputContext, params.config.endDate);
    const poolSnapshotResult = runCanadaAcbEngine(poolSnapshotContext);
    if (poolSnapshotResult.isErr()) {
      return err(poolSnapshotResult.error);
    }

    const taxReportResult = buildCanadaTaxReport({
      calculation,
      inputContext: acbWorkflowResult.value.inputContext,
      acbEngineResult: adjustedAcbEngineResult.value,
      poolSnapshot: poolSnapshotResult.value,
      superficialLossEngineResult: superficialLossResult.value,
    });
    if (taxReportResult.isErr()) {
      return err(taxReportResult.error);
    }

    let displayReport: CanadaDisplayCostBasisReport | undefined;
    if (params.config.currency !== 'CAD') {
      const displayReportResult = await buildCanadaDisplayCostBasisReport({
        taxReport: taxReportResult.value,
        displayCurrency: params.config.currency as Currency,
        fxProvider: this.fxRateProvider,
      });
      if (displayReportResult.isErr()) {
        return err(displayReportResult.error);
      }
      displayReport = displayReportResult.value;
    }

    logger.info(
      {
        calculationId: calculation.id,
        dispositionsProcessed: taxReportResult.value.dispositions.length,
        assetsProcessed: calculation.assetsProcessed.length,
      },
      'Canada cost basis calculation completed'
    );

    return ok({
      kind: 'canada-workflow',
      calculation,
      taxReport: taxReportResult.value,
      ...(displayReport ? { displayReport } : {}),
    });
  }

  private buildCanadaCalculation(
    params: CostBasisInput,
    inputContext: { inputEvents: { assetSymbol: Currency }[]; scopedTransactionIds: number[] }
  ): CanadaCostBasisCalculation {
    const calculationDate = new Date();
    const assetsProcessed = [...new Set(inputContext.inputEvents.map((event) => event.assetSymbol))];

    return {
      id: globalThis.crypto.randomUUID(),
      calculationDate,
      method: 'average-cost',
      jurisdiction: 'CA',
      taxYear: params.config.taxYear,
      displayCurrency: params.config.currency as Currency,
      taxCurrency: 'CAD',
      startDate: params.config.startDate,
      endDate: params.config.endDate,
      transactionsProcessed: inputContext.scopedTransactionIds.length,
      assetsProcessed,
    };
  }

  /**
   * Filter transactions to the report window end date.
   * Pre-period acquisitions are included so the lot pool is complete.
   */
  private filterTransactionsForWindow(
    transactions: UniversalTransactionData[],
    config: CostBasisInput['config'],
    options?: { lookaheadDays?: number | undefined }
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
    const reportEndDate = new Date(config.endDate);
    const calculationEndDate = new Date(reportEndDate);
    calculationEndDate.setUTCDate(calculationEndDate.getUTCDate() + (options?.lookaheadDays ?? 0));

    const transactionsUpToEndDate = transactions.filter((tx) => new Date(tx.timestamp) <= calculationEndDate);

    if (transactionsUpToEndDate.length === 0) {
      return err(new Error(`No transactions found on or before ${calculationEndDate.toISOString().split('T')[0]}`));
    }

    return ok(transactionsUpToEndDate);
  }

  private appendCanadaAdjustmentEvents(
    inputContext: CanadaTaxInputContext,
    adjustmentEvents: CanadaTaxInputContext['inputEvents']
  ): CanadaTaxInputContext {
    return {
      ...inputContext,
      inputEvents: [...inputContext.inputEvents, ...adjustmentEvents],
    };
  }

  private filterCanadaInputContextToReportEnd(
    inputContext: CanadaTaxInputContext,
    reportEndDate: Date
  ): CanadaTaxInputContext {
    return {
      ...inputContext,
      inputEvents: inputContext.inputEvents.filter((event) => event.timestamp.getTime() <= reportEndDate.getTime()),
    };
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
