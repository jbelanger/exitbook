import type { AssetReviewSummary, ProjectionStatus, Transaction } from '@exitbook/core';
import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetReviewProjectionRuntimePorts } from '../../../ports/asset-review-projection-ports.js';
import {
  createAssetReviewProjectionRuntime,
  type AssetReviewProviderSupport,
} from '../asset-review-projection-runtime.js';

interface MockTokenMetadataRecord {
  blockchain: string;
  contractAddress: string;
  possibleSpam?: boolean | undefined;
  refreshedAt: Date;
  source: string;
}

interface RuntimePortHarness {
  ports: AssetReviewProjectionRuntimePorts;
  getLastBuiltAt(): Date | undefined;
  getReplaceCallCount(): number;
  getStoredSummaries(): Map<string, AssetReviewSummary>;
  setLatestOverrideAt(value: Date | undefined): void;
}

function createTransactions(): Transaction[] {
  return [
    {
      id: 1,
      accountId: 1,
      txFingerprint: 'tx-1',
      datetime: '2026-03-10T00:00:00.000Z',
      timestamp: Date.parse('2026-03-10T00:00:00.000Z'),
      platformKey: 'ethereum',
      sourceType: 'blockchain',
      status: 'success',
      blockchain: {
        name: 'ethereum',
        transaction_hash: 'tx-1',
        is_confirmed: true,
      },
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xscam',
            assetSymbol: 'SCAM' as Currency,
            grossAmount: parseDecimal('100'),
            movementFingerprint: 'movement-1',
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    },
  ];
}

function createRuntimePortHarness(): RuntimePortHarness {
  const transactions = createTransactions();
  let storedSummaries = new Map<string, AssetReviewSummary>();
  let replaceCallCount = 0;
  let latestOverrideAt: Date | undefined;
  let lastBuiltAt: Date | undefined;
  let freshness: { reason: string | undefined; status: ProjectionStatus } = {
    status: 'stale',
    reason: 'asset review has never been built',
  };

  const ports: AssetReviewProjectionRuntimePorts = {
    checkAssetReviewFreshness: vi.fn(async () => ok(freshness)),
    listTransactions: vi.fn(async () => ok(transactions)),
    loadReviewDecisions: vi.fn(async () => ok(new Map())),
    markAssetReviewBuilding: vi.fn(async () => ok(undefined)),
    replaceAssetReviewProjection: vi.fn(async (summaries: Iterable<AssetReviewSummary>) => {
      replaceCallCount += 1;
      const nextSummaries = [...summaries];
      storedSummaries = new Map(nextSummaries.map((summary) => [summary.assetId, summary]));
      lastBuiltAt = new Date(Date.now());
      freshness = { status: 'fresh', reason: undefined };
      return ok(undefined);
    }),
    markAssetReviewFailed: vi.fn(async () => ok(undefined)),
    getLastAssetReviewBuiltAt: vi.fn(async () => ok(lastBuiltAt)),
    findLatestAssetReviewOverrideAt: vi.fn(async () => ok(latestOverrideAt)),
  };

  return {
    ports,
    getLastBuiltAt: () => lastBuiltAt,
    getReplaceCallCount: () => replaceCallCount,
    getStoredSummaries: () => new Map(storedSummaries),
    setLatestOverrideAt: (value) => {
      latestOverrideAt = value;
    },
  };
}

describe('createAssetReviewProjectionRuntime', () => {
  const providerState = {
    latestTokenMetadataAt: undefined as Date | undefined,
    metadataByChainAndRef: new Map<string, MockTokenMetadataRecord | undefined>(),
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
    providerState.latestTokenMetadataAt = undefined;
    providerState.metadataByChainAndRef.clear();
  });

  it('rebuilds when asset-review overrides become newer than the last build', async () => {
    const harness = createRuntimePortHarness();
    const runtime = createAssetReviewProjectionRuntime({
      ports: harness.ports,
      providerSupportFactory: {
        open: vi.fn(async () => ok(createProviderSupport(providerState))),
      },
      tokenMetadataFreshness: {
        findLatestTokenMetadataRefreshAt: vi.fn(async () => ok(providerState.latestTokenMetadataAt)),
      },
    });

    vi.setSystemTime(new Date('2026-03-10T00:05:00.000Z'));
    assertOk(await runtime.ensureFresh());
    expect(harness.getReplaceCallCount()).toBe(1);

    harness.setLatestOverrideAt(new Date('2026-03-10T00:10:00.000Z'));
    vi.setSystemTime(new Date('2026-03-10T00:15:00.000Z'));

    assertOk(await runtime.ensureFresh());

    expect(harness.getReplaceCallCount()).toBe(2);
    expect(harness.getLastBuiltAt()?.toISOString()).toBe('2026-03-10T00:15:00.000Z');
  });

  it('rebuilds when token metadata becomes newer than the last build', async () => {
    const harness = createRuntimePortHarness();
    const runtime = createAssetReviewProjectionRuntime({
      ports: harness.ports,
      providerSupportFactory: {
        open: vi.fn(async () => ok(createProviderSupport(providerState))),
      },
      tokenMetadataFreshness: {
        findLatestTokenMetadataRefreshAt: vi.fn(async () => ok(providerState.latestTokenMetadataAt)),
      },
    });

    vi.setSystemTime(new Date('2026-03-10T00:05:00.000Z'));
    assertOk(await runtime.ensureFresh());
    const initialProjection = harness.getStoredSummaries();

    expect(initialProjection.get('blockchain:ethereum:0xscam')).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });

    vi.setSystemTime(new Date('2026-03-10T00:10:00.000Z'));
    providerState.latestTokenMetadataAt = new Date('2026-03-10T00:10:00.000Z');
    providerState.metadataByChainAndRef.set('ethereum:0xscam', {
      blockchain: 'ethereum',
      contractAddress: '0xscam',
      possibleSpam: true,
      refreshedAt: new Date('2026-03-10T00:10:00.000Z'),
      source: 'test-provider',
    });

    vi.setSystemTime(new Date('2026-03-10T00:15:00.000Z'));
    assertOk(await runtime.ensureFresh());
    const refreshedProjection = harness.getStoredSummaries();
    const refreshedSummary = refreshedProjection.get('blockchain:ethereum:0xscam');

    expect(refreshedSummary).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: true,
    });
    expect(refreshedSummary?.evidence.map((item) => item.kind)).toEqual(['provider-spam-flag']);
    expect(harness.getLastBuiltAt()?.toISOString()).toBe('2026-03-10T00:15:00.000Z');
  });
});

function createProviderSupport(providerState: {
  latestTokenMetadataAt: Date | undefined;
  metadataByChainAndRef: Map<string, MockTokenMetadataRecord | undefined>;
}): AssetReviewProviderSupport {
  return {
    getByTokenRefs: async (blockchain, tokenRefs) =>
      ok(
        new Map(
          tokenRefs.map((tokenRef) => [tokenRef, providerState.metadataByChainAndRef.get(`${blockchain}:${tokenRef}`)])
        )
      ),
    resolveBatch: async (_blockchain, tokenRefs) =>
      ok(
        new Map(
          tokenRefs.map((tokenRef) => [
            tokenRef,
            {
              provider: 'coingecko',
              referenceStatus: 'unknown' as const,
            },
          ])
        )
      ),
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- test no-op stub satisfies Promise<void> interface
    cleanup: async () => {},
  };
}
