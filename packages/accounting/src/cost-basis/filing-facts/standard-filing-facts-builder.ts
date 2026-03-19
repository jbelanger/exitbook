import { err, ok, type Result, wrapError } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import { resolveCostBasisJurisdictionRules } from '../jurisdictions/registry.js';
import type { StandardCostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import {
  buildCostBasisFilingAssetSummaries,
  buildCostBasisFilingFactsSummary,
} from './filing-facts-summary-builder.js';
import type {
  StandardCostBasisAcquisitionFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisFilingFacts,
  StandardCostBasisTransferFilingFact,
} from './filing-facts-types.js';

type StandardTaxTreatmentCategory = 'short_term' | 'long_term';

interface BuildStandardCostBasisFilingFactsInput {
  artifact: StandardCostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}

export function buildStandardCostBasisFilingFacts(
  input: BuildStandardCostBasisFilingFactsInput
): Result<StandardCostBasisFilingFacts, Error> {
  try {
    const jurisdiction = input.artifact.summary.calculation.config.jurisdiction;
    const rulesResult = resolveCostBasisJurisdictionRules(jurisdiction);
    if (rulesResult.isErr()) {
      return err(rulesResult.error);
    }

    const jurisdictionRules = rulesResult.value;
    const lotsById = new Map(input.artifact.lots.map((lot) => [lot.id, lot]));
    const acquisitions: StandardCostBasisAcquisitionFilingFact[] = input.artifact.lots.map((lot) => ({
      kind: 'standard-acquisition',
      id: lot.id,
      assetId: lot.assetId,
      assetSymbol: lot.assetSymbol,
      acquiredAt: lot.acquisitionDate,
      quantity: lot.quantity,
      remainingQuantity: lot.remainingQuantity,
      totalCostBasis: lot.totalCostBasis,
      costBasisPerUnit: lot.costBasisPerUnit,
      transactionId: lot.acquisitionTransactionId,
      status: lot.status,
    }));

    const dispositions: StandardCostBasisDispositionFilingFact[] = [];
    for (const disposal of input.artifact.disposals) {
      const sourceLot = lotsById.get(disposal.lotId);
      if (!sourceLot) {
        return err(new Error(`Missing source lot ${disposal.lotId} for filing-facts disposal ${disposal.id}`));
      }
      const lossDisallowed = disposal.lossDisallowed === true;

      dispositions.push({
        kind: 'standard-disposition',
        id: disposal.id,
        lotId: disposal.lotId,
        assetId: sourceLot.assetId,
        assetSymbol: sourceLot.assetSymbol,
        acquiredAt: sourceLot.acquisitionDate,
        disposedAt: disposal.disposalDate,
        quantity: disposal.quantityDisposed,
        proceedsPerUnit: disposal.proceedsPerUnit,
        totalProceeds: disposal.totalProceeds,
        totalCostBasis: disposal.totalCostBasis,
        costBasisPerUnit: disposal.costBasisPerUnit,
        gainLoss: disposal.gainLoss,
        taxableGainLoss: lossDisallowed
          ? new Decimal(0)
          : jurisdictionRules.calculateTaxableGain(disposal.gainLoss, disposal.holdingPeriodDays),
        deniedLossAmount: disposal.disallowedLossAmount ?? new Decimal(0),
        taxTreatmentCategory: normalizeStandardTaxTreatmentCategory({
          jurisdiction,
          acquiredAt: sourceLot.acquisitionDate,
          disposedAt: disposal.disposalDate,
          artifactTaxTreatmentCategory: disposal.taxTreatmentCategory,
        }),
        holdingPeriodDays: disposal.holdingPeriodDays,
        acquisitionTransactionId: sourceLot.acquisitionTransactionId,
        disposalTransactionId: disposal.disposalTransactionId,
        grossProceeds: disposal.grossProceeds,
        sellingExpenses: disposal.sellingExpenses,
        netProceeds: disposal.netProceeds,
        lossDisallowed,
      });
    }

    const transfers: StandardCostBasisTransferFilingFact[] = [];
    for (const transfer of input.artifact.lotTransfers) {
      const sourceLot = lotsById.get(transfer.sourceLotId);
      if (!sourceLot) {
        return err(new Error(`Missing source lot ${transfer.sourceLotId} for filing-facts transfer ${transfer.id}`));
      }

      transfers.push({
        kind: 'standard-transfer',
        id: transfer.id,
        sourceLotId: transfer.sourceLotId,
        assetId: sourceLot.assetId,
        assetSymbol: sourceLot.assetSymbol,
        transferredAt: transfer.transferDate,
        quantity: transfer.quantityTransferred,
        totalCostBasis: transfer.costBasisPerUnit.times(transfer.quantityTransferred),
        costBasisPerUnit: transfer.costBasisPerUnit,
        sourceTransactionId: transfer.sourceTransactionId,
        targetTransactionId: transfer.targetTransactionId,
        provenanceKind: transfer.provenance.kind,
        sourceAcquiredAt: sourceLot.acquisitionDate,
        ...(transfer.provenance.kind === 'confirmed-link' ? { linkedConfirmedLinkId: transfer.provenance.linkId } : {}),
        ...(transfer.metadata?.sameAssetFeeUsdValue
          ? { sameAssetFeeAmount: transfer.metadata.sameAssetFeeUsdValue }
          : {}),
      });
    }

    const assetSummaries = buildCostBasisFilingAssetSummaries({
      acquisitions,
      dispositions,
      transfers,
    });
    const summary = buildCostBasisFilingFactsSummary({
      acquisitions,
      dispositions,
      transfers,
      assetSummaries,
    });

    return ok({
      kind: 'standard',
      calculationId: input.artifact.summary.calculation.id,
      jurisdiction,
      method: input.artifact.summary.calculation.config.method,
      taxYear: input.artifact.summary.calculation.config.taxYear,
      taxCurrency: input.artifact.summary.calculation.config.currency,
      scopeKey: input.scopeKey,
      snapshotId: input.snapshotId,
      summary,
      assetSummaries,
      acquisitions,
      dispositions,
      transfers,
    });
  } catch (error) {
    return wrapError(error, 'Failed to build standard filing facts');
  }
}

function normalizeStandardTaxTreatmentCategory(input: {
  acquiredAt: Date;
  artifactTaxTreatmentCategory?: string | undefined;
  disposedAt: Date;
  jurisdiction: string;
}): string | undefined {
  if (input.jurisdiction !== 'US') {
    return input.artifactTaxTreatmentCategory;
  }

  return classifyUsTaxTreatmentCategory(input.acquiredAt, input.disposedAt);
}

function classifyUsTaxTreatmentCategory(acquiredAt: Date, disposedAt: Date): StandardTaxTreatmentCategory {
  return isLongTermUsHolding(acquiredAt, disposedAt) ? 'long_term' : 'short_term';
}

function isLongTermUsHolding(acquiredAt: Date, disposedAt: Date): boolean {
  const acquisitionDate = toUtcCalendarDate(acquiredAt);
  const disposalDate = toUtcCalendarDate(disposedAt);
  const oneYearAnniversary = new Date(acquisitionDate.getTime());
  oneYearAnniversary.setUTCFullYear(oneYearAnniversary.getUTCFullYear() + 1);

  // US long-term treatment starts only after the one-year anniversary date.
  return disposalDate.getTime() > oneYearAnniversary.getTime();
}

function toUtcCalendarDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
