import type { PriceAtTxTime } from '@exitbook/core';
import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalKind, AccountingPostingRole } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import type {
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerSourceActivity,
} from '../../../../ports/cost-basis-ledger-persistence.js';
import { runStandardLedgerOperationPipeline } from '../standard-ledger-operation-pipeline.js';

const BTC = assertOk(parseCurrency('BTC'));
const USD = assertOk(parseCurrency('USD'));

describe('runStandardLedgerOperationPipeline', () => {
  it('runs ledger facts through projection, operation IR, and the standard operation engine', () => {
    const result = assertOk(
      runStandardLedgerOperationPipeline({
        calculationId: 'calculation:test',
        ledgerFacts: makeFacts({
          postings: [
            makePosting({
              id: 1,
              journalFingerprint: 'journal:buy',
              journalId: 1,
              postingFingerprint: 'posting:buy',
              price: '100',
              quantity: '1',
            }),
            makePosting({
              id: 2,
              journalFingerprint: 'journal:sell',
              journalId: 2,
              postingFingerprint: 'posting:sell',
              price: '200',
              quantity: '-0.4',
            }),
          ],
          journals: [
            makeJournal({ id: 1, journalFingerprint: 'journal:buy', sourceActivityId: 1 }),
            makeJournal({ id: 2, journalFingerprint: 'journal:sell', sourceActivityId: 2 }),
          ],
          sourceActivities: [
            makeSourceActivity({
              id: 1,
              sourceActivityFingerprint: 'activity:buy',
              timestamp: '2026-01-01T00:00:00.000Z',
            }),
            makeSourceActivity({
              id: 2,
              sourceActivityFingerprint: 'activity:sell',
              timestamp: '2026-01-02T00:00:00.000Z',
            }),
          ],
        }),
        method: 'fifo',
      })
    );

    expect(result.eventProjection.events.map((event) => event.kind)).toEqual(['acquisition', 'disposal']);
    expect(result.operationProjection.operations.map((operation) => operation.kind)).toEqual(['acquire', 'dispose']);
    expect(result.engineResult.blockers).toEqual([]);
    expect(result.engineResult.disposals).toHaveLength(1);
    expect(result.engineResult.disposals[0]?.grossProceeds.toFixed()).toBe('80');
    expect(result.engineResult.disposals[0]?.costBasis.toFixed()).toBe('40');
    expect(result.engineResult.disposals[0]?.gainLoss.toFixed()).toBe('40');
  });

  it('preserves excluded posting lineage through the composed pipeline', () => {
    const excludedAssetId = 'blockchain:bitcoin:native';
    const result = assertOk(
      runStandardLedgerOperationPipeline({
        calculationId: 'calculation:test',
        excludedAssetIds: new Set([excludedAssetId]),
        ledgerFacts: makeFacts({
          postings: [
            makePosting({
              id: 1,
              postingFingerprint: 'posting:excluded',
              price: '100',
              quantity: '1',
            }),
          ],
        }),
        method: 'fifo',
      })
    );

    expect(result.eventProjection.events).toEqual([]);
    expect(result.operationProjection.operations).toEqual([]);
    expect(result.operationProjection.excludedPostings.map((posting) => posting.postingFingerprint)).toEqual([
      'posting:excluded',
    ]);
    expect(result.engineResult.lots).toEqual([]);
  });
});

function makeFacts(params: {
  journalKind?: AccountingJournalKind | undefined;
  journals?: CostBasisLedgerJournal[] | undefined;
  postings: CostBasisLedgerPosting[];
  relationships?: CostBasisLedgerFacts['relationships'] | undefined;
  sourceActivities?: CostBasisLedgerSourceActivity[] | undefined;
}): CostBasisLedgerFacts {
  return {
    sourceActivities: params.sourceActivities ?? [makeSourceActivity()],
    journals: params.journals ?? [
      makeJournal(params.journalKind === undefined ? {} : { journalKind: params.journalKind }),
    ],
    postings: params.postings,
    relationships: params.relationships ?? [],
  };
}

function makeSourceActivity(
  overrides: Partial<Omit<CostBasisLedgerSourceActivity, 'activityDatetime'>> & {
    timestamp?: string | undefined;
  } = {}
): CostBasisLedgerSourceActivity {
  return {
    id: overrides.id ?? 1,
    ownerAccountId: overrides.ownerAccountId ?? 1,
    sourceActivityOrigin: overrides.sourceActivityOrigin ?? 'provider_event',
    sourceActivityStableKey: overrides.sourceActivityStableKey ?? 'activity:default',
    sourceActivityFingerprint: overrides.sourceActivityFingerprint ?? 'activity:default',
    platformKey: overrides.platformKey ?? 'bitcoin',
    platformKind: overrides.platformKind ?? 'blockchain',
    activityStatus: overrides.activityStatus ?? 'success',
    activityDatetime: new Date(overrides.timestamp ?? '2026-01-01T00:00:00.000Z'),
    ...(overrides.activityTimestampMs === undefined ? {} : { activityTimestampMs: overrides.activityTimestampMs }),
    ...(overrides.fromAddress === undefined ? {} : { fromAddress: overrides.fromAddress }),
    ...(overrides.toAddress === undefined ? {} : { toAddress: overrides.toAddress }),
    ...(overrides.blockchainName === undefined ? {} : { blockchainName: overrides.blockchainName }),
    ...(overrides.blockchainBlockHeight === undefined
      ? {}
      : { blockchainBlockHeight: overrides.blockchainBlockHeight }),
    ...(overrides.blockchainTransactionHash === undefined
      ? {}
      : { blockchainTransactionHash: overrides.blockchainTransactionHash }),
    ...(overrides.blockchainIsConfirmed === undefined
      ? {}
      : { blockchainIsConfirmed: overrides.blockchainIsConfirmed }),
  };
}

function makeJournal(overrides: Partial<CostBasisLedgerJournal> = {}): CostBasisLedgerJournal {
  return {
    id: overrides.id ?? 1,
    sourceActivityId: overrides.sourceActivityId ?? 1,
    sourceActivityFingerprint: overrides.sourceActivityFingerprint ?? 'activity:default',
    journalFingerprint: overrides.journalFingerprint ?? 'journal:default',
    journalStableKey: overrides.journalStableKey ?? overrides.journalFingerprint ?? 'journal:default',
    journalKind: overrides.journalKind ?? 'trade',
    diagnostics: overrides.diagnostics ?? [],
  };
}

function makePosting(
  overrides: Omit<Partial<CostBasisLedgerPosting>, 'id' | 'postingFingerprint' | 'quantity'> & {
    id: number;
    postingFingerprint: string;
    price?: string | undefined;
    quantity: string;
    role?: AccountingPostingRole | undefined;
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
    ...(overrides.price === undefined ? {} : { priceAtTxTime: makePrice(overrides.price) }),
    ...(overrides.settlement === undefined ? {} : { settlement: overrides.settlement }),
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
