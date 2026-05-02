import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type {
  LedgerCostBasisAcquireOperation,
  LedgerCostBasisCarryLeg,
  LedgerCostBasisCarryOperation,
  LedgerCostBasisDisposeOperation,
  LedgerCostBasisFeeOperation,
  LedgerCostBasisOperation,
  LedgerCostBasisOperationBlocker,
  LedgerCostBasisOperationBlockerPropagation,
  LedgerCostBasisOperationProjection,
} from '../../ledger/ledger-cost-basis-operation-projection.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

export interface RunStandardLedgerOperationEngineInput {
  calculationId: string;
  operationProjection: LedgerCostBasisOperationProjection;
  strategy: ICostBasisStrategy;
}

export interface StandardLedgerOperationEngineResult {
  blockers: readonly StandardLedgerCalculationBlocker[];
  carries: readonly StandardLedgerCarry[];
  disposals: readonly StandardLedgerDisposal[];
  lots: readonly StandardLedgerLot[];
}

export type StandardLedgerBasisStatus = 'priced' | 'unresolved';

export interface StandardLedgerLot {
  assetId: string;
  assetSymbol: Currency;
  basisStatus: StandardLedgerBasisStatus;
  calculationId: string;
  chainKey: string;
  costBasisPerUnit?: Decimal | undefined;
  acquisitionDate: Date;
  id: string;
  originalQuantity: Decimal;
  provenance: StandardLedgerLotProvenance;
  remainingQuantity: Decimal;
  totalCostBasis?: Decimal | undefined;
}

export type StandardLedgerLotProvenance =
  | {
      kind: 'acquire-operation';
      operationId: string;
      sourceEventId: string;
    }
  | {
      kind: 'carry-operation';
      operationId: string;
      relationshipStableKey: string;
      sourceLotId: string;
      targetLegSourceEventId: string;
    };

export interface StandardLedgerDisposal {
  assetId: string;
  assetSymbol: Currency;
  calculationId: string;
  chainKey: string;
  costBasis: Decimal;
  disposalDate: Date;
  gainLoss: Decimal;
  grossProceeds: Decimal;
  id: string;
  operationId: string;
  quantity: Decimal;
  slices: readonly StandardLedgerLotSelectionSlice[];
}

export interface StandardLedgerCarry {
  calculationId: string;
  id: string;
  kind: 'cross-chain' | 'same-chain';
  operationId: string;
  relationshipKind: LedgerCostBasisCarryOperation['relationshipKind'];
  relationshipStableKey: string;
  slices: readonly StandardLedgerCarrySlice[];
  sourceLegs: readonly LedgerCostBasisCarryLeg[];
  targetLegs: readonly LedgerCostBasisCarryLeg[];
}

export interface StandardLedgerCarrySlice {
  sourceChainKey: string;
  sourceLotId?: string | undefined;
  targetChainKey: string;
  targetLotId?: string | undefined;
  sourceQuantity: Decimal;
  targetQuantity: Decimal;
  basisStatus: StandardLedgerBasisStatus;
  costBasis?: Decimal | undefined;
}

export interface StandardLedgerLotSelectionSlice {
  acquisitionDate: Date;
  basisStatus: StandardLedgerBasisStatus;
  costBasis?: Decimal | undefined;
  costBasisPerUnit?: Decimal | undefined;
  lotId: string;
  quantity: Decimal;
}

export type StandardLedgerCalculationBlockerReason =
  | 'chain_fenced'
  | 'fee_treatment_unimplemented'
  | 'insufficient_lots'
  | 'missing_disposal_price'
  | 'unknown_fee_attachment'
  | 'unresolved_basis_disposal'
  | 'unsupported_strategy'
  | 'upstream_operation_blocker';

export interface StandardLedgerCalculationBlocker {
  affectedChainKeys: readonly string[];
  blockerId: string;
  inputEventIds: readonly string[];
  inputOperationIds: readonly string[];
  message: string;
  propagation: LedgerCostBasisOperationBlockerPropagation;
  reason: StandardLedgerCalculationBlockerReason;
  sourceOperationBlocker?: LedgerCostBasisOperationBlocker | undefined;
}

