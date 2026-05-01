import type { PriceAtTxTime } from '@exitbook/core';
import { err, ok, type Currency, type Result } from '@exitbook/foundation';
import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

import type {
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerRelationship,
  CostBasisLedgerRelationshipAllocation,
  CostBasisLedgerSourceActivity,
} from '../../ports/cost-basis-ledger-persistence.js';

const BASIS_CARRYOVER_RELATIONSHIP_KINDS = new Set<AccountingJournalRelationshipKind>([
  'internal_transfer',
  'same_hash_carryover',
  'bridge',
  'asset_migration',
]);

export type LedgerCostBasisInputEventKind = 'acquisition' | 'disposal' | 'carryover-in' | 'carryover-out' | 'fee';

export type LedgerCostBasisProjectionBlockerReason =
  | 'missing_relationship'
  | 'relationship_residual'
  | 'unsupported_protocol_posting';

export interface LedgerCostBasisInputEvent {
  eventId: string;
  kind: LedgerCostBasisInputEventKind;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string;
  timestamp: Date;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  relationshipStableKey?: string | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
  relationshipAllocationId?: number | undefined;
}

export interface LedgerCostBasisProjectionBlocker {
  reason: LedgerCostBasisProjectionBlockerReason;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  postingQuantity: Decimal;
  blockedQuantity: Decimal;
  relationshipStableKeys: readonly string[];
  message: string;
}

export interface LedgerCostBasisEventProjection {
  events: readonly LedgerCostBasisInputEvent[];
  blockers: readonly LedgerCostBasisProjectionBlocker[];
}

interface LedgerPostingContext {
  posting: CostBasisLedgerPosting;
  journal: CostBasisLedgerJournal;
  sourceActivity: CostBasisLedgerSourceActivity;
}

interface RelationshipAllocationContext {
  relationship: CostBasisLedgerRelationship;
  allocation: CostBasisLedgerRelationshipAllocation;
}

export function projectLedgerCostBasisEvents(
  facts: CostBasisLedgerFacts
): Result<LedgerCostBasisEventProjection, Error> {
  const journalById = new Map(facts.journals.map((journal) => [journal.id, journal]));
  const sourceActivityById = new Map(facts.sourceActivities.map((activity) => [activity.id, activity]));

  const allocationsByPostingFingerprint = groupRelationshipAllocationsByPostingFingerprint(facts.relationships);

  const contexts: LedgerPostingContext[] = [];
  for (const posting of facts.postings) {
    const context = resolveLedgerPostingContext(posting, journalById, sourceActivityById);
    if (context.isErr()) {
      return err(context.error);
    }
    contexts.push(context.value);
  }

  contexts.sort(compareLedgerPostingContexts);

  const events: LedgerCostBasisInputEvent[] = [];
  const blockers: LedgerCostBasisProjectionBlocker[] = [];

  for (const context of contexts) {
    const allocations = allocationsByPostingFingerprint.get(context.posting.postingFingerprint) ?? [];
    const projection = projectLedgerPostingCostBasisEvents(context, allocations);
    if (projection.isErr()) {
      return err(projection.error);
    }

    events.push(...projection.value.events);
    blockers.push(...projection.value.blockers);
  }

  return ok({ events, blockers });
}

