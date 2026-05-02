import type { PriceAtTxTime } from '@exitbook/core';
import { isFiat, ok, type Currency, type Result } from '@exitbook/foundation';
import type {
  AccountingJournalKind,
  AccountingJournalRelationshipKind,
  AccountingPostingRole,
  AccountingSettlement,
} from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

import { resolveTaxAssetIdentity } from '../model/tax-asset-identity.js';

import type {
  LedgerCostBasisEventProjection,
  LedgerCostBasisExcludedPosting,
  LedgerCostBasisInputEvent,
  LedgerCostBasisJournalContext,
  LedgerCostBasisProjectionBlocker,
} from './ledger-cost-basis-event-projection.js';
import {
  classifyLedgerCostBasisFeeAttachment,
  type LedgerCostBasisFeeAttachment,
} from './ledger-cost-basis-fee-attachment.js';
import type { LedgerCostBasisRelationshipBasisTreatment } from './ledger-cost-basis-relationship-treatment.js';

export interface BuildLedgerCostBasisOperationsInput {
  projection: LedgerCostBasisEventProjection;
  identityConfig?: LedgerCostBasisOperationIdentityConfig | undefined;
}

export interface LedgerCostBasisOperationIdentityConfig {
  assetIdentityOverridesByAssetId?: ReadonlyMap<string, string> | undefined;
}

export interface LedgerCostBasisOperationProjection {
  operations: readonly LedgerCostBasisOperation[];
  blockers: readonly LedgerCostBasisOperationBlocker[];
  excludedPostings: readonly LedgerCostBasisExcludedPosting[];
  exclusionFingerprint: string;
}

export type LedgerCostBasisOperation =
  | LedgerCostBasisAcquireOperation
  | LedgerCostBasisDisposeOperation
  | LedgerCostBasisCarryOperation
  | LedgerCostBasisFeeOperation;

export interface LedgerCostBasisOperationRelationshipContext {
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  relationshipBasisTreatment: LedgerCostBasisRelationshipBasisTreatment;
  relationshipAllocationId: number;
}

interface LedgerCostBasisSinglePostingOperationBase {
  operationId: string;
  sourceEventId: string;
  timestamp: Date;
  sourceActivityFingerprint: string;
  ownerAccountId: number;
  journalFingerprint: string;
  journalKind: AccountingJournalKind;
  postingFingerprint: string;
  postingRole: AccountingPostingRole;
  chainKey: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  relationshipContext?: LedgerCostBasisOperationRelationshipContext | undefined;
}

export interface LedgerCostBasisAcquireOperation extends LedgerCostBasisSinglePostingOperationBase {
  kind: 'acquire';
}

export interface LedgerCostBasisDisposeOperation extends LedgerCostBasisSinglePostingOperationBase {
  kind: 'dispose';
}

export interface LedgerCostBasisFeeOperation extends Omit<
  LedgerCostBasisSinglePostingOperationBase,
  'relationshipContext'
> {
  kind: 'fee';
  postingRole: 'fee' | 'protocol_overhead';
  settlement: AccountingSettlement;
  attachment: LedgerCostBasisFeeAttachment;
}

export interface LedgerCostBasisCarryOperation {
  kind: 'carry';
  operationId: string;
  timestamp: Date;
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  relationshipBasisTreatment: 'carry_basis';
  inputEventIds: readonly string[];
  sourceLegs: readonly LedgerCostBasisCarryLeg[];
  targetLegs: readonly LedgerCostBasisCarryLeg[];
}

export interface LedgerCostBasisCarryLeg {
  allocationId: number;
  sourceEventId: string;
  timestamp: Date;
  sourceActivityFingerprint: string;
  ownerAccountId: number;
  journalFingerprint: string;
  journalKind: AccountingJournalKind;
  postingFingerprint: string;
  postingRole: AccountingPostingRole;
  chainKey: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
}

export type LedgerCostBasisOperationBlockerPropagation = 'op-only' | 'after-fence';

export type LedgerCostBasisOperationBlockerReason =
  | LedgerCostBasisProjectionBlocker['reason']
  | 'carry_relationship_context_missing'
  | 'carry_relationship_leg_missing'
  | 'fee_journal_context_missing'
  | 'fee_settlement_missing'
  | 'fiat_cost_basis_event'
  | 'relationship_context_incomplete'
  | 'tax_asset_identity_unresolved';

