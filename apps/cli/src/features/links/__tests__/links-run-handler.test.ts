import type { TransactionLink, TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import type { OverrideEvent, OverrideStore, TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

const mockLinkTransactions = vi.fn();

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/accounting')>('@exitbook/accounting');

  class MockTransactionLinkingService {
    linkTransactions = mockLinkTransactions;

    constructor(_logger: unknown, _config: unknown) {
      /* empty */
    }
  }

  return {
    ...actual,
    TransactionLinkingService: MockTransactionLinkingService,
  };
});

import { LinksRunHandler } from '../links-run-handler.js';

describe('LinksRunHandler', () => {
  it('applies unlink overrides to internal links so rejected links do not reappear', async () => {
    const internalLink: TransactionLink = {
      id: 'internal-link-1',
      sourceTransactionId: 1,
      targetTransactionId: 2,
      assetSymbol: 'ETH',
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

    mockLinkTransactions.mockReturnValue(
      ok({
        confirmedLinks: [internalLink],
        suggestedLinks: [],
        totalSourceTransactions: 1,
        totalTargetTransactions: 1,
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
    } as unknown as TransactionRepository;

    const mockCreateBulk = vi.fn().mockResolvedValue(ok(0));
    const linkRepository = {
      countAll: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: mockCreateBulk,
    } as unknown as TransactionLinkRepository;

    const overrideStore = {
      readAll: vi.fn().mockResolvedValue(ok([unlinkEvent])),
    } as unknown as OverrideStore;

    const handler = new LinksRunHandler(transactionRepository, linkRepository, overrideStore);

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
    mockLinkTransactions.mockReturnValue(err(new Error('linking failed')));

    const transactionRepository = {
      getTransactions: vi.fn().mockResolvedValue(ok([{ id: 1, source: 'kraken', externalId: 'tx-1' }])),
    } as unknown as TransactionRepository;

    const linkRepository = {
      countAll: vi.fn().mockResolvedValue(ok(0)),
      deleteAll: vi.fn().mockResolvedValue(ok(undefined)),
      createBulk: vi.fn().mockResolvedValue(ok(0)),
    } as unknown as TransactionLinkRepository;

    const handler = new LinksRunHandler(transactionRepository, linkRepository);
    const result = await handler.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('linking failed');
  });
});
