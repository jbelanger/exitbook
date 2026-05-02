import type { PriceAtTxTime } from '@exitbook/core';
import { err, ok, type Currency, type Result } from '@exitbook/foundation';
import type {
  AccountingJournalKind,
  AccountingJournalRelationshipKind,
  AccountingPostingRole,
  AccountingSettlement,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import type {
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerRelationship,
  CostBasisLedgerRelationshipAllocation,
  CostBasisLedgerSourceActivity,
} from '../../ports/cost-basis-ledger-persistence.js';
import { buildAccountingExclusionFingerprint } from '../accounting-exclusion-fingerprint.js';

import {
  classifyLedgerCostBasisRelationshipTreatment,
  type LedgerCostBasisRelationshipBasisTreatment,
} from './ledger-cost-basis-relationship-treatment.js';

export type LedgerCostBasisInputEventKind = 'acquisition' | 'disposal' | 'carryover-in' | 'carryover-out' | 'fee';

export type LedgerCostBasisProjectionBlockerReason =
  | LedgerCostBasisPostingBlockerReason
  | LedgerCostBasisRelationshipBlockerReason;

export type LedgerCostBasisPostingBlockerReason =
  | 'cost_settlement_missing'
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
  | 'protocol_position_requires_carry_basis_relationship'
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
  ownerAccountId: number;
  journalFingerprint: string;
  journalKind: AccountingJournalKind;
  postingFingerprint: string;
  postingRole: AccountingPostingRole;
  timestamp: Date;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  settlement?: AccountingSettlement | undefined;
  relationshipStableKey?: string | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
  relationshipBasisTreatment?: LedgerCostBasisRelationshipBasisTreatment | undefined;
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

export interface LedgerCostBasisJournalPostingContext {
  postingFingerprint: string;
  postingRole: AccountingPostingRole;
  assetId: string;
  assetSymbol: Currency;
  postingQuantity: Decimal;
}

export interface LedgerCostBasisJournalContext {
  journalFingerprint: string;
  journalKind: AccountingJournalKind;
  postings: readonly LedgerCostBasisJournalPostingContext[];
  relationshipStableKeys: readonly string[];
}

export interface LedgerCostBasisEventProjection {
  events: readonly LedgerCostBasisInputEvent[];
  blockers: readonly LedgerCostBasisProjectionBlocker[];
  excludedPostings: readonly LedgerCostBasisExcludedPosting[];
  journalContexts: readonly LedgerCostBasisJournalContext[];
  exclusionFingerprint: string;
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

  return ok({
    events,
    blockers,
    excludedPostings,
    journalContexts: buildJournalContexts(contexts, facts.relationships),
    exclusionFingerprint: buildAccountingExclusionFingerprint({
      excludedAssetIds: options.excludedAssetIds ?? [],
      excludedPostingFingerprints: excludedPostings.map((posting) => posting.postingFingerprint),
    }),
  });
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
  let allocatedQuantity = new Decimal(0);

  for (const allocationContext of allocations) {
    allocatedQuantity = allocatedQuantity.plus(allocationContext.allocation.quantity);
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

  if (isFeeLikeCostPosting(posting) && posting.settlement === undefined) {
    return ok({
      events: [],
      blockers: [
        buildProjectionBlocker({
          context,
          blockedQuantity: posting.quantity.abs(),
          reason: 'cost_settlement_missing',
          relationshipStableKeys: [],
          message: `Ledger cost-basis ${posting.role} posting ${posting.postingFingerprint} has no settlement`,
        }),
      ],
    });
  }

  if (isFeeLikeCostPosting(posting)) {
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
  const basisTreatment = classifyLedgerCostBasisRelationshipTreatment(relationship);
  const kind = selectRelationshipAllocationEventKind(allocation.allocationSide, basisTreatment);

  return buildPostingEvent(context, kind, allocation.quantity, {
    relationshipAllocationId: allocation.id,
    relationshipBasisTreatment: basisTreatment,
    relationshipKind: relationship.relationshipKind,
    relationshipStableKey: relationship.relationshipStableKey,
  });
}

function selectRelationshipAllocationEventKind(
  allocationSide: CostBasisLedgerRelationshipAllocation['allocationSide'],
  basisTreatment: LedgerCostBasisRelationshipBasisTreatment
): LedgerCostBasisInputEventKind {
  if (basisTreatment === 'carry_basis') {
    return allocationSide === 'source' ? 'carryover-out' : 'carryover-in';
  }

  return allocationSide === 'source' ? 'disposal' : 'acquisition';
}

function isFeeLikeCostPosting(posting: CostBasisLedgerPosting): boolean {
  return posting.role === 'fee' || posting.role === 'protocol_overhead';
}

function buildPostingEvent(
  context: LedgerPostingContext,
  kind: LedgerCostBasisInputEventKind,
  quantity: Decimal,
  relationship?: Pick<
    LedgerCostBasisInputEvent,
    'relationshipAllocationId' | 'relationshipBasisTreatment' | 'relationshipKind' | 'relationshipStableKey'
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
    ownerAccountId: sourceActivity.ownerAccountId,
    journalFingerprint: journal.journalFingerprint,
    journalKind: journal.journalKind,
    postingFingerprint: posting.postingFingerprint,
    postingRole: posting.role,
    timestamp: sourceActivity.activityDatetime,
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    quantity,
    priceAtTxTime: posting.priceAtTxTime,
    ...(posting.settlement === undefined ? {} : { settlement: posting.settlement }),
    ...(relationship?.relationshipAllocationId === undefined
      ? {}
      : { relationshipAllocationId: relationship.relationshipAllocationId }),
    ...(relationship?.relationshipBasisTreatment === undefined
      ? {}
      : { relationshipBasisTreatment: relationship.relationshipBasisTreatment }),
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
  const pendingRelationshipAllocations: {
    allocationIntegrity: readonly RelationshipAllocationIntegrity[];
    relationship: CostBasisLedgerRelationship;
  }[] = [];

  for (const relationship of relationships) {
    const basisTreatment = classifyLedgerCostBasisRelationshipTreatment(relationship);
    const allocationIntegrity = relationship.allocations.map((allocation) =>
      buildRelationshipAllocationIntegrity(allocation, basisTreatment, contextByPostingFingerprint, excludedAssetIds)
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
      pendingRelationshipAllocations.push({ allocationIntegrity, relationship });
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
    pendingRelationshipAllocations,
    contextByPostingFingerprint
  );
  if (overallocatedPostingFingerprints.size > 0) {
    for (const { allocationIntegrity, relationship } of pendingRelationshipAllocations) {
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
    const blockedPostingFingerprints = [...params.overallocatedAllocations, ...params.validAllocations]
      .map(({ allocation }) => allocation.postingFingerprint)
      .join(', ');
    return (
      `Ledger cost-basis relationship ${params.relationship.relationshipStableKey} overallocates posting(s): ` +
      `${overallocatedPostingFingerprints}; blocked relationship posting allocation(s): ${blockedPostingFingerprints}`
    );
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
  basisTreatment: LedgerCostBasisRelationshipBasisTreatment,
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

  const validationReasons = findRelationshipAllocationValidationReasons(allocation, basisTreatment, context);
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
        allocatedQuantityByPostingFingerprint.get(allocation.allocation.postingFingerprint) ?? new Decimal(0);
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
  basisTreatment: LedgerCostBasisRelationshipBasisTreatment,
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
  if (isProtocolPositionPosting(context.posting) && basisTreatment !== 'carry_basis') {
    validationReasons.push('protocol_position_requires_carry_basis_relationship');
  }
  if (allocation.allocationSide === 'source' && context.posting.quantity.gt(0)) {
    validationReasons.push('source_allocation_points_at_positive_posting');
  }
  if (allocation.allocationSide === 'target' && context.posting.quantity.lt(0)) {
    validationReasons.push('target_allocation_points_at_negative_posting');
  }

  return validationReasons;
}

function isProtocolPositionPosting(posting: CostBasisLedgerPosting): boolean {
  return posting.role === 'protocol_deposit' || posting.role === 'protocol_refund';
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

function buildJournalContexts(
  contexts: readonly LedgerPostingContext[],
  relationships: readonly CostBasisLedgerRelationship[]
): LedgerCostBasisJournalContext[] {
  const contextByPostingFingerprint = new Map(
    contexts.map((context) => [context.posting.postingFingerprint, context] as const)
  );
  const relationshipStableKeysByJournalFingerprint = new Map<string, Set<string>>();

  for (const relationship of relationships) {
    for (const allocation of relationship.allocations) {
      const context = contextByPostingFingerprint.get(allocation.postingFingerprint);
      if (context === undefined) {
        continue;
      }

      const relationshipStableKeys =
        relationshipStableKeysByJournalFingerprint.get(context.journal.journalFingerprint) ?? new Set<string>();
      relationshipStableKeys.add(relationship.relationshipStableKey);
      relationshipStableKeysByJournalFingerprint.set(context.journal.journalFingerprint, relationshipStableKeys);
    }
  }

  const contextsByJournalFingerprint = new Map<string, LedgerPostingContext[]>();
  for (const context of contexts) {
    const journalContexts = contextsByJournalFingerprint.get(context.journal.journalFingerprint) ?? [];
    journalContexts.push(context);
    contextsByJournalFingerprint.set(context.journal.journalFingerprint, journalContexts);
  }

  return [...contextsByJournalFingerprint.values()].map((journalContexts) => {
    const firstContext = journalContexts[0]!;

    return {
      journalFingerprint: firstContext.journal.journalFingerprint,
      journalKind: firstContext.journal.journalKind,
      postings: journalContexts.map(({ posting }) => ({
        postingFingerprint: posting.postingFingerprint,
        postingRole: posting.role,
        assetId: posting.assetId,
        assetSymbol: posting.assetSymbol,
        postingQuantity: posting.quantity,
      })),
      relationshipStableKeys: [
        ...(relationshipStableKeysByJournalFingerprint.get(firstContext.journal.journalFingerprint) ?? []),
      ].sort(),
    };
  });
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
