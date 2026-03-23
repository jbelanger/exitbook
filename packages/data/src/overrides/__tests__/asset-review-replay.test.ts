import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OverrideEvent } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAssetReviewDecisions, replayAssetReviewEvents } from '../asset-review-replay.js';
import { OverrideStore } from '../override-store.js';

function createAssetReviewConfirmEvent(assetId: string, createdAt: string, evidenceFingerprint: string): OverrideEvent {
  return {
    id: `confirm:${assetId}:${createdAt}`,
    created_at: createdAt,
    actor: 'user',
    source: 'cli',
    scope: 'asset-review-confirm',
    payload: {
      type: 'asset_review_confirm',
      asset_id: assetId,
      evidence_fingerprint: evidenceFingerprint,
    },
  };
}

function createAssetReviewClearEvent(assetId: string, createdAt: string): OverrideEvent {
  return {
    id: `clear:${assetId}:${createdAt}`,
    created_at: createdAt,
    actor: 'user',
    source: 'cli',
    scope: 'asset-review-clear',
    payload: {
      type: 'asset_review_clear',
      asset_id: assetId,
    },
  };
}

describe('asset-review-replay', () => {
  let tempDir: string;
  let store: OverrideStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'asset-review-replay-test-'));
    store = new OverrideStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('replayAssetReviewEvents', () => {
    it('returns the final review decision per asset with latest-event-wins semantics', () => {
      const result = replayAssetReviewEvents([
        createAssetReviewConfirmEvent('test:scam', '2025-01-01T00:00:00.000Z', 'asset-review:v1:one'),
        createAssetReviewClearEvent('test:scam', '2025-01-02T00:00:00.000Z'),
        createAssetReviewConfirmEvent('test:scam', '2025-01-03T00:00:00.000Z', 'asset-review:v1:two'),
        createAssetReviewConfirmEvent('test:dust', '2025-01-04T00:00:00.000Z', 'asset-review:v1:dust'),
      ]);

      expect([...assertOk(result).entries()]).toEqual([
        [
          'test:scam',
          {
            action: 'confirm',
            assetId: 'test:scam',
            evidenceFingerprint: 'asset-review:v1:two',
          },
        ],
        [
          'test:dust',
          {
            action: 'confirm',
            assetId: 'test:dust',
            evidenceFingerprint: 'asset-review:v1:dust',
          },
        ],
      ]);
    });

    it('returns an error when a non-review scope is provided', () => {
      const result = replayAssetReviewEvents([
        {
          id: 'price-1',
          created_at: '2025-01-01T00:00:00.000Z',
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

  describe('readAssetReviewDecisions', () => {
    it('returns an empty map when the override store does not exist', async () => {
      const result = await readAssetReviewDecisions(store);

      expect(assertOk(result)).toEqual(new Map());
    });

    it('reads review confirm and clear events from the store', async () => {
      assertOk(
        await store.append({
          scope: 'asset-review-confirm',
          payload: {
            type: 'asset_review_confirm',
            asset_id: 'test:scam',
            evidence_fingerprint: 'asset-review:v1:one',
          },
        })
      );
      assertOk(
        await store.append({
          scope: 'asset-review-clear',
          payload: {
            type: 'asset_review_clear',
            asset_id: 'test:dust',
          },
        })
      );

      const result = await readAssetReviewDecisions(store);

      expect([...assertOk(result).entries()]).toEqual([
        [
          'test:scam',
          {
            action: 'confirm',
            assetId: 'test:scam',
            evidenceFingerprint: 'asset-review:v1:one',
          },
        ],
        [
          'test:dust',
          {
            action: 'clear',
            assetId: 'test:dust',
          },
        ],
      ]);
    });
  });
});
