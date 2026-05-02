import { parseDecimal } from '@exitbook/foundation';

import type {
  LedgerCostBasisExcludedPosting,
  LedgerCostBasisPostingBlocker,
  LedgerCostBasisProjectionBlocker,
  LedgerCostBasisRelationshipBlocker,
} from '../ledger/ledger-cost-basis-event-projection.js';
import type {
  LedgerCostBasisCarryLeg,
  LedgerCostBasisOperationBlocker,
} from '../ledger/ledger-cost-basis-operation-projection.js';
import type {
  StandardLedgerCalculationBlocker,
  StandardLedgerCarry,
  StandardLedgerCarrySlice,
  StandardLedgerDisposal,
  StandardLedgerLot,
  StandardLedgerLotSelectionSlice,
  StandardLedgerOperationEngineResult,
} from '../standard/operation-engine/standard-ledger-operation-engine.js';
import type {
  StandardLedgerCostBasisCalculation,
  StandardLedgerCostBasisExecutionMeta,
  StandardLedgerCostBasisProjectionAudit,
  StandardLedgerCostBasisWorkflowResult,
} from '../workflow/workflow-result-types.js';

import type { StoredStandardLedgerArtifact } from './artifact-storage-schemas.js';

export function toStoredStandardLedgerArtifact(
  result: StandardLedgerCostBasisWorkflowResult
): StoredStandardLedgerArtifact {
  return {
    kind: 'standard-ledger-workflow',
    calculation: toStoredStandardLedgerCalculation(result.calculation),
    projection: toStoredStandardLedgerProjectionAudit(result.projection),
    engineResult: toStoredStandardLedgerOperationEngineResult(result.engineResult),
    executionMeta: toStoredStandardLedgerExecutionMeta(result.executionMeta),
  };
}

export function fromStoredStandardLedgerArtifact(
  artifact: StoredStandardLedgerArtifact
): StandardLedgerCostBasisWorkflowResult {
  return {
    kind: 'standard-ledger-workflow',
    calculation: fromStoredStandardLedgerCalculation(artifact.calculation),
    projection: fromStoredStandardLedgerProjectionAudit(artifact.projection),
    engineResult: fromStoredStandardLedgerOperationEngineResult(artifact.engineResult),
    executionMeta: fromStoredStandardLedgerExecutionMeta(artifact.executionMeta),
  };
}

function toStoredStandardLedgerCalculation(
  calculation: StandardLedgerCostBasisCalculation
): StoredStandardLedgerArtifact['calculation'] {
  return {
    id: calculation.id,
    calculationDate: calculation.calculationDate.toISOString(),
    config: {
      method: calculation.config.method,
      currency: calculation.config.currency,
      jurisdiction: calculation.config.jurisdiction,
      taxYear: calculation.config.taxYear,
      startDate: calculation.startDate.toISOString(),
      endDate: calculation.endDate.toISOString(),
      ...(calculation.config.specificLotSelectionStrategy
        ? { specificLotSelectionStrategy: calculation.config.specificLotSelectionStrategy }
        : {}),
    },
    startDate: calculation.startDate.toISOString(),
    endDate: calculation.endDate.toISOString(),
    totalProceeds: calculation.totalProceeds.toFixed(),
    totalCostBasis: calculation.totalCostBasis.toFixed(),
    totalGainLoss: calculation.totalGainLoss.toFixed(),
    totalTaxableGainLoss: calculation.totalTaxableGainLoss.toFixed(),
    assetsProcessed: calculation.assetsProcessed,
    eventsProjected: calculation.eventsProjected,
    operationsProcessed: calculation.operationsProcessed,
    lotsCreated: calculation.lotsCreated,
    disposalsProcessed: calculation.disposalsProcessed,
    blockersProduced: calculation.blockersProduced,
    status: calculation.status,
    ...(calculation.errorMessage === undefined ? {} : { errorMessage: calculation.errorMessage }),
    createdAt: calculation.createdAt.toISOString(),
    ...(calculation.completedAt === undefined ? {} : { completedAt: calculation.completedAt.toISOString() }),
  };
}