export interface LedgerCostBasisOperationBlocker {
  blockerId: string;
  reason: LedgerCostBasisOperationBlockerReason;
  propagation: LedgerCostBasisOperationBlockerPropagation;
  affectedChainKeys: readonly string[];
  inputEventIds: readonly string[];
  sourceProjectionBlocker?: LedgerCostBasisProjectionBlocker | undefined;
  message: string;
}

interface ChainKeyResolution {
  chainKey: string;
}

interface ChainKeyResolutionFailure {
  reason: 'fiat_cost_basis_event' | 'tax_asset_identity_unresolved';
  message: string;
}

interface RelationshipContextResult {
  relationshipContext?: LedgerCostBasisOperationRelationshipContext | undefined;
  blocker?: LedgerCostBasisOperationBlocker | undefined;
}

interface CarryEventGroup {
  relationshipStableKey: string;
  events: LedgerCostBasisInputEvent[];
}

export function buildLedgerCostBasisOperations(
  input: BuildLedgerCostBasisOperationsInput
): Result<LedgerCostBasisOperationProjection, Error> {
  const identityConfig = input.identityConfig ?? {};
  const blockers: LedgerCostBasisOperationBlocker[] = input.projection.blockers.map((blocker) =>
    buildProjectionOperationBlocker(blocker, identityConfig)
  );
  const operations: LedgerCostBasisOperation[] = [];
  const carryEventGroups = new Map<string, CarryEventGroup>();
  const journalContextByFingerprint = new Map(
    input.projection.journalContexts.map((context) => [context.journalFingerprint, context] as const)
  );

  for (const event of input.projection.events) {
    if (event.kind === 'carryover-in' || event.kind === 'carryover-out') {
      const relationshipStableKey = event.relationshipStableKey;
      if (relationshipStableKey === undefined) {
        blockers.push(
          buildEventOperationBlocker({
            affectedChainKeys: [],
            event,
            message: `Ledger cost-basis carry event ${event.eventId} has no relationship stable key`,
            propagation: 'after-fence',
            reason: 'carry_relationship_context_missing',
          })
        );
        continue;
      }

      const group = carryEventGroups.get(relationshipStableKey) ?? { relationshipStableKey, events: [] };
      group.events.push(event);
      carryEventGroups.set(relationshipStableKey, group);
      continue;
    }

    const operation = buildSinglePostingOperation(event, journalContextByFingerprint, identityConfig);
    if ('blocker' in operation) {
      blockers.push(operation.blocker);
      continue;
    }

    operations.push(operation.operation);
  }

  for (const group of carryEventGroups.values()) {
    const operation = buildCarryOperation(group, identityConfig);
    if ('blockers' in operation) {
      blockers.push(...operation.blockers);
      continue;
    }

    operations.push(operation.operation);
  }

  return ok({
    operations: operations.sort(compareLedgerCostBasisOperations),
    blockers: blockers.sort(compareLedgerCostBasisOperationBlockers),
    excludedPostings: input.projection.excludedPostings,
    exclusionFingerprint: input.projection.exclusionFingerprint,
  });
}

function buildSinglePostingOperation(
  event: LedgerCostBasisInputEvent,
  journalContextByFingerprint: ReadonlyMap<string, LedgerCostBasisJournalContext>,
  identityConfig: LedgerCostBasisOperationIdentityConfig
):
  | { operation: LedgerCostBasisAcquireOperation | LedgerCostBasisDisposeOperation | LedgerCostBasisFeeOperation }
  | {
      blocker: LedgerCostBasisOperationBlocker;
    } {
  const chainKey = resolveOperationChainKey(event, identityConfig);
  if ('failure' in chainKey) {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [],
        event,
        message: chainKey.failure.message,
        propagation: 'after-fence',
        reason: chainKey.failure.reason,
      }),
    };
  }

  if (event.kind === 'fee') {
    return buildFeeOperation(event, chainKey.chainKey, journalContextByFingerprint);
  }

  const relationshipContext = buildOperationRelationshipContext(event);
  if (relationshipContext.blocker !== undefined) {
    return { blocker: relationshipContext.blocker };
  }

  const operationBase = buildSinglePostingOperationBase(
    event,
    chainKey.chainKey,
    relationshipContext.relationshipContext
  );
  if (event.kind === 'acquisition') {
    return { operation: { ...operationBase, kind: 'acquire' } };
  }

  return { operation: { ...operationBase, kind: 'dispose' } };
}

