import { parseCurrency, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalKind, AccountingJournalRelationshipKind } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import type {
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerRelationship,
  CostBasisLedgerRelationshipAllocation,
  CostBasisLedgerSourceActivity,
} from '../../../ports/cost-basis-ledger-persistence.js';
import {
  projectLedgerCostBasisEvents,
  type LedgerCostBasisPostingBlocker,
  type LedgerCostBasisProjectionBlocker,
  type LedgerCostBasisRelationshipBlocker,
} from '../ledger-cost-basis-event-projection.js';

const BTC = assertOk(parseCurrency('BTC'));
const ETH = assertOk(parseCurrency('ETH'));
const RNDR = assertOk(parseCurrency('RNDR'));
const RENDER = assertOk(parseCurrency('RENDER'));
const SPAM = assertOk(parseCurrency('SPAM'));
const USDC = assertOk(parseCurrency('USDC'));

describe('projectLedgerCostBasisEvents', () => {
  it('projects accepted internal transfers as carryover events, not disposals', () => {
    const facts = makeTransferFacts({ relationshipKind: 'internal_transfer' });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => event.kind)).toEqual(['carryover-out', 'carryover-in']);
    expect(projection.events.every((event) => event.relationshipKind === 'internal_transfer')).toBe(true);
    expect(projection.events.every((event) => event.relationshipBasisTreatment === 'carry_basis')).toBe(true);
    expect(projection.events.some((event) => event.kind === 'disposal')).toBe(false);
  });

  it('projects accepted external transfer relationships as disposal and acquisition events', () => {
    const facts = makeTransferFacts({ relationshipKind: 'external_transfer' });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => [event.kind, event.relationshipBasisTreatment])).toEqual([
      ['disposal', 'dispose_and_acquire'],
      ['acquisition', 'dispose_and_acquire'],
    ]);
  });

  it('projects unlinked outflows as disposal candidates', () => {
    const facts = makeFacts({
      postings: [makePosting({ id: 1, postingFingerprint: 'posting:btc-out', quantity: '-0.25' })],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events).toMatchObject([
      {
        kind: 'disposal',
        postingFingerprint: 'posting:btc-out',
      },
    ]);
    expect(projection.events[0]?.quantity.toFixed()).toBe('0.25');
  });

  it('projects opening positions as acquisition events with opening provenance', () => {
    const facts = makeFacts({
      journalKind: 'opening_balance',
      postings: [
        makePosting({
          id: 1,
          postingFingerprint: 'posting:btc-opening',
          quantity: '2',
          role: 'opening_position',
        }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events).toMatchObject([
      {
        journalKind: 'opening_balance',
        kind: 'acquisition',
        postingFingerprint: 'posting:btc-opening',
        postingRole: 'opening_position',
      },
    ]);
    expect(projection.events[0]?.priceAtTxTime).toBeUndefined();
    expect(projection.events[0]?.quantity.toFixed()).toBe('2');
  });

  it('omits accepted excluded assets from input events and reports skipped postings', () => {
    const excludedAssetId = 'blockchain:ethereum:0xspam';
    const facts = makeFacts({
      postings: [
        makePosting({
          id: 1,
          assetId: excludedAssetId,
          assetSymbol: SPAM,
          postingFingerprint: 'posting:spam-in',
          quantity: '1000',
        }),
        makePosting({ id: 2, postingFingerprint: 'posting:btc-in', quantity: '0.1' }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts, { excludedAssetIds: new Set([excludedAssetId]) }));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => event.postingFingerprint)).toEqual(['posting:btc-in']);
    expect(projection.excludedPostings).toMatchObject([
      {
        assetId: excludedAssetId,
        postingFingerprint: 'posting:spam-in',
        reason: 'asset_excluded',
      },
    ]);
    expect(projection.excludedPostings[0]?.postingQuantity.toFixed()).toBe('1000');
  });

  it('projects asset migrations as carryover events across changed asset identities', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'asset_migration',
      source: {
        assetId: 'exchange:kucoin:rndr',
        assetSymbol: RNDR,
        postingFingerprint: 'posting:rndr-out',
      },
      target: {
        assetId: 'blockchain:ethereum:0xrender',
        assetSymbol: RENDER,
        postingFingerprint: 'posting:render-in',
      },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => [event.kind, event.assetSymbol, event.relationshipKind])).toEqual([
      ['carryover-out', 'RNDR', 'asset_migration'],
      ['carryover-in', 'RENDER', 'asset_migration'],
    ]);
  });

  it('projects bridges as carryover events', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'bridge',
      source: { assetId: 'blockchain:ethereum:usdc', assetSymbol: USDC, postingFingerprint: 'posting:eth-usdc-out' },
      target: { assetId: 'blockchain:base:usdc', assetSymbol: USDC, postingFingerprint: 'posting:base-usdc-in' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => [event.kind, event.relationshipKind])).toEqual([
      ['carryover-out', 'bridge'],
      ['carryover-in', 'bridge'],
    ]);
  });

  it('projects protocol position postings through basis-carryover relationships', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'bridge',
      source: { role: 'protocol_deposit' },
      target: { role: 'protocol_refund' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => [event.kind, event.postingRole])).toEqual([
      ['carryover-out', 'protocol_deposit'],
      ['carryover-in', 'protocol_refund'],
    ]);
  });

  it('projects fee postings as fee events', () => {
    const facts = makeFacts({
      journalKind: 'expense_only',
      postings: [
        makePosting({
          id: 1,
          postingFingerprint: 'posting:eth-fee',
          quantity: '-0.01',
          role: 'fee',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          settlement: 'on-chain',
        }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => event.kind)).toEqual(['fee']);
    expect(projection.events[0]?.quantity.toFixed()).toBe('0.01');
  });

  it('blocks fee postings without settlement', () => {
    const facts = makeFacts({
      journalKind: 'expense_only',
      postings: [
        makePosting({
          id: 1,
          postingFingerprint: 'posting:eth-fee-unsettled',
          quantity: '-0.01',
          role: 'fee',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
        }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectPostingBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'cost_settlement_missing',
      postingFingerprint: 'posting:eth-fee-unsettled',
    });
    expect(blocker.blockedQuantity.toFixed()).toBe('0.01');
  });

  it('blocks protocol overhead postings without settlement', () => {
    const facts = makeFacts({
      journalKind: 'expense_only',
      postings: [
        makePosting({
          id: 1,
          postingFingerprint: 'posting:protocol-overhead',
          quantity: '-0.02',
          role: 'protocol_overhead',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
        }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectPostingBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'cost_settlement_missing',
      postingFingerprint: 'posting:protocol-overhead',
    });
    expect(blocker.blockedQuantity.toFixed()).toBe('0.02');
  });

  it('blocks unlinked protocol position postings', () => {
    const cases: readonly {
      blockedQuantity: string;
      postingFingerprint: string;
      quantity: string;
      role: CostBasisLedgerPosting['role'];
    }[] = [
      {
        blockedQuantity: '1',
        postingFingerprint: 'posting:protocol-deposit',
        quantity: '-1',
        role: 'protocol_deposit',
      },
      {
        blockedQuantity: '0.5',
        postingFingerprint: 'posting:protocol-refund',
        quantity: '0.5',
        role: 'protocol_refund',
      },
    ];

    for (const testCase of cases) {
      const facts = makeFacts({
        journalKind: 'protocol_event',
        postings: [
          makePosting({
            id: 1,
            postingFingerprint: testCase.postingFingerprint,
            quantity: testCase.quantity,
            role: testCase.role,
          }),
        ],
      });

      const projection = assertOk(projectLedgerCostBasisEvents(facts));

      expect(projection.events).toEqual([]);
      expect(projection.blockers).toHaveLength(1);
      const blocker = expectPostingBlocker(projection.blockers[0]);
      expect(blocker).toMatchObject({
        reason: 'unsupported_protocol_posting',
        postingFingerprint: testCase.postingFingerprint,
      });
      expect(blocker.blockedQuantity.toFixed()).toBe(testCase.blockedQuantity);
    }
  });

  it('blocks zero-quantity postings instead of aborting projection', () => {
    const facts = makeFacts({
      postings: [makePosting({ id: 1, postingFingerprint: 'posting:zero', quantity: '0' })],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectPostingBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'zero_quantity_posting',
      postingFingerprint: 'posting:zero',
    });
    expect(blocker.blockedQuantity.toFixed()).toBe('0');
  });

  it('blocks residual quantities after partial carryover allocation', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: { allocationQuantity: '0.9', quantity: '-1' },
      target: { allocationQuantity: '0.9', quantity: '0.9' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events.map((event) => [event.kind, event.quantity.toFixed()])).toEqual([
      ['carryover-out', '0.9'],
      ['carryover-in', '0.9'],
    ]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectPostingBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_residual',
      postingFingerprint: 'posting:source',
      relationshipStableKeys: ['relationship:test'],
    });
    expect(blocker.blockedQuantity.toFixed()).toBe('0.1');
  });

  it('blocks accepted relationship allocations that point at missing postings', () => {
    const facts = makeTransferFacts({ relationshipKind: 'internal_transfer' });

    const projection = assertOk(
      projectLedgerCostBasisEvents({
        ...facts,
        postings: facts.postings.filter((posting) => posting.postingFingerprint !== 'posting:target'),
      })
    );

    expect(projection.events).toEqual([]);
    expect(projection.excludedPostings).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_missing_posting',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:target', 'missing_posting'],
      ['posting:source', 'blocked_by_relationship'],
    ]);
  });

  it('blocks accepted relationship allocations whose posting metadata no longer matches', () => {
    const facts = makeTransferFacts({ relationshipKind: 'internal_transfer' });
    const relationship = facts.relationships[0];
    if (relationship === undefined) {
      throw new Error('Expected relationship fixture');
    }

    const projection = assertOk(
      projectLedgerCostBasisEvents({
        ...facts,
        relationships: [
          {
            ...relationship,
            allocations: relationship.allocations.map((allocation) =>
              allocation.postingFingerprint === 'posting:source'
                ? {
                    ...allocation,
                    assetSymbol: ETH,
                    currentPostingId: 999,
                    journalFingerprint: 'journal:stale',
                  }
                : allocation
            ),
          },
        ],
      })
    );

    expect(projection.events).toEqual([]);
    expect(projection.excludedPostings).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_posting_mismatch',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'mismatched_posting'],
      ['posting:target', 'blocked_by_relationship'],
    ]);
    expect(blocker.allocations[0]?.mismatchReasons).toEqual([
      'journal_fingerprint_mismatch',
      'asset_symbol_mismatch',
      'current_posting_id_mismatch',
    ]);
  });

  it('blocks mixed excluded and non-excluded relationship allocations', () => {
    const excludedAssetId = 'blockchain:ethereum:0xspam';
    const facts = makeTransferFacts({
      relationshipKind: 'asset_migration',
      source: {
        allocationQuantity: '1000',
        assetId: excludedAssetId,
        assetSymbol: SPAM,
        quantity: '-1000',
      },
      target: {
        assetId: 'blockchain:ethereum:0xrender',
        assetSymbol: RENDER,
        postingFingerprint: 'posting:render-in',
      },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts, { excludedAssetIds: new Set([excludedAssetId]) }));

    expect(projection.events).toEqual([]);
    expect(projection.excludedPostings.map((posting) => posting.postingFingerprint)).toEqual(['posting:source']);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_partially_excluded',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'excluded_posting'],
      ['posting:render-in', 'blocked_by_relationship'],
    ]);
  });

  it('blocks relationship allocations whose side contradicts posting sign', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: { allocationSide: 'target' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_invalid',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'invalid_allocation'],
      ['posting:target', 'blocked_by_relationship'],
    ]);
    expect(blocker.allocations[0]?.validationReasons).toEqual(['target_allocation_points_at_negative_posting']);
  });

  it('blocks relationship allocations with non-positive quantities', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: { allocationQuantity: '0' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_invalid',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'invalid_allocation'],
      ['posting:target', 'blocked_by_relationship'],
    ]);
    expect(blocker.allocations[0]?.validationReasons).toEqual(['non_positive_quantity']);
  });

  it('blocks relationships that over-allocate a posting', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: { allocationQuantity: '1.1', quantity: '-1' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_overallocated',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'overallocated_posting'],
      ['posting:target', 'blocked_by_relationship'],
    ]);
    expect(blocker.allocations[0]?.validationReasons).toEqual(['overallocated_posting']);
    expect(blocker.message).toContain('overallocates posting(s): posting:source');
    expect(blocker.message).toContain('blocked relationship posting allocation(s): posting:source, posting:target');
  });

  it('blocks protocol position postings in non-carryover relationships', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'external_transfer',
      source: { role: 'protocol_deposit' },
      target: { role: 'protocol_refund' },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_invalid',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'invalid_allocation'],
      ['posting:target', 'invalid_allocation'],
    ]);
    expect(blocker.allocations.map((allocation) => allocation.validationReasons)).toEqual([
      ['protocol_position_requires_carry_basis_relationship'],
      ['protocol_position_requires_carry_basis_relationship'],
    ]);
  });

  it('blocks relationship allocations that point at fee postings', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: {
        assetId: 'blockchain:ethereum:native',
        assetSymbol: ETH,
        role: 'fee',
      },
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.events).toEqual([]);
    expect(projection.blockers).toHaveLength(1);
    const blocker = expectRelationshipBlocker(projection.blockers[0]);
    expect(blocker).toMatchObject({
      reason: 'relationship_allocation_invalid',
      relationshipStableKey: 'relationship:test',
    });
    expect(blocker.allocations.map((allocation) => [allocation.postingFingerprint, allocation.state])).toEqual([
      ['posting:source', 'invalid_allocation'],
      ['posting:target', 'blocked_by_relationship'],
    ]);
    expect(blocker.allocations[0]?.validationReasons).toEqual(['relationship_allocation_points_at_fee_posting']);
  });
});

