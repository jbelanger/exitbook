import { err, ok, type Result, wrapError } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { resolveCostBasisJurisdictionRules } from '../jurisdictions/registry.js';
import type {
  StandardLedgerCarry,
  StandardLedgerLot,
  StandardLedgerLotProvenance,
  StandardLedgerLotSelectionSlice,
  StandardLedgerBasisStatus,
} from '../standard/operation-engine/standard-ledger-operation-engine.js';
import type {
  StandardCostBasisWorkflowResult,
  StandardLedgerCostBasisWorkflowResult,
} from '../workflow/workflow-result-types.js';

import {
  buildCostBasisFilingAssetSummaries,
  buildCostBasisFilingFactsSummary,
} from './filing-facts-summary-builder.js';
import type {
  StandardCostBasisAcquisitionFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisFilingFacts,
  StandardCostBasisTransferFilingFact,
  StandardLedgerCostBasisAcquisitionFilingFact,
  StandardLedgerCostBasisDispositionFilingFact,
  StandardLedgerCostBasisFilingFacts,
  StandardLedgerCostBasisTransferFilingFact,
} from './filing-facts-types.js';

type StandardTaxTreatmentCategory = 'short_term' | 'long_term';

interface BuildStandardCostBasisFilingFactsInput {
  artifact: StandardCostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}

