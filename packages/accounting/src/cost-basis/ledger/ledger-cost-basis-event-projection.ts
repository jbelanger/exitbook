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
  | LedgerCostBasisPostingBlockerReason
  | LedgerCostBasisRelationshipBlockerReason;

export type LedgerCostBasisPostingBlockerReason =
  | 'fee_settlement_missing'
  | 'missing_relationship'
  | 'relationship_residual'
  | 'unsupported_protocol_posting'
  | 'zero_quantity_posting';

export type LedgerCostBasisRelationshipBlockerReason =
  | 'relationship_allocation_invalid'
  | 'relationship_allocation_missing_posting'
  | 'relationship_allocation_overallocated'
  | 'relationship_allocation_posting_mismatch'
  | 'relationship_partially_excluded';

export type LedgerCostBasisRelationshipAllocationBlockerState =
  | 'blocked_by_relationship'
  | 'excluded_posting'
  | 'invalid_allocation'
  | 'mismatched_posting'
  | 'missing_posting'
  | 'overallocated_posting';

export type LedgerCostBasisRelationshipAllocationMismatchReason =
  | 'asset_id_mismatch'
  | 'asset_symbol_mismatch'
  | 'current_journal_id_mismatch'
  | 'current_posting_id_mismatch'
  | 'journal_fingerprint_mismatch'
  | 'source_activity_fingerprint_mismatch';

export type LedgerCostBasisRelationshipAllocationValidationReason =
  | 'non_positive_quantity'
  | 'overallocated_posting'
  | 'relationship_allocation_points_at_fee_posting'
  | 'relationship_allocation_points_at_protocol_overhead_posting'
  | 'source_allocation_points_at_positive_posting'
  | 'target_allocation_points_at_negative_posting';

export type LedgerCostBasisExclusionReason = 'asset_excluded';

export interface ProjectLedgerCostBasisEventsOptions {
  excludedAssetIds?: ReadonlySet<string> | undefined;
}

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

export type LedgerCostBasisProjectionBlocker = LedgerCostBasisPostingBlocker | LedgerCostBasisRelationshipBlocker;

