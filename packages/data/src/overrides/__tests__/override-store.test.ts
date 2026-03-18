import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LinkOverridePayload, PriceOverridePayload } from '@exitbook/core';
import { assertErr } from '@exitbook/core/test-utils';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { OverrideStore } from '../override-store.js';

function createTxFingerprint(seed: string): string {
  return seed.repeat(32).slice(0, 64);
}

function createLinkPayload(sourceFingerprint: string, targetFingerprint: string, asset: string): LinkOverridePayload {
  const normalizedAsset = asset.toLowerCase();
  return {
    type: 'link_override',
    action: 'confirm',
    link_type: 'transfer',
    source_fingerprint: sourceFingerprint,
    target_fingerprint: targetFingerprint,
    asset,
    resolved_link_fingerprint: `resolved-link:v1:movement:${sourceFingerprint}:outflow:0:movement:${targetFingerprint}:inflow:0:test:${normalizedAsset}:test:${normalizedAsset}`,
    source_asset_id: `test:${normalizedAsset}`,
    target_asset_id: `test:${normalizedAsset}`,
    source_movement_fingerprint: `movement:${sourceFingerprint}:outflow:0`,
    target_movement_fingerprint: `movement:${targetFingerprint}:inflow:0`,
    source_amount: '1',
    target_amount: '1',
  };
}

