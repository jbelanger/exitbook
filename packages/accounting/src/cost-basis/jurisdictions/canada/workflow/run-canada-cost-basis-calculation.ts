import type { AssetReviewSummary, Transaction, TransactionLink } from '@exitbook/core';
import { err, ok, randomUUID, type Currency, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { AccountingExclusionPolicy } from '../../../standard/validation/accounting-exclusion-policy.js';
import type { ValidatedCostBasisConfig } from '../../../workflow/cost-basis-input.js';
import { getCostBasisRebuildTransactions } from '../../../workflow/price-completeness.js';
import type { CostBasisExecutionMeta, CanadaCostBasisWorkflowResult } from '../../../workflow/workflow-result-types.js';
import { buildCanadaDisplayCostBasisReport, buildCanadaTaxReport } from '../tax/canada-tax-report-builder.js';
import type { CanadaCostBasisCalculation, CanadaTaxInputContext } from '../tax/canada-tax-types.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';
import { runCanadaAcbWorkflow } from './canada-acb-workflow.js';
import { runCanadaSuperficialLossEngine } from './canada-superficial-loss-engine.js';

const logger = getLogger('run-canada-cost-basis-calculation');

interface RunCanadaCostBasisCalculationParams {
  input: ValidatedCostBasisConfig;
  transactions: Transaction[];
  confirmedLinks: TransactionLink[];
  priceRuntime: IPriceProviderRuntime;
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

  const acbWorkflowResult = await runCanadaAcbWorkflow({
    transactions: priceCoverageResult.value.rebuildTransactions,
    confirmedLinks: params.confirmedLinks,
    priceRuntime: params.priceRuntime,
    accountingExclusionPolicy: params.accountingExclusionPolicy,
    assetReviewSummaries: params.assetReviewSummaries,
    taxAssetIdentityPolicy: params.input.taxAssetIdentityPolicy,
  });
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
      ? filterCanadaInputContextToReportEnd(augmentedInputContext, params.input.endDate)
      : augmentedInputContext;
  const poolSnapshotResult = runCanadaAcbEngine(poolSnapshotInputContext);
  if (poolSnapshotResult.isErr()) {
    return err(poolSnapshotResult.error);
  }

  const taxReportResult = buildCanadaTaxReport({
    calculation,
    inputContext: augmentedInputContext,
    acbEngineResult: adjustedAcbEngineResult.value,
    poolStateEngineResult: poolSnapshotResult.value,
    superficialLossEngineResult: superficialLossResult.value,
  });
  if (taxReportResult.isErr()) {
    return err(taxReportResult.error);
  }

  const displayReportResult = await buildCanadaDisplayCostBasisReport({
    taxReport: taxReportResult.value,
    displayCurrency: params.input.currency as Currency,
    priceRuntime: params.priceRuntime,
  });
  if (displayReportResult.isErr()) {
    return err(displayReportResult.error);
  }

  return ok({
    kind: 'canada-workflow',
    calculation,
    taxReport: taxReportResult.value,
    displayReport: displayReportResult.value,
    inputContext: augmentedInputContext,
    executionMeta,
  });
}

function buildCanadaCalculation(
  input: ValidatedCostBasisConfig,
  inputContext: { inputEvents: { assetSymbol: Currency }[]; scopedTransactionIds: number[] }
): CanadaCostBasisCalculation {
  const calculationDate = new Date();
  const assetsProcessed = [...new Set(inputContext.inputEvents.map((event) => event.assetSymbol))];

  return {
    id: randomUUID(),
    calculationDate,
    method: 'average-cost',
    jurisdiction: 'CA',
    taxYear: input.taxYear,
    displayCurrency: input.currency as Currency,
    taxCurrency: 'CAD',
    startDate: input.startDate,
    endDate: input.endDate,
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