function buildFeeOperation(
  event: LedgerCostBasisInputEvent,
  chainKey: string,
  journalContextByFingerprint: ReadonlyMap<string, LedgerCostBasisJournalContext>
): { operation: LedgerCostBasisFeeOperation } | { blocker: LedgerCostBasisOperationBlocker } {
  if (event.postingRole !== 'fee' && event.postingRole !== 'protocol_overhead') {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [chainKey],
        event,
        message: `Ledger cost-basis fee event ${event.eventId} has unsupported posting role ${event.postingRole}`,
        propagation: 'after-fence',
        reason: 'relationship_context_incomplete',
      }),
    };
  }

  if (event.settlement === undefined) {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [chainKey],
        event,
        message: `Ledger cost-basis fee event ${event.eventId} has no settlement`,
        propagation: 'after-fence',
        reason: 'fee_settlement_missing',
      }),
    };
  }

  const journalContext = journalContextByFingerprint.get(event.journalFingerprint);
  if (journalContext === undefined) {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [chainKey],
        event,
        message: `Ledger cost-basis fee event ${event.eventId} has no journal context`,
        propagation: 'op-only',
        reason: 'fee_journal_context_missing',
      }),
    };
  }

  return {
    operation: {
      ...buildSinglePostingOperationBase(event, chainKey),
      kind: 'fee',
      postingRole: event.postingRole,
      settlement: event.settlement,
      attachment: classifyLedgerCostBasisFeeAttachment(event, journalContext),
    },
  };
}

function buildCarryOperation(
  group: CarryEventGroup,
  identityConfig: LedgerCostBasisOperationIdentityConfig
): { operation: LedgerCostBasisCarryOperation } | { blockers: LedgerCostBasisOperationBlocker[] } {
  const blockers: LedgerCostBasisOperationBlocker[] = [];
  const sourceLegs: LedgerCostBasisCarryLeg[] = [];
  const targetLegs: LedgerCostBasisCarryLeg[] = [];
  let relationshipKind: AccountingJournalRelationshipKind | undefined;

  for (const event of group.events) {
    const relationshipContext = buildRequiredCarryRelationshipContext(event);
    if ('blocker' in relationshipContext) {
      blockers.push(relationshipContext.blocker);
      continue;
    }

    relationshipKind = relationshipContext.relationshipKind;
    const chainKey = resolveOperationChainKey(event, identityConfig);
    if ('failure' in chainKey) {
      blockers.push(
        buildEventOperationBlocker({
          affectedChainKeys: [],
          event,
          message: chainKey.failure.message,
          propagation: 'after-fence',
          reason: chainKey.failure.reason,
        })
      );
      continue;
    }

    const leg = buildCarryLeg(event, chainKey.chainKey, relationshipContext.relationshipAllocationId);
    if (event.kind === 'carryover-out') {
      sourceLegs.push(leg);
    } else {
      targetLegs.push(leg);
    }
  }

  if (blockers.length > 0) {
    return { blockers };
  }

  if (sourceLegs.length === 0 || targetLegs.length === 0 || relationshipKind === undefined) {
    return {
      blockers: group.events.map((event) =>
        buildEventOperationBlocker({
          affectedChainKeys: dedupeSorted([
            ...sourceLegs.map((leg) => leg.chainKey),
            ...targetLegs.map((leg) => leg.chainKey),
          ]),
          event,
          message: `Ledger cost-basis carry relationship ${group.relationshipStableKey} is missing source or target legs`,
          propagation: 'after-fence',
          reason: 'carry_relationship_leg_missing',
        })
      ),
    };
  }

  const inputEventIds = group.events.map((event) => event.eventId).sort();
  return {
    operation: {
      kind: 'carry',
      operationId: `ledger-cost-basis-operation:carry:${group.relationshipStableKey}`,
      timestamp: getEarliestEventTimestamp(group.events),
      relationshipStableKey: group.relationshipStableKey,
      relationshipKind,
      relationshipBasisTreatment: 'carry_basis',
      inputEventIds,
      sourceLegs: sourceLegs.sort(compareCarryLegs),
      targetLegs: targetLegs.sort(compareCarryLegs),
    },
  };
}

function buildSinglePostingOperationBase(
  event: LedgerCostBasisInputEvent,
  chainKey: string,
  relationshipContext?: LedgerCostBasisOperationRelationshipContext  
): LedgerCostBasisSinglePostingOperationBase {
  return {
    operationId: `ledger-cost-basis-operation:${event.kind}:${event.eventId}`,
    sourceEventId: event.eventId,
    timestamp: event.timestamp,
    sourceActivityFingerprint: event.sourceActivityFingerprint,
    ownerAccountId: event.ownerAccountId,
    journalFingerprint: event.journalFingerprint,
    journalKind: event.journalKind,
    postingFingerprint: event.postingFingerprint,
    postingRole: event.postingRole,
    chainKey,
    assetId: event.assetId,
    assetSymbol: event.assetSymbol,
    quantity: event.quantity,
    ...(event.priceAtTxTime === undefined ? {} : { priceAtTxTime: event.priceAtTxTime }),
    ...(relationshipContext === undefined ? {} : { relationshipContext }),
  };
}