interface MutableChainState {
  lots: StandardLedgerLot[];
}

interface LotSelectionResult {
  slices: StandardLedgerLotSelectionSlice[];
  updatedLots: StandardLedgerLot[];
}

type LotSelectionBlocker =
  | {
      reason: 'insufficient_lots';
      unmatchedQuantity: Decimal;
    }
  | {
      reason: 'unsupported_strategy';
      strategyName: ReturnType<ICostBasisStrategy['getName']>;
    };

const ZERO = parseDecimal('0');

export function runStandardLedgerOperationEngine(
  input: RunStandardLedgerOperationEngineInput
): Result<StandardLedgerOperationEngineResult, Error> {
  const blockers: StandardLedgerCalculationBlocker[] = input.operationProjection.blockers.map((blocker) =>
    mapOperationBlocker(blocker)
  );
  const fencedChainKeys = new Set(
    blockers.filter((blocker) => blocker.propagation === 'after-fence').flatMap((blocker) => blocker.affectedChainKeys)
  );
  const chainStateByKey = new Map<string, MutableChainState>();
  const carries: StandardLedgerCarry[] = [];
  const disposals: StandardLedgerDisposal[] = [];

  for (const operation of input.operationProjection.operations) {
    const affectedChainKeys = getOperationAffectedChainKeys(operation);
    const fencedAffectedChainKeys = affectedChainKeys.filter((chainKey) => fencedChainKeys.has(chainKey));
    if (fencedAffectedChainKeys.length > 0) {
      blockers.push(buildChainFencedBlocker(operation, fencedAffectedChainKeys));
      continue;
    }

    switch (operation.kind) {
      case 'acquire':
        processAcquireOperation(operation, input.calculationId, chainStateByKey);
        break;
      case 'dispose': {
        const result = processDisposeOperation(operation, input, chainStateByKey);
        if ('blocker' in result) {
          blockers.push(result.blocker);
          applyFence(result.blocker, fencedChainKeys);
          break;
        }

        disposals.push(result.disposal);
        break;
      }
      case 'carry': {
        const result = processCarryOperation(operation, input, chainStateByKey);
        if ('blocker' in result) {
          blockers.push(result.blocker);
          applyFence(result.blocker, fencedChainKeys);
          break;
        }

        carries.push(result.carry);
        break;
      }
      case 'fee': {
        const blocker = processFeeOperation(operation);
        if (blocker !== undefined) {
          blockers.push(blocker);
          applyFence(blocker, fencedChainKeys);
        }
        break;
      }
    }
  }

  return ok({
    blockers: blockers.sort(compareCalculationBlockers),
    carries: carries.sort(compareCarries),
    disposals: disposals.sort(compareDisposals),
    lots: [...chainStateByKey.values()].flatMap((chainState) => chainState.lots).sort(compareLots),
  });
}

function processAcquireOperation(
  operation: LedgerCostBasisAcquireOperation,
  calculationId: string,
  chainStateByKey: Map<string, MutableChainState>
): void {
  const chainState = getOrCreateChainState(operation.chainKey, chainStateByKey);
  chainState.lots.push(
    buildAcquireLot({
      acquisitionDate: operation.timestamp,
      assetId: operation.assetId,
      assetSymbol: operation.assetSymbol,
      calculationId,
      chainKey: operation.chainKey,
      costBasisPerUnit: operation.priceAtTxTime?.price.amount,
      id: `standard-ledger-lot:${operation.operationId}`,
      operationId: operation.operationId,
      quantity: operation.quantity,
      sourceEventId: operation.sourceEventId,
    })
  );
}

