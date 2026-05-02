import { parseCurrency, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalKind, AccountingPostingRole } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import type {
  LedgerCostBasisEventProjection,
  LedgerCostBasisExcludedPosting,
  LedgerCostBasisInputEvent,
  LedgerCostBasisPostingBlocker,
} from '../ledger-cost-basis-event-projection.js';
import {
  buildLedgerCostBasisOperations,
  type LedgerCostBasisAcquireOperation,
  type LedgerCostBasisCarryOperation,
  type LedgerCostBasisDisposeOperation,
  type LedgerCostBasisFeeOperation,
  type LedgerCostBasisOperation,
} from '../ledger-cost-basis-operation-projection.js';

const BTC = assertOk(parseCurrency('BTC'));
const ETH = assertOk(parseCurrency('ETH'));
const LINK = assertOk(parseCurrency('LINK'));
const RNDR = assertOk(parseCurrency('RNDR'));
const RENDER = assertOk(parseCurrency('RENDER'));
const SPAM = assertOk(parseCurrency('SPAM'));
const USD = assertOk(parseCurrency('USD'));

describe('buildLedgerCostBasisOperations', () => {
  it('maps acquisition, disposal, and standalone fee events into positive operation quantities', () => {
    const projection = makeProjection({
      events: [
        makeEvent({ kind: 'acquisition', postingFingerprint: 'posting:btc-in', quantity: '0.5' }),
        makeEvent({ kind: 'disposal', postingFingerprint: 'posting:btc-out', quantity: '0.25' }),
        makeEvent({
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          journalFingerprint: 'journal:fee',
          journalKind: 'expense_only',
          kind: 'fee',
          postingFingerprint: 'posting:eth-fee',
          postingRole: 'fee',
          quantity: '0.01',
          settlement: 'on-chain',
        }),
      ],
      journalContexts: [
        makeJournalContext({
          journalFingerprint: 'journal:fee',
          journalKind: 'expense_only',
          postingFingerprints: ['posting:eth-fee'],
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));
    const singlePostingOperations = result.operations.filter(isSinglePostingOperation);

    expect(result.blockers).toEqual([]);
    expect(
      singlePostingOperations.map((operation) => [operation.kind, operation.chainKey, operation.quantity.toFixed()])
    ).toEqual([
      ['acquire', 'btc', '0.5'],
      ['dispose', 'btc', '0.25'],
      ['fee', 'eth', '0.01'],
    ]);
    expect((result.operations[2] as LedgerCostBasisFeeOperation).attachment).toEqual({
      kind: 'standalone',
      rule: 'expense_only_without_relationships',
    });
  });

  it('represents missing acquisition prices without creating blockers', () => {
    const projection = makeProjection({
      events: [makeEvent({ kind: 'acquisition', postingFingerprint: 'posting:opening', quantity: '2' })],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));
    const acquire = result.operations.filter(isAcquireDisposeOperation)[0];

    expect(result.blockers).toEqual([]);
    expect(acquire?.kind).toBe('acquire');
    expect(acquire?.priceAtTxTime).toBeUndefined();
  });

  it('retains accepted dispose-and-acquire relationship context on single-posting operations', () => {
    const projection = makeProjection({
      events: [
        makeEvent({
          kind: 'disposal',
          postingFingerprint: 'posting:source',
          relationshipAllocationId: 1,
          relationshipBasisTreatment: 'dispose_and_acquire',
          relationshipKind: 'external_transfer',
          relationshipStableKey: 'relationship:external',
        }),
        makeEvent({
          kind: 'acquisition',
          postingFingerprint: 'posting:target',
          quantity: '1',
          relationshipAllocationId: 2,
          relationshipBasisTreatment: 'dispose_and_acquire',
          relationshipKind: 'external_transfer',
          relationshipStableKey: 'relationship:external',
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));
    const acquireDisposeOperations = result.operations.filter(isAcquireDisposeOperation);

    expect(result.blockers).toEqual([]);
    expect(result.operations.map((operation) => operation.kind)).toEqual(['dispose', 'acquire']);
    expect(acquireDisposeOperations.map((operation) => operation.relationshipContext)).toEqual([
      {
        relationshipAllocationId: 1,
        relationshipBasisTreatment: 'dispose_and_acquire',
        relationshipKind: 'external_transfer',
        relationshipStableKey: 'relationship:external',
      },
      {
        relationshipAllocationId: 2,
        relationshipBasisTreatment: 'dispose_and_acquire',
        relationshipKind: 'external_transfer',
        relationshipStableKey: 'relationship:external',
      },
    ]);
  });

  it('groups carryover legs by relationship and preserves allocation evidence', () => {
    const projection = makeProjection({
      events: [
        makeEvent({
          assetId: 'exchange:kucoin:rndr',
          assetSymbol: RNDR,
          kind: 'carryover-out',
          postingFingerprint: 'posting:rndr-out',
          quantity: '10',
          relationshipAllocationId: 11,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'asset_migration',
          relationshipStableKey: 'relationship:migration',
        }),
        makeEvent({
          assetId: 'blockchain:ethereum:0xrender',
          assetSymbol: RENDER,
          kind: 'carryover-in',
          ownerAccountId: 2,
          postingFingerprint: 'posting:render-in',
          quantity: '10',
          relationshipAllocationId: 12,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'asset_migration',
          relationshipStableKey: 'relationship:migration',
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));
    const carry = result.operations[0] as LedgerCostBasisCarryOperation;

    expect(result.blockers).toEqual([]);
    expect(result.operations.map((operation) => operation.kind)).toEqual(['carry']);
    expect(carry.relationshipKind).toBe('asset_migration');
    expect(carry.inputEventIds).toEqual([
      'ledger-cost-basis:carryover-in:posting:render-in',
      'ledger-cost-basis:carryover-out:posting:rndr-out',
    ]);
    expect(
      carry.sourceLegs.map((leg) => [leg.allocationId, leg.chainKey, leg.ownerAccountId, leg.quantity.toFixed()])
    ).toEqual([[11, 'rndr', 1, '10']]);
    expect(
      carry.targetLegs.map((leg) => [leg.allocationId, leg.chainKey, leg.ownerAccountId, leg.quantity.toFixed()])
    ).toEqual([[12, 'blockchain:ethereum:0xrender', 2, '10']]);
  });

  it('uses resolved tax asset identity overrides for chain keys', () => {
    const tokenAssetId = 'blockchain:ethereum:0x514910771af9ca656af840dff83e8264ecf986ca';
    const projection = makeProjection({
      events: [
        makeEvent({ assetId: 'exchange:kraken:link', assetSymbol: LINK, postingFingerprint: 'posting:exchange-link' }),
        makeEvent({ assetId: tokenAssetId, assetSymbol: LINK, postingFingerprint: 'posting:onchain-link' }),
      ],
    });

    const result = assertOk(
      buildLedgerCostBasisOperations({
        projection,
        identityConfig: { assetIdentityOverridesByAssetId: new Map([[tokenAssetId, 'link']]) },
      })
    );

    expect(result.blockers).toEqual([]);
    expect(result.operations.filter(isSinglePostingOperation).map((operation) => operation.chainKey)).toEqual([
      'link',
      'link',
    ]);
  });

  it('blocks fiat events instead of creating tax asset chains', () => {
    const projection = makeProjection({
      events: [
        makeEvent({
          assetId: 'fiat:usd',
          assetSymbol: USD,
          kind: 'acquisition',
          postingFingerprint: 'posting:usd',
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));

    expect(result.operations).toEqual([]);
    expect(result.blockers).toMatchObject([
      {
        affectedChainKeys: [],
        propagation: 'after-fence',
        reason: 'fiat_cost_basis_event',
        inputEventIds: ['ledger-cost-basis:acquisition:posting:usd'],
      },
    ]);
  });

  it('keeps unknown fee attachment scoped to the fee asset chain', () => {
    const projection = makeProjection({
      events: [
        makeEvent({
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          journalFingerprint: 'journal:bridge',
          journalKind: 'transfer',
          kind: 'fee',
          postingFingerprint: 'posting:eth-fee',
          postingRole: 'fee',
          quantity: '0.01',
          settlement: 'on-chain',
        }),
      ],
      journalContexts: [
        makeJournalContext({
          journalFingerprint: 'journal:bridge',
          journalKind: 'transfer',
          postingFingerprints: ['posting:eth-fee'],
          relationshipStableKeys: ['relationship:bridge'],
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));
    const fee = result.operations[0] as LedgerCostBasisFeeOperation;

    expect(result.blockers).toEqual([]);
    expect(fee.chainKey).toBe('eth');
    expect(fee.attachment).toEqual({ kind: 'unknown', reason: 'unclassified_fee_context' });
  });

  it('accounts for every input event exactly once across operations and blockers', () => {
    const projection = makeProjection({
      events: [
        makeEvent({ kind: 'acquisition', postingFingerprint: 'posting:btc-in' }),
        makeEvent({
          kind: 'carryover-out',
          postingFingerprint: 'posting:carry-out',
          relationshipAllocationId: 31,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'internal_transfer',
          relationshipStableKey: 'relationship:carry',
        }),
        makeEvent({
          kind: 'carryover-in',
          postingFingerprint: 'posting:carry-in',
          relationshipAllocationId: 32,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'internal_transfer',
          relationshipStableKey: 'relationship:carry',
        }),
        makeEvent({
          assetId: 'fiat:usd',
          assetSymbol: USD,
          kind: 'disposal',
          postingFingerprint: 'posting:usd-out',
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));

    expect(collectCoveredInputEventIds(result)).toEqual(projection.events.map((event) => event.eventId).sort());
  });

  it('maps projection blockers with explicit propagation and affected chains', () => {
    const projection = makeProjection({
      blockers: [
        makePostingBlocker({ postingFingerprint: 'posting:zero', reason: 'zero_quantity_posting' }),
        makePostingBlocker({ postingFingerprint: 'posting:protocol', reason: 'unsupported_protocol_posting' }),
      ],
      events: [],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));

    expect(result.operations).toEqual([]);
    expect(result.blockers.map((blocker) => [blocker.reason, blocker.propagation, blocker.affectedChainKeys])).toEqual([
      ['unsupported_protocol_posting', 'after-fence', ['btc']],
      ['zero_quantity_posting', 'op-only', ['btc']],
    ]);
  });

  it('keeps unrelated chain operations byte-identical when another chain is blocked', () => {
    const unaffectedEvent = makeEvent({ kind: 'acquisition', postingFingerprint: 'posting:btc-in' });
    const cleanProjection = makeProjection({ events: [unaffectedEvent] });
    const blockedProjection = makeProjection({
      blockers: [
        makePostingBlocker({
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          postingFingerprint: 'posting:eth-blocked',
          reason: 'unsupported_protocol_posting',
        }),
      ],
      events: [unaffectedEvent],
    });

    const cleanResult = assertOk(buildLedgerCostBasisOperations({ projection: cleanProjection }));
    const blockedResult = assertOk(buildLedgerCostBasisOperations({ projection: blockedProjection }));

    expect(JSON.stringify(blockedResult.operations)).toBe(JSON.stringify(cleanResult.operations));
  });

  it('is deterministic for equivalent projections regardless of input event order', () => {
    const firstProjection = makeProjection({
      events: [
        makeEvent({ kind: 'disposal', postingFingerprint: 'posting:btc-out', quantity: '0.2' }),
        makeEvent({ kind: 'acquisition', postingFingerprint: 'posting:btc-in', quantity: '0.5' }),
      ],
    });
    const secondProjection = makeProjection({
      events: [...firstProjection.events].reverse(),
    });

    const firstResult = assertOk(buildLedgerCostBasisOperations({ projection: firstProjection }));
    const secondResult = assertOk(buildLedgerCostBasisOperations({ projection: secondProjection }));

    expect(JSON.stringify(firstResult)).toBe(JSON.stringify(secondResult));
  });

  it('passes through exclusion lineage unchanged', () => {
    const excludedPostings: LedgerCostBasisExcludedPosting[] = [
      {
        assetId: 'blockchain:ethereum:0xspam',
        assetSymbol: SPAM,
        journalFingerprint: 'journal:spam',
        message: 'spam excluded',
        postingFingerprint: 'posting:spam',
        postingQuantity: parseDecimal('1000'),
        reason: 'asset_excluded',
        sourceActivityFingerprint: 'activity:spam',
      },
    ];
    const projection = makeProjection({
      events: [],
      excludedPostings,
      exclusionFingerprint: 'accounting-exclusions:test',
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));

    expect(result.excludedPostings).toBe(excludedPostings);
    expect(result.exclusionFingerprint).toBe('accounting-exclusions:test');
  });

  it('preserves protocol position carry as carry operations', () => {
    const projection = makeProjection({
      events: [
        makeEvent({
          kind: 'carryover-out',
          postingFingerprint: 'posting:protocol-deposit',
          postingRole: 'protocol_deposit',
          relationshipAllocationId: 21,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'bridge',
          relationshipStableKey: 'relationship:protocol',
        }),
        makeEvent({
          kind: 'carryover-in',
          postingFingerprint: 'posting:protocol-refund',
          postingRole: 'protocol_refund',
          relationshipAllocationId: 22,
          relationshipBasisTreatment: 'carry_basis',
          relationshipKind: 'bridge',
          relationshipStableKey: 'relationship:protocol',
        }),
      ],
    });

    const result = assertOk(buildLedgerCostBasisOperations({ projection }));

    expect(result.blockers).toEqual([]);
    expect(result.operations.map((operation) => operation.kind)).toEqual(['carry']);
  });
});

function makeProjection(overrides: Partial<LedgerCostBasisEventProjection> = {}): LedgerCostBasisEventProjection {
  return {
    blockers: [],
    events: [],
    excludedPostings: [],
    exclusionFingerprint: 'accounting-exclusions:none',
    journalContexts: [],
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<Omit<LedgerCostBasisInputEvent, 'assetSymbol' | 'kind' | 'quantity'>> & {
    assetSymbol?: Currency | undefined;
    kind?: LedgerCostBasisInputEvent['kind'] | undefined;
    quantity?: string | undefined;
  } = {}
): LedgerCostBasisInputEvent {
  const kind = overrides.kind ?? 'acquisition';
  const postingFingerprint = overrides.postingFingerprint ?? 'posting:btc';

  return {
    eventId: overrides.eventId ?? `ledger-cost-basis:${kind}:${postingFingerprint}`,
    kind,
    sourceActivityFingerprint: overrides.sourceActivityFingerprint ?? 'activity:default',
    ownerAccountId: overrides.ownerAccountId ?? 1,
    journalFingerprint: overrides.journalFingerprint ?? 'journal:default',
    journalKind: overrides.journalKind ?? 'transfer',
    postingFingerprint,
    postingRole: overrides.postingRole ?? 'principal',
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
    assetId: overrides.assetId ?? 'blockchain:bitcoin:native',
    assetSymbol: overrides.assetSymbol ?? BTC,
    quantity: parseDecimal(overrides.quantity ?? '1'),
    ...(overrides.priceAtTxTime === undefined ? {} : { priceAtTxTime: overrides.priceAtTxTime }),
    ...(overrides.settlement === undefined ? {} : { settlement: overrides.settlement }),
    ...(overrides.relationshipAllocationId === undefined
      ? {}
      : { relationshipAllocationId: overrides.relationshipAllocationId }),
    ...(overrides.relationshipBasisTreatment === undefined
      ? {}
      : { relationshipBasisTreatment: overrides.relationshipBasisTreatment }),
    ...(overrides.relationshipKind === undefined ? {} : { relationshipKind: overrides.relationshipKind }),
    ...(overrides.relationshipStableKey === undefined
      ? {}
      : { relationshipStableKey: overrides.relationshipStableKey }),
  };
}

function makeJournalContext(overrides: {
  journalFingerprint: string;
  journalKind: AccountingJournalKind;
  postingFingerprints: readonly string[];
  relationshipStableKeys?: readonly string[] | undefined;
}): LedgerCostBasisEventProjection['journalContexts'][number] {
  return {
    journalFingerprint: overrides.journalFingerprint,
    journalKind: overrides.journalKind,
    postings: overrides.postingFingerprints.map((postingFingerprint) => ({
      assetId: 'blockchain:ethereum:native',
      assetSymbol: ETH,
      postingFingerprint,
      postingQuantity: parseDecimal('-0.01'),
      postingRole: 'fee' as AccountingPostingRole,
    })),
    relationshipStableKeys: overrides.relationshipStableKeys ?? [],
  };
}

function makePostingBlocker(overrides: {
  assetId?: string | undefined;
  assetSymbol?: Currency | undefined;
  postingFingerprint: string;
  reason: LedgerCostBasisPostingBlocker['reason'];
}): LedgerCostBasisPostingBlocker {
  return {
    assetId: overrides.assetId ?? 'blockchain:bitcoin:native',
    assetSymbol: overrides.assetSymbol ?? BTC,
    blockedQuantity: parseDecimal('1'),
    journalFingerprint: 'journal:default',
    message: `${overrides.reason} blocked`,
    postingFingerprint: overrides.postingFingerprint,
    postingQuantity: parseDecimal('1'),
    reason: overrides.reason,
    relationshipStableKeys: [],
    scope: 'posting',
    sourceActivityFingerprint: 'activity:default',
  };
}

function isSinglePostingOperation(
  operation: LedgerCostBasisOperation
): operation is LedgerCostBasisAcquireOperation | LedgerCostBasisDisposeOperation | LedgerCostBasisFeeOperation {
  return operation.kind === 'acquire' || operation.kind === 'dispose' || operation.kind === 'fee';
}

function isAcquireDisposeOperation(
  operation: LedgerCostBasisOperation
): operation is LedgerCostBasisAcquireOperation | LedgerCostBasisDisposeOperation {
  return operation.kind === 'acquire' || operation.kind === 'dispose';
}

function collectCoveredInputEventIds(result: {
  blockers: readonly { inputEventIds: readonly string[] }[];
  operations: readonly LedgerCostBasisOperation[];
}): string[] {
  return [
    ...result.operations.flatMap((operation) =>
      operation.kind === 'carry' ? operation.inputEventIds : [operation.sourceEventId]
    ),
    ...result.blockers.flatMap((blocker) => blocker.inputEventIds),
  ].sort();
}
