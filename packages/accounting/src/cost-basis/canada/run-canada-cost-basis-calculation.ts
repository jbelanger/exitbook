import type { AssetReviewSummary, Currency, TransactionLink, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import type { CostBasisExecutionMeta, CanadaCostBasisWorkflowResult } from '../orchestration/cost-basis-workflow.js';
import type { AccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import { getCostBasisRebuildTransactions, type CostBasisInput } from '../shared/cost-basis-utils.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';
import { runCanadaAcbWorkflow } from './canada-acb-workflow.js';
import { runCanadaSuperficialLossEngine } from './canada-superficial-loss-engine.js';
import { buildCanadaDisplayCostBasisReport, buildCanadaTaxReport } from './canada-tax-report-builder.js';
import type { CanadaCostBasisCalculation, CanadaTaxInputContext } from './canada-tax-types.js';

const logger = getLogger('run-canada-cost-basis-calculation');

export interface RunCanadaCostBasisCalculationParams {
  input: CostBasisInput;
  transactions: UniversalTransactionData[];
  confirmedLinks: TransactionLink[];
  fxRateProvider: IFxRateProvider;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
  poolSnapshotStrategy: 'report-end' | 'full-input-range';
}

export async function runCanadaCostBasisCalculation(
  params: RunCanadaCostBasisCalculationParams
): Promise<Result<CanadaCostBasisWorkflowResult, Error>> {
  const priceCoverageResult = getCostBasisRebuildTransactions(
    params.transactions,
    'CAD',
    params.accountingExclusionPolicy
  );
  if (priceCoverageResult.isErr()) {
    return err(priceCoverageResult.error);
  }

  const executionMeta: CostBasisExecutionMeta = {
    missingPricesCount: priceCoverageResult.value.missingPricesCount,
    retainedTransactionIds: priceCoverageResult.value.rebuildTransactions.map((transaction) => transaction.id),
  };

  if (params.missingPricePolicy === 'error' && executionMeta.missingPricesCount > 0) {
    return err(
      new Error(
        `${executionMeta.missingPricesCount} transactions are missing required price data. ` +
          `Run 'exitbook prices enrich' and retry cost basis.`
      )
    );
  }

  if (params.missingPricePolicy === 'exclude' && executionMeta.missingPricesCount > 0) {
    logger.warn(
      {
        missingPricesCount: executionMeta.missingPricesCount,
        originalTransactionsCount: params.transactions.length,
        rebuildTransactionsCount: priceCoverageResult.value.rebuildTransactions.length,
      },
      'Excluding transactions with missing prices from the Canada cost basis calculation'
    );
  }

  const acbWorkflowResult = await runCanadaAcbWorkflow(
    priceCoverageResult.value.rebuildTransactions,
    params.confirmedLinks,
    params.fxRateProvider,
    {
      accountingExclusionPolicy: params.accountingExclusionPolicy,
      assetReviewSummaries: params.assetReviewSummaries,
      taxAssetIdentityPolicy: params.input.config.taxAssetIdentityPolicy,
    }
  );
  if (acbWorkflowResult.isErr()) {
    return err(acbWorkflowResult.error);
  }

  const calculation = buildCanadaCalculation(params.input, acbWorkflowResult.value.inputContext);
  const superficialLossResult = runCanadaSuperficialLossEngine({
    inputContext: acbWorkflowResult.value.inputContext,
    acbEngineResult: acbWorkflowResult.value.acbEngineResult,
  });
  if (superficialLossResult.isErr()) {
    return err(superficialLossResult.error);
  }

  const augmentedInputContext = appendCanadaAdjustmentEvents(
    acbWorkflowResult.value.inputContext,
    superficialLossResult.value.adjustmentEvents
  );
  const adjustedAcbEngineResult = runCanadaAcbEngine(augmentedInputContext);
  if (adjustedAcbEngineResult.isErr()) {
    return err(adjustedAcbEngineResult.error);
  }

  const poolSnapshotInputContext =
    params.poolSnapshotStrategy === 'report-end'
      ? filterCanadaInputContextToReportEnd(augmentedInputContext, params.input.config.endDate)
      : augmentedInputContext;
  const poolSnapshotResult = runCanadaAcbEngine(poolSnapshotInputContext);
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

  const displayReportResult = await buildCanadaDisplayCostBasisReport({
    taxReport: taxReportResult.value,
    displayCurrency: params.input.config.currency as Currency,
    fxProvider: params.fxRateProvider,
  });
  if (displayReportResult.isErr()) {
    return err(displayReportResult.error);
  }

  return ok({
    kind: 'canada-workflow',
    calculation,
    taxReport: taxReportResult.value,
    displayReport: displayReportResult.value,
    inputContext: acbWorkflowResult.value.inputContext,
    executionMeta,
  });
}

function buildCanadaCalculation(
  input: CostBasisInput,
  inputContext: { inputEvents: { assetSymbol: Currency }[]; scopedTransactionIds: number[] }
): CanadaCostBasisCalculation {
  const calculationDate = new Date();
  const assetsProcessed = [...new Set(inputContext.inputEvents.map((event) => event.assetSymbol))];

  return {
    id: globalThis.crypto.randomUUID(),
    calculationDate,
    method: 'average-cost',
    jurisdiction: 'CA',
    taxYear: input.config.taxYear,
    displayCurrency: input.config.currency as Currency,
    taxCurrency: 'CAD',
    startDate: input.config.startDate,
    endDate: input.config.endDate,
    transactionsProcessed: inputContext.scopedTransactionIds.length,
    assetsProcessed,
  };
}

function appendCanadaAdjustmentEvents(
  inputContext: CanadaTaxInputContext,
  adjustmentEvents: CanadaTaxInputContext['inputEvents']
): CanadaTaxInputContext {
  return {
    ...inputContext,
    inputEvents: [...inputContext.inputEvents, ...adjustmentEvents],
  };
}

function filterCanadaInputContextToReportEnd(
  inputContext: CanadaTaxInputContext,
  reportEndDate: Date
): CanadaTaxInputContext {
  return {
    ...inputContext,
    inputEvents: inputContext.inputEvents.filter((event) => event.timestamp.getTime() <= reportEndDate.getTime()),
  };
}