function processDisposeOperation(
  operation: LedgerCostBasisDisposeOperation,
  input: RunStandardLedgerOperationEngineInput,
  chainStateByKey: Map<string, MutableChainState>
): { disposal: StandardLedgerDisposal } | { blocker: StandardLedgerCalculationBlocker } {
  if (operation.priceAtTxTime === undefined) {
    return {
      blocker: buildOperationBlocker({
        affectedChainKeys: [operation.chainKey],
        inputEventIds: [operation.sourceEventId],
        inputOperationIds: [operation.operationId],
        message: `Standard ledger disposal ${operation.operationId} is missing priceAtTxTime`,
        propagation: 'after-fence',
        reason: 'missing_disposal_price',
      }),
    };
  }

  const chainState = getOrCreateChainState(operation.chainKey, chainStateByKey);
  const selection = selectLotSlices({
    quantity: operation.quantity,
    strategy: input.strategy,
    lots: chainState.lots,
  });
  if ('blocker' in selection) {
    return {
      blocker: buildLotSelectionBlocker({
        affectedChainKeys: [operation.chainKey],
        assetSymbol: operation.assetSymbol,
        blocker: selection.blocker,
        inputEventIds: [operation.sourceEventId],
        inputOperationIds: [operation.operationId],
        operationDescription: `disposal ${operation.operationId}`,
      }),
    };
  }

  const unresolvedSlices = selection.slices.filter((slice) => slice.basisStatus === 'unresolved');
  if (unresolvedSlices.length > 0) {
    return {
      blocker: buildOperationBlocker({
        affectedChainKeys: [operation.chainKey],
        inputEventIds: [operation.sourceEventId],
        inputOperationIds: [operation.operationId],
        message: `Standard ledger disposal ${operation.operationId} consumes unresolved basis`,
        propagation: 'after-fence',
        reason: 'unresolved_basis_disposal',
      }),
    };
  }

  chainState.lots = selection.updatedLots;

  const grossProceeds = operation.quantity.times(operation.priceAtTxTime.price.amount);
  const costBasis = sumDecimals(selection.slices.map((slice) => slice.costBasis ?? ZERO));
  return {
    disposal: {
      assetId: operation.assetId,
      assetSymbol: operation.assetSymbol,
      calculationId: input.calculationId,
      chainKey: operation.chainKey,
      costBasis,
      disposalDate: operation.timestamp,
      gainLoss: grossProceeds.minus(costBasis),
      grossProceeds,
      id: `standard-ledger-disposal:${operation.operationId}`,
      operationId: operation.operationId,
      quantity: operation.quantity,
      slices: selection.slices,
    },
  };
}