describe('OverrideStore', () => {
  let tempDir: string;
  let store: OverrideStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'override-store-test-'));
    store = new OverrideStore(tempDir);
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('append', () => {
    it('should append a link override event', async () => {
      const payload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const result = await store.append({
        scope: 'link',
        payload,
        reason: 'Test link confirmation',
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const event = result.value;
        expect(event.id).toBeDefined();
        expect(event.created_at).toBeDefined();
        expect(event.actor).toBe('user');
        expect(event.source).toBe('cli');
        expect(event.scope).toBe('link');
        expect(event.reason).toBe('Test link confirmation');
        expect(event.payload).toEqual(payload);
      }
    });

    it('should append a price override event', async () => {
      const payload: PriceOverridePayload = {
        type: 'price_override',
        asset: 'BTC',
        quote_asset: 'USD',
        price: '45000.00',
        price_source: 'manual',
        timestamp: '2024-01-15T14:30:00Z',
      };

      const result = await store.append({
        scope: 'price',
        payload,
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const event = result.value;
        expect(event.scope).toBe('price');
        expect(event.payload).toEqual(payload);
      }
    });

    it('should append an asset review confirm event', async () => {
      const result = await store.append({
        scope: 'asset-review-confirm',
        payload: {
          type: 'asset_review_confirm',
          asset_id: 'blockchain:ethereum:0xscam',
          evidence_fingerprint: 'asset-review:v1:abc123',
        },
        reason: 'Intentional airdrop',
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const event = result.value;
        expect(event.scope).toBe('asset-review-confirm');
        expect(event.reason).toBe('Intentional airdrop');
        expect(event.payload).toEqual({
          type: 'asset_review_confirm',
          asset_id: 'blockchain:ethereum:0xscam',
          evidence_fingerprint: 'asset-review:v1:abc123',
        });
      }
    });

    it('should reject mismatched scope and payload type', async () => {
      // Attempt to write a price_override payload with scope 'link'
      const result = await store.append({
        scope: 'link',
        payload: {
          type: 'price_override',
          asset: 'BTC',
          quote_asset: 'USD',
          price: '45000.00',
          price_source: 'manual',
          timestamp: '2024-01-15T14:30:00Z',
        },
      });

      expect(assertErr(result).message).toContain("scope 'link' requires payload type 'link_override'");
    });

    it('should create overrides.db file if it does not exist', async () => {
      expect(store.exists()).toBe(false);

      const payload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const result = await store.append({
        scope: 'link',
        payload,
      });

      expect(result.isOk()).toBe(true);
      expect(store.exists()).toBe(true);
    });

    it('should return an error result and recover queue after unexpected append failure', async () => {
      const payload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const appendImplSpy = vi
        .spyOn(store as unknown as { appendImpl: (options: unknown) => Promise<unknown> }, 'appendImpl')
        .mockRejectedValueOnce(new Error('simulated append failure'));

      const firstResult = await store.append({
        scope: 'link',
        payload,
      });

      expect(firstResult.isErr()).toBe(true);
      if (firstResult.isErr()) {
        expect(firstResult.error.message).toContain('simulated append failure');
      }

      appendImplSpy.mockRestore();

      const secondResult = await store.append({
        scope: 'link',
        payload,
      });

      expect(secondResult.isOk()).toBe(true);
    });
  });

  describe('readAll', () => {
    it('should return empty array if file does not exist', async () => {
      const result = await store.readAll();

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should read all events in order', async () => {
      const payload1 = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const payload2: PriceOverridePayload = {
        type: 'price_override',
        asset: 'BTC',
        quote_asset: 'USD',
        price: '45000.00',
        price_source: 'manual',
        timestamp: '2024-01-15T14:30:00Z',
      };

      const payload3 = createLinkPayload(createTxFingerprint('c3'), createTxFingerprint('d4'), 'ETH');

      await store.append({ scope: 'link', payload: payload1 });
      await store.append({ scope: 'price', payload: payload2 });
      await store.append({ scope: 'link', payload: payload3 });

      const result = await store.readAll();

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const events = result.value;
        expect(events).toHaveLength(3);
        expect(events[0]?.scope).toBe('link');
        expect(events[1]?.scope).toBe('price');
        expect(events[2]?.scope).toBe('link');
      }
    });

    it('should preserve append order via database sequence', async () => {
      const payload1 = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const payload2 = createLinkPayload(createTxFingerprint('c3'), createTxFingerprint('d4'), 'ETH');

      const first = await store.append({ scope: 'link', payload: payload1 });
      const second = await store.append({ scope: 'link', payload: payload2 });

      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);

      const result = await store.readAll();
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.payload).toEqual(payload1);
        expect(result.value[1]?.payload).toEqual(payload2);
      }
    });
  });

  describe('readByScope', () => {
    it('should filter events by scope', async () => {
      const linkPayload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      const pricePayload: PriceOverridePayload = {
        type: 'price_override',
        asset: 'BTC',
        quote_asset: 'USD',
        price: '45000.00',
        price_source: 'manual',
        timestamp: '2024-01-15T14:30:00Z',
      };

      await store.append({ scope: 'link', payload: linkPayload });
      await store.append({ scope: 'price', payload: pricePayload });
      await store.append({ scope: 'link', payload: linkPayload });

      const result = await store.readByScope('link');

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const events = result.value;
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.scope === 'link')).toBe(true);
      }
    });

    it('should query scope directly without delegating to readAll', async () => {
      const linkPayload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');
      await store.append({ scope: 'link', payload: linkPayload });

      const readAllSpy = vi.spyOn(store, 'readAll');
      const result = await store.readByScope('link');

      expect(result.isOk()).toBe(true);
      expect(readAllSpy).not.toHaveBeenCalled();
    });
  });

  describe('readByScopes', () => {
    it('should read multiple scopes in append order', async () => {
      const sourceFingerprint = createTxFingerprint('a1');
      const targetFingerprint = createTxFingerprint('b2');
      const linkPayload = createLinkPayload(sourceFingerprint, targetFingerprint, 'BTC');
      const otherLinkPayload = createLinkPayload(createTxFingerprint('c3'), createTxFingerprint('d4'), 'BTC');
      const pricePayload: PriceOverridePayload = {
        type: 'price_override',
        asset: 'BTC',
        quote_asset: 'USD',
        price: '45000.00',
        price_source: 'manual',
        timestamp: '2024-01-15T14:30:00Z',
      };

      await store.append({ scope: 'link', payload: linkPayload });
      await store.append({ scope: 'price', payload: pricePayload });
      await store.append({
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          resolved_link_fingerprint: `resolved-link:v1:movement:${sourceFingerprint}:outflow:0:movement:${targetFingerprint}:inflow:0:test:btc:test:btc`,
        },
      });
      await store.append({ scope: 'link', payload: otherLinkPayload });

      const result = await store.readByScopes(['link', 'unlink']);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        expect(result.value.map((event) => event.scope)).toEqual(['link', 'unlink', 'link']);
      }
    });

    it('should read asset review scopes alongside other overrides in append order', async () => {
      const linkPayload = createLinkPayload(createTxFingerprint('a1'), createTxFingerprint('b2'), 'BTC');

      await store.append({ scope: 'link', payload: linkPayload });
      await store.append({
        scope: 'asset-review-confirm',
        payload: {
          type: 'asset_review_confirm',
          asset_id: 'blockchain:ethereum:0xscam',
          evidence_fingerprint: 'asset-review:v1:abc123',
        },
      });
      await store.append({
        scope: 'asset-review-clear',
        payload: {
          type: 'asset_review_clear',
          asset_id: 'blockchain:ethereum:0xscam',
        },
      });

      const result = await store.readByScopes(['link', 'asset-review-confirm', 'asset-review-clear']);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.map((event) => event.scope)).toEqual([
          'link',
          'asset-review-confirm',
          'asset-review-clear',
        ]);
      }
    });

    it('rejects legacy pre-simplification fingerprints on read', async () => {
      const legacyPayload = createLinkPayload('tx:v2:kraken:1:trade-1', 'tx:v2:blockchain:bitcoin:2:abc123', 'BTC');

      const appendResult = await store.append({ scope: 'link', payload: legacyPayload });
      expect(appendResult.isOk()).toBe(true);

      const result = await store.readByScopes(['link']);
      expect(assertErr(result).message).toContain('legacy transaction identity');
      expect(assertErr(result).message).toContain('Delete');
    });
  });

  describe('file independence', () => {
    it('should store overrides in a dedicated sqlite file independent of the main database', () => {
      const filePath = store.getFilePath();

      expect(filePath).toMatch(/overrides\.db$/);
      expect(filePath).not.toMatch(/transactions\.db$/);
    });
  });
});