function expectPostingBlocker(blocker: LedgerCostBasisProjectionBlocker | undefined): LedgerCostBasisPostingBlocker {
  expect(blocker?.scope).toBe('posting');
  if (blocker?.scope !== 'posting') {
    throw new Error('Expected posting blocker');
  }

  return blocker;
}

function expectRelationshipBlocker(
  blocker: LedgerCostBasisProjectionBlocker | undefined
): LedgerCostBasisRelationshipBlocker {
  expect(blocker?.scope).toBe('relationship');
  if (blocker?.scope !== 'relationship') {
    throw new Error('Expected relationship blocker');
  }

  return blocker;
}

function makeTransferFacts(params: {
  relationshipKind: AccountingJournalRelationshipKind;
  source?: Partial<TransferEndpointOptions> | undefined;
  target?: Partial<TransferEndpointOptions> | undefined;
}): CostBasisLedgerFacts {
  const source: TransferEndpointOptions = {
    allocationQuantity: '1',
    allocationSide: 'source',
    assetId: 'blockchain:bitcoin:native',
    assetSymbol: BTC,
    postingFingerprint: 'posting:source',
    quantity: '-1',
    role: 'principal',
    ...params.source,
  };
  const target: TransferEndpointOptions = {
    allocationQuantity: '1',
    allocationSide: 'target',
    assetId: 'blockchain:bitcoin:native',
    assetSymbol: BTC,
    postingFingerprint: 'posting:target',
    quantity: '1',
    role: 'principal',
    ...params.target,
  };

  return makeFacts({
    postings: [
      makePosting({
        id: 1,
        assetId: source.assetId,
        assetSymbol: source.assetSymbol,
        postingFingerprint: source.postingFingerprint,
        quantity: source.quantity,
        role: source.role,
      }),
      makePosting({
        id: 2,
        assetId: target.assetId,
        assetSymbol: target.assetSymbol,
        journalId: 2,
        postingFingerprint: target.postingFingerprint,
        quantity: target.quantity,
        role: target.role,
      }),
    ],
    journals: [
      makeJournal({ id: 1, sourceActivityId: 1, journalFingerprint: 'journal:source' }),
      makeJournal({ id: 2, sourceActivityId: 2, journalFingerprint: 'journal:target' }),
    ],
    sourceActivities: [
      makeSourceActivity({ id: 1, sourceActivityFingerprint: 'activity:source' }),
      makeSourceActivity({
        id: 2,
        activityDatetime: new Date('2026-01-01T00:01:00.000Z'),
        sourceActivityFingerprint: 'activity:target',
      }),
    ],
    relationships: [
      makeRelationship({
        relationshipKind: params.relationshipKind,
        allocations: [
          makeAllocation({
            id: 1,
            allocationSide: source.allocationSide,
            assetId: source.assetId,
            assetSymbol: source.assetSymbol,
            currentJournalId: 1,
            currentPostingId: 1,
            journalFingerprint: 'journal:source',
            postingFingerprint: source.postingFingerprint,
            quantity: source.allocationQuantity,
            sourceActivityFingerprint: 'activity:source',
          }),
          makeAllocation({
            id: 2,
            allocationSide: target.allocationSide,
            assetId: target.assetId,
            assetSymbol: target.assetSymbol,
            currentJournalId: 2,
            currentPostingId: 2,
            journalFingerprint: 'journal:target',
            postingFingerprint: target.postingFingerprint,
            quantity: target.allocationQuantity,
            sourceActivityFingerprint: 'activity:target',
          }),
        ],
      }),
    ],
  });
}