function buildCarryLeg(
  event: LedgerCostBasisInputEvent,
  chainKey: string,
  relationshipAllocationId: number
): LedgerCostBasisCarryLeg {
  return {
    allocationId: relationshipAllocationId,
    sourceEventId: event.eventId,
    timestamp: event.timestamp,
    sourceActivityFingerprint: event.sourceActivityFingerprint,
    ownerAccountId: event.ownerAccountId,
    journalFingerprint: event.journalFingerprint,
    journalKind: event.journalKind,
    postingFingerprint: event.postingFingerprint,
    postingRole: event.postingRole,
    chainKey,
    assetId: event.assetId,
    assetSymbol: event.assetSymbol,
    quantity: event.quantity,
    ...(event.priceAtTxTime === undefined ? {} : { priceAtTxTime: event.priceAtTxTime }),
  };
}

function buildOperationRelationshipContext(event: LedgerCostBasisInputEvent): RelationshipContextResult {
  const hasAnyRelationshipContext =
    event.relationshipStableKey !== undefined ||
    event.relationshipKind !== undefined ||
    event.relationshipBasisTreatment !== undefined ||
    event.relationshipAllocationId !== undefined;

  if (!hasAnyRelationshipContext) {
    return {};
  }

  if (
    event.relationshipStableKey === undefined ||
    event.relationshipKind === undefined ||
    event.relationshipBasisTreatment === undefined ||
    event.relationshipAllocationId === undefined
  ) {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [],
        event,
        message: `Ledger cost-basis event ${event.eventId} has incomplete relationship context`,
        propagation: 'after-fence',
        reason: 'relationship_context_incomplete',
      }),
    };
  }

  return {
    relationshipContext: {
      relationshipStableKey: event.relationshipStableKey,
      relationshipKind: event.relationshipKind,
      relationshipBasisTreatment: event.relationshipBasisTreatment,
      relationshipAllocationId: event.relationshipAllocationId,
    },
  };
}

function buildRequiredCarryRelationshipContext(event: LedgerCostBasisInputEvent):
  | {
      relationshipAllocationId: number;
      relationshipKind: AccountingJournalRelationshipKind;
    }
  | { blocker: LedgerCostBasisOperationBlocker } {
  if (
    event.relationshipStableKey === undefined ||
    event.relationshipKind === undefined ||
    event.relationshipBasisTreatment !== 'carry_basis' ||
    event.relationshipAllocationId === undefined
  ) {
    return {
      blocker: buildEventOperationBlocker({
        affectedChainKeys: [],
        event,
        message: `Ledger cost-basis carry event ${event.eventId} has incomplete carry relationship context`,
        propagation: 'after-fence',
        reason: 'carry_relationship_context_missing',
      }),
    };
  }

  return { relationshipKind: event.relationshipKind, relationshipAllocationId: event.relationshipAllocationId };
}

function resolveOperationChainKey(
  event: Pick<LedgerCostBasisInputEvent, 'assetId' | 'assetSymbol' | 'eventId'>,
  identityConfig: LedgerCostBasisOperationIdentityConfig
): ChainKeyResolution | { failure: ChainKeyResolutionFailure } {
  if (isFiat(event.assetSymbol)) {
    return {
      failure: {
        reason: 'fiat_cost_basis_event',
        message: `Ledger cost-basis event ${event.eventId} references fiat asset ${event.assetSymbol}`,
      },
    };
  }

  const result = resolveTaxAssetIdentity(
    {
      assetId: event.assetId,
      assetSymbol: event.assetSymbol,
    },
    identityConfig
  );

  if (result.isErr()) {
    return {
      failure: {
        reason: 'tax_asset_identity_unresolved',
        message: `Failed to resolve tax asset identity for ledger cost-basis event ${event.eventId}: ${result.error.message}`,
      },
    };
  }

  return { chainKey: result.value.identityKey };
}