function processCarryOperation(
  operation: LedgerCostBasisCarryOperation,
  input: RunStandardLedgerOperationEngineInput,
  chainStateByKey: Map<string, MutableChainState>
): { carry: StandardLedgerCarry } | { blocker: StandardLedgerCalculationBlocker } {
  const sourceChainKeys = dedupeSorted(operation.sourceLegs.map((leg) => leg.chainKey));
  const targetChainKeys = dedupeSorted(operation.targetLegs.map((leg) => leg.chainKey));
  const affectedChainKeys = dedupeSorted([...sourceChainKeys, ...targetChainKeys]);
  const isSameChainCarry =
    sourceChainKeys.length === 1 && targetChainKeys.length === 1 && sourceChainKeys[0] === targetChainKeys[0];

  if (isSameChainCarry) {
    return {
      carry: {
        calculationId: input.calculationId,
        id: `standard-ledger-carry:${operation.operationId}`,
        kind: 'same-chain',
        operationId: operation.operationId,
        relationshipKind: operation.relationshipKind,
        relationshipStableKey: operation.relationshipStableKey,
        slices: [],
        sourceLegs: operation.sourceLegs,
        targetLegs: operation.targetLegs,
      },
    };
  }

  const pendingSourceLotsByChainKey = new Map<string, StandardLedgerLot[]>();
  const sourceSlices: {
    leg: LedgerCostBasisCarryLeg;
    slice: StandardLedgerLotSelectionSlice;
  }[] = [];

  for (const sourceLeg of operation.sourceLegs) {
    const pendingLots =
      pendingSourceLotsByChainKey.get(sourceLeg.chainKey) ??
      getOrCreateChainState(sourceLeg.chainKey, chainStateByKey).lots;
    const selection = selectLotSlices({
      quantity: sourceLeg.quantity,
      strategy: input.strategy,
      lots: pendingLots,
    });
    if ('blocker' in selection) {
      return {
        blocker: buildLotSelectionBlocker({
          affectedChainKeys,
          assetSymbol: sourceLeg.assetSymbol,
          blocker: selection.blocker,
          inputEventIds: operation.inputEventIds,
          inputOperationIds: [operation.operationId],
          operationDescription: `carry ${operation.operationId}`,
        }),
      };
    }

    pendingSourceLotsByChainKey.set(sourceLeg.chainKey, selection.updatedLots);
    sourceSlices.push(...selection.slices.map((slice) => ({ leg: sourceLeg, slice })));
  }

  const totalSourceQuantity = sumDecimals(sourceSlices.map(({ slice }) => slice.quantity));
  const totalTargetQuantity = sumDecimals(operation.targetLegs.map((leg) => leg.quantity));
  if (!totalSourceQuantity.gt(0) || !totalTargetQuantity.gt(0)) {
    return {
      blocker: buildOperationBlocker({
        affectedChainKeys,
        inputEventIds: operation.inputEventIds,
        inputOperationIds: [operation.operationId],
        message: `Standard ledger carry ${operation.operationId} has no positive source or target quantity`,
        propagation: 'after-fence',
        reason: 'insufficient_lots',
      }),
    };
  }

  for (const [chainKey, lots] of pendingSourceLotsByChainKey) {
    getOrCreateChainState(chainKey, chainStateByKey).lots = lots;
  }

  const carrySlices: StandardLedgerCarrySlice[] = [];
  let targetLotIndex = 0;
  for (const targetLeg of operation.targetLegs) {
    const targetChainState = getOrCreateChainState(targetLeg.chainKey, chainStateByKey);
    for (const { leg, slice } of sourceSlices) {
      targetLotIndex += 1;
      const targetQuantity = targetLeg.quantity.times(slice.quantity).dividedBy(totalSourceQuantity);
      if (!targetQuantity.gt(0)) {
        continue;
      }

      const targetCostBasis = slice.costBasis?.times(targetLeg.quantity).dividedBy(totalTargetQuantity);
      const targetLot = buildCarryTargetLot({
        acquisitionDate: slice.acquisitionDate,
        assetId: targetLeg.assetId,
        assetSymbol: targetLeg.assetSymbol,
        calculationId: input.calculationId,
        chainKey: targetLeg.chainKey,
        costBasisPerUnit: targetCostBasis === undefined ? undefined : targetCostBasis.dividedBy(targetQuantity),
        id: `standard-ledger-lot:${operation.operationId}:target:${targetLotIndex}`,
        operationId: operation.operationId,
        quantity: targetQuantity,
        relationshipStableKey: operation.relationshipStableKey,
        sourceLotId: slice.lotId,
        targetLegSourceEventId: targetLeg.sourceEventId,
      });
      targetChainState.lots.push(targetLot);
      carrySlices.push({
        basisStatus: slice.basisStatus,
        ...(targetCostBasis === undefined ? {} : { costBasis: targetCostBasis }),
        sourceChainKey: leg.chainKey,
        sourceLotId: slice.lotId,
        sourceQuantity: slice.quantity,
        targetChainKey: targetLeg.chainKey,
        targetLotId: targetLot.id,
        targetQuantity,
      });
    }
  }

  return {
    carry: {
      calculationId: input.calculationId,
      id: `standard-ledger-carry:${operation.operationId}`,
      kind: 'cross-chain',
      operationId: operation.operationId,
      relationshipKind: operation.relationshipKind,
      relationshipStableKey: operation.relationshipStableKey,
      slices: carrySlices,
      sourceLegs: operation.sourceLegs,
      targetLegs: operation.targetLegs,
    },
  };
}

