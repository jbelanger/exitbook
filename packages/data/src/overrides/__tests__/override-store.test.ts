import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { OverrideStore } from '../override-store.js';
import type { LinkOverridePayload, PriceOverridePayload } from '../override.schemas.js';

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
      const payload: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-123',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

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

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("scope 'link' requires payload type 'link_override'");
    });

    it('should create overrides.jsonl file if it does not exist', async () => {
      expect(store.exists()).toBe(false);

      const payload: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-123',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

      const result = await store.append({
        scope: 'link',
        payload,
      });

      expect(result.isOk()).toBe(true);
      expect(store.exists()).toBe(true);
    });

    it('should return an error result and recover queue after unexpected append failure', async () => {
      const payload: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-123',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

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
      const payload1: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-1',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

      const payload2: PriceOverridePayload = {
        type: 'price_override',
        asset: 'BTC',
        quote_asset: 'USD',
        price: '45000.00',
        price_source: 'manual',
        timestamp: '2024-01-15T14:30:00Z',
      };

      const payload3: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-3',
        target_fingerprint: 'blockchain:bitcoin:def',
        asset: 'ETH',
      };

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

    it('should skip invalid JSONL lines', async () => {
      const payload: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-1',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

      await store.append({ scope: 'link', payload });

      // Manually append invalid JSON to the file
      const { appendFile } = await import('node:fs/promises');
      await appendFile(store.getFilePath(), 'invalid json line\n', 'utf-8');

      const result = await store.readAll();

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.scope).toBe('link');
      }
    });
  });

  describe('readByScope', () => {
    it('should filter events by scope', async () => {
      const linkPayload: LinkOverridePayload = {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'kraken:TRADE-1',
        target_fingerprint: 'blockchain:bitcoin:abc',
        asset: 'BTC',
      };

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
  });

  describe('file independence', () => {
    it('should store overrides as a plain file independent of database operations', () => {
      // The override store file path is a plain JSONL file on the filesystem,
      // not a database table. ClearService operates exclusively through SQL
      // repositories and never touches filesystem files, so overrides.jsonl
      // inherently survives database wipes and reprocessing.
      const filePath = store.getFilePath();

      expect(filePath).toMatch(/overrides\.jsonl$/);
      expect(filePath).not.toMatch(/\.db$/);
      expect(filePath).not.toMatch(/\.sqlite$/);
    });
  });
});
