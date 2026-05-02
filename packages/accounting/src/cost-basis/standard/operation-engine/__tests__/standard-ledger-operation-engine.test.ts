import type { PriceAtTxTime } from '@exitbook/core';
import { err, parseCurrency, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalKind, AccountingJournalRelationshipKind, AccountingPostingRole } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import type {
  LedgerCostBasisAcquireOperation,
  LedgerCostBasisCarryLeg,
  LedgerCostBasisCarryOperation,
  LedgerCostBasisDisposeOperation,
  LedgerCostBasisFeeOperation,
  LedgerCostBasisOperation,
  LedgerCostBasisOperationProjection,
} from '../../../ledger/ledger-cost-basis-operation-projection.js';
import type { ICostBasisStrategy } from '../../strategies/base-strategy.js';
import { FifoStrategy } from '../../strategies/fifo-strategy.js';
import { LifoStrategy } from '../../strategies/lifo-strategy.js';
import {
  runStandardLedgerOperationEngine,
  type StandardLedgerOperationEngineResult,
} from '../standard-ledger-operation-engine.js';

const BTC = assertOk(parseCurrency('BTC'));
const ETH = assertOk(parseCurrency('ETH'));
const RENDER = assertOk(parseCurrency('RENDER'));
const USD = assertOk(parseCurrency('USD'));