export interface LedgerCostBasisPostingBlocker {
  scope: 'posting';
  reason: LedgerCostBasisPostingBlockerReason;
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

export interface LedgerCostBasisRelationshipBlockerAllocation {
  allocationId: number;
  allocationSide: CostBasisLedgerRelationshipAllocation['allocationSide'];
  postingFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  state: LedgerCostBasisRelationshipAllocationBlockerState;
  mismatchReasons: readonly LedgerCostBasisRelationshipAllocationMismatchReason[];
  validationReasons: readonly LedgerCostBasisRelationshipAllocationValidationReason[];
}

export interface LedgerCostBasisRelationshipBlocker {
  scope: 'relationship';
  reason: LedgerCostBasisRelationshipBlockerReason;
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  allocations: readonly LedgerCostBasisRelationshipBlockerAllocation[];
  message: string;
}

export interface LedgerCostBasisExcludedPosting {
  reason: LedgerCostBasisExclusionReason;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  postingQuantity: Decimal;
  message: string;
}

export interface LedgerCostBasisEventProjection {
  events: readonly LedgerCostBasisInputEvent[];
  blockers: readonly LedgerCostBasisProjectionBlocker[];
  excludedPostings: readonly LedgerCostBasisExcludedPosting[];
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

interface RelationshipProjectionIntegrity {
  blockers: readonly LedgerCostBasisRelationshipBlocker[];
  blockedPostingFingerprints: ReadonlySet<string>;
  blockedRelationshipStableKeys: ReadonlySet<string>;
}

interface RelationshipAllocationIntegrity {
  allocation: CostBasisLedgerRelationshipAllocation;
  mismatchReasons: readonly LedgerCostBasisRelationshipAllocationMismatchReason[];
  validationReasons: readonly LedgerCostBasisRelationshipAllocationValidationReason[];
  state: LedgerCostBasisRelationshipAllocationBlockerState | 'valid';
}

interface LedgerCostBasisPostingProjection {
  events: readonly LedgerCostBasisInputEvent[];
  blockers: readonly LedgerCostBasisPostingBlocker[];
}

export function projectLedgerCostBasisEvents(
  facts: CostBasisLedgerFacts,
  options: ProjectLedgerCostBasisEventsOptions = {}
): Result<LedgerCostBasisEventProjection, Error> {
  const journalById = new Map(facts.journals.map((journal) => [journal.id, journal]));
  const sourceActivityById = new Map(facts.sourceActivities.map((activity) => [activity.id, activity]));

  const contexts: LedgerPostingContext[] = [];
  for (const posting of facts.postings) {
    const context = resolveLedgerPostingContext(posting, journalById, sourceActivityById);
    if (context.isErr()) {
      return err(context.error);
    }
    contexts.push(context.value);
  }

  contexts.sort(compareLedgerPostingContexts);

  const contextByPostingFingerprint = new Map(contexts.map((context) => [context.posting.postingFingerprint, context]));
  const relationshipIntegrity = findRelationshipProjectionIntegrity(
    facts.relationships,
    contextByPostingFingerprint,
    options.excludedAssetIds
  );
  const allocationsByPostingFingerprint = groupRelationshipAllocationsByPostingFingerprint(
    facts.relationships,
    relationshipIntegrity.blockedRelationshipStableKeys
  );

  const events: LedgerCostBasisInputEvent[] = [];
  const blockers: LedgerCostBasisProjectionBlocker[] = [...relationshipIntegrity.blockers];
  const excludedPostings: LedgerCostBasisExcludedPosting[] = [];

  for (const context of contexts) {
    if (options.excludedAssetIds?.has(context.posting.assetId) === true) {
      excludedPostings.push(buildExcludedPosting(context));
      continue;
    }

    const allocations = allocationsByPostingFingerprint.get(context.posting.postingFingerprint) ?? [];
    if (
      allocations.length === 0 &&
      relationshipIntegrity.blockedPostingFingerprints.has(context.posting.postingFingerprint)
    ) {
      continue;
    }

    const projection = projectLedgerPostingCostBasisEvents(context, allocations);
    if (projection.isErr()) {
      return err(projection.error);
    }

    events.push(...projection.value.events);
    blockers.push(...projection.value.blockers);
  }

  return ok({ events, blockers, excludedPostings });
}

function projectLedgerPostingCostBasisEvents(
  context: LedgerPostingContext,
  allocations: readonly RelationshipAllocationContext[]
): Result<LedgerCostBasisPostingProjection, Error> {
  const { posting } = context;
  if (posting.quantity.isZero()) {
    return ok({
      events: [],
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: posting.quantity.abs(),
          reason: 'zero_quantity_posting',
          relationshipStableKeys: allocations.map(({ relationship }) => relationship.relationshipStableKey),
          message: `Ledger cost-basis posting ${posting.postingFingerprint} has zero quantity`,
        }),
      ],
    });
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

function projectUnrelatedLedgerPosting(context: LedgerPostingContext): Result<LedgerCostBasisPostingProjection, Error> {
  const { journal, posting } = context;

  if (posting.role === 'fee' && posting.settlement === undefined) {
    return ok({
      events: [],
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: posting.quantity.abs(),
          reason: 'fee_settlement_missing',
          relationshipStableKeys: [],
          message: `Ledger cost-basis fee posting ${posting.postingFingerprint} has no settlement`,
        }),
      ],
    });
  }

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
  reason: LedgerCostBasisPostingBlockerReason;
  relationshipStableKeys: readonly string[];
}): LedgerCostBasisPostingBlocker {
  const { journal, posting, sourceActivity } = params.context;

  return {
    scope: 'posting',
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

function findRelationshipProjectionIntegrity(
  relationships: readonly CostBasisLedgerRelationship[],
  contextByPostingFingerprint: ReadonlyMap<string, LedgerPostingContext>,
  excludedAssetIds: ReadonlySet<string> | undefined
): RelationshipProjectionIntegrity {
  const blockers: LedgerCostBasisRelationshipBlocker[] = [];
  const blockedRelationshipStableKeys = new Set<string>();
  const blockedPostingFingerprints = new Set<string>();
  const validRelationshipAllocations: {
    allocationIntegrity: readonly RelationshipAllocationIntegrity[];
    relationship: CostBasisLedgerRelationship;
  }[] = [];

  for (const relationship of relationships) {
    const allocationIntegrity = relationship.allocations.map((allocation) =>
      buildRelationshipAllocationIntegrity(allocation, contextByPostingFingerprint, excludedAssetIds)
    );
    const missingAllocations = allocationIntegrity.filter((allocation) => allocation.state === 'missing_posting');
    const excludedAllocations = allocationIntegrity.filter((allocation) => allocation.state === 'excluded_posting');
    const mismatchedAllocations = allocationIntegrity.filter((allocation) => allocation.state === 'mismatched_posting');
    const invalidAllocations = allocationIntegrity.filter((allocation) => allocation.state === 'invalid_allocation');
    const validAllocations = allocationIntegrity.filter((allocation) => allocation.state === 'valid');
    const nonExcludedPresentAllocations = allocationIntegrity.filter(
      (allocation) =>
        allocation.state === 'valid' ||
        allocation.state === 'mismatched_posting' ||
        allocation.state === 'invalid_allocation'
    );

    const hasMissingAllocation = missingAllocations.length > 0;
    const hasMismatchedAllocation = mismatchedAllocations.length > 0;
    const hasInvalidAllocation = invalidAllocations.length > 0;
    const hasPartialExclusion = excludedAllocations.length > 0 && nonExcludedPresentAllocations.length > 0;
    if (!hasMissingAllocation && !hasMismatchedAllocation && !hasInvalidAllocation && !hasPartialExclusion) {
      validRelationshipAllocations.push({ allocationIntegrity, relationship });
      continue;
    }

    blockedRelationshipStableKeys.add(relationship.relationshipStableKey);
    for (const allocation of nonExcludedPresentAllocations) {
      blockedPostingFingerprints.add(allocation.allocation.postingFingerprint);
    }

    blockers.push(
      buildRelationshipBlocker({
        missingAllocations,
        excludedAllocations,
        invalidAllocations,
        mismatchedAllocations,
        overallocatedAllocations: [],
        relationship,
        reason: selectRelationshipBlockerReason({
          hasInvalidAllocation,
          hasMissingAllocation,
          hasMismatchedAllocation,
        }),
        validAllocations,
      })
    );
  }

  const overallocatedPostingFingerprints = findOverallocatedPostingFingerprints(
    validRelationshipAllocations,
    contextByPostingFingerprint
  );
  if (overallocatedPostingFingerprints.size > 0) {
    for (const { allocationIntegrity, relationship } of validRelationshipAllocations) {
      const overallocatedAllocations = allocationIntegrity.filter((allocation) =>
        overallocatedPostingFingerprints.has(allocation.allocation.postingFingerprint)
      );
      if (overallocatedAllocations.length === 0) {
        continue;
      }

      const validAllocations = allocationIntegrity.filter(
        (allocation) => !overallocatedPostingFingerprints.has(allocation.allocation.postingFingerprint)
      );

      blockedRelationshipStableKeys.add(relationship.relationshipStableKey);
      for (const allocation of allocationIntegrity) {
        blockedPostingFingerprints.add(allocation.allocation.postingFingerprint);
      }

      blockers.push(
        buildRelationshipBlocker({
          missingAllocations: [],
          excludedAllocations: [],
          invalidAllocations: [],
          mismatchedAllocations: [],
          overallocatedAllocations,
          relationship,
          reason: 'relationship_allocation_overallocated',
          validAllocations,
        })
      );
    }
  }

  return { blockers, blockedPostingFingerprints, blockedRelationshipStableKeys };
}

function buildRelationshipBlocker(params: {
  excludedAllocations: readonly RelationshipAllocationIntegrity[];
  invalidAllocations: readonly RelationshipAllocationIntegrity[];
  mismatchedAllocations: readonly RelationshipAllocationIntegrity[];
  missingAllocations: readonly RelationshipAllocationIntegrity[];
  overallocatedAllocations: readonly RelationshipAllocationIntegrity[];
  reason: LedgerCostBasisRelationshipBlockerReason;
  relationship: CostBasisLedgerRelationship;
  validAllocations: readonly RelationshipAllocationIntegrity[];
}): LedgerCostBasisRelationshipBlocker {
  const allocations: LedgerCostBasisRelationshipBlockerAllocation[] = [
    ...params.missingAllocations.map((allocation) => buildRelationshipBlockerAllocation(allocation, 'missing_posting')),
    ...params.excludedAllocations.map((allocation) =>
      buildRelationshipBlockerAllocation(allocation, 'excluded_posting')
    ),
    ...params.invalidAllocations.map((allocation) =>
      buildRelationshipBlockerAllocation(allocation, 'invalid_allocation')
    ),
    ...params.mismatchedAllocations.map((allocation) =>
      buildRelationshipBlockerAllocation(allocation, 'mismatched_posting')
    ),
    ...params.overallocatedAllocations.map((allocation) =>
      buildRelationshipBlockerAllocation(
        {
          ...allocation,
          validationReasons: [...allocation.validationReasons, 'overallocated_posting'],
        },
        'overallocated_posting'
      )
    ),
    ...params.validAllocations.map((allocation) =>
      buildRelationshipBlockerAllocation(allocation, 'blocked_by_relationship')
    ),
  ];

  return {
    scope: 'relationship',
    reason: params.reason,
    relationshipStableKey: params.relationship.relationshipStableKey,
    relationshipKind: params.relationship.relationshipKind,
    allocations,
    message: buildRelationshipBlockerMessage(params),
  };
}

function buildRelationshipBlockerAllocation(
  allocationIntegrity: RelationshipAllocationIntegrity,
  state: LedgerCostBasisRelationshipAllocationBlockerState
): LedgerCostBasisRelationshipBlockerAllocation {
  const { allocation } = allocationIntegrity;

  return {
    allocationId: allocation.id,
    allocationSide: allocation.allocationSide,
    postingFingerprint: allocation.postingFingerprint,
    assetId: allocation.assetId,
    assetSymbol: allocation.assetSymbol,
    quantity: allocation.quantity,
    state,
    mismatchReasons: allocationIntegrity.mismatchReasons,
    validationReasons: allocationIntegrity.validationReasons,
  };
}

function buildRelationshipBlockerMessage(params: {
  excludedAllocations: readonly RelationshipAllocationIntegrity[];
  invalidAllocations: readonly RelationshipAllocationIntegrity[];
  mismatchedAllocations: readonly RelationshipAllocationIntegrity[];
  missingAllocations: readonly RelationshipAllocationIntegrity[];
  overallocatedAllocations: readonly RelationshipAllocationIntegrity[];
  reason: LedgerCostBasisRelationshipBlockerReason;
  relationship: CostBasisLedgerRelationship;
  validAllocations: readonly RelationshipAllocationIntegrity[];
}): string {
  if (params.reason === 'relationship_allocation_missing_posting') {
    const missingPostingFingerprints = params.missingAllocations
      .map(({ allocation }) => allocation.postingFingerprint)
      .join(', ');
    return `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} references missing posting allocation(s): ${missingPostingFingerprints}`;
  }

  if (params.reason === 'relationship_allocation_posting_mismatch') {
    const mismatches = params.mismatchedAllocations
      .map(({ allocation, mismatchReasons }) => `${allocation.postingFingerprint} (${mismatchReasons.join(', ')})`)
      .join(', ');
    return `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} has allocation metadata that does not match loaded posting(s): ${mismatches}`;
  }

  if (params.reason === 'relationship_allocation_invalid') {
    const invalidAllocations = params.invalidAllocations
      .map(({ allocation, validationReasons }) => `${allocation.postingFingerprint} (${validationReasons.join(', ')})`)
      .join(', ');
    return `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} has invalid allocation(s): ${invalidAllocations}`;
  }

  if (params.reason === 'relationship_allocation_overallocated') {
    const overallocatedPostingFingerprints = params.overallocatedAllocations
      .map(({ allocation }) => allocation.postingFingerprint)
      .join(', ');
    return `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} overallocates posting(s): ${overallocatedPostingFingerprints}`;
  }

  const excludedPostingFingerprints = params.excludedAllocations
    .map(({ allocation }) => allocation.postingFingerprint)
    .join(', ');
  const blockedPostingFingerprints = [
    ...params.validAllocations,
    ...params.mismatchedAllocations,
    ...params.invalidAllocations,
  ]
    .map(({ allocation }) => allocation.postingFingerprint)
    .join(', ');
  return (
    `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} mixes excluded posting allocation(s) ` +
    `${excludedPostingFingerprints} with non-excluded allocation(s) ${blockedPostingFingerprints}`
  );
}

function selectRelationshipBlockerReason(params: {
  hasInvalidAllocation: boolean;
  hasMismatchedAllocation: boolean;
  hasMissingAllocation: boolean;
}): LedgerCostBasisRelationshipBlockerReason {
  if (params.hasMissingAllocation) {
    return 'relationship_allocation_missing_posting';
  }

  if (params.hasMismatchedAllocation) {
    return 'relationship_allocation_posting_mismatch';
  }

  if (params.hasInvalidAllocation) {
    return 'relationship_allocation_invalid';
  }

  return 'relationship_partially_excluded';
}

function buildRelationshipAllocationIntegrity(
  allocation: CostBasisLedgerRelationshipAllocation,
  contextByPostingFingerprint: ReadonlyMap<string, LedgerPostingContext>,
  excludedAssetIds: ReadonlySet<string> | undefined
): RelationshipAllocationIntegrity {
  const context = contextByPostingFingerprint.get(allocation.postingFingerprint);
  if (context === undefined) {
    return { allocation, mismatchReasons: [], validationReasons: [], state: 'missing_posting' };
  }

  if (excludedAssetIds?.has(context.posting.assetId) === true) {
    return { allocation, mismatchReasons: [], validationReasons: [], state: 'excluded_posting' };
  }

  const mismatchReasons = findRelationshipAllocationMismatchReasons(allocation, context);
  if (mismatchReasons.length > 0) {
    return { allocation, mismatchReasons, validationReasons: [], state: 'mismatched_posting' };
  }

  const validationReasons = findRelationshipAllocationValidationReasons(allocation, context);
  if (validationReasons.length > 0) {
    return { allocation, mismatchReasons: [], validationReasons, state: 'invalid_allocation' };
  }

  return { allocation, mismatchReasons: [], validationReasons: [], state: 'valid' };
}

function findOverallocatedPostingFingerprints(
  relationshipAllocations: readonly {
    allocationIntegrity: readonly RelationshipAllocationIntegrity[];
    relationship: CostBasisLedgerRelationship;
  }[],
  contextByPostingFingerprint: ReadonlyMap<string, LedgerPostingContext>
): Set<string> {
  const allocatedQuantityByPostingFingerprint = new Map<string, Decimal>();

  for (const { allocationIntegrity } of relationshipAllocations) {
    for (const allocation of allocationIntegrity) {
      if (allocation.state !== 'valid') {
        continue;
      }

      const currentQuantity =
        allocatedQuantityByPostingFingerprint.get(allocation.allocation.postingFingerprint) ??
        allocation.allocation.quantity.times(0);
      allocatedQuantityByPostingFingerprint.set(
        allocation.allocation.postingFingerprint,
        currentQuantity.plus(allocation.allocation.quantity)
      );
    }
  }

  const overallocatedPostingFingerprints = new Set<string>();
  for (const [postingFingerprint, allocatedQuantity] of allocatedQuantityByPostingFingerprint) {
    const context = contextByPostingFingerprint.get(postingFingerprint);
    if (context !== undefined && allocatedQuantity.gt(context.posting.quantity.abs())) {
      overallocatedPostingFingerprints.add(postingFingerprint);
    }
  }

  return overallocatedPostingFingerprints;
}

function findRelationshipAllocationMismatchReasons(
  allocation: CostBasisLedgerRelationshipAllocation,
  context: LedgerPostingContext
): LedgerCostBasisRelationshipAllocationMismatchReason[] {
  const mismatchReasons: LedgerCostBasisRelationshipAllocationMismatchReason[] = [];

  if (allocation.sourceActivityFingerprint !== context.sourceActivity.sourceActivityFingerprint) {
    mismatchReasons.push('source_activity_fingerprint_mismatch');
  }
  if (allocation.journalFingerprint !== context.journal.journalFingerprint) {
    mismatchReasons.push('journal_fingerprint_mismatch');
  }
  if (allocation.assetId !== context.posting.assetId) {
    mismatchReasons.push('asset_id_mismatch');
  }
  if (allocation.assetSymbol !== context.posting.assetSymbol) {
    mismatchReasons.push('asset_symbol_mismatch');
  }
  if (allocation.currentJournalId !== undefined && allocation.currentJournalId !== context.journal.id) {
    mismatchReasons.push('current_journal_id_mismatch');
  }
  if (allocation.currentPostingId !== undefined && allocation.currentPostingId !== context.posting.id) {
    mismatchReasons.push('current_posting_id_mismatch');
  }

  return mismatchReasons;
}

function findRelationshipAllocationValidationReasons(
  allocation: CostBasisLedgerRelationshipAllocation,
  context: LedgerPostingContext
): LedgerCostBasisRelationshipAllocationValidationReason[] {
  const validationReasons: LedgerCostBasisRelationshipAllocationValidationReason[] = [];

  if (allocation.quantity.lte(0)) {
    validationReasons.push('non_positive_quantity');
  }
  if (context.posting.role === 'fee') {
    validationReasons.push('relationship_allocation_points_at_fee_posting');
  }
  if (context.posting.role === 'protocol_overhead') {
    validationReasons.push('relationship_allocation_points_at_protocol_overhead_posting');
  }
  if (allocation.allocationSide === 'source' && context.posting.quantity.gt(0)) {
    validationReasons.push('source_allocation_points_at_positive_posting');
  }
  if (allocation.allocationSide === 'target' && context.posting.quantity.lt(0)) {
    validationReasons.push('target_allocation_points_at_negative_posting');
  }

  return validationReasons;
}

function buildExcludedPosting(context: LedgerPostingContext): LedgerCostBasisExcludedPosting {
  const { journal, posting, sourceActivity } = context;

  return {
    reason: 'asset_excluded',
    sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
    journalFingerprint: journal.journalFingerprint,
    postingFingerprint: posting.postingFingerprint,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    postingQuantity: posting.quantity,
    message: `Ledger cost-basis posting ${posting.postingFingerprint} is excluded by accepted asset exclusion ${posting.assetId}`,
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
  relationships: readonly CostBasisLedgerRelationship[],
  blockedRelationshipStableKeys: ReadonlySet<string>
): Map<string, RelationshipAllocationContext[]> {
  const allocationsByPostingFingerprint = new Map<string, RelationshipAllocationContext[]>();

  for (const relationship of relationships) {
    if (blockedRelationshipStableKeys.has(relationship.relationshipStableKey)) {
      continue;
    }

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
