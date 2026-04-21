import { computeResolvedLinkFingerprint } from '@exitbook/core';
import type { OverrideEvent } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { parseDecimal } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ILinkingPersistence, LinksSaveResult } from '../../../ports/index.js';
import { createTransaction, requirePresent } from '../../shared/test-utils.js';
import type { LinkingEvent } from '../linking-events.js';
import { LinkingOrchestrator } from '../linking-orchestrator.js';

const PROFILE_KEY = 'default';

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockStore(overrides: Partial<ILinkingPersistence> = {}): ILinkingPersistence {
  const store: ILinkingPersistence = {
    loadTransactions: vi.fn().mockResolvedValue(ok([])),
    loadTransactionAnnotations: vi.fn().mockResolvedValue(ok([])),

    replaceLinks: vi.fn().mockImplementation((links: unknown[]) => {
      return ok({ previousCount: 0, savedCount: links.length } satisfies LinksSaveResult);
    }),

    markLinksBuilding: vi.fn().mockResolvedValue(ok(undefined)),
    markLinksFresh: vi.fn().mockResolvedValue(ok(undefined)),
    markLinksFailed: vi.fn().mockResolvedValue(ok(undefined)),

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

function buildResolvedLinkFingerprint(params: {
  sourceAssetId: string;
  sourceMovementFingerprint: string;
  targetAssetId: string;
  targetMovementFingerprint: string;
}): string {
  return assertOk(computeResolvedLinkFingerprint(params));
}

describe('LinkingOrchestrator', () => {
  it('applies exact unlink overrides to internal links so rejected links do not reappear', async () => {
    // Two blockchain transactions with same hash from different accounts → internal link
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:ethereum',
        platformKind: 'blockchain',
        datetime: '2026-02-07T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '1' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:ethereum',
        platformKind: 'blockchain',
        datetime: '2026-02-07T00:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '1' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
      }),
    ];
    const sourceMovementFingerprint = requirePresent(
      transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
      'Expected source outflow movement fingerprint'
    );
    const targetMovementFingerprint = requirePresent(
      transactions[1]!.movements.inflows?.[0]?.movementFingerprint,
      'Expected target inflow movement fingerprint'
    );

    const unlinkEvent: OverrideEvent = {
      id: 'evt-1',
      created_at: '2026-02-07T10:00:00.000Z',
      profile_key: PROFILE_KEY,
      actor: 'cli-user',
      source: 'cli',
      scope: 'unlink',
      payload: {
        type: 'unlink_override',
        resolved_link_fingerprint: buildResolvedLinkFingerprint({
          sourceAssetId: 'test:eth',
          targetAssetId: 'test:eth',
          sourceMovementFingerprint,
          targetMovementFingerprint,
        }),
      },
    };

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
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
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(assertErr(result).message).toContain('load failed');
  });

  it('loads asserted bridge annotations for the fetched transaction set', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'blockchain:ethereum',
        platformKind: 'blockchain',
        datetime: '2026-02-07T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '1' }],
      }),
    ];
    const loadTransactionAnnotations = vi.fn().mockResolvedValue(ok([]));
    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
      loadTransactionAnnotations,
    });

    const handler = new LinkingOrchestrator(store);
    const result = await handler.execute({
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(assertOk(result).totalSourceCandidates).toBeGreaterThanOrEqual(0);
    expect(loadTransactionAnnotations).toHaveBeenCalledWith({
      kinds: ['bridge_participant'],
      tiers: ['asserted'],
      transactionIds: [1],
    });
  });

  it('emits events during execution when eventBus is provided', async () => {
    // A kraken withdrawal and a bitcoin deposit that should match
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        platformKind: 'exchange',
        datetime: '2026-02-08T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        platformKind: 'blockchain',
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
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    assertOk(result);

    // Verify event sequence: load → build linkable movements → match → save
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('load.started');
    expect(eventTypes).toContain('load.completed');
    expect(eventTypes).toContain('candidates.started');
    expect(eventTypes).toContain('candidates.completed');
    expect(eventTypes).toContain('match.started');
    expect(eventTypes).toContain('match.completed');
    expect(eventTypes).toContain('save.started');
    expect(eventTypes).toContain('save.completed');
  });

  it('returns error when replacing links fails', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        platformKind: 'exchange',
        datetime: '2026-02-08T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        platformKind: 'blockchain',
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
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(assertErr(result).message).toContain('replace failed');
  });

  it('skips orphaned override when exact asset ids do not resolve from current linkable movements', async () => {
    // Transactions have ETH movements only — override references BTC (no match)
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        platformKind: 'exchange',
        datetime: '2026-02-07T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '10' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        platformKind: 'blockchain',
        datetime: '2026-02-07T01:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '10' }],
      }),
    ];
    const sourceTxFingerprint = transactions[0]!.txFingerprint;
    const targetTxFingerprint = transactions[1]!.txFingerprint;
    const sourceMovementFingerprint = requirePresent(
      transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
      'Expected source outflow movement fingerprint'
    );
    const targetMovementFingerprint = requirePresent(
      transactions[1]!.movements.inflows?.[0]?.movementFingerprint,
      'Expected target inflow movement fingerprint'
    );

    // Override event that references BTC — but neither tx has BTC movements
    const linkOverride: OverrideEvent = {
      id: 'evt-orphan',
      created_at: '2026-02-07T10:00:00.000Z',
      profile_key: PROFILE_KEY,
      actor: 'cli-user',
      source: 'cli',
      scope: 'link',
      payload: {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: sourceTxFingerprint,
        target_fingerprint: targetTxFingerprint,
        asset: 'BTC',
        resolved_link_fingerprint: buildResolvedLinkFingerprint({
          sourceAssetId: 'test:btc',
          targetAssetId: 'test:btc',
          sourceMovementFingerprint,
          targetMovementFingerprint,
        }),
        source_asset_id: 'test:btc',
        target_asset_id: 'test:btc',
        source_movement_fingerprint: sourceMovementFingerprint,
        target_movement_fingerprint: targetMovementFingerprint,
        source_amount: '10',
        target_amount: '10',
      },
    };

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

    // Should succeed — the orphaned override is skipped, not a fatal error
    assertOk(result);
  });

  it('skips orphaned override when exact source movement identity no longer resolves', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        platformKind: 'exchange',
        datetime: '2026-02-07T00:00:00Z',
        outflows: [{ assetSymbol: 'USDC', amount: '100' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:ethereum',
        platformKind: 'blockchain',
        datetime: '2026-02-07T01:00:00Z',
        inflows: [{ assetSymbol: 'USDC', amount: '101' }],
      }),
    ];
    const sourceTxFingerprint = transactions[0]!.txFingerprint;
    const targetTxFingerprint = transactions[1]!.txFingerprint;
    const targetMovementFingerprint = requirePresent(
      transactions[1]!.movements.inflows?.[0]?.movementFingerprint,
      'Expected target inflow movement fingerprint'
    );
    const missingSourceMovementFingerprint = `movement:${sourceTxFingerprint}:outflow:9`;

    const linkOverride: OverrideEvent = {
      id: 'evt-orphan-ambiguous-source',
      created_at: '2026-02-07T10:00:00.000Z',
      profile_key: PROFILE_KEY,
      actor: 'cli-user',
      source: 'cli',
      scope: 'link',
      payload: {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: sourceTxFingerprint,
        target_fingerprint: targetTxFingerprint,
        asset: 'USDC',
        resolved_link_fingerprint: buildResolvedLinkFingerprint({
          sourceAssetId: 'test:usdc',
          targetAssetId: 'test:usdc',
          sourceMovementFingerprint: missingSourceMovementFingerprint,
          targetMovementFingerprint,
        }),
        source_asset_id: 'test:usdc',
        target_asset_id: 'test:usdc',
        source_movement_fingerprint: missingSourceMovementFingerprint,
        target_movement_fingerprint: targetMovementFingerprint,
        source_amount: '100',
        target_amount: '101',
      },
    };

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

    assertOk(result);
  });

  describe('projection lifecycle', () => {
    const defaultParams = {
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    };

    it('marks building then fresh on successful run', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          source: 'kraken',
          platformKind: 'exchange',
          datetime: '2026-02-08T00:00:00Z',
          outflows: [{ assetSymbol: 'BTC', amount: '1' }],
        }),
        createTransaction({
          id: 2,
          source: 'blockchain:bitcoin',
          platformKind: 'blockchain',
          datetime: '2026-02-08T01:00:00Z',
          inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
        }),
      ];

      const store = createMockStore({
        loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
      });

      const handler = new LinkingOrchestrator(store);
      assertOk(await handler.execute(defaultParams));

      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksBuilding).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFresh).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFailed).not.toHaveBeenCalled();
    });

    it('marks fresh on empty transactions (not stuck in building)', async () => {
      const store = createMockStore();

      const handler = new LinkingOrchestrator(store);
      assertOk(await handler.execute(defaultParams));

      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksBuilding).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFresh).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFailed).not.toHaveBeenCalled();
    });

    it('marks failed when transaction persistence fails', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          source: 'kraken',
          platformKind: 'exchange',
          datetime: '2026-02-08T00:00:00Z',
          outflows: [{ assetSymbol: 'BTC', amount: '1' }],
        }),
        createTransaction({
          id: 2,
          source: 'blockchain:bitcoin',
          platformKind: 'blockchain',
          datetime: '2026-02-08T01:00:00Z',
          inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
        }),
      ];

      const store = createMockStore({
        loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
        replaceLinks: vi.fn().mockResolvedValue(err(new Error('db write failed'))),
      });

      const handler = new LinkingOrchestrator(store);
      assertErr(await handler.execute(defaultParams));

      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksBuilding).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFailed).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFresh).not.toHaveBeenCalled();
    });

    it('marks fresh even when zero links are saved (all rejected by overrides)', async () => {
      const transactions = [
        createTransaction({
          id: 1,
          accountId: 1,
          source: 'blockchain:ethereum',
          platformKind: 'blockchain',
          datetime: '2026-02-07T00:00:00Z',
          outflows: [{ assetSymbol: 'ETH', amount: '1' }],
          blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
        }),
        createTransaction({
          id: 2,
          accountId: 2,
          source: 'blockchain:ethereum',
          platformKind: 'blockchain',
          datetime: '2026-02-07T00:00:00Z',
          inflows: [{ assetSymbol: 'ETH', amount: '1' }],
          blockchain: { name: 'ethereum', transaction_hash: '0xaaa111', is_confirmed: true },
        }),
      ];
      const sourceMovementFingerprint = requirePresent(
        transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
        'Expected source outflow movement fingerprint'
      );
      const targetMovementFingerprint = requirePresent(
        transactions[1]!.movements.inflows?.[0]?.movementFingerprint,
        'Expected target inflow movement fingerprint'
      );

      const unlinkEvent: OverrideEvent = {
        id: 'evt-1',
        created_at: '2026-02-07T10:00:00.000Z',
        profile_key: PROFILE_KEY,
        actor: 'cli-user',
        source: 'cli',
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          resolved_link_fingerprint: buildResolvedLinkFingerprint({
            sourceAssetId: 'test:eth',
            targetAssetId: 'test:eth',
            sourceMovementFingerprint,
            targetMovementFingerprint,
          }),
        },
      };

      const store = createMockStore({
        loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
      });

      const handler = new LinkingOrchestrator(store);
      const result = assertOk(await handler.execute(defaultParams, [unlinkEvent]));

      expect(result.totalSaved).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksBuilding).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFresh).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
      expect(store.markLinksFailed).not.toHaveBeenCalled();
    });
  });

  it('skips orphaned override when exact target movement identity no longer resolves', async () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        platformKind: 'exchange',
        datetime: '2026-02-07T00:00:00Z',
        outflows: [{ assetSymbol: 'USDC', amount: '100' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:ethereum',
        platformKind: 'blockchain',
        datetime: '2026-02-07T01:00:00Z',
        inflows: [{ assetSymbol: 'USDC', amount: '99' }],
      }),
    ];
    const sourceTxFingerprint = transactions[0]!.txFingerprint;
    const targetTxFingerprint = transactions[1]!.txFingerprint;
    const sourceMovementFingerprint = requirePresent(
      transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
      'Expected source outflow movement fingerprint'
    );
    const missingTargetMovementFingerprint = `movement:${targetTxFingerprint}:inflow:9`;

    const linkOverride: OverrideEvent = {
      id: 'evt-orphan-ambiguous-target',
      created_at: '2026-02-07T10:00:00.000Z',
      profile_key: PROFILE_KEY,
      actor: 'cli-user',
      source: 'cli',
      scope: 'link',
      payload: {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: sourceTxFingerprint,
        target_fingerprint: targetTxFingerprint,
        asset: 'USDC',
        resolved_link_fingerprint: buildResolvedLinkFingerprint({
          sourceAssetId: 'test:usdc',
          targetAssetId: 'test:usdc',
          sourceMovementFingerprint,
          targetMovementFingerprint: missingTargetMovementFingerprint,
        }),
        source_asset_id: 'test:usdc',
        target_asset_id: 'test:usdc',
        source_movement_fingerprint: sourceMovementFingerprint,
        target_movement_fingerprint: missingTargetMovementFingerprint,
        source_amount: '100',
        target_amount: '99',
      },
    };

    const store = createMockStore({
      loadTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    });

    const handler = new LinkingOrchestrator(store);

    const result = await handler.execute(
      {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      },
      [linkOverride]
    );

    assertOk(result);
  });
});