describe('runStandardLedgerOperationEngine', () => {
  it('opens priced lots and disposes them using FIFO lot selection', () => {
    const result = runEngine([
      makeAcquire({ operationId: 'op:buy-1', price: '100', quantity: '1', timestamp: '2026-01-01T00:00:00.000Z' }),
      makeAcquire({ operationId: 'op:buy-2', price: '200', quantity: '1', timestamp: '2026-01-02T00:00:00.000Z' }),
      makeDispose({ operationId: 'op:sell', price: '300', quantity: '1.5', timestamp: '2026-01-03T00:00:00.000Z' }),
    ]);

    expect(result.blockers).toEqual([]);
    expect(result.disposals).toHaveLength(1);
    expect(result.disposals[0]?.grossProceeds.toFixed()).toBe('450');
    expect(result.disposals[0]?.costBasis.toFixed()).toBe('200');
    expect(result.disposals[0]?.gainLoss.toFixed()).toBe('250');
    expect(result.disposals[0]?.slices.map((slice) => [slice.lotId, slice.quantity.toFixed()])).toEqual([
      ['standard-ledger-lot:op:buy-1', '1'],
      ['standard-ledger-lot:op:buy-2', '0.5'],
    ]);
    expect(result.lots.map((lot) => [lot.id, lot.remainingQuantity.toFixed()])).toEqual([
      ['standard-ledger-lot:op:buy-1', '0'],
      ['standard-ledger-lot:op:buy-2', '0.5'],
    ]);
  });

  it('uses the configured strategy to relieve source lots for cross-chain carry', () => {
    const result = runEngine(
      [
        makeAcquire({ operationId: 'op:buy-old', price: '100', quantity: '1', timestamp: '2026-01-01T00:00:00.000Z' }),
        makeAcquire({ operationId: 'op:buy-new', price: '200', quantity: '1', timestamp: '2026-01-02T00:00:00.000Z' }),
        makeCarry({
          operationId: 'op:migrate',
          relationshipKind: 'asset_migration',
          sourceChainKey: 'btc',
          sourceQuantity: '1.5',
          targetAssetId: 'blockchain:ethereum:0xrender',
          targetAssetSymbol: RENDER,
          targetChainKey: 'blockchain:ethereum:0xrender',
          targetQuantity: '15',
          timestamp: '2026-01-03T00:00:00.000Z',
        }),
      ],
      {},
      new LifoStrategy()
    );

    expect(result.blockers).toEqual([]);
    expect(result.carries).toHaveLength(1);
    expect(result.carries[0]?.kind).toBe('cross-chain');
    expect(
      result.carries[0]?.slices.map((slice) => [
        slice.sourceLotId,
        slice.sourceQuantity.toFixed(),
        slice.targetQuantity.toFixed(),
      ])
    ).toEqual([
      ['standard-ledger-lot:op:buy-new', '1', '10'],
      ['standard-ledger-lot:op:buy-old', '0.5', '5'],
    ]);
    expect(sum(result.carries[0]?.slices.map((slice) => slice.costBasis ?? parseDecimal('0')) ?? []).toFixed()).toBe(
      '250'
    );
    expect(
      result.lots.filter((lot) => lot.chainKey === 'btc').map((lot) => [lot.id, lot.remainingQuantity.toFixed()])
    ).toEqual([
      ['standard-ledger-lot:op:buy-old', '0.5'],
      ['standard-ledger-lot:op:buy-new', '0'],
    ]);
    expect(
      result.lots
        .filter((lot) => lot.chainKey === 'blockchain:ethereum:0xrender')
        .map((lot) => [lot.basisStatus, lot.remainingQuantity.toFixed(), lot.totalCostBasis?.toFixed()])
    ).toEqual([
      ['priced', '5', '50'],
      ['priced', '10', '200'],
    ]);
  });

  it('preserves total basis across multi-source multi-target cross-chain carry', () => {
    const result = runEngine([
      makeAcquire({
        assetId: 'source:a',
        assetSymbol: BTC,
        chainKey: 'source:a',
        operationId: 'op:buy-a',
        price: '100',
        quantity: '1',
      }),
      makeAcquire({
        assetId: 'source:b',
        assetSymbol: ETH,
        chainKey: 'source:b',
        operationId: 'op:buy-b',
        price: '200',
        quantity: '2',
      }),
      makeCarryWithLegs({
        operationId: 'op:nm-carry',
        relationshipKind: 'bridge',
        sourceLegs: [
          makeCarryLeg({ allocationId: 1, assetId: 'source:a', assetSymbol: BTC, chainKey: 'source:a', quantity: '1' }),
          makeCarryLeg({ allocationId: 2, assetId: 'source:b', assetSymbol: ETH, chainKey: 'source:b', quantity: '2' }),
        ],
        targetLegs: [
          makeCarryLeg({
            allocationId: 3,
            assetId: 'target:x',
            assetSymbol: RENDER,
            chainKey: 'target:x',
            quantity: '3',
          }),
          makeCarryLeg({
            allocationId: 4,
            assetId: 'target:y',
            assetSymbol: RENDER,
            chainKey: 'target:y',
            quantity: '9',
          }),
        ],
      }),
    ]);

    expect(result.blockers).toEqual([]);
    expect(result.carries).toHaveLength(1);
    expect(
      result.carries[0]?.slices.map((slice) => [
        slice.sourceChainKey,
        slice.targetChainKey,
        slice.sourceQuantity.toFixed(),
        slice.targetQuantity.toFixed(),
        slice.costBasis?.toFixed(),
      ])
    ).toEqual([
      ['source:a', 'target:x', '1', '1', '25'],
      ['source:b', 'target:x', '2', '2', '100'],
      ['source:a', 'target:y', '1', '3', '75'],
      ['source:b', 'target:y', '2', '6', '300'],
    ]);
    expect(sum(result.carries[0]?.slices.map((slice) => slice.costBasis ?? parseDecimal('0')) ?? []).toFixed()).toBe(
      '500'
    );
    expect(
      sum(
        result.lots
          .filter((lot) => lot.chainKey.startsWith('target:'))
          .map((lot) => lot.totalCostBasis ?? parseDecimal('0'))
      ).toFixed()
    ).toBe('500');
    expect(
      result.lots
        .filter((lot) => lot.chainKey.startsWith('source:'))
        .map((lot) => [lot.chainKey, lot.remainingQuantity.toFixed()])
    ).toEqual([
      ['source:a', '0'],
      ['source:b', '0'],
    ]);
  });

  it('keeps same-chain carry from mutating lot state', () => {
    const acquire = makeAcquire({ operationId: 'op:buy', price: '100', quantity: '1' });
    const clean = runEngine([acquire]);
    const withCarry = runEngine([
      acquire,
      makeCarry({ operationId: 'op:same-chain', sourceChainKey: 'btc', targetChainKey: 'btc' }),
    ]);

    expect(withCarry.blockers).toEqual([]);
    expect(JSON.stringify(withCarry.lots)).toBe(JSON.stringify(clean.lots));
    expect(withCarry.carries.map((carry) => carry.kind)).toEqual(['same-chain']);
    expect(withCarry.carries[0]?.slices).toEqual([]);
  });

  it('keeps multi-leg same-chain carry from mutating lot state when quantities balance per chain', () => {
    const acquire = makeAcquire({ operationId: 'op:buy', price: '100', quantity: '2' });
    const clean = runEngine([acquire]);
    const withCarry = runEngine([
      acquire,
      makeCarryWithLegs({
        operationId: 'op:multi-same-chain',
        sourceLegs: [
          makeCarryLeg({ allocationId: 1, chainKey: 'btc', quantity: '0.75' }),
          makeCarryLeg({ allocationId: 2, chainKey: 'btc', quantity: '1.25' }),
        ],
        targetLegs: [
          makeCarryLeg({ allocationId: 3, chainKey: 'btc', quantity: '1' }),
          makeCarryLeg({ allocationId: 4, chainKey: 'btc', quantity: '1' }),
        ],
      }),
    ]);

    expect(withCarry.blockers).toEqual([]);
    expect(JSON.stringify(withCarry.lots)).toBe(JSON.stringify(clean.lots));
    expect(withCarry.carries.map((carry) => carry.kind)).toEqual(['same-chain']);
    expect(withCarry.carries[0]?.slices).toEqual([]);
  });

  it('blocks same-chain carry when source and target quantities do not balance per chain', () => {
    const acquire = makeAcquire({ operationId: 'op:buy', price: '100', quantity: '2' });
    const result = runEngine([
      acquire,
      makeCarryWithLegs({
        operationId: 'op:mismatched-same-chain',
        sourceLegs: [makeCarryLeg({ allocationId: 1, chainKey: 'btc', quantity: '2' })],
        targetLegs: [makeCarryLeg({ allocationId: 2, chainKey: 'btc', quantity: '1.5' })],
      }),
    ]);

    expect(result.carries).toEqual([]);
    expect(result.blockers).toMatchObject([
      {
        affectedChainKeys: ['btc'],
        propagation: 'after-fence',
        reason: 'same_chain_carry_quantity_mismatch',
      },
    ]);
    expect(result.lots.map((lot) => [lot.id, lot.remainingQuantity.toFixed()])).toEqual([
      ['standard-ledger-lot:op:buy', '2'],
    ]);
  });

  it('keeps unknown fee attachment scoped to the fee asset chain', () => {
    const acquire = makeAcquire({ operationId: 'op:buy', price: '100', quantity: '1' });
    const clean = runEngine([acquire]);
    const withUnknownFee = runEngine([
      acquire,
      makeFee({
        attachment: { kind: 'unknown', reason: 'unclassified_fee_context' },
        chainKey: 'eth',
        operationId: 'op:fee',
      }),
    ]);

    expect(JSON.stringify(withUnknownFee.lots)).toBe(JSON.stringify(clean.lots));
    expect(withUnknownFee.blockers).toMatchObject([
      {
        affectedChainKeys: ['eth'],
        propagation: 'op-only',
        reason: 'unknown_fee_attachment',
      },
    ]);
  });

  it('keeps an after-fence blocker on one chain from changing another chain', () => {
    const btcAcquire = makeAcquire({ operationId: 'op:buy-btc', price: '100', quantity: '1' });
    const clean = runEngine([btcAcquire]);
    const blocked = runEngine([btcAcquire], {
      blockers: [
        {
          affectedChainKeys: ['eth'],
          blockerId: 'upstream:eth',
          inputEventIds: [],
          message: 'eth blocked',
          propagation: 'after-fence',
          reason: 'unsupported_protocol_posting',
        },
      ],
    });

    expect(JSON.stringify(blocked.lots)).toBe(JSON.stringify(clean.lots));
    expect(blocked.blockers).toMatchObject([
      {
        affectedChainKeys: ['eth'],
        propagation: 'after-fence',
        reason: 'upstream_operation_blocker',
      },
    ]);
  });

  it('allows unresolved-basis acquisitions until a disposal consumes them', () => {
    const unresolvedOnly = runEngine([makeAcquire({ operationId: 'op:opening', quantity: '1' })]);
    const consumed = runEngine([
      makeAcquire({ operationId: 'op:opening', quantity: '1' }),
      makeDispose({ operationId: 'op:sell', price: '300', quantity: '1' }),
    ]);

    expect(unresolvedOnly.blockers).toEqual([]);
    expect(unresolvedOnly.lots.map((lot) => [lot.basisStatus, lot.remainingQuantity.toFixed()])).toEqual([
      ['unresolved', '1'],
    ]);
    expect(consumed.disposals).toEqual([]);
    expect(consumed.blockers).toMatchObject([
      {
        affectedChainKeys: ['btc'],
        propagation: 'after-fence',
        reason: 'unresolved_basis_disposal',
      },
    ]);
  });

  it('carries unresolved basis across chains without blocking', () => {
    const result = runEngine([
      makeAcquire({ operationId: 'op:opening', quantity: '1' }),
      makeCarry({
        operationId: 'op:migrate',
        relationshipKind: 'asset_migration',
        sourceChainKey: 'btc',
        sourceQuantity: '1',
        targetAssetId: 'blockchain:ethereum:0xrender',
        targetAssetSymbol: RENDER,
        targetChainKey: 'blockchain:ethereum:0xrender',
        targetQuantity: '1',
      }),
    ]);

    expect(result.blockers).toEqual([]);
    expect(
      result.lots
        .filter((lot) => lot.chainKey === 'blockchain:ethereum:0xrender')
        .map((lot) => [lot.basisStatus, lot.remainingQuantity.toFixed(), lot.costBasisPerUnit])
    ).toEqual([['unresolved', '1', undefined]]);
  });

  it('accounts for each operation as state, audit carry, fee blocker, or calculation blocker', () => {
    const operations = [
      makeAcquire({ operationId: 'op:buy', price: '100', quantity: '1' }),
      makeCarry({ operationId: 'op:same-chain', sourceChainKey: 'btc', targetChainKey: 'btc' }),
      makeFee({
        attachment: { kind: 'unknown', reason: 'unclassified_fee_context' },
        chainKey: 'eth',
        operationId: 'op:fee',
      }),
      makeDispose({ operationId: 'op:too-large', price: '200', quantity: '2' }),
    ];

    const result = runEngine(operations);

    expect(collectCoveredOperationIds(result)).toEqual(['op:buy', 'op:fee', 'op:same-chain', 'op:too-large']);
  });

  it('fails closed when an unsupported specific-id strategy reaches the engine', () => {
    const result = runEngine(
      [
        makeAcquire({ operationId: 'op:buy', price: '100', quantity: '1' }),
        makeDispose({ operationId: 'op:sell', price: '200', quantity: '1' }),
      ],
      {},
      SPECIFIC_ID_STRATEGY
    );

    expect(result.disposals).toEqual([]);
    expect(result.blockers).toMatchObject([
      {
        affectedChainKeys: ['btc'],
        propagation: 'after-fence',
        reason: 'unsupported_strategy',
      },
    ]);
  });
});