function projectLedgerPostingCostBasisEvents(
  context: LedgerPostingContext,
  allocations: readonly RelationshipAllocationContext[]
): Result<LedgerCostBasisEventProjection, Error> {
  const { posting } = context;
  if (posting.quantity.isZero()) {
    return err(new Error(`Ledger cost-basis posting ${posting.postingFingerprint} has zero quantity`));
  }

  if (allocations.length === 0) {
    return projectUnrelatedLedgerPosting(context);
  }

  const events: LedgerCostBasisInputEvent[] = [];
  let allocatedQuantity = posting.quantity.abs().times(0);

  for (const allocationContext of allocations) {
    const allocationValidation = validateRelationshipAllocationDirection(context, allocationContext);
    if (allocationValidation.isErr()) {
      return err(allocationValidation.error);
    }

    allocatedQuantity = allocatedQuantity.plus(allocationContext.allocation.quantity);
    if (allocatedQuantity.gt(posting.quantity.abs())) {
      return err(
        new Error(
          `Ledger cost-basis posting ${posting.postingFingerprint} is over-allocated by relationships: ` +
            `${allocatedQuantity.toFixed()} allocated for ${posting.quantity.abs().toFixed()} posting quantity`
        )
      );
    }

    events.push(projectRelationshipAllocationEvent(context, allocationContext));
  }

  const residualQuantity = posting.quantity.abs().minus(allocatedQuantity);
  if (residualQuantity.gt(0)) {
    return ok({
      events,
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: residualQuantity,
          reason: 'relationship_residual',
          relationshipStableKeys: allocations.map(({ relationship }) => relationship.relationshipStableKey),
          message:
            `Ledger cost-basis posting ${posting.postingFingerprint} has ${residualQuantity.toFixed()} ` +
            `${posting.assetSymbol} not covered by accepted relationship allocations`,
        }),
      ],
    });
  }

  return ok({ events, blockers: [] });
}

function projectUnrelatedLedgerPosting(context: LedgerPostingContext): Result<LedgerCostBasisEventProjection, Error> {
  const { journal, posting } = context;

  if (posting.role === 'fee' || posting.role === 'protocol_overhead') {
    return ok({ events: [buildPostingEvent(context, 'fee', posting.quantity.abs())], blockers: [] });
  }

  if (posting.role === 'protocol_deposit' || posting.role === 'protocol_refund') {
    return ok({
      events: [],
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: posting.quantity.abs(),
          reason: 'unsupported_protocol_posting',
          relationshipStableKeys: [],
          message:
            `Ledger cost-basis posting ${posting.postingFingerprint} has protocol role ${posting.role} ` +
            'without a supported cost-basis relationship',
        }),
      ],
    });
  }

  if (journal.journalKind === 'internal_transfer') {
    return ok({
      events: [],
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: posting.quantity.abs(),
          reason: 'missing_relationship',
          relationshipStableKeys: [],
          message:
            `Ledger cost-basis internal-transfer posting ${posting.postingFingerprint} has no accepted ` +
            'relationship allocation',
        }),
      ],
    });
  }

  const eventKind: LedgerCostBasisInputEventKind = posting.quantity.gt(0) ? 'acquisition' : 'disposal';
  return ok({ events: [buildPostingEvent(context, eventKind, posting.quantity.abs())], blockers: [] });
}

function projectRelationshipAllocationEvent(
  context: LedgerPostingContext,
  allocationContext: RelationshipAllocationContext
): LedgerCostBasisInputEvent {
  const { allocation, relationship } = allocationContext;
  const carriesBasis = BASIS_CARRYOVER_RELATIONSHIP_KINDS.has(relationship.relationshipKind);
  const kind: LedgerCostBasisInputEventKind = carriesBasis
    ? allocation.allocationSide === 'source'
      ? 'carryover-out'
      : 'carryover-in'
    : allocation.allocationSide === 'source'
      ? 'disposal'
      : 'acquisition';

  return buildPostingEvent(context, kind, allocation.quantity, {
    relationshipAllocationId: allocation.id,
    relationshipKind: relationship.relationshipKind,
    relationshipStableKey: relationship.relationshipStableKey,
  });
}

function buildPostingEvent(
  context: LedgerPostingContext,
  kind: LedgerCostBasisInputEventKind,
  quantity: Decimal,
  relationship?: Pick<
    LedgerCostBasisInputEvent,
    'relationshipAllocationId' | 'relationshipKind' | 'relationshipStableKey'
  >
): LedgerCostBasisInputEvent {
  const { journal, posting, sourceActivity } = context;
  const eventIdParts = [
    'ledger-cost-basis',
    kind,
    posting.postingFingerprint,
    relationship?.relationshipAllocationId ?? 'posting',
  ];

  return {
    eventId: eventIdParts.join(':'),
    kind,
    sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
    journalFingerprint: journal.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    timestamp: sourceActivity.activityDatetime,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    quantity,
    priceAtTxTime: posting.priceAtTxTime,
    ...(relationship?.relationshipAllocationId === undefined
      ? {}
      : { relationshipAllocationId: relationship.relationshipAllocationId }),
    ...(relationship?.relationshipKind === undefined ? {} : { relationshipKind: relationship.relationshipKind }),
    ...(relationship?.relationshipStableKey === undefined
      ? {}
      : { relationshipStableKey: relationship.relationshipStableKey }),
  };
}