function fromStoredStandardLedgerCalculation(
  calculation: StoredStandardLedgerArtifact['calculation']
): StandardLedgerCostBasisCalculation {
  return {
    id: calculation.id,
    calculationDate: new Date(calculation.calculationDate),
    config: {
      method: calculation.config.method,
      currency: calculation.config.currency,
      jurisdiction: calculation.config.jurisdiction,
      taxYear: calculation.config.taxYear,
      startDate: new Date(calculation.config.startDate),
      endDate: new Date(calculation.config.endDate),
      ...(calculation.config.specificLotSelectionStrategy === undefined
        ? {}
        : { specificLotSelectionStrategy: calculation.config.specificLotSelectionStrategy }),
    },
    startDate: new Date(calculation.startDate),
    endDate: new Date(calculation.endDate),
    totalProceeds: parseDecimal(calculation.totalProceeds),
    totalCostBasis: parseDecimal(calculation.totalCostBasis),
    totalGainLoss: parseDecimal(calculation.totalGainLoss),
    totalTaxableGainLoss: parseDecimal(calculation.totalTaxableGainLoss),
    assetsProcessed: calculation.assetsProcessed,
    eventsProjected: calculation.eventsProjected,
    operationsProcessed: calculation.operationsProcessed,
    lotsCreated: calculation.lotsCreated,
    disposalsProcessed: calculation.disposalsProcessed,
    blockersProduced: calculation.blockersProduced,
    status: calculation.status,
    ...(calculation.errorMessage === undefined ? {} : { errorMessage: calculation.errorMessage }),
    createdAt: new Date(calculation.createdAt),
    ...(calculation.completedAt === undefined ? {} : { completedAt: new Date(calculation.completedAt) }),
  };
}

function toStoredStandardLedgerProjectionAudit(
  projection: StandardLedgerCostBasisProjectionAudit
): StoredStandardLedgerArtifact['projection'] {
  return {
    eventIds: projection.eventIds,
    operationIds: projection.operationIds,
    projectionBlockers: projection.projectionBlockers.map(toStoredLedgerProjectionBlocker),
    operationBlockers: projection.operationBlockers.map(toStoredLedgerOperationBlocker),
    excludedPostings: projection.excludedPostings.map(toStoredStandardLedgerExcludedPosting),
    exclusionFingerprint: projection.exclusionFingerprint,
  };
}

function fromStoredStandardLedgerProjectionAudit(
  projection: StoredStandardLedgerArtifact['projection']
): StandardLedgerCostBasisProjectionAudit {
  return {
    eventIds: projection.eventIds,
    operationIds: projection.operationIds,
    projectionBlockers: projection.projectionBlockers.map(fromStoredLedgerProjectionBlocker),
    operationBlockers: projection.operationBlockers.map(fromStoredLedgerOperationBlocker),
    excludedPostings: projection.excludedPostings.map(fromStoredStandardLedgerExcludedPosting),
    exclusionFingerprint: projection.exclusionFingerprint,
  };
}

function toStoredStandardLedgerOperationEngineResult(
  result: StandardLedgerOperationEngineResult
): StoredStandardLedgerArtifact['engineResult'] {
  return {
    lots: result.lots.map(toStoredStandardLedgerLot),
    disposals: result.disposals.map(toStoredStandardLedgerDisposal),
    carries: result.carries.map(toStoredStandardLedgerCarry),
    blockers: result.blockers.map(toStoredStandardLedgerCalculationBlocker),
  };
}

function fromStoredStandardLedgerOperationEngineResult(
  result: StoredStandardLedgerArtifact['engineResult']
): StandardLedgerOperationEngineResult {
  return {
    lots: result.lots.map(fromStoredStandardLedgerLot),
    disposals: result.disposals.map(fromStoredStandardLedgerDisposal),
    carries: result.carries.map(fromStoredStandardLedgerCarry),
    blockers: result.blockers.map(fromStoredStandardLedgerCalculationBlocker),
  };
}

