import { parseDecimal, type Currency } from '@exitbook/core';
import type { OverrideEvent, OverrideStore, TransactionQueries } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TransactionLinkQueries } from '../../persistence/transaction-link-queries.js';
import type { LinkingEvent } from '../linking-events.js';
import { LinkingOrchestrator } from '../linking-orchestrator.js';
import { TransactionLinkingService } from '../transaction-linking-service.js';
import type { TransactionLink } from '../types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LinkingOrchestrator', () => {
  it('applies unlink overrides to internal links so rejected links do not reappear', async () => {
    const internalLink: TransactionLink = {
      id: 'internal-link-1',
      sourceTransactionId: 1,
      targetTransactionId: 2,
      assetSymbol: 'ETH' as Currency,
      sourceAssetId: 'test:eth',
      targetAssetId: 'test:eth',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
      linkType: 'blockchain_internal',
      confidenceScore: parseDecimal('0.99'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1'),
        timingValid: true,
        timingHours: 0,
      },
      status: 'confirmed',
      createdAt: new Date('2026-02-07T00:00:00Z'),
      updatedAt: new Date('2026-02-07T00:00:00Z'),
    };

    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [internalLink],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 2,
        unmatchedSourceCount: 0,
        unmatchedTargetCount: 0,
      })
    );

    const transactions = [
      { id: 1, source: 'blockchain:ethereum', externalId: '0xaaa111' },
      { id: 2, source: 'blockchain:ethereum', externalId: '0xbbb222' },
    ];

    const unlinkEvent: OverrideEvent = {
      id: 'evt-1',
      created_at: '2026-02-07T10:00:00.000Z',
      actor: 'cli-user',
      source: 'cli',
      scope: 'unlink',
      payload: {
        type: 'unlink_override',
        link_fingerprint: 'link:blockchain:ethereum:0xaaa111:blockchain:ethereum:0xbbb222:ETH',
      },
    };

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    } as unknown as TransactionQueries;

    const mockCreateBulk = vi.fn().mockResolvedValue(ok(0));
    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: mockCreateBulk,
    } as unknown as TransactionLinkQueries;

    const overrideStore = {
      readAll: vi.fn().mockResolvedValue(ok([unlinkEvent])),
    } as unknown as OverrideStore;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    expect(value.internalLinksCount).toBe(1);
    expect(value.confirmedLinksCount).toBe(0);
    expect(value.suggestedLinksCount).toBe(0);
    expect(value.totalSaved).toBeUndefined();
    expect(mockCreateBulk).not.toHaveBeenCalled();
  });

  it('returns error when linking service fails', async () => {
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(err(new Error('linking failed')));

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok([{ id: 1, source: 'kraken', externalId: 'tx-1' }])),
    } as unknown as TransactionQueries;

    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: vi.fn().mockResolvedValue(ok(0)),
    } as unknown as TransactionLinkQueries;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository);
    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('linking failed');
  });

  it('emits events during execution when eventBus is provided', async () => {
    const confirmedLink: TransactionLink = {
      id: 'link-1',
      sourceTransactionId: 1,
      targetTransactionId: 2,
      assetSymbol: 'BTC' as Currency,
      sourceAssetId: 'test:btc',
      targetAssetId: 'test:btc',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
      linkType: 'exchange_to_blockchain',
      confidenceScore: parseDecimal('0.98'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1'),
        timingValid: true,
        timingHours: 0.5,
      },
      status: 'confirmed',
      createdAt: new Date('2026-02-08T00:00:00Z'),
      updatedAt: new Date('2026-02-08T00:00:00Z'),
    };

    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [confirmedLink],
        suggestedLinks: [],
        totalSourceTransactions: 2,
        totalTargetTransactions: 3,
        matchedTransactionCount: 3,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 2,
      })
    );

    const transactions = [
      { id: 1, source: 'kraken', externalId: 'tx-1' },
      { id: 2, source: 'blockchain:bitcoin', externalId: 'tx-2' },
      { id: 3, source: 'blockchain:bitcoin', externalId: 'tx-3' },
      { id: 4, source: 'blockchain:bitcoin', externalId: 'tx-4' },
      { id: 5, source: 'blockchain:bitcoin', externalId: 'tx-5' },
    ];

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    } as unknown as TransactionQueries;

    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: vi.fn().mockResolvedValue(ok(1)),
    } as unknown as TransactionLinkQueries;

    const emittedEvents: LinkingEvent[] = [];
    const mockEventBus = {
      emit: vi.fn((event: LinkingEvent) => {
        emittedEvents.push(event);
      }),
      subscribe: vi.fn(),
    } as unknown as EventBus<LinkingEvent>;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, undefined, mockEventBus);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isOk()).toBe(true);

    // Verify event sequence: load fires before match
    expect(emittedEvents).toHaveLength(6);
    expect(emittedEvents[0]).toEqual({ type: 'load.started' });
    expect(emittedEvents[1]).toEqual({ type: 'load.completed', totalTransactions: 5 });
    expect(emittedEvents[2]).toEqual({ type: 'match.started' });
    expect(emittedEvents[3]).toEqual({
      type: 'match.completed',
      sourceCount: 2,
      targetCount: 3,
      internalCount: 0,
      confirmedCount: 1,
      suggestedCount: 0,
    });
    expect(emittedEvents[4]).toEqual({ type: 'save.started' });
    expect(emittedEvents[5]).toEqual({ type: 'save.completed', totalSaved: 1 });
  });

  it('does not emit save events in dry run mode', async () => {
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 1,
      })
    );

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok([{ id: 1, source: 'kraken', externalId: 'tx-1' }])),
    } as unknown as TransactionQueries;

    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: vi.fn(),
    } as unknown as TransactionLinkQueries;

    const emittedEvents: LinkingEvent[] = [];
    const mockEventBus = {
      emit: vi.fn((event: LinkingEvent) => {
        emittedEvents.push(event);
      }),
      subscribe: vi.fn(),
    } as unknown as EventBus<LinkingEvent>;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, undefined, mockEventBus);

    const result = await handler.execute({
      dryRun: true,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isOk()).toBe(true);

    // Should emit load.started, load.completed, match.started, match.completed (no save in dry run)
    expect(emittedEvents).toHaveLength(4);
    expect(emittedEvents[0]!.type).toBe('load.started');
    expect(emittedEvents[1]!.type).toBe('load.completed');
    expect(emittedEvents[2]!.type).toBe('match.started');
    expect(emittedEvents[3]!.type).toBe('match.completed');
    expect(emittedEvents.some((e) => e.type === 'save.started')).toBe(false);
    expect(emittedEvents.some((e) => e.type === 'save.completed')).toBe(false);
  });

  it('returns error when clearing existing links fails', async () => {
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 1,
      })
    );

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok([{ id: 1, source: 'kraken', externalId: 'tx-1' }])),
    } as unknown as TransactionQueries;

    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(2)),
      deleteAll: vi.fn().mockResolvedValue(err(new Error('delete failed'))),
      createBulk: vi.fn(),
    } as unknown as TransactionLinkQueries;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository);
    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('delete failed');
  });

  it('skips orphaned override when assetId cannot be resolved from movements', async () => {
    // Algorithm produces no links
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 1,
      })
    );

    // Transactions have ETH movements only — override references BTC (no match)
    const transactions = [
      {
        id: 1,
        source: 'kraken',
        externalId: 'tx-1',
        movements: {
          outflows: [{ assetId: 'exchange:kraken:eth', assetSymbol: 'ETH', grossAmount: parseDecimal('10') }],
        },
      },
      {
        id: 2,
        source: 'blockchain:bitcoin',
        externalId: 'tx-2',
        movements: {
          inflows: [{ assetId: 'blockchain:bitcoin:eth', assetSymbol: 'ETH', grossAmount: parseDecimal('10') }],
        },
      },
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
        source_fingerprint: 'kraken:tx-1',
        target_fingerprint: 'blockchain:bitcoin:tx-2',
        asset: 'BTC',
      },
    };

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    } as unknown as TransactionQueries;

    const mockCreateBulk = vi.fn().mockResolvedValue(ok(0));
    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: mockCreateBulk,
    } as unknown as TransactionLinkQueries;

    const overrideStore = {
      readAll: vi.fn().mockResolvedValue(ok([linkOverride])),
    } as unknown as OverrideStore;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    // Should succeed — the orphaned override is skipped, not a fatal error
    expect(result.isOk()).toBe(true);

    // No links should have been saved (the orphaned override was rejected)
    expect(mockCreateBulk).not.toHaveBeenCalled();
  });

  it('skips orphaned override when source transaction has ambiguous assetIds for symbol', async () => {
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 1,
      })
    );

    const transactions = [
      {
        id: 1,
        source: 'kraken',
        externalId: 'tx-1',
        movements: {
          outflows: [
            { assetId: 'exchange:kraken:usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('100') },
            { assetId: 'blockchain:ethereum:0xa0b8...usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('1') },
          ],
        },
      },
      {
        id: 2,
        source: 'blockchain:ethereum',
        externalId: 'tx-2',
        movements: {
          inflows: [
            { assetId: 'blockchain:ethereum:0xa0b8...usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('101') },
          ],
        },
      },
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
        source_fingerprint: 'kraken:tx-1',
        target_fingerprint: 'blockchain:ethereum:tx-2',
        asset: 'USDC',
      },
    };

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    } as unknown as TransactionQueries;

    const mockCreateBulk = vi.fn().mockResolvedValue(ok(0));
    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: mockCreateBulk,
    } as unknown as TransactionLinkQueries;

    const overrideStore = {
      readAll: vi.fn().mockResolvedValue(ok([linkOverride])),
    } as unknown as OverrideStore;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isOk()).toBe(true);
    expect(mockCreateBulk).not.toHaveBeenCalled();
  });

  it('skips orphaned override when target transaction has ambiguous assetIds for symbol', async () => {
    vi.spyOn(TransactionLinkingService.prototype, 'linkTransactions').mockReturnValue(
      ok({
        confirmedLinks: [],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 1,
        unmatchedTargetCount: 1,
      })
    );

    const transactions = [
      {
        id: 1,
        source: 'kraken',
        externalId: 'tx-1',
        movements: {
          outflows: [{ assetId: 'exchange:kraken:usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('100') }],
        },
      },
      {
        id: 2,
        source: 'blockchain:ethereum',
        externalId: 'tx-2',
        movements: {
          inflows: [
            { assetId: 'blockchain:ethereum:0xa0b8...usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('99') },
            { assetId: 'blockchain:arbitrum:0xaf88...usdc', assetSymbol: 'USDC', grossAmount: parseDecimal('1') },
          ],
        },
      },
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
        source_fingerprint: 'kraken:tx-1',
        target_fingerprint: 'blockchain:ethereum:tx-2',
        asset: 'USDC',
      },
    };

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok(transactions)),
    } as unknown as TransactionQueries;

    const mockCreateBulk = vi.fn().mockResolvedValue(ok(0));
    const linkRepository = {
      count: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: mockCreateBulk,
    } as unknown as TransactionLinkQueries;

    const overrideStore = {
      readAll: vi.fn().mockResolvedValue(ok([linkOverride])),
    } as unknown as OverrideStore;

    const handler = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore);

    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isOk()).toBe(true);
    expect(mockCreateBulk).not.toHaveBeenCalled();
  });
});