function processFeeOperation(operation: LedgerCostBasisFeeOperation): StandardLedgerCalculationBlocker | undefined {
  if (operation.attachment.kind === 'unknown') {
    return buildOperationBlocker({
      affectedChainKeys: [operation.chainKey],
      inputEventIds: [operation.sourceEventId],
      inputOperationIds: [operation.operationId],
      message: `Standard ledger fee ${operation.operationId} has unknown attachment: ${operation.attachment.reason}`,
      propagation: 'op-only',
      reason: 'unknown_fee_attachment',
    });
  }

  return buildOperationBlocker({
    affectedChainKeys: [operation.chainKey],
    inputEventIds: [operation.sourceEventId],
    inputOperationIds: [operation.operationId],
    message: `Standard ledger fee ${operation.operationId} has no implemented fee treatment for ${operation.attachment.kind}`,
    propagation: 'op-only',
    reason: 'fee_treatment_unimplemented',
  });
}

function buildAcquireLot(params: {
  acquisitionDate: Date;
  assetId: string;
  assetSymbol: Currency;
  calculationId: string;
  chainKey: string;
  costBasisPerUnit?: Decimal | undefined;
  id: string;
  operationId: string;
  quantity: Decimal;
  sourceEventId: string;
}): StandardLedgerLot {
  return buildLot({
    acquisitionDate: params.acquisitionDate,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    calculationId: params.calculationId,
    chainKey: params.chainKey,
    costBasisPerUnit: params.costBasisPerUnit,
    id: params.id,
    provenance: {
      kind: 'acquire-operation',
      operationId: params.operationId,
      sourceEventId: params.sourceEventId,
    },
    quantity: params.quantity,
  });
}

function buildCarryTargetLot(params: {
  acquisitionDate: Date;
  assetId: string;
  assetSymbol: Currency;
  calculationId: string;
  chainKey: string;
  costBasisPerUnit?: Decimal | undefined;
  id: string;
  operationId: string;
  quantity: Decimal;
  relationshipStableKey: string;
  sourceLotId: string;
  targetLegSourceEventId: string;
}): StandardLedgerLot {
  return buildLot({
    acquisitionDate: params.acquisitionDate,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    calculationId: params.calculationId,
    chainKey: params.chainKey,
    costBasisPerUnit: params.costBasisPerUnit,
    id: params.id,
    provenance: {
      kind: 'carry-operation',
      operationId: params.operationId,
      relationshipStableKey: params.relationshipStableKey,
      sourceLotId: params.sourceLotId,
      targetLegSourceEventId: params.targetLegSourceEventId,
    },
    quantity: params.quantity,
  });
}

function buildLot(params: {
  acquisitionDate: Date;
  assetId: string;
  assetSymbol: Currency;
  calculationId: string;
  chainKey: string;
  costBasisPerUnit?: Decimal | undefined;
  id: string;
  provenance: StandardLedgerLotProvenance;
  quantity: Decimal;
}): StandardLedgerLot {
  const basisStatus: StandardLedgerBasisStatus = params.costBasisPerUnit === undefined ? 'unresolved' : 'priced';
  const totalCostBasis = params.costBasisPerUnit?.times(params.quantity);

  return {
    acquisitionDate: params.acquisitionDate,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    basisStatus,
    calculationId: params.calculationId,
    chainKey: params.chainKey,
    ...(params.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: params.costBasisPerUnit }),
    id: params.id,
    originalQuantity: params.quantity,
    provenance: params.provenance,
    remainingQuantity: params.quantity,
    ...(totalCostBasis === undefined ? {} : { totalCostBasis }),
  };
}

