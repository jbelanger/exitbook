import type { AssetReviewSummary, PriceAtTxTime } from '@exitbook/core';
import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalKind, AccountingPostingRole } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import type {
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerSourceActivity,
} from '../../../../ports/cost-basis-ledger-persistence.js';
import type { ValidatedCostBasisConfig } from '../../../workflow/cost-basis-input.js';
import { runStandardLedgerCostBasisCalculation } from '../run-standard-ledger-cost-basis-calculation.js';

const BTC = assertOk(parseCurrency('BTC'));
const USD = assertOk(parseCurrency('USD'));

const CONFIG: ValidatedCostBasisConfig = {
  method: 'fifo',
  jurisdiction: 'US',
  taxYear: 2024,
  currency: 'USD',
  startDate: new Date('2024-01-01T00:00:00.000Z'),
  endDate: new Date('2024-12-31T23:59:59.999Z'),
};

describe('runStandardLedgerCostBasisCalculation', () => {
  it('builds a ledger-native workflow result from ledger facts', () => {
    const result = assertOk(
      runStandardLedgerCostBasisCalculation({
        calculationId: 'calculation:standard-ledger:test',
        calculationDate: new Date('2026-03-15T12:00:00.000Z'),
        completedAt: new Date('2026-03-15T12:00:01.000Z'),
        config: CONFIG,
        ledgerFacts: makeFacts({
          postings: [
            makePosting({
              id: 1,
              journalId: 1,
              journalFingerprint: 'journal:buy',
              postingFingerprint: 'posting:buy',
              price: '100',
              quantity: '1',
            }),
            makePosting({
              id: 2,
              journalId: 2,
              journalFingerprint: 'journal:sell',
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
              timestamp: '2023-01-01T00:00:00.000Z',
            }),
            makeSourceActivity({
              id: 2,
              sourceActivityFingerprint: 'activity:sell',
              timestamp: '2024-02-01T00:00:00.000Z',
            }),
          ],
        }),
      })
    );

    expect(result.kind).toBe('standard-ledger-workflow');
    expect(result.calculation).toMatchObject({
      id: 'calculation:standard-ledger:test',
      eventsProjected: 2,
      operationsProcessed: 2,
      lotsCreated: 1,
      disposalsProcessed: 1,
      blockersProduced: 0,
      status: 'completed',
    });
    expect(result.calculation.totalProceeds.toFixed()).toBe('80');
    expect(result.calculation.totalCostBasis.toFixed()).toBe('40');
    expect(result.calculation.totalGainLoss.toFixed()).toBe('40');
    expect(result.projection.eventIds).toEqual([
      'ledger-cost-basis:acquisition:posting:buy:posting',
      'ledger-cost-basis:disposal:posting:sell:posting',
    ]);
    expect(result.projection.operationIds).toEqual([
      'ledger-cost-basis-operation:acquisition:ledger-cost-basis:acquisition:posting:buy:posting',
      'ledger-cost-basis-operation:disposal:ledger-cost-basis:disposal:posting:sell:posting',
    ]);
    expect(result.executionMeta.exclusionFingerprint).toBe('accounting-exclusions:none');
    expect(result.engineResult.disposals[0]?.gainLoss.toFixed()).toBe('40');
    expect(result.engineResult.disposals[0]?.provenance).toMatchObject({
      sourceActivityFingerprint: 'activity:sell',
      journalFingerprint: 'journal:sell',
      postingFingerprint: 'posting:sell',
    });
  });

  it('fails before projection when an in-scope asset still blocks accounting review', () => {
    const error = assertErr(
      runStandardLedgerCostBasisCalculation({
        calculationId: 'calculation:standard-ledger:test',
        config: CONFIG,
        ledgerFacts: makeFacts({
          postings: [
            makePosting({
              id: 1,
              postingFingerprint: 'posting:buy',
              price: '100',
              quantity: '1',
            }),
          ],
        }),
        options: {
          assetReviewSummaries: new Map([[DEFAULT_ASSET_ID, makeBlockingAssetReviewSummary(DEFAULT_ASSET_ID)]]),
        },
      })
    );

    expect(error.message).toContain('standard ledger cost basis');
    expect(error.message).toContain(DEFAULT_ASSET_ID);
  });
});

const DEFAULT_ASSET_ID = 'blockchain:bitcoin:native';

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
    assetId: overrides.assetId ?? DEFAULT_ASSET_ID,
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

function makeBlockingAssetReviewSummary(assetId: string): AssetReviewSummary {
  return {
    assetId,
    reviewStatus: 'needs-review',
    referenceStatus: 'matched',
    evidenceFingerprint: `asset-review:${assetId}`,
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'scam-diagnostic',
        severity: 'error',
        message: 'Suspicious asset evidence requires review',
      },
    ],
  };
}