const SPECIFIC_ID_STRATEGY: ICostBasisStrategy = {
  getName: () => 'specific-id',
  matchDisposal: () => err(new Error('specific-id is not implemented')),
};

function runEngine(
  operations: readonly LedgerCostBasisOperation[],
  overrides: Partial<LedgerCostBasisOperationProjection> = {},
  strategy: ICostBasisStrategy = new FifoStrategy()
): StandardLedgerOperationEngineResult {
  return assertOk(
    runStandardLedgerOperationEngine({
      calculationId: 'calculation:test',
      operationProjection: {
        blockers: [],
        excludedPostings: [],
        exclusionFingerprint: 'accounting-exclusions:none',
        operations,
        ...overrides,
      },
      strategy,
    })
  );
}

function makeAcquire(
  overrides: Partial<
    Omit<LedgerCostBasisAcquireOperation, 'assetSymbol' | 'kind' | 'priceAtTxTime' | 'quantity' | 'timestamp'>
  > & {
    assetSymbol?: Currency | undefined;
    price?: string | undefined;
    quantity?: string | undefined;
    timestamp?: Date | string | undefined;
  } = {}
): LedgerCostBasisAcquireOperation {
  const operationId = overrides.operationId ?? 'op:acquire';
  return {
    ...makeSinglePostingBase({ ...overrides, operationId, price: overrides.price, quantity: overrides.quantity }),
    kind: 'acquire',
  };
}