interface TransferEndpointOptions {
  allocationQuantity: string;
  allocationSide: CostBasisLedgerRelationshipAllocation['allocationSide'];
  assetId: string;
  assetSymbol: Currency;
  postingFingerprint: string;
  quantity: string;
  role: CostBasisLedgerPosting['role'];
}

function makeFacts(params: {
  journalKind?: AccountingJournalKind | undefined;
  journals?: CostBasisLedgerJournal[] | undefined;
  postings: CostBasisLedgerPosting[];
  relationships?: CostBasisLedgerRelationship[] | undefined;
  sourceActivities?: CostBasisLedgerSourceActivity[] | undefined;
}): CostBasisLedgerFacts {
  const journals = params.journals ?? [
    makeJournal(params.journalKind === undefined ? {} : { journalKind: params.journalKind }),
  ];

  return {
    sourceActivities: params.sourceActivities ?? [makeSourceActivity()],
    journals,
    postings: params.postings,
    relationships: params.relationships ?? [],
  };
}

function makeSourceActivity(overrides: Partial<CostBasisLedgerSourceActivity> = {}): CostBasisLedgerSourceActivity {
  return {
    id: 1,
    ownerAccountId: 1,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: 'activity',
    sourceActivityFingerprint: 'activity:default',
    platformKey: 'bitcoin',
    platformKind: 'blockchain',
    activityStatus: 'success',
    activityDatetime: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeJournal(overrides: Partial<CostBasisLedgerJournal> = {}): CostBasisLedgerJournal {
  return {
    id: 1,
    sourceActivityId: 1,
    sourceActivityFingerprint: 'activity:default',
    journalFingerprint: 'journal:default',
    journalStableKey: 'journal:default',
    journalKind: 'transfer',
    diagnostics: [],
    ...overrides,
  };
}

function makePosting(
  overrides: Omit<Partial<CostBasisLedgerPosting>, 'id' | 'postingFingerprint' | 'quantity'> & {
    id: number;
    postingFingerprint: string;
    quantity: string;
  }
): CostBasisLedgerPosting {
  return {
    id: overrides.id,
    journalId: overrides.journalId ?? 1,
    journalFingerprint: overrides.journalFingerprint ?? 'journal:default',
    postingFingerprint: overrides.postingFingerprint,
    postingStableKey: overrides.postingStableKey ?? overrides.postingFingerprint,
    assetId: overrides.assetId ?? 'blockchain:bitcoin:native',
    assetSymbol: overrides.assetSymbol ?? BTC,
    quantity: parseDecimal(overrides.quantity),
    role: overrides.role ?? 'principal',
    balanceCategory: overrides.balanceCategory ?? 'liquid',
    sourceComponents: overrides.sourceComponents ?? [],
    ...(overrides.priceAtTxTime === undefined ? {} : { priceAtTxTime: overrides.priceAtTxTime }),
    ...(overrides.settlement === undefined ? {} : { settlement: overrides.settlement }),
  };
}

function makeRelationship(
  overrides: Partial<CostBasisLedgerRelationship> & {
    allocations: CostBasisLedgerRelationshipAllocation[];
    relationshipKind: AccountingJournalRelationshipKind;
  }
): CostBasisLedgerRelationship {
  return {
    id: overrides.id ?? 1,
    relationshipOrigin: overrides.relationshipOrigin ?? 'ledger_linking',
    relationshipStableKey: overrides.relationshipStableKey ?? 'relationship:test',
    relationshipKind: overrides.relationshipKind,
    recognitionStrategy: overrides.recognitionStrategy ?? 'reviewed_relationship',
    recognitionEvidence: overrides.recognitionEvidence ?? {},
    allocations: overrides.allocations,
    ...(overrides.confidenceScore === undefined ? {} : { confidenceScore: overrides.confidenceScore }),
  };
}

function makeAllocation(
  overrides: Omit<Partial<CostBasisLedgerRelationshipAllocation>, 'id' | 'postingFingerprint' | 'quantity'> & {
    allocationSide: CostBasisLedgerRelationshipAllocation['allocationSide'];
    assetId: string;
    assetSymbol: Currency;
    id: number;
    postingFingerprint: string;
    quantity: string;
  }
): CostBasisLedgerRelationshipAllocation {
  return {
    id: overrides.id,
    allocationSide: overrides.allocationSide,
    quantity: parseDecimal(overrides.quantity),
    sourceActivityFingerprint: overrides.sourceActivityFingerprint ?? 'activity:default',
    journalFingerprint: overrides.journalFingerprint ?? 'journal:default',
    postingFingerprint: overrides.postingFingerprint,
    assetId: overrides.assetId,
    assetSymbol: overrides.assetSymbol,
    ...(overrides.currentJournalId === undefined ? {} : { currentJournalId: overrides.currentJournalId }),
    ...(overrides.currentPostingId === undefined ? {} : { currentPostingId: overrides.currentPostingId }),
  };
}
