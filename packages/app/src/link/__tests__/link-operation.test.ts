import type { OverrideEvent } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinkOperation } from '../link-operation.js';
import type { LinkingEvent } from '../linking-events.js';

import {
  createExchangeToChainTransferPair,
  createMockDb,
  createMockEventBus,
  createTransaction,
  defaultLinkParams,
} from './link-test-utils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LinkOperation', () => {
  describe('overrides', () => {
    it('applies unlink overrides to internal links so rejected links do not reappear', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          accountId: 1,
          source: 'blockchain:ethereum',
          sourceType: 'blockchain',
          datetime: '2026-02-07T00:00:00Z',
          outflows: [{ assetSymbol: 'ETH', amount: '1' }],
          blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
        }),
        createTransaction({
          id: 2,
          accountId: 2,
          source: 'blockchain:ethereum',
          sourceType: 'blockchain',
          datetime: '2026-02-07T00:00:00Z',
          inflows: [{ assetSymbol: 'ETH', amount: '1' }],
          blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
        }),
      ];

      const unlinkEvent: OverrideEvent = {
        id: 'evt-1',
        created_at: '2026-02-07T10:00:00.000Z',
        actor: 'cli-user',
        source: 'cli',
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          link_fingerprint:
            'link:blockchain:ethereum:blockchain:ethereum-1:blockchain:ethereum:blockchain:ethereum-2:ETH',
        },
      };

      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(transactions)) },
      });

      const mockOverrideStore = {
        exists: () => true,
        readAll: vi.fn().mockResolvedValue(ok([unlinkEvent])),
      };

      const operation = new LinkOperation(db, mockOverrideStore as never);
      const result = await operation.execute(defaultLinkParams);

      const value = assertOk(result);
      expect(value.internalLinksCount).toBe(1);
      expect(value.confirmedLinksCount).toBe(0);
      expect(value.suggestedLinksCount).toBe(0);
      expect(value.totalSaved).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
      expect(db.transactionLinks.createBatch).not.toHaveBeenCalled();
    });

    it('returns error when override loading fails', async () => {
      const db = createMockDb();
      const mockOverrideStore = {
        exists: () => true,
        readAll: vi.fn().mockResolvedValue(err(new Error('read failed'))),
      };

      const operation = new LinkOperation(db, mockOverrideStore as never);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('Failed to read override events: read failed');
    });

    it('skips orphaned override when assetId cannot be resolved from movements', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2026-02-07T00:00:00Z',
          outflows: [{ assetSymbol: 'ETH', amount: '10' }],
        }),
        createTransaction({
          id: 2,
          source: 'blockchain:bitcoin',
          sourceType: 'blockchain',
          datetime: '2026-02-07T01:00:00Z',
          inflows: [{ assetSymbol: 'ETH', amount: '10' }],
        }),
      ];

      const linkOverride: OverrideEvent = {
        id: 'evt-orphan',
        created_at: '2026-02-07T10:00:00.000Z',
        actor: 'cli-user',
        source: 'cli',
        scope: 'link',
        payload: {
          type: 'link_override',
          action: 'confirm',
          link_type: 'transfer',
          source_fingerprint: 'kraken:kraken-1',
          target_fingerprint: 'blockchain:bitcoin:blockchain:bitcoin-2',
          asset: 'BTC',
        },
      };

      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(transactions)) },
      });

      const mockOverrideStore = {
        exists: () => true,
        readAll: vi.fn().mockResolvedValue(ok([linkOverride])),
      };

      const operation = new LinkOperation(db, mockOverrideStore as never);
      const result = await operation.execute(defaultLinkParams);

      assertOk(result);
    });

    it('skips orphaned override when target transaction has ambiguous assetIds for symbol', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          source: 'kraken',
          sourceType: 'exchange',
          datetime: '2026-02-07T00:00:00Z',
          outflows: [{ assetSymbol: 'USDC', amount: '100' }],
        }),
        createTransaction({
          id: 2,
          source: 'blockchain:ethereum',
          sourceType: 'blockchain',
          datetime: '2026-02-07T01:00:00Z',
          inflows: [{ assetSymbol: 'USDC', amount: '99' }],
        }),
      ];

      const linkOverride: OverrideEvent = {
        id: 'evt-orphan-ambiguous-target',
        created_at: '2026-02-07T10:00:00.000Z',
        actor: 'cli-user',
        source: 'cli',
        scope: 'link',
        payload: {
          type: 'link_override',
          action: 'confirm',
          link_type: 'transfer',
          source_fingerprint: 'kraken:kraken-1',
          target_fingerprint: 'blockchain:ethereum:blockchain:ethereum-2',
          asset: 'USDC',
        },
      };

      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(transactions)) },
      });

      const mockOverrideStore = {
        exists: () => true,
        readAll: vi.fn().mockResolvedValue(ok([linkOverride])),
      };

      const operation = new LinkOperation(db, mockOverrideStore as never);
      const result = await operation.execute(defaultLinkParams);

      assertOk(result);
    });
  });

  describe('error handling', () => {
    it('returns error when transaction loading fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(err(new Error('load failed'))) },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('load failed');
    });

    it('returns error when clearing existing links fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        transactionLinks: {
          deleteAll: vi.fn().mockResolvedValue(err(new Error('delete failed'))),
        },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('delete failed');
    });

    it('returns error when persisting linkable movements fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        linkableMovements: {
          createBatch: vi.fn().mockResolvedValue(err(new Error('persist failed'))),
        },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('persist failed');
    });

    it('returns error when reading back linkable movements fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        linkableMovements: {
          createBatch: vi.fn().mockResolvedValue(ok(2)),
          findAll: vi.fn().mockResolvedValue(err(new Error('readback failed'))),
        },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('readback failed');
    });

    it('returns error when saving links fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        transactionLinks: {
          createBatch: vi.fn().mockResolvedValue(err(new Error('save failed'))),
        },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);

      expect(assertErr(result).message).toContain('save failed');
    });
  });

  describe('events and persistence', () => {
    it('emits events during execution when eventBus is provided', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        transactionLinks: { createBatch: vi.fn().mockResolvedValue(ok(1)) },
      });

      const emittedEvents: LinkingEvent[] = [];
      const operation = new LinkOperation(db, undefined, createMockEventBus(emittedEvents));
      const result = await operation.execute(defaultLinkParams);
      assertOk(result);

      const eventTypes = emittedEvents.map((event) => event.type);
      expect(eventTypes).toContain('load.started');
      expect(eventTypes).toContain('load.completed');
      expect(eventTypes).toContain('materialize.started');
      expect(eventTypes).toContain('materialize.completed');
      expect(eventTypes).toContain('match.started');
      expect(eventTypes).toContain('match.completed');
      expect(eventTypes).toContain('save.started');
      expect(eventTypes).toContain('save.completed');
    });

    it('emits existing.cleared when old links are removed', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        transactionLinks: {
          deleteAll: vi.fn().mockResolvedValue(ok(3)),
        },
      });

      const emittedEvents: LinkingEvent[] = [];
      const operation = new LinkOperation(db, undefined, createMockEventBus(emittedEvents));
      const result = await operation.execute(defaultLinkParams);
      const value = assertOk(result);

      expect(value.existingLinksCleared).toBe(3);
      expect(emittedEvents.some((event) => event.type === 'existing.cleared')).toBe(true);
    });

    it('continues when clearing linkable movements fails', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
        linkableMovements: {
          deleteAll: vi.fn().mockResolvedValue(err(new Error('movement clear failed'))),
        },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute(defaultLinkParams);
      const value = assertOk(result);

      expect(value.dryRun).toBe(false);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
      expect(db.linkableMovements.deleteAll).toHaveBeenCalledTimes(1);
    });

    it('does not emit save events in dry run mode', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok([createExchangeToChainTransferPair()[0]!])) },
      });

      const emittedEvents: LinkingEvent[] = [];
      const operation = new LinkOperation(db, undefined, createMockEventBus(emittedEvents));

      const result = await operation.execute({ ...defaultLinkParams, dryRun: true });
      assertOk(result);

      const eventTypes = emittedEvents.map((event) => event.type);
      expect(eventTypes).toContain('load.started');
      expect(eventTypes).toContain('load.completed');
      expect(eventTypes).toContain('materialize.started');
      expect(eventTypes).toContain('materialize.completed');
      expect(eventTypes).toContain('match.started');
      expect(eventTypes).toContain('match.completed');
      expect(eventTypes).not.toContain('save.started');
      expect(eventTypes).not.toContain('save.completed');
    });

    it('does not persist in dry-run mode', async () => {
      const db = createMockDb({
        transactions: { findAll: vi.fn().mockResolvedValue(ok(createExchangeToChainTransferPair())) },
      });

      const operation = new LinkOperation(db);
      const result = await operation.execute({ ...defaultLinkParams, dryRun: true });

      const value = assertOk(result);
      expect(value.dryRun).toBe(true);
      expect(value.totalSaved).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
      expect(db.transactionLinks.deleteAll).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
      expect(db.linkableMovements.deleteAll).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
      expect(db.transactionLinks.createBatch).not.toHaveBeenCalled();
    });
  });

  it('returns empty result when no transactions exist', async () => {
    const db = createMockDb();
    const operation = new LinkOperation(db);
    const result = await operation.execute(defaultLinkParams);

    const value = assertOk(result);
    expect(value.internalLinksCount).toBe(0);
    expect(value.confirmedLinksCount).toBe(0);
    expect(value.suggestedLinksCount).toBe(0);
    expect(value.dryRun).toBe(false);
  });
});