function makeDispose(
  overrides: Partial<
    Omit<LedgerCostBasisDisposeOperation, 'assetSymbol' | 'kind' | 'priceAtTxTime' | 'quantity' | 'timestamp'>
  > & {
    assetSymbol?: Currency | undefined;
    price?: string | undefined;
    quantity?: string | undefined;
    timestamp?: Date | string | undefined;
  } = {}
): LedgerCostBasisDisposeOperation {
  const operationId = overrides.operationId ?? 'op:dispose';
  return {
    ...makeSinglePostingBase({ ...overrides, operationId, price: overrides.price, quantity: overrides.quantity }),
    kind: 'dispose',
  };
}

function makeFee(
  overrides: Partial<
    Omit<LedgerCostBasisFeeOperation, 'assetSymbol' | 'attachment' | 'kind' | 'priceAtTxTime' | 'quantity'>
  > &
    Pick<LedgerCostBasisFeeOperation, 'attachment'> & {
      assetSymbol?: Currency | undefined;
      price?: string | undefined;
      quantity?: string | undefined;
    }
): LedgerCostBasisFeeOperation {
  const operationId = overrides.operationId ?? 'op:fee';
  return {
    ...makeSinglePostingBase({
      assetId: overrides.assetId ?? 'blockchain:ethereum:native',
      assetSymbol: overrides.assetSymbol ?? ETH,
      chainKey: overrides.chainKey ?? 'eth',
      journalKind: overrides.journalKind ?? 'expense_only',
      operationId,
      postingRole: overrides.postingRole ?? 'fee',
      price: overrides.price,
      quantity: overrides.quantity,
      sourceEventId: overrides.sourceEventId,
      timestamp: overrides.timestamp,
    }),
    attachment: overrides.attachment,
    kind: 'fee',
    postingRole: overrides.postingRole ?? 'fee',
    settlement: overrides.settlement ?? 'on-chain',
  };
}