interface BuildStandardLedgerCostBasisFilingFactsInput {
  artifact: StandardLedgerCostBasisWorkflowResult;
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

export function buildStandardLedgerCostBasisFilingFacts(
  input: BuildStandardLedgerCostBasisFilingFactsInput
): Result<StandardLedgerCostBasisFilingFacts, Error> {
  try {
    const { calculation } = input.artifact;
    const jurisdiction = calculation.config.jurisdiction;
    const rulesResult = resolveCostBasisJurisdictionRules(jurisdiction);
    if (rulesResult.isErr()) {
      return err(rulesResult.error);
    }

    const blockerIds = input.artifact.engineResult.blockers.map((blocker) => blocker.blockerId);
    if (blockerIds.length > 0) {
      return err(
        new Error(
          `Cannot build standard ledger filing facts while calculation blockers remain: ${blockerIds.join(', ')}`
        )
      );
    }

    const jurisdictionRules = rulesResult.value;
    const lotsById = new Map(input.artifact.engineResult.lots.map((lot) => [lot.id, lot]));
    const acquisitions: StandardLedgerCostBasisAcquisitionFilingFact[] = [];
    for (const lot of input.artifact.engineResult.lots) {
      const pricedLotResult = requirePricedStandardLedgerLot(lot.id, {
        basisStatus: lot.basisStatus,
        costBasisPerUnit: lot.costBasisPerUnit,
        totalCostBasis: lot.totalCostBasis,
      });
      if (pricedLotResult.isErr()) {
        return err(pricedLotResult.error);
      }

      acquisitions.push({
        kind: 'standard-ledger-acquisition',
        id: lot.id,
        assetId: lot.assetId,
        assetSymbol: lot.assetSymbol,
        chainKey: lot.chainKey,
        acquiredAt: lot.acquisitionDate,
        quantity: lot.originalQuantity,
        remainingQuantity: lot.remainingQuantity,
        totalCostBasis: pricedLotResult.value.totalCostBasis,
        costBasisPerUnit: pricedLotResult.value.costBasisPerUnit,
        operationId: lot.provenance.operationId,
        sourceEventId: getStandardLedgerLotSourceEventId(lot.provenance),
        provenance: lot.provenance,
        status: deriveStandardLedgerLotStatus(lot),
      });
    }

    const dispositions: StandardLedgerCostBasisDispositionFilingFact[] = [];
    for (const disposal of input.artifact.engineResult.disposals) {
      if (disposal.quantity.isZero()) {
        return err(new Error(`Cannot build filing-facts disposal ${disposal.id} with zero quantity`));
      }

      disposal.slices.forEach((slice, sliceIndex) => {
        const sourceLot = lotsById.get(slice.lotId);
        if (!sourceLot) {
          throw new Error(`Missing source lot ${slice.lotId} for standard ledger disposal ${disposal.id}`);
        }

        const pricedSlice = requirePricedStandardLedgerLotSelectionSlice(disposal.id, slice);
        if (pricedSlice.isErr()) {
          throw pricedSlice.error;
        }

        const totalProceeds = disposal.grossProceeds.times(slice.quantity).div(disposal.quantity);
        const gainLoss = totalProceeds.minus(pricedSlice.value.costBasis);
        const holdingPeriodDays = calculateHoldingPeriodDays(slice.acquisitionDate, disposal.disposalDate);

        dispositions.push({
          kind: 'standard-ledger-disposition',
          id: `${disposal.id}:slice:${sliceIndex + 1}`,
          disposalId: disposal.id,
          operationId: disposal.operationId,
          sliceIndex,
          sourceLotId: slice.lotId,
          assetId: disposal.assetId,
          assetSymbol: disposal.assetSymbol,
          chainKey: disposal.chainKey,
          acquiredAt: slice.acquisitionDate,
          disposedAt: disposal.disposalDate,
          quantity: slice.quantity,
          proceedsPerUnit: totalProceeds.div(slice.quantity),
          totalProceeds,
          totalCostBasis: pricedSlice.value.costBasis,
          costBasisPerUnit: pricedSlice.value.costBasisPerUnit,
          gainLoss,
          taxableGainLoss: jurisdictionRules.calculateTaxableGain(gainLoss, holdingPeriodDays),
          deniedLossAmount: new Decimal(0),
          taxTreatmentCategory: normalizeStandardTaxTreatmentCategory({
            jurisdiction,
            acquiredAt: slice.acquisitionDate,
            disposedAt: disposal.disposalDate,
          }),
          holdingPeriodDays,
          grossProceeds: totalProceeds,
          lossDisallowed: false,
        });
      });
    }

    const transfers: StandardLedgerCostBasisTransferFilingFact[] = [];
    for (const carry of input.artifact.engineResult.carries) {
      carry.slices.forEach((slice, sliceIndex) => {
        if (slice.targetQuantity.isZero()) {
          throw new Error(`Cannot build filing-facts transfer ${carry.id} slice ${sliceIndex + 1} with zero quantity`);
        }
        if (!slice.costBasis) {
          throw new Error(
            `Cannot build filing-facts transfer ${carry.id} slice ${sliceIndex + 1} with unresolved basis`
          );
        }

        const referenceLotId = slice.targetLotId ?? slice.sourceLotId;
        if (!referenceLotId) {
          throw new Error(`Missing lot reference for standard ledger transfer ${carry.id} slice ${sliceIndex + 1}`);
        }

        const referenceLot = lotsById.get(referenceLotId);
        if (!referenceLot) {
          throw new Error(
            `Missing reference lot ${referenceLotId} for standard ledger transfer ${carry.id} slice ${sliceIndex + 1}`
          );
        }

        transfers.push({
          kind: 'standard-ledger-transfer',
          id: `${carry.id}:slice:${sliceIndex + 1}`,
          assetId: referenceLot.assetId,
          assetSymbol: referenceLot.assetSymbol,
          transferredAt: getStandardLedgerCarryTransferDate(carry),
          quantity: slice.targetQuantity,
          totalCostBasis: slice.costBasis,
          costBasisPerUnit: slice.costBasis.div(slice.targetQuantity),
          operationId: carry.operationId,
          relationshipKind: carry.relationshipKind,
          relationshipStableKey: carry.relationshipStableKey,
          sourceChainKey: slice.sourceChainKey,
          ...(slice.sourceLotId === undefined ? {} : { sourceLotId: slice.sourceLotId }),
          sourceQuantity: slice.sourceQuantity,
          targetChainKey: slice.targetChainKey,
          ...(slice.targetLotId === undefined ? {} : { targetLotId: slice.targetLotId }),
          targetQuantity: slice.targetQuantity,
        });
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
      kind: 'standard-ledger',
      calculationId: calculation.id,
      jurisdiction,
      method: calculation.config.method,
      taxYear: calculation.config.taxYear,
      taxCurrency: calculation.config.currency,
      scopeKey: input.scopeKey,
      snapshotId: input.snapshotId,
      summary,
      assetSummaries,
      acquisitions,
      dispositions,
      transfers,
    });
  } catch (error) {
    return wrapError(error, 'Failed to build standard ledger filing facts');
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

function requirePricedStandardLedgerLot(
  lotId: string,
  lot: {
    basisStatus: StandardLedgerBasisStatus;
    costBasisPerUnit?: Decimal | undefined;
    totalCostBasis?: Decimal | undefined;
  }
): Result<{ costBasisPerUnit: Decimal; totalCostBasis: Decimal }, Error> {
  if (lot.basisStatus !== 'priced' || lot.costBasisPerUnit === undefined || lot.totalCostBasis === undefined) {
    return err(new Error(`Cannot build filing facts for unresolved-basis standard ledger lot ${lotId}`));
  }

  return ok({
    costBasisPerUnit: lot.costBasisPerUnit,
    totalCostBasis: lot.totalCostBasis,
  });
}

function requirePricedStandardLedgerLotSelectionSlice(
  disposalId: string,
  slice: StandardLedgerLotSelectionSlice
): Result<{ costBasis: Decimal; costBasisPerUnit: Decimal }, Error> {
  if (slice.basisStatus !== 'priced' || slice.costBasis === undefined || slice.costBasisPerUnit === undefined) {
    return err(new Error(`Cannot build filing facts for unresolved-basis standard ledger disposal ${disposalId}`));
  }

  return ok({
    costBasis: slice.costBasis,
    costBasisPerUnit: slice.costBasisPerUnit,
  });
}

function getStandardLedgerLotSourceEventId(provenance: StandardLedgerLotProvenance): string {
  return provenance.kind === 'acquire-operation' ? provenance.sourceEventId : provenance.targetLegSourceEventId;
}

function deriveStandardLedgerLotStatus(lot: StandardLedgerLot): StandardCostBasisAcquisitionFilingFact['status'] {
  if (lot.remainingQuantity.isZero()) {
    return 'fully_disposed';
  }

  if (lot.remainingQuantity.eq(lot.originalQuantity)) {
    return 'open';
  }

  return 'partially_disposed';
}

function getStandardLedgerCarryTransferDate(carry: StandardLedgerCarry): Date {
  const firstLeg = carry.targetLegs[0] ?? carry.sourceLegs[0];
  if (!firstLeg) {
    throw new Error(`Missing carry leg timestamp for standard ledger transfer ${carry.id}`);
  }

  return firstLeg.timestamp;
}

function classifyUsTaxTreatmentCategory(acquiredAt: Date, disposedAt: Date): StandardTaxTreatmentCategory {
  return isLongTermUsHolding(acquiredAt, disposedAt) ? 'long_term' : 'short_term';
}

function calculateHoldingPeriodDays(acquiredAt: Date, disposedAt: Date): number {
  const acquiredDate = toUtcCalendarDate(acquiredAt);
  const disposedDate = toUtcCalendarDate(disposedAt);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.max(0, Math.floor((disposedDate.getTime() - acquiredDate.getTime()) / millisecondsPerDay));
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
