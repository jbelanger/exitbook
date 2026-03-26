import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OverrideEvent } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readExcludedAssetIds, replayAssetExclusionEvents } from '../asset-exclusion-replay.js';
import { OverrideStore } from '../override-store.js';

const PROFILE_KEY = 'default';
const OTHER_PROFILE_KEY = 'other';

function createAssetExcludeEvent(assetId: string, createdAt: string, profileKey = PROFILE_KEY): OverrideEvent {
  return {
    id: `exclude:${assetId}:${createdAt}`,
    created_at: createdAt,
    profile_key: profileKey,
    actor: 'user',
    source: 'cli',
    scope: 'asset-exclude',
    payload: {
      type: 'asset_exclude',
      asset_id: assetId,
    },
  };
}

function createAssetIncludeEvent(assetId: string, createdAt: string, profileKey = PROFILE_KEY): OverrideEvent {
  return {
    id: `include:${assetId}:${createdAt}`,
    created_at: createdAt,
    profile_key: profileKey,
    actor: 'user',
    source: 'cli',
    scope: 'asset-include',
    payload: {
      type: 'asset_include',
      asset_id: assetId,
    },
  };
}

describe('asset-exclusion-replay', () => {
  let tempDir: string;
  let store: OverrideStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'asset-exclusion-replay-test-'));
    store = new OverrideStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('replayAssetExclusionEvents', () => {
    it('returns the final excluded asset set with latest-event-wins semantics', () => {
      const result = replayAssetExclusionEvents([
        createAssetExcludeEvent('test:scam', '2025-01-01T00:00:00.000Z'),
        createAssetExcludeEvent('test:dust', '2025-01-02T00:00:00.000Z'),
        createAssetIncludeEvent('test:scam', '2025-01-03T00:00:00.000Z'),
        createAssetExcludeEvent('test:broken', '2025-01-04T00:00:00.000Z'),
      ]);

      expect([...assertOk(result)].sort()).toEqual(['test:broken', 'test:dust']);
    });

    it('replays the provided asset exclusion events without additional profile filtering', () => {
      const result = replayAssetExclusionEvents([
        createAssetExcludeEvent('test:scam', '2025-01-01T00:00:00.000Z', OTHER_PROFILE_KEY),
        createAssetExcludeEvent('test:dust', '2025-01-02T00:00:00.000Z'),
        createAssetIncludeEvent('test:dust', '2025-01-03T00:00:00.000Z', OTHER_PROFILE_KEY),
      ]);

      expect([...assertOk(result)].sort()).toEqual(['test:scam']);
    });

    it('returns an error when a non-asset scope is provided', () => {
      const result = replayAssetExclusionEvents([
        {
          id: 'price-1',
          created_at: '2025-01-01T00:00:00.000Z',
          profile_key: PROFILE_KEY,
          actor: 'user',
          source: 'cli',
          scope: 'price',
          payload: {
            type: 'price_override',
            asset: 'BTC',
            quote_asset: 'USD',
            price: '50000',
            price_source: 'manual',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        },
      ]);

      expect(assertErr(result).message).toContain("unsupported scope 'price'");
    });
  });

  describe('readExcludedAssetIds', () => {
    it('returns an empty set when the override store does not exist', async () => {
      const result = await readExcludedAssetIds(store, PROFILE_KEY);

      expect(assertOk(result)).toEqual(new Set());
    });

    it('reads asset exclusion events from the store and replays them strictly', async () => {
      assertOk(
        await store.append({
          profileKey: PROFILE_KEY,
          scope: 'asset-exclude',
          payload: {
            type: 'asset_exclude',
            asset_id: 'test:scam',
          },
        })
      );
      assertOk(
        await store.append({
          profileKey: PROFILE_KEY,
          scope: 'asset-exclude',
          payload: {
            type: 'asset_exclude',
            asset_id: 'test:dust',
          },
        })
      );
      assertOk(
        await store.append({
          profileKey: PROFILE_KEY,
          scope: 'asset-include',
          payload: {
            type: 'asset_include',
            asset_id: 'test:scam',
          },
        })
      );
      assertOk(
        await store.append({
          profileKey: OTHER_PROFILE_KEY,
          scope: 'asset-exclude',
          payload: {
            type: 'asset_exclude',
            asset_id: 'test:other-profile',
          },
        })
      );

      const result = await readExcludedAssetIds(store, PROFILE_KEY);

      expect([...assertOk(result)]).toEqual(['test:dust']);
    });
  });
});