function selectLotSlices(params: {
  lots: readonly StandardLedgerLot[];
  quantity: Decimal;
  strategy: ICostBasisStrategy;
}): LotSelectionResult | { blocker: LotSelectionBlocker } {
  const sortedLots = sortOpenLotsForStrategy(params.lots, params.strategy);
  if ('blocker' in sortedLots) {
    return { blocker: sortedLots.blocker };
  }

  const availableQuantity = sumDecimals(sortedLots.map((lot) => lot.remainingQuantity));
  if (availableQuantity.lt(params.quantity)) {
    return { blocker: { reason: 'insufficient_lots', unmatchedQuantity: params.quantity.minus(availableQuantity) } };
  }

  const slices: StandardLedgerLotSelectionSlice[] = [];
  let remainingQuantity = params.quantity;
  const consumedQuantityByLotId = new Map<string, Decimal>();

  for (const lot of sortedLots) {
    if (!remainingQuantity.gt(0)) {
      break;
    }

    const selectedQuantity = minDecimal(remainingQuantity, lot.remainingQuantity);
    if (!selectedQuantity.gt(0)) {
      continue;
    }

    slices.push({
      acquisitionDate: lot.acquisitionDate,
      basisStatus: lot.basisStatus,
      ...(lot.costBasisPerUnit === undefined ? {} : { costBasisPerUnit: lot.costBasisPerUnit }),
      ...(lot.costBasisPerUnit === undefined ? {} : { costBasis: selectedQuantity.times(lot.costBasisPerUnit) }),
      lotId: lot.id,
      quantity: selectedQuantity,
    });
    consumedQuantityByLotId.set(lot.id, selectedQuantity);
    remainingQuantity = remainingQuantity.minus(selectedQuantity);
  }

  const updatedLots = params.lots.map((lot) => {
    const consumedQuantity = consumedQuantityByLotId.get(lot.id);
    if (consumedQuantity === undefined) {
      return lot;
    }

    const remainingLotQuantity = lot.remainingQuantity.minus(consumedQuantity);
    return {
      ...lot,
      remainingQuantity: remainingLotQuantity,
    };
  });

  return { slices, updatedLots };
}

function sortOpenLotsForStrategy(
  lots: readonly StandardLedgerLot[],
  strategy: ICostBasisStrategy
): StandardLedgerLot[] | { blocker: Extract<LotSelectionBlocker, { reason: 'unsupported_strategy' }> } {
  const openLots = lots.filter((lot) => lot.remainingQuantity.gt(0));
  const strategyName = strategy.getName();
  switch (strategyName) {
    case 'fifo':
      return [...openLots].sort(compareLotsFifo);
    case 'lifo':
      return [...openLots].sort(compareLotsLifo);
    case 'specific-id':
      return { blocker: { reason: 'unsupported_strategy', strategyName } };
  }
}

function buildLotSelectionBlocker(params: {
  affectedChainKeys: readonly string[];
  assetSymbol: Currency;
  blocker: LotSelectionBlocker;
  inputEventIds: readonly string[];
  inputOperationIds: readonly string[];
  operationDescription: string;
}): StandardLedgerCalculationBlocker {
  if (params.blocker.reason === 'unsupported_strategy') {
    return buildOperationBlocker({
      affectedChainKeys: params.affectedChainKeys,
      inputEventIds: params.inputEventIds,
      inputOperationIds: params.inputOperationIds,
      message: `Standard ledger ${params.operationDescription} cannot use unsupported ${params.blocker.strategyName} strategy`,
      propagation: 'after-fence',
      reason: 'unsupported_strategy',
    });
  }

  return buildOperationBlocker({
    affectedChainKeys: params.affectedChainKeys,
    inputEventIds: params.inputEventIds,
    inputOperationIds: params.inputOperationIds,
    message:
      `Standard ledger ${params.operationDescription} has insufficient lots: ` +
      `${params.blocker.unmatchedQuantity.toFixed()} ${params.assetSymbol} unmatched`,
    propagation: 'after-fence',
    reason: 'insufficient_lots',
  });
}

function getOperationAffectedChainKeys(operation: LedgerCostBasisOperation): string[] {
  if (operation.kind === 'carry') {
    return dedupeSorted([
      ...operation.sourceLegs.map((leg) => leg.chainKey),
      ...operation.targetLegs.map((leg) => leg.chainKey),
    ]);
  }

  return [operation.chainKey];
}

