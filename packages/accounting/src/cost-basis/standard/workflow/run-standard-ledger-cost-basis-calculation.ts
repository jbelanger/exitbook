import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, randomUUID, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { AccountingExclusionPolicy } from '../../../accounting-model/accounting-exclusion-policy.js';
import { collectBlockingAssetReviewSummaries } from '../../../accounting-model/asset-review-preflight.js';
import type { CostBasisLedgerFacts } from '../../../ports/cost-basis-ledger-persistence.js';
import { resolveCostBasisJurisdictionRules } from '../../jurisdictions/registry.js';
import type { ValidatedCostBasisConfig } from '../../workflow/cost-basis-input.js';
import { validateCostBasisInput } from '../../workflow/cost-basis-input.js';
import type {
  StandardLedgerCostBasisCalculation,
  StandardLedgerCostBasisExecutionMeta,
  StandardLedgerCostBasisProjectionAudit,
  StandardLedgerCostBasisWorkflowResult,
} from '../../workflow/workflow-result-types.js';
import {
  runStandardLedgerOperationPipeline,
  type RunStandardLedgerOperationPipelineInput,
  type StandardLedgerOperationPipelineResult,
} from '../operation-engine/standard-ledger-operation-pipeline.js';

export interface RunStandardLedgerCostBasisCalculationInput {
  calculationDate?: Date | undefined;
  calculationId?: string | undefined;
  completedAt?: Date | undefined;
  config: ValidatedCostBasisConfig;
  ledgerFacts: CostBasisLedgerFacts;
  options?: StandardLedgerCostBasisCalculationOptions | undefined;
}

export interface StandardLedgerCostBasisCalculationOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  identityConfig?: RunStandardLedgerOperationPipelineInput['identityConfig'] | undefined;
}

export function runStandardLedgerCostBasisCalculation(
  input: RunStandardLedgerCostBasisCalculationInput
): Result<StandardLedgerCostBasisWorkflowResult, Error> {
  const validationResult = validateCostBasisInput(input.config);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  if (input.config.jurisdiction === 'CA') {
    return err(new Error('Canada (CA) cost basis must run through the specialized Canada workflow'));
  }
  const jurisdictionRulesResult = resolveCostBasisJurisdictionRules(input.config.jurisdiction);
  if (jurisdictionRulesResult.isErr()) {
    return err(jurisdictionRulesResult.error);
  }

  const assetReviewResult = assertNoLedgerAssetsRequireReview(
    input.ledgerFacts,
    input.options?.accountingExclusionPolicy,
    input.options?.assetReviewSummaries
  );
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const calculationId = input.calculationId ?? randomUUID();
  const pipelineResult = runStandardLedgerOperationPipeline({
    calculationId,
    excludedAssetIds: input.options?.accountingExclusionPolicy?.excludedAssetIds,
    identityConfig: input.options?.identityConfig,
    ledgerFacts: input.ledgerFacts,
    method: input.config.method,
  });
  if (pipelineResult.isErr()) {
    return err(pipelineResult.error);
  }

  const calculationDate = input.calculationDate ?? new Date();
  const completedAt = input.completedAt ?? new Date();
  const reportableDisposals = pipelineResult.value.engineResult.disposals.filter(
    (disposal) => disposal.disposalDate >= input.config.startDate && disposal.disposalDate <= input.config.endDate
  );
  const calculation = buildStandardLedgerCostBasisCalculation({
    calculationDate,
    calculationId,
    completedAt,
    config: input.config,
    eventsProjected: pipelineResult.value.eventProjection.events.length,
    operationsProcessed: pipelineResult.value.operationProjection.operations.length,
    reportableDisposals,
    blockersProduced:
      pipelineResult.value.eventProjection.blockers.length +
      pipelineResult.value.operationProjection.blockers.length +
      pipelineResult.value.engineResult.blockers.length,
    lotsCreated: pipelineResult.value.engineResult.lots.length,
  });
  const projection = buildStandardLedgerCostBasisProjectionAudit(pipelineResult.value);
  const executionMeta = buildStandardLedgerCostBasisExecutionMeta(
    projection,
    pipelineResult.value.engineResult.blockers
  );

  return ok({
    kind: 'standard-ledger-workflow',
    calculation,
    projection,
    engineResult: pipelineResult.value.engineResult,
    executionMeta,
  });
}