function makeSinglePostingBase(overrides: {
  assetId?: string | undefined;
  assetSymbol?: Currency | undefined;
  chainKey?: string | undefined;
  journalKind?: AccountingJournalKind | undefined;
  operationId: string;
  postingRole?: AccountingPostingRole | undefined;
  price?: string | undefined;
  quantity?: string | undefined;
  sourceEventId?: string | undefined;
  timestamp?: Date | string | undefined;
}): Omit<LedgerCostBasisAcquireOperation, 'kind'> {
  const timestamp =
    overrides.timestamp instanceof Date
      ? overrides.timestamp
      : new Date(overrides.timestamp ?? '2026-01-01T00:00:00.000Z');
  const sourceEventId = overrides.sourceEventId ?? `event:${overrides.operationId}`;
  return {
    assetId: overrides.assetId ?? 'blockchain:bitcoin:native',
    assetSymbol: overrides.assetSymbol ?? BTC,
    chainKey: overrides.chainKey ?? 'btc',
    journalFingerprint: `journal:${overrides.operationId}`,
    journalKind: overrides.journalKind ?? 'trade',
    operationId: overrides.operationId,
    ownerAccountId: 1,
    postingFingerprint: `posting:${overrides.operationId}`,
    postingRole: overrides.postingRole ?? 'principal',
    quantity: parseDecimal(overrides.quantity ?? '1'),
    sourceActivityFingerprint: `activity:${overrides.operationId}`,
    sourceEventId,
    timestamp,
    ...(overrides.price === undefined ? {} : { priceAtTxTime: makePrice(overrides.price) }),
  };
}

function makeCarry(overrides: {
  operationId?: string | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
  sourceAssetId?: string | undefined;
  sourceAssetSymbol?: Currency | undefined;
  sourceChainKey?: string | undefined;
  sourceQuantity?: string | undefined;
  targetAssetId?: string | undefined;
  targetAssetSymbol?: Currency | undefined;
  targetChainKey?: string | undefined;
  targetQuantity?: string | undefined;
  timestamp?: string | undefined;
}): LedgerCostBasisCarryOperation {
  const operationId = overrides.operationId ?? 'op:carry';
  const timestamp = new Date(overrides.timestamp ?? '2026-01-02T00:00:00.000Z');
  return makeCarryWithLegs({
    operationId,
    relationshipKind: overrides.relationshipKind ?? 'internal_transfer',
    sourceLegs: [
      makeCarryLeg({
        allocationId: 1,
        assetId: overrides.sourceAssetId ?? 'blockchain:bitcoin:native',
        assetSymbol: overrides.sourceAssetSymbol ?? BTC,
        chainKey: overrides.sourceChainKey ?? 'btc',
        ownerAccountId: 1,
        postingFingerprint: `posting:${operationId}:source`,
        quantity: parseDecimal(overrides.sourceQuantity ?? '1'),
        sourceEventId: `event:${operationId}:source`,
        sourceActivityFingerprint: `activity:${operationId}:source`,
        timestamp,
      }),
    ],
    targetLegs: [
      makeCarryLeg({
        allocationId: 2,
        assetId: overrides.targetAssetId ?? 'blockchain:bitcoin:native',
        assetSymbol: overrides.targetAssetSymbol ?? BTC,
        chainKey: overrides.targetChainKey ?? 'btc',
        ownerAccountId: 2,
        postingFingerprint: `posting:${operationId}:target`,
        quantity: parseDecimal(overrides.targetQuantity ?? overrides.sourceQuantity ?? '1'),
        sourceEventId: `event:${operationId}:target`,
        sourceActivityFingerprint: `activity:${operationId}:target`,
        timestamp,
      }),
    ],
    timestamp,
  });
}

