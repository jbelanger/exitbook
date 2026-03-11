import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
} from '../../../persistence/token-metadata/index.js';
import { createCoinGeckoTokenReferenceResolver } from '../coingecko-token-reference.js';

describe('coingecko-token-reference', () => {
  let tempDir: string;
  let db: TokenMetadataDB;
  let queries: ReturnType<typeof createTokenMetadataQueries>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'coingecko-token-reference-test-'));
    db = assertOk(createTokenMetadataDatabase(join(tempDir, 'token-metadata.db')));
    assertOk(await initializeTokenMetadataDatabase(db));
    queries = createTokenMetadataQueries(db);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeTokenMetadataDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and reads token reference matches and platform mappings', async () => {
    assertOk(
      await queries.saveReferenceMatch({
        blockchain: 'ethereum',
        contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        provider: 'coingecko',
        referenceStatus: 'matched',
        assetPlatformId: 'ethereum',
        externalAssetId: 'usd-coin',
        externalContractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        externalName: 'USD Coin',
        externalSymbol: 'usdc',
        refreshedAt: new Date('2026-03-10T00:00:00.000Z'),
      })
    );
    assertOk(
      await queries.saveReferencePlatformMapping({
        blockchain: 'ethereum',
        provider: 'coingecko',
        assetPlatformId: 'ethereum',
        chainIdentifier: 1,
        refreshedAt: new Date('2026-03-10T00:00:00.000Z'),
      })
    );

    const match = assertOk(
      await queries.getReferenceMatch('ethereum', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'coingecko')
    );
    const mapping = assertOk(await queries.getReferencePlatformMapping('ethereum', 'coingecko'));

    expect(match).toMatchObject({
      blockchain: 'ethereum',
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      provider: 'coingecko',
      referenceStatus: 'matched',
      assetPlatformId: 'ethereum',
      externalAssetId: 'usd-coin',
      externalName: 'USD Coin',
      externalSymbol: 'usdc',
    });
    expect(mapping).toMatchObject({
      blockchain: 'ethereum',
      provider: 'coingecko',
      assetPlatformId: 'ethereum',
      chainIdentifier: 1,
    });
  });

  it('marks reference cache rows stale using the configured freshness windows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));

    expect(queries.isReferenceStale(new Date('2026-03-01T00:00:00.000Z'))).toBe(true);
    expect(queries.isReferenceStale(new Date('2026-03-05T00:00:00.000Z'))).toBe(false);
    expect(queries.isReferencePlatformMappingStale(new Date('2026-02-01T00:00:00.000Z'))).toBe(true);
    expect(queries.isReferencePlatformMappingStale(new Date('2026-02-20T00:00:00.000Z'))).toBe(false);
  });

  it('returns reference unknown when CoinGecko is not configured', async () => {
    const resolver = assertOk(createCoinGeckoTokenReferenceResolver(queries, { apiKey: undefined }));

    try {
      const result = assertOk(await resolver.resolveBatch('ethereum', ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']));

      expect(result.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toEqual({
        provider: 'coingecko',
        referenceStatus: 'unknown',
      });
    } finally {
      await resolver.close();
    }
  });
});