function assertNoLedgerAssetsRequireReview(
  facts: CostBasisLedgerFacts,
  accountingExclusionPolicy?: AccountingExclusionPolicy  ,
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>  
): Result<void, Error> {
  const assetsInScope = new Set<string>();
  for (const posting of facts.postings) {
    if (accountingExclusionPolicy?.excludedAssetIds.has(posting.assetId) === true) {
      continue;
    }
    assetsInScope.add(posting.assetId);
  }

  const flaggedAssets = collectBlockingAssetReviewSummaries(assetsInScope, assetReviewSummaries);
  if (flaggedAssets.length === 0) {
    return ok(undefined);
  }

  return err(new Error(formatLedgerAssetReviewMessage(flaggedAssets)));
}

function formatLedgerAssetReviewMessage(assets: AssetReviewSummary[]): string {
  const lines = [
    'Assets flagged for review require confirmation or exclusion before standard ledger cost basis can proceed:',
  ];
  for (const asset of assets) {
    lines.push(`- ${asset.assetId}: ${asset.warningSummary ?? 'Suspicious asset evidence requires review'}`);
  }
  return lines.join('\n');
}

function buildStandardLedgerCostBasisCalculation(input: {
  blockersProduced: number;
  calculationDate: Date;
  calculationId: string;
  completedAt: Date;
  config: ValidatedCostBasisConfig;
  eventsProjected: number;
  lotsCreated: number;
  operationsProcessed: number;
  reportableDisposals: readonly {
    assetSymbol: string;
    costBasis: Decimal;
    gainLoss: Decimal;
    grossProceeds: Decimal;
  }[];
}): StandardLedgerCostBasisCalculation {
  const totalProceeds = sumDecimals(input.reportableDisposals.map((disposal) => disposal.grossProceeds));
  const totalCostBasis = sumDecimals(input.reportableDisposals.map((disposal) => disposal.costBasis));
  const totalGainLoss = sumDecimals(input.reportableDisposals.map((disposal) => disposal.gainLoss));

  return {
    id: input.calculationId,
    calculationDate: input.calculationDate,
    config: input.config,
    startDate: input.config.startDate,
    endDate: input.config.endDate,
    totalProceeds,
    totalCostBasis,
    totalGainLoss,
    totalTaxableGainLoss: totalGainLoss,
    assetsProcessed: [...new Set(input.reportableDisposals.map((disposal) => String(disposal.assetSymbol)))].sort(),
    eventsProjected: input.eventsProjected,
    operationsProcessed: input.operationsProcessed,
    lotsCreated: input.lotsCreated,
    disposalsProcessed: input.reportableDisposals.length,
    blockersProduced: input.blockersProduced,
    status: 'completed',
    createdAt: input.calculationDate,
    completedAt: input.completedAt,
  };
}

function buildStandardLedgerCostBasisProjectionAudit(
  pipelineResult: StandardLedgerOperationPipelineResult
): StandardLedgerCostBasisProjectionAudit {
  return {
    eventIds: pipelineResult.eventProjection.events.map((event) => event.eventId),
    operationIds: pipelineResult.operationProjection.operations.map((operation) => operation.operationId),
    projectionBlockers: pipelineResult.eventProjection.blockers,
    operationBlockers: pipelineResult.operationProjection.blockers,
    excludedPostings: pipelineResult.eventProjection.excludedPostings,
    exclusionFingerprint: pipelineResult.eventProjection.exclusionFingerprint,
  };
}

function buildStandardLedgerCostBasisExecutionMeta(
  projection: StandardLedgerCostBasisProjectionAudit,
  calculationBlockers: readonly { blockerId: string; message: string }[]
): StandardLedgerCostBasisExecutionMeta {
  return {
    calculationBlockerIds: calculationBlockers.map((blocker) => blocker.blockerId),
    eventIds: projection.eventIds,
    excludedPostingFingerprints: projection.excludedPostings.map((posting) => posting.postingFingerprint),
    exclusionFingerprint: projection.exclusionFingerprint,
    operationBlockerIds: projection.operationBlockers.map((blocker) => blocker.blockerId),
    operationIds: projection.operationIds,
    projectionBlockerMessages: projection.projectionBlockers.map((blocker) => blocker.message),
  };
}

function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0));
}