function toStoredStandardLedgerLot(
  lot: StandardLedgerLot
): StoredStandardLedgerArtifact['engineResult']['lots'][number] {
  return {
    id: lot.id,
    calculationId: lot.calculationId,
    chainKey: lot.chainKey,
    assetId: lot.assetId,
    assetSymbol: lot.assetSymbol,
    basisStatus: lot.basisStatus,
    ...(lot.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: lot.costBasisPerUnit.toFixed() }),
    ...(lot.totalCostBasis === undefined ? {} : { totalCostBasis: lot.totalCostBasis.toFixed() }),
    originalQuantity: lot.originalQuantity.toFixed(),
    remainingQuantity: lot.remainingQuantity.toFixed(),
    acquisitionDate: lot.acquisitionDate.toISOString(),
    provenance: lot.provenance,
  };
}

function fromStoredStandardLedgerLot(
  lot: StoredStandardLedgerArtifact['engineResult']['lots'][number]
): StandardLedgerLot {
  return {
    id: lot.id,
    calculationId: lot.calculationId,
    chainKey: lot.chainKey,
    assetId: lot.assetId,
    assetSymbol: lot.assetSymbol,
    basisStatus: lot.basisStatus,
    ...(lot.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: parseDecimal(lot.costBasisPerUnit) }),
    ...(lot.totalCostBasis === undefined ? {} : { totalCostBasis: parseDecimal(lot.totalCostBasis) }),
    originalQuantity: parseDecimal(lot.originalQuantity),
    remainingQuantity: parseDecimal(lot.remainingQuantity),
    acquisitionDate: new Date(lot.acquisitionDate),
    provenance: lot.provenance,
  };
}

function toStoredStandardLedgerDisposal(
  disposal: StandardLedgerDisposal
): StoredStandardLedgerArtifact['engineResult']['disposals'][number] {
  return {
    id: disposal.id,
    calculationId: disposal.calculationId,
    operationId: disposal.operationId,
    chainKey: disposal.chainKey,
    assetId: disposal.assetId,
    assetSymbol: disposal.assetSymbol,
    quantity: disposal.quantity.toFixed(),
    grossProceeds: disposal.grossProceeds.toFixed(),
    costBasis: disposal.costBasis.toFixed(),
    gainLoss: disposal.gainLoss.toFixed(),
    disposalDate: disposal.disposalDate.toISOString(),
    slices: disposal.slices.map(toStoredStandardLedgerLotSelectionSlice),
  };
}

function fromStoredStandardLedgerDisposal(
  disposal: StoredStandardLedgerArtifact['engineResult']['disposals'][number]
): StandardLedgerDisposal {
  return {
    id: disposal.id,
    calculationId: disposal.calculationId,
    operationId: disposal.operationId,
    chainKey: disposal.chainKey,
    assetId: disposal.assetId,
    assetSymbol: disposal.assetSymbol,
    quantity: parseDecimal(disposal.quantity),
    grossProceeds: parseDecimal(disposal.grossProceeds),
    costBasis: parseDecimal(disposal.costBasis),
    gainLoss: parseDecimal(disposal.gainLoss),
    disposalDate: new Date(disposal.disposalDate),
    slices: disposal.slices.map(fromStoredStandardLedgerLotSelectionSlice),
  };
}

function toStoredStandardLedgerLotSelectionSlice(
  slice: StandardLedgerLotSelectionSlice
): StoredStandardLedgerArtifact['engineResult']['disposals'][number]['slices'][number] {
  return {
    lotId: slice.lotId,
    quantity: slice.quantity.toFixed(),
    acquisitionDate: slice.acquisitionDate.toISOString(),
    basisStatus: slice.basisStatus,
    ...(slice.costBasis === undefined ? {} : { costBasis: slice.costBasis.toFixed() }),
    ...(slice.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: slice.costBasisPerUnit.toFixed() }),
  };
}

function fromStoredStandardLedgerLotSelectionSlice(
  slice: StoredStandardLedgerArtifact['engineResult']['disposals'][number]['slices'][number]
): StandardLedgerLotSelectionSlice {
  return {
    lotId: slice.lotId,
    quantity: parseDecimal(slice.quantity),
    acquisitionDate: new Date(slice.acquisitionDate),
    basisStatus: slice.basisStatus,
    ...(slice.costBasis === undefined ? {} : { costBasis: parseDecimal(slice.costBasis) }),
    ...(slice.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: parseDecimal(slice.costBasisPerUnit) }),
  };
}