function buildProjectionBlocker(params: {
  blockedQuantity: Decimal;
  context: LedgerPostingContext;
  message: string;
  reason: LedgerCostBasisProjectionBlockerReason;
  relationshipStableKeys: readonly string[];
}): LedgerCostBasisProjectionBlocker {
  const { journal, posting, sourceActivity } = params.context;

  return {
    reason: params.reason,
    sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
    journalFingerprint: journal.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    postingQuantity: posting.quantity,
    blockedQuantity: params.blockedQuantity,
    relationshipStableKeys: params.relationshipStableKeys,
    message: params.message,
  };
}

function validateRelationshipAllocationDirection(
  context: LedgerPostingContext,
  allocationContext: RelationshipAllocationContext
): Result<void, Error> {
  const { allocation, relationship } = allocationContext;
  const { posting } = context;

  if (allocation.quantity.lte(0)) {
    return err(new Error(`Ledger relationship allocation ${allocation.id} quantity must be positive`));
  }

  if (allocation.assetId !== posting.assetId) {
    return err(
      new Error(
        `Ledger relationship ${relationship.relationshipStableKey} allocation ${allocation.id} asset ` +
          `${allocation.assetId} does not match posting ${posting.postingFingerprint} asset ${posting.assetId}`
      )
    );
  }

  if (allocation.allocationSide === 'source' && posting.quantity.gt(0)) {
    return err(
      new Error(
        `Ledger relationship ${relationship.relationshipStableKey} source allocation ${allocation.id} ` +
          `points at positive posting ${posting.postingFingerprint}`
      )
    );
  }

  if (allocation.allocationSide === 'target' && posting.quantity.lt(0)) {
    return err(
      new Error(
        `Ledger relationship ${relationship.relationshipStableKey} target allocation ${allocation.id} ` +
          `points at negative posting ${posting.postingFingerprint}`
      )
    );
  }

  return ok(undefined);
}

function resolveLedgerPostingContext(
  posting: CostBasisLedgerPosting,
  journalById: ReadonlyMap<number, CostBasisLedgerJournal>,
  sourceActivityById: ReadonlyMap<number, CostBasisLedgerSourceActivity>
): Result<LedgerPostingContext, Error> {
  const journal = journalById.get(posting.journalId);
  if (journal === undefined) {
    return err(new Error(`Ledger cost-basis posting ${posting.postingFingerprint} references missing journal`));
  }

  const sourceActivity = sourceActivityById.get(journal.sourceActivityId);
  if (sourceActivity === undefined) {
    return err(new Error(`Ledger cost-basis journal ${journal.journalFingerprint} references missing source activity`));
  }

  return ok({ posting, journal, sourceActivity });
}

function groupRelationshipAllocationsByPostingFingerprint(
  relationships: readonly CostBasisLedgerRelationship[]
): Map<string, RelationshipAllocationContext[]> {
  const allocationsByPostingFingerprint = new Map<string, RelationshipAllocationContext[]>();

  for (const relationship of relationships) {
    for (const allocation of relationship.allocations) {
      const allocations = allocationsByPostingFingerprint.get(allocation.postingFingerprint) ?? [];
      allocations.push({ relationship, allocation });
      allocationsByPostingFingerprint.set(allocation.postingFingerprint, allocations);
    }
  }

  return allocationsByPostingFingerprint;
}

function compareLedgerPostingContexts(left: LedgerPostingContext, right: LedgerPostingContext): number {
  return (
    left.sourceActivity.activityDatetime.getTime() - right.sourceActivity.activityDatetime.getTime() ||
    left.sourceActivity.sourceActivityFingerprint.localeCompare(right.sourceActivity.sourceActivityFingerprint) ||
    left.journal.journalStableKey.localeCompare(right.journal.journalStableKey) ||
    left.posting.postingStableKey.localeCompare(right.posting.postingStableKey)
  );
}