function buildProjectionOperationBlocker(
  blocker: LedgerCostBasisProjectionBlocker,
  identityConfig: LedgerCostBasisOperationIdentityConfig
): LedgerCostBasisOperationBlocker {
  return {
    blockerId: buildProjectionOperationBlockerId(blocker),
    reason: blocker.reason,
    propagation: blocker.reason === 'zero_quantity_posting' ? 'op-only' : 'after-fence',
    affectedChainKeys: resolveProjectionBlockerChainKeys(blocker, identityConfig),
    inputEventIds: [],
    sourceProjectionBlocker: blocker,
    message: blocker.message,
  };
}

function resolveProjectionBlockerChainKeys(
  blocker: LedgerCostBasisProjectionBlocker,
  identityConfig: LedgerCostBasisOperationIdentityConfig
): readonly string[] {
  if (blocker.scope === 'posting') {
    const chainKey = resolveOperationChainKey(
      {
        assetId: blocker.assetId,
        assetSymbol: blocker.assetSymbol,
        eventId: blocker.postingFingerprint,
      },
      identityConfig
    );
    return 'chainKey' in chainKey ? [chainKey.chainKey] : [];
  }

  return dedupeSorted(
    blocker.allocations.flatMap((allocation) => {
      const chainKey = resolveOperationChainKey(
        {
          assetId: allocation.assetId,
          assetSymbol: allocation.assetSymbol,
          eventId: allocation.postingFingerprint,
        },
        identityConfig
      );
      return 'chainKey' in chainKey ? [chainKey.chainKey] : [];
    })
  );
}

function buildEventOperationBlocker(params: {
  affectedChainKeys: readonly string[];
  event: LedgerCostBasisInputEvent;
  message: string;
  propagation: LedgerCostBasisOperationBlockerPropagation;
  reason: LedgerCostBasisOperationBlockerReason;
}): LedgerCostBasisOperationBlocker {
  return {
    blockerId: `ledger-cost-basis-operation-blocker:event:${params.reason}:${params.event.eventId}`,
    reason: params.reason,
    propagation: params.propagation,
    affectedChainKeys: dedupeSorted(params.affectedChainKeys),
    inputEventIds: [params.event.eventId],
    message: params.message,
  };
}

function buildProjectionOperationBlockerId(blocker: LedgerCostBasisProjectionBlocker): string {
  if (blocker.scope === 'posting') {
    return `ledger-cost-basis-operation-blocker:projection:${blocker.reason}:${blocker.postingFingerprint}`;
  }

  return `ledger-cost-basis-operation-blocker:projection:${blocker.reason}:${blocker.relationshipStableKey}`;
}

function getEarliestEventTimestamp(events: readonly LedgerCostBasisInputEvent[]): Date {
  const firstTimestamp = events[0]?.timestamp;
  if (firstTimestamp === undefined) {
    return new Date(0);
  }

  return events.reduce((earliest, event) => (event.timestamp < earliest ? event.timestamp : earliest), firstTimestamp);
}

function compareLedgerCostBasisOperations(left: LedgerCostBasisOperation, right: LedgerCostBasisOperation): number {
  return compareStringArrays(buildOperationSortParts(left), buildOperationSortParts(right));
}

function buildOperationSortParts(operation: LedgerCostBasisOperation): string[] {
  if (operation.kind === 'carry') {
    return [
      operation.timestamp.toISOString(),
      operation.relationshipStableKey,
      operation.sourceLegs[0]?.sourceActivityFingerprint ?? '',
      operation.sourceLegs[0]?.journalFingerprint ?? '',
      operation.sourceLegs[0]?.postingFingerprint ?? '',
      operation.operationId,
    ];
  }

  return [
    operation.timestamp.toISOString(),
    operation.sourceActivityFingerprint,
    operation.journalFingerprint,
    'relationshipContext' in operation ? (operation.relationshipContext?.relationshipStableKey ?? '') : '',
    operation.postingFingerprint,
    operation.operationId,
  ];
}

function compareCarryLegs(left: LedgerCostBasisCarryLeg, right: LedgerCostBasisCarryLeg): number {
  return compareStringArrays(
    [
      left.timestamp.toISOString(),
      left.sourceActivityFingerprint,
      left.journalFingerprint,
      left.postingFingerprint,
      left.allocationId.toString().padStart(16, '0'),
    ],
    [
      right.timestamp.toISOString(),
      right.sourceActivityFingerprint,
      right.journalFingerprint,
      right.postingFingerprint,
      right.allocationId.toString().padStart(16, '0'),
    ]
  );
}

function compareLedgerCostBasisOperationBlockers(
  left: LedgerCostBasisOperationBlocker,
  right: LedgerCostBasisOperationBlocker
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