function getOrCreateChainState(chainKey: string, chainStateByKey: Map<string, MutableChainState>): MutableChainState {
  const existing = chainStateByKey.get(chainKey);
  if (existing !== undefined) {
    return existing;
  }

  const created = { lots: [] };
  chainStateByKey.set(chainKey, created);
  return created;
}

function mapOperationBlocker(blocker: LedgerCostBasisOperationBlocker): StandardLedgerCalculationBlocker {
  return {
    affectedChainKeys: blocker.affectedChainKeys,
    blockerId: `standard-ledger-calculation-blocker:${blocker.blockerId}`,
    inputEventIds: blocker.inputEventIds,
    inputOperationIds: [],
    message: blocker.message,
    propagation: blocker.propagation,
    reason: 'upstream_operation_blocker',
    sourceOperationBlocker: blocker,
  };
}

function buildChainFencedBlocker(
  operation: LedgerCostBasisOperation,
  affectedChainKeys: readonly string[]
): StandardLedgerCalculationBlocker {
  return buildOperationBlocker({
    affectedChainKeys,
    inputEventIds: operation.kind === 'carry' ? operation.inputEventIds : [operation.sourceEventId],
    inputOperationIds: [operation.operationId],
    message: `Standard ledger operation ${operation.operationId} was skipped because its chain is already fenced`,
    propagation: 'after-fence',
    reason: 'chain_fenced',
  });
}

function buildOperationBlocker(params: {
  affectedChainKeys: readonly string[];
  inputEventIds: readonly string[];
  inputOperationIds: readonly string[];
  message: string;
  propagation: LedgerCostBasisOperationBlockerPropagation;
  reason: StandardLedgerCalculationBlockerReason;
}): StandardLedgerCalculationBlocker {
  return {
    affectedChainKeys: dedupeSorted(params.affectedChainKeys),
    blockerId: `standard-ledger-calculation-blocker:${params.reason}:${params.inputOperationIds.join(':')}`,
    inputEventIds: [...params.inputEventIds].sort(),
    inputOperationIds: [...params.inputOperationIds].sort(),
    message: params.message,
    propagation: params.propagation,
    reason: params.reason,
  };
}

function applyFence(blocker: StandardLedgerCalculationBlocker, fencedChainKeys: Set<string>): void {
  if (blocker.propagation !== 'after-fence') {
    return;
  }

  for (const chainKey of blocker.affectedChainKeys) {
    fencedChainKeys.add(chainKey);
  }
}

function sumDecimals(values: readonly Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), ZERO);
}

function minDecimal(left: Decimal, right: Decimal): Decimal {
  return left.lte(right) ? left : right;
}

function compareLots(left: StandardLedgerLot, right: StandardLedgerLot): number {
  return compareStringArrays(
    [left.chainKey, left.acquisitionDate.toISOString(), left.id],
    [right.chainKey, right.acquisitionDate.toISOString(), right.id]
  );
}

function compareLotsFifo(left: StandardLedgerLot, right: StandardLedgerLot): number {
  return compareStringArrays(
    [left.acquisitionDate.toISOString(), left.id],
    [right.acquisitionDate.toISOString(), right.id]
  );
}

function compareLotsLifo(left: StandardLedgerLot, right: StandardLedgerLot): number {
  return compareStringArrays(
    [right.acquisitionDate.toISOString(), right.id],
    [left.acquisitionDate.toISOString(), left.id]
  );
}

function compareDisposals(left: StandardLedgerDisposal, right: StandardLedgerDisposal): number {
  return compareStringArrays(
    [left.disposalDate.toISOString(), left.operationId],
    [right.disposalDate.toISOString(), right.operationId]
  );
}

function compareCarries(left: StandardLedgerCarry, right: StandardLedgerCarry): number {
  return compareStringArrays([left.operationId], [right.operationId]);
}

function compareCalculationBlockers(
  left: StandardLedgerCalculationBlocker,
  right: StandardLedgerCalculationBlocker
): number {
  return compareStringArrays(
    [left.propagation, left.reason, left.blockerId],
    [right.propagation, right.reason, right.blockerId]
  );
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? '';
    const rightValue = right[index] ?? '';
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
