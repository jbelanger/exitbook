import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { err, ok } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { HttpClient } from '@exitbook/http';
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
    vi.restoreAllMocks();
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

  it('resolves non-EVM CoinGecko platforms by platform id and preserves case-sensitive refs', async () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    vi.spyOn(HttpClient.prototype, 'get').mockImplementation(async (endpoint: string) => {
      if (endpoint === '/asset_platforms') {
        return ok([{ id: 'solana', chain_identifier: undefined }]);
      }

      if (endpoint === '/coins/list?include_platform=true') {
        return ok([
          {
            id: 'usd-coin',
            symbol: 'usdc',
            name: 'USD Coin',
            platforms: {
              solana: mint,
            },
          },
        ]);
      }

      return err(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    const resolver = assertOk(createCoinGeckoTokenReferenceResolver(queries, { apiKey: 'demo-key' }));

    try {
      const result = assertOk(await resolver.resolveBatch('solana', [mint]));
      const mapping = assertOk(await queries.getReferencePlatformMapping('solana', 'coingecko'));
      const match = assertOk(await queries.getReferenceMatch('solana', mint, 'coingecko'));

      expect(result.get(mint)).toMatchObject({
        provider: 'coingecko',
        referenceStatus: 'matched',
        assetPlatformId: 'solana',
        externalAssetId: 'usd-coin',
        externalContractAddress: mint,
      });
      expect(mapping).toMatchObject({
        blockchain: 'solana',
        provider: 'coingecko',
        assetPlatformId: 'solana',
        chainIdentifier: undefined,
      });
      expect(match).toMatchObject({
        blockchain: 'solana',
        contractAddress: mint,
        referenceStatus: 'matched',
        externalContractAddress: mint,
      });
    } finally {
      await resolver.close();
    }
  });

  it('matches aliased CoinGecko platform ids for supported non-EVM chains', async () => {
    const tokenContract = 'usdt.tether-token.near';
    vi.spyOn(HttpClient.prototype, 'get').mockImplementation(async (endpoint: string) => {
      if (endpoint === '/asset_platforms') {
        return ok([{ id: 'near-protocol', chain_identifier: undefined }]);
      }

      if (endpoint === '/coins/list?include_platform=true') {
        return ok([
          {
            id: 'tether',
            symbol: 'usdt',
            name: 'Tether',
            platforms: {
              'near-protocol': tokenContract,
            },
          },
        ]);
      }

      return err(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    const resolver = assertOk(createCoinGeckoTokenReferenceResolver(queries, { apiKey: 'demo-key' }));

    try {
      const result = assertOk(await resolver.resolveBatch('near', [tokenContract]));

      expect(result.get(tokenContract)).toMatchObject({
        provider: 'coingecko',
        referenceStatus: 'matched',
        assetPlatformId: 'near-protocol',
        externalAssetId: 'tether',
      });
    } finally {
      await resolver.close();
    }
  });

  it('returns reference unknown for unsupported blockchains even when CoinGecko is configured', async () => {
    const tokenRef = 'rTokenIssuerExample';
    vi.spyOn(HttpClient.prototype, 'get').mockImplementation(async (endpoint: string) => {
      if (endpoint === '/asset_platforms') {
        return ok([{ id: 'solana', chain_identifier: undefined }]);
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const resolver = assertOk(createCoinGeckoTokenReferenceResolver(queries, { apiKey: 'demo-key' }));

    try {
      const result = assertOk(await resolver.resolveBatch('xrp', [tokenRef]));

      expect(result.get(tokenRef)).toEqual({
        provider: 'coingecko',
        referenceStatus: 'unknown',
      });
      expect(assertOk(await queries.getReferencePlatformMapping('xrp', 'coingecko'))).toBeUndefined();
    } finally {
      await resolver.close();
    }
  });
});