function toStoredStandardLedgerCarry(
  carry: StandardLedgerCarry
): StoredStandardLedgerArtifact['engineResult']['carries'][number] {
  return {
    id: carry.id,
    calculationId: carry.calculationId,
    operationId: carry.operationId,
    kind: carry.kind,
    relationshipKind: carry.relationshipKind,
    relationshipStableKey: carry.relationshipStableKey,
    slices: carry.slices.map(toStoredStandardLedgerCarrySlice),
    sourceLegs: carry.sourceLegs.map(toStoredStandardLedgerCarryLeg),
    targetLegs: carry.targetLegs.map(toStoredStandardLedgerCarryLeg),
  };
}

function fromStoredStandardLedgerCarry(
  carry: StoredStandardLedgerArtifact['engineResult']['carries'][number]
): StandardLedgerCarry {
  return {
    id: carry.id,
    calculationId: carry.calculationId,
    operationId: carry.operationId,
    kind: carry.kind,
    relationshipKind: carry.relationshipKind,
    relationshipStableKey: carry.relationshipStableKey,
    slices: carry.slices.map(fromStoredStandardLedgerCarrySlice),
    sourceLegs: carry.sourceLegs.map(fromStoredStandardLedgerCarryLeg),
    targetLegs: carry.targetLegs.map(fromStoredStandardLedgerCarryLeg),
  };
}

function toStoredStandardLedgerCarrySlice(
  slice: StandardLedgerCarrySlice
): StoredStandardLedgerArtifact['engineResult']['carries'][number]['slices'][number] {
  return {
    sourceChainKey: slice.sourceChainKey,
    ...(slice.sourceLotId === undefined ? {} : { sourceLotId: slice.sourceLotId }),
    sourceQuantity: slice.sourceQuantity.toFixed(),
    targetChainKey: slice.targetChainKey,
    ...(slice.targetLotId === undefined ? {} : { targetLotId: slice.targetLotId }),
    targetQuantity: slice.targetQuantity.toFixed(),
    basisStatus: slice.basisStatus,
    ...(slice.costBasis === undefined ? {} : { costBasis: slice.costBasis.toFixed() }),
  };
}

function fromStoredStandardLedgerCarrySlice(
  slice: StoredStandardLedgerArtifact['engineResult']['carries'][number]['slices'][number]
): StandardLedgerCarrySlice {
  return {
    sourceChainKey: slice.sourceChainKey,
    ...(slice.sourceLotId === undefined ? {} : { sourceLotId: slice.sourceLotId }),
    sourceQuantity: parseDecimal(slice.sourceQuantity),
    targetChainKey: slice.targetChainKey,
    ...(slice.targetLotId === undefined ? {} : { targetLotId: slice.targetLotId }),
    targetQuantity: parseDecimal(slice.targetQuantity),
    basisStatus: slice.basisStatus,
    ...(slice.costBasis === undefined ? {} : { costBasis: parseDecimal(slice.costBasis) }),
  };
}

function toStoredStandardLedgerCarryLeg(
  leg: LedgerCostBasisCarryLeg
): StoredStandardLedgerArtifact['engineResult']['carries'][number]['sourceLegs'][number] {
  return {
    allocationId: leg.allocationId,
    sourceEventId: leg.sourceEventId,
    timestamp: leg.timestamp.toISOString(),
    sourceActivityFingerprint: leg.sourceActivityFingerprint,
    ownerAccountId: leg.ownerAccountId,
    journalFingerprint: leg.journalFingerprint,
    journalKind: leg.journalKind,
    postingFingerprint: leg.postingFingerprint,
    postingRole: leg.postingRole,
    chainKey: leg.chainKey,
    assetId: leg.assetId,
    assetSymbol: leg.assetSymbol,
    quantity: leg.quantity.toFixed(),
  };
}

