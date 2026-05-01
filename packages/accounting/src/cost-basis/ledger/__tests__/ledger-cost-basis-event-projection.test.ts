import { parseCurrency, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
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
import { projectLedgerCostBasisEvents } from '../ledger-cost-basis-event-projection.js';

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
    expect(projection.events.some((event) => event.kind === 'disposal')).toBe(false);
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
        }),
      ],
    });

    const projection = assertOk(projectLedgerCostBasisEvents(facts));

    expect(projection.blockers).toEqual([]);
    expect(projection.events.map((event) => event.kind)).toEqual(['fee']);
    expect(projection.events[0]?.quantity.toFixed()).toBe('0.01');
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
    expect(projection.blockers[0]).toMatchObject({
      reason: 'relationship_residual',
      postingFingerprint: 'posting:source',
      relationshipStableKeys: ['relationship:test'],
    });
    expect(projection.blockers[0]?.blockedQuantity.toFixed()).toBe('0.1');
  });

  it('rejects relationship allocations whose side contradicts posting sign', () => {
    const facts = makeTransferFacts({
      relationshipKind: 'internal_transfer',
      source: { allocationSide: 'target' },
    });

    const error = assertErr(projectLedgerCostBasisEvents(facts));

    expect(error.message).toContain('target allocation');
    expect(error.message).toContain('points at negative posting posting:source');
  });
});

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
    ...params.source,
  };
  const target: TransferEndpointOptions = {
    allocationQuantity: '1',
    allocationSide: 'target',
    assetId: 'blockchain:bitcoin:native',
    assetSymbol: BTC,
    postingFingerprint: 'posting:target',
    quantity: '1',
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
      }),
      makePosting({
        id: 2,
        assetId: target.assetId,
        assetSymbol: target.assetSymbol,
        journalId: 2,
        postingFingerprint: target.postingFingerprint,
        quantity: target.quantity,
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
            postingFingerprint: source.postingFingerprint,
            quantity: source.allocationQuantity,
          }),
          makeAllocation({
            id: 2,
            allocationSide: target.allocationSide,
            assetId: target.assetId,
            assetSymbol: target.assetSymbol,
            postingFingerprint: target.postingFingerprint,
            quantity: target.allocationQuantity,
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
