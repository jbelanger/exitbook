import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
} from '@exitbook/blockchain-providers';
import { parseDecimal, type Currency } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { DataContext, OverrideStore } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findLatestAssetReviewExternalInputAt } from '../asset-review-external-input-freshness.js';
import {
  ensureAssetReviewProjectionFresh,
  readAssetReviewProjectionSummaries,
} from '../asset-review-projection-runtime.js';

describe('asset-review-projection-runtime', () => {
  let dataDir: string;
  let db: DataContext;
  let tokenMetadataDb: TokenMetadataDB;
  let tokenMetadataQueries: ReturnType<typeof createTokenMetadataQueries>;
  let originalCoinGeckoApiKey: string | undefined;
  let originalCoinGeckoUseProApi: string | undefined;

  beforeEach(async () => {
    originalCoinGeckoApiKey = process.env['COINGECKO_API_KEY'];
    originalCoinGeckoUseProApi = process.env['COINGECKO_USE_PRO_API'];
    // Keep projection tests offline even when the workspace test runner loads .env.
    delete process.env['COINGECKO_API_KEY'];
    delete process.env['COINGECKO_USE_PRO_API'];

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));

    dataDir = mkdtempSync(join(tmpdir(), 'asset-review-projection-runtime-test-'));
    db = assertOk(await DataContext.initialize(join(dataDir, 'transactions.db')));

    tokenMetadataDb = assertOk(createTokenMetadataDatabase(join(dataDir, 'token-metadata.db')));
    assertOk(await initializeTokenMetadataDatabase(tokenMetadataDb));
    tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);

    const user = assertOk(await db.users.findOrCreateDefault());
    const account = assertOk(
      await db.accounts.findOrCreate({
        userId: user.id,
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: 'wallet-1',
      })
    );

    assertOk(
      await db.transactions.createBatch(
        [
          {
            externalId: 'tx-1',
            datetime: '2026-03-10T00:00:00.000Z',
            timestamp: Date.parse('2026-03-10T00:00:00.000Z'),
            source: 'ethereum',
            sourceType: 'blockchain',
            status: 'success',
            movements: {
              inflows: [
                {
                  assetId: 'blockchain:ethereum:0xscam',
                  assetSymbol: 'SCAM' as Currency,
                  grossAmount: parseDecimal('100'),
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
        ],
        account.id
      )
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    assertOk(await db.close());
    assertOk(await closeTokenMetadataDatabase(tokenMetadataDb));
    rmSync(dataDir, { recursive: true, force: true });

    if (originalCoinGeckoApiKey === undefined) {
      delete process.env['COINGECKO_API_KEY'];
    } else {
      process.env['COINGECKO_API_KEY'] = originalCoinGeckoApiKey;
    }

    if (originalCoinGeckoUseProApi === undefined) {
      delete process.env['COINGECKO_USE_PRO_API'];
    } else {
      process.env['COINGECKO_USE_PRO_API'] = originalCoinGeckoUseProApi;
    }
  });

  it('includes asset-review overrides in the external freshness timestamp', async () => {
    const overrideStore = new OverrideStore(dataDir);

    vi.setSystemTime(new Date('2026-03-10T00:10:00.000Z'));
    assertOk(
      await overrideStore.append({
        scope: 'asset-review-confirm',
        payload: {
          type: 'asset_review_confirm',
          asset_id: 'blockchain:ethereum:0xscam',
          evidence_fingerprint: 'asset-review:v1:test',
        },
      })
    );

    const latestExternalInputAt = assertOk(await findLatestAssetReviewExternalInputAt(dataDir));

    expect(latestExternalInputAt?.toISOString()).toBe('2026-03-10T00:10:00.000Z');
  });

  it('rebuilds a fresh projection when token metadata changes after the last build', async () => {
    vi.setSystemTime(new Date('2026-03-10T00:05:00.000Z'));
    assertOk(await ensureAssetReviewProjectionFresh(db, dataDir));
    const initialProjection = assertOk(await readAssetReviewProjectionSummaries(db));

    expect(initialProjection.get('blockchain:ethereum:0xscam')).toMatchObject({
      reviewStatus: 'clear',
      accountingBlocked: false,
      evidence: [],
    });

    vi.setSystemTime(new Date('2026-03-10T00:10:00.000Z'));
    assertOk(
      await tokenMetadataQueries.save('ethereum', '0xscam', {
        blockchain: 'ethereum',
        contractAddress: '0xscam',
        possibleSpam: true,
        refreshedAt: new Date('2026-03-10T00:10:00.000Z'),
        source: 'test-provider',
      })
    );

    vi.setSystemTime(new Date('2026-03-10T00:15:00.000Z'));
    assertOk(await ensureAssetReviewProjectionFresh(db, dataDir));
    const refreshedProjection = assertOk(await readAssetReviewProjectionSummaries(db, ['blockchain:ethereum:0xscam']));
    const refreshedSummary = refreshedProjection.get('blockchain:ethereum:0xscam');

    expect(refreshedSummary).toMatchObject({
      reviewStatus: 'needs-review',
      accountingBlocked: true,
    });
    expect(refreshedSummary?.evidence.map((item) => item.kind)).toEqual(['provider-spam-flag']);

    const state = assertOk(await db.projectionState.get('asset-review'));
    expect(state?.lastBuiltAt?.toISOString()).toBe('2026-03-10T00:15:00.000Z');
  });
});