function fromStoredStandardLedgerCarryLeg(
  leg: StoredStandardLedgerArtifact['engineResult']['carries'][number]['sourceLegs'][number]
): LedgerCostBasisCarryLeg {
  return {
    allocationId: leg.allocationId,
    sourceEventId: leg.sourceEventId,
    timestamp: new Date(leg.timestamp),
    sourceActivityFingerprint: leg.sourceActivityFingerprint,
    ownerAccountId: leg.ownerAccountId,
    journalFingerprint: leg.journalFingerprint,
    journalKind: leg.journalKind,
    postingFingerprint: leg.postingFingerprint,
    postingRole: leg.postingRole,
    chainKey: leg.chainKey,
    assetId: leg.assetId,
    assetSymbol: leg.assetSymbol,
    quantity: parseDecimal(leg.quantity),
  };
}

function toStoredStandardLedgerCalculationBlocker(
  blocker: StandardLedgerCalculationBlocker
): StoredStandardLedgerArtifact['engineResult']['blockers'][number] {
  return {
    blockerId: blocker.blockerId,
    reason: blocker.reason,
    propagation: blocker.propagation,
    affectedChainKeys: [...blocker.affectedChainKeys],
    inputEventIds: [...blocker.inputEventIds],
    inputOperationIds: [...blocker.inputOperationIds],
    message: blocker.message,
    ...(blocker.sourceOperationBlocker === undefined
      ? {}
      : { sourceOperationBlocker: toStoredLedgerOperationBlocker(blocker.sourceOperationBlocker) }),
  };
}

function fromStoredStandardLedgerCalculationBlocker(
  blocker: StoredStandardLedgerArtifact['engineResult']['blockers'][number]
): StandardLedgerCalculationBlocker {
  return {
    blockerId: blocker.blockerId,
    reason: blocker.reason,
    propagation: blocker.propagation,
    affectedChainKeys: blocker.affectedChainKeys,
    inputEventIds: blocker.inputEventIds,
    inputOperationIds: blocker.inputOperationIds,
    message: blocker.message,
    ...(blocker.sourceOperationBlocker === undefined
      ? {}
      : { sourceOperationBlocker: fromStoredLedgerOperationBlocker(blocker.sourceOperationBlocker) }),
  };
}

function toStoredLedgerOperationBlocker(
  blocker: LedgerCostBasisOperationBlocker
): StoredStandardLedgerArtifact['projection']['operationBlockers'][number] {
  return {
    blockerId: blocker.blockerId,
    reason: blocker.reason,
    propagation: blocker.propagation,
    affectedChainKeys: [...blocker.affectedChainKeys],
    inputEventIds: [...blocker.inputEventIds],
    ...(blocker.sourceProjectionBlocker === undefined
      ? {}
      : { sourceProjectionBlocker: toStoredLedgerProjectionBlocker(blocker.sourceProjectionBlocker) }),
    message: blocker.message,
  };
}

function fromStoredLedgerOperationBlocker(
  blocker: StoredStandardLedgerArtifact['projection']['operationBlockers'][number]
): LedgerCostBasisOperationBlocker {
  return {
    blockerId: blocker.blockerId,
    reason: blocker.reason,
    propagation: blocker.propagation,
    affectedChainKeys: blocker.affectedChainKeys,
    inputEventIds: blocker.inputEventIds,
    ...(blocker.sourceProjectionBlocker === undefined
      ? {}
      : { sourceProjectionBlocker: fromStoredLedgerProjectionBlocker(blocker.sourceProjectionBlocker) }),
    message: blocker.message,
  };
}

function toStoredLedgerProjectionBlocker(
  blocker: LedgerCostBasisProjectionBlocker
): StoredStandardLedgerArtifact['projection']['projectionBlockers'][number] {
  if (blocker.scope === 'posting') {
    return {
      scope: 'posting',
      reason: blocker.reason,
      sourceActivityFingerprint: blocker.sourceActivityFingerprint,
      journalFingerprint: blocker.journalFingerprint,
      postingFingerprint: blocker.postingFingerprint,
      assetId: blocker.assetId,
      assetSymbol: blocker.assetSymbol,
      postingQuantity: blocker.postingQuantity.toFixed(),
      blockedQuantity: blocker.blockedQuantity.toFixed(),
      relationshipStableKeys: [...blocker.relationshipStableKeys],
      message: blocker.message,
    };
  }

  return {
    scope: 'relationship',
    reason: blocker.reason,
    relationshipStableKey: blocker.relationshipStableKey,
    relationshipKind: blocker.relationshipKind,
    allocations: blocker.allocations.map((allocation) => ({
      allocationId: allocation.allocationId,
      allocationSide: allocation.allocationSide,
      postingFingerprint: allocation.postingFingerprint,
      assetId: allocation.assetId,
      assetSymbol: allocation.assetSymbol,
      quantity: allocation.quantity.toFixed(),
      state: allocation.state,
      mismatchReasons: [...allocation.mismatchReasons],
      validationReasons: [...allocation.validationReasons],
    })),
    message: blocker.message,
  };
}