function makeCarryWithLegs(overrides: {
  operationId?: string | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
  sourceLegs: readonly LedgerCostBasisCarryLeg[];
  targetLegs: readonly LedgerCostBasisCarryLeg[];
  timestamp?: Date | undefined;
}): LedgerCostBasisCarryOperation {
  const operationId = overrides.operationId ?? 'op:carry';
  const timestamp = overrides.timestamp ?? new Date('2026-01-02T00:00:00.000Z');
  return {
    inputEventIds: [...overrides.sourceLegs, ...overrides.targetLegs].map((leg) => leg.sourceEventId),
    kind: 'carry',
    operationId,
    relationshipBasisTreatment: 'carry_basis',
    relationshipKind: overrides.relationshipKind ?? 'internal_transfer',
    relationshipStableKey: `relationship:${operationId}`,
    sourceLegs: overrides.sourceLegs,
    targetLegs: overrides.targetLegs,
    timestamp,
  };
}

function makeCarryLeg(
  overrides: Omit<Partial<LedgerCostBasisCarryLeg>, 'allocationId' | 'assetSymbol' | 'quantity' | 'timestamp'> & {
    allocationId: number;
    assetSymbol?: Currency | undefined;
    quantity: string | ReturnType<typeof parseDecimal>;
    timestamp?: Date | string | undefined;
  }
): LedgerCostBasisCarryLeg {
  const timestamp =
    overrides.timestamp instanceof Date
      ? overrides.timestamp
      : new Date(overrides.timestamp ?? '2026-01-02T00:00:00.000Z');
  const quantity = typeof overrides.quantity === 'string' ? parseDecimal(overrides.quantity) : overrides.quantity;
  return {
    allocationId: overrides.allocationId,
    assetId: overrides.assetId ?? 'blockchain:bitcoin:native',
    assetSymbol: overrides.assetSymbol ?? BTC,
    chainKey: overrides.chainKey ?? 'btc',
    journalFingerprint: overrides.journalFingerprint ?? `journal:carry:${overrides.allocationId}`,
    journalKind: overrides.journalKind ?? 'transfer',
    ownerAccountId: overrides.ownerAccountId ?? 1,
    postingFingerprint: overrides.postingFingerprint ?? `posting:carry:${overrides.allocationId}`,
    postingRole: overrides.postingRole ?? 'principal',
    quantity,
    sourceActivityFingerprint: overrides.sourceActivityFingerprint ?? `activity:carry:${overrides.allocationId}`,
    sourceEventId: overrides.sourceEventId ?? `event:carry:${overrides.allocationId}`,
    timestamp,
    ...(overrides.priceAtTxTime === undefined ? {} : { priceAtTxTime: overrides.priceAtTxTime }),
  };
}

function makePrice(amount: string): PriceAtTxTime {
  return {
    fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
    price: {
      amount: parseDecimal(amount),
      currency: USD,
    },
    source: 'test',
  };
}

function sum(values: readonly ReturnType<typeof parseDecimal>[]): ReturnType<typeof parseDecimal> {
  return values.reduce((total, value) => total.plus(value), parseDecimal('0'));
}

function collectCoveredOperationIds(result: StandardLedgerOperationEngineResult): string[] {
  return [
    ...result.lots.flatMap((lot) => lot.provenance.operationId),
    ...result.disposals.map((disposal) => disposal.operationId),
    ...result.carries.map((carry) => carry.operationId),
    ...result.blockers.flatMap((blocker) => blocker.inputOperationIds),
  ].sort();
}
