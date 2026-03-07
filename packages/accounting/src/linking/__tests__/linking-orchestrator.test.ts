import { parseDecimal } from '@exitbook/core';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { EventBus } from '@exitbook/events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ILinkingPersistence, LinksSaveResult } from '../../ports/index.js';
import type { LinkingEvent } from '../linking-events.js';
import { LinkingOrchestrator } from '../linking-orchestrator.js';

import { createTransaction } from './test-utils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockStore(overrides: Partial<ILinkingPersistence> = {}): ILinkingPersistence {
  const store: ILinkingPersistence = {
    loadTransactions: vi.fn().mockResolvedValue(ok([])),

    replaceMovements: vi.fn().mockImplementation((movements: unknown[]) => {
      const withIds = movements.map((m, i) => ({ ...(m as object), id: i + 1 }));
      return ok(withIds);
    }),

    replaceLinks: vi.fn().mockImplementation((links: unknown[]) => {
      return ok({ previousCount: 0, savedCount: links.length } satisfies LinksSaveResult);
    }),

    withTransaction: vi.fn(),

    ...overrides,
  };

  // Passthrough: just call the function with the same store (no real transaction in tests)
  (store.withTransaction as ReturnType<typeof vi.fn>).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- store.withTransaction is expected to be async, but our mock doesn't need real transactions
    (fn: (txStore: ILinkingPersistence) => Promise<unknown>) => fn(store)
  );

  return store;
}

describe('LinkingOrchestrator', () => {
  it('applies unlink overrides to internal links so rejected links do not reappear', async () => {
    // Two blockchain transactions with same hash from different accounts → internal link
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

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [unlinkEvent]
    );

    const value = assertOk(result);

    // Internal link was created but unlink override should reject it
    expect(value.internalLinksCount).toBe(1);
    expect(value.confirmedLinksCount).toBe(0);
    expect(value.suggestedLinksCount).toBe(0);
    // Only the rejected internal link → no non-rejected links to save
    expect(value.totalSaved).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
    expect(store.replaceLinks).not.toHaveBeenCalled();
  });

  it('returns error when transaction loading fails', async () => {
    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(err(new Error('load failed'))),
    });

    const handler = new LinkingOrchestrator(store);
    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(assertErr(result).message).toContain('load failed');
  });

  it('emits events during execution when eventBus is provided', async () => {
    // A kraken withdrawal and a bitcoin deposit that should match
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-02-08T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-02-08T01:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
      }),
    ];

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
      replaceLinks: vi.fn().mockResolvedValue(ok({ previousCount: 0, savedCount: 1 })),
    });

    const emittedEvents: LinkingEvent[] = [];
    const mockEventBus = {
      emit: vi.fn().mockImplementation((event: LinkingEvent) => {
        emittedEvents.push(event);
      }),
      subscribe: vi.fn(),
    } as unknown as EventBus<LinkingEvent>;

    const handler = new LinkingOrchestrator(store, mockEventBus);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    assertOk(result);

    // Verify event sequence: load → materialize → match → save
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('load.started');
    expect(eventTypes).toContain('load.completed');
    expect(eventTypes).toContain('materialize.started');
    expect(eventTypes).toContain('materialize.completed');
    expect(eventTypes).toContain('match.started');
    expect(eventTypes).toContain('match.completed');
    expect(eventTypes).toContain('save.started');
    expect(eventTypes).toContain('save.completed');
  });

  it('does not emit save events in dry run mode', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-02-08T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
    ];

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const emittedEvents: LinkingEvent[] = [];
    const mockEventBus = {
      emit: vi.fn().mockImplementation((event: LinkingEvent) => {
        emittedEvents.push(event);
      }),
      subscribe: vi.fn(),
    } as unknown as EventBus<LinkingEvent>;

    const handler = new LinkingOrchestrator(store, mockEventBus);

    const result = await handler.execute({
      dryRun: true,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    assertOk(result);

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('load.started');
    expect(eventTypes).toContain('load.completed');
    expect(eventTypes).toContain('materialize.started');
    expect(eventTypes).toContain('materialize.completed');
    expect(eventTypes).toContain('match.started');
    expect(eventTypes).toContain('match.completed');
    expect(eventTypes).not.toContain('save.started');
    expect(eventTypes).not.toContain('save.completed');
  });

  it('returns error when replacing links fails', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-02-08T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-02-08T01:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
      }),
    ];

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
      replaceLinks: vi.fn().mockResolvedValue(err(new Error('replace failed'))),
    });

    const handler = new LinkingOrchestrator(store);
    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(assertErr(result).message).toContain('replace failed');
  });

  it('skips orphaned override when assetId cannot be resolved from movements', async () => {
    // Transactions have ETH movements only — override references BTC (no match)
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

    // Override event that references BTC — but neither tx has BTC movements
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

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

    // Should succeed — the orphaned override is skipped, not a fatal error
    assertOk(result);
  });

  it('skips orphaned override when source transaction has ambiguous assetIds for symbol', async () => {
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
        inflows: [{ assetSymbol: 'USDC', amount: '101' }],
      }),
    ];

    const linkOverride: OverrideEvent = {
      id: 'evt-orphan-ambiguous-source',
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

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

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

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

    assertOk(result);
  });
});