function fromStoredLedgerProjectionBlocker(
  blocker: StoredStandardLedgerArtifact['projection']['projectionBlockers'][number]
): LedgerCostBasisProjectionBlocker {
  if (blocker.scope === 'posting') {
    return {
      scope: 'posting',
      reason: blocker.reason,
      sourceActivityFingerprint: blocker.sourceActivityFingerprint,
      journalFingerprint: blocker.journalFingerprint,
      postingFingerprint: blocker.postingFingerprint,
      assetId: blocker.assetId,
      assetSymbol: blocker.assetSymbol,
      postingQuantity: parseDecimal(blocker.postingQuantity),
      blockedQuantity: parseDecimal(blocker.blockedQuantity),
      relationshipStableKeys: blocker.relationshipStableKeys,
      message: blocker.message,
    } satisfies LedgerCostBasisPostingBlocker;
  }

  return {
    scope: 'relationship',
    reason: blocker.reason,
    relationshipStableKey: blocker.relationshipStableKey,
    relationshipKind: blocker.relationshipKind,
    allocations: blocker.allocations.map((allocation) => ({
      allocationId: allocation.allocationId,
      allocationSide: allocation.allocationSide,
      postingFingerprint: allocation.postingFingerprint,
      assetId: allocation.assetId,
      assetSymbol: allocation.assetSymbol,
      quantity: parseDecimal(allocation.quantity),
      state: allocation.state,
      mismatchReasons: allocation.mismatchReasons,
      validationReasons: allocation.validationReasons,
    })),
    message: blocker.message,
  } satisfies LedgerCostBasisRelationshipBlocker;
}

function toStoredStandardLedgerExcludedPosting(
  posting: LedgerCostBasisExcludedPosting
): StoredStandardLedgerArtifact['projection']['excludedPostings'][number] {
  return {
    reason: posting.reason,
    sourceActivityFingerprint: posting.sourceActivityFingerprint,
    journalFingerprint: posting.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    postingQuantity: posting.postingQuantity.toFixed(),
    message: posting.message,
  };
}

function fromStoredStandardLedgerExcludedPosting(
  posting: StoredStandardLedgerArtifact['projection']['excludedPostings'][number]
): LedgerCostBasisExcludedPosting {
  return {
    reason: posting.reason,
    sourceActivityFingerprint: posting.sourceActivityFingerprint,
    journalFingerprint: posting.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    postingQuantity: parseDecimal(posting.postingQuantity),
    message: posting.message,
  };
}

function toStoredStandardLedgerExecutionMeta(
  meta: StandardLedgerCostBasisExecutionMeta
): StoredStandardLedgerArtifact['executionMeta'] {
  return {
    calculationBlockerIds: meta.calculationBlockerIds,
    eventIds: meta.eventIds,
    excludedPostingFingerprints: meta.excludedPostingFingerprints,
    exclusionFingerprint: meta.exclusionFingerprint,
    operationBlockerIds: meta.operationBlockerIds,
    operationIds: meta.operationIds,
    projectionBlockerMessages: meta.projectionBlockerMessages,
  };
}

function fromStoredStandardLedgerExecutionMeta(
  meta: StoredStandardLedgerArtifact['executionMeta']
): StandardLedgerCostBasisExecutionMeta {
  return {
    calculationBlockerIds: meta.calculationBlockerIds,
    eventIds: meta.eventIds,
    excludedPostingFingerprints: meta.excludedPostingFingerprints,
    exclusionFingerprint: meta.exclusionFingerprint,
    operationBlockerIds: meta.operationBlockerIds,
    operationIds: meta.operationIds,
    projectionBlockerMessages: meta.projectionBlockerMessages,
  };
}
