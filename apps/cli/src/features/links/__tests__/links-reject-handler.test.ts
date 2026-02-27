import { type TransactionLink } from '@exitbook/accounting';
import { parseDecimal, type Currency } from '@exitbook/core';
import { createTransactionLinkQueries, createTransactionQueries, type OverrideStore } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinksRejectHandler } from '../links-reject-handler.js';
import type { LinksRejectParams } from '../links-reject-handler.js';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    createTransactionQueries: vi.fn(),
    createTransactionLinkQueries: vi.fn(),
  };
});

describe('LinksRejectHandler', () => {
  let mockLinkQueries: {
    findById: Mock;
    updateStatus: Mock;
  };
  let mockTransactionQueries: {
    findById: Mock;
  };
  let mockOverrideStore: {
    append: Mock;
  };
  let handler: LinksRejectHandler;
  const mockDb = {} as ConstructorParameters<typeof LinksRejectHandler>[0];

  beforeEach(() => {
    vi.clearAllMocks();

    mockLinkQueries = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };

    mockTransactionQueries = {
      findById: vi.fn(),
    };

    mockOverrideStore = {
      append: vi.fn().mockResolvedValue(ok({ id: 'test-event-id' })),
    };

    (createTransactionQueries as unknown as Mock).mockReturnValue(mockTransactionQueries);
    (createTransactionLinkQueries as unknown as Mock).mockReturnValue(mockLinkQueries);

    handler = new LinksRejectHandler(mockDb, mockOverrideStore as unknown as OverrideStore);
  });

  const createMockLink = (
    id: number,
    status: 'suggested' | 'confirmed' | 'rejected',
    reviewedBy?: string,
    reviewedAt?: Date
  ): TransactionLink => ({
    id,
    sourceTransactionId: 1,
    targetTransactionId: 2,
    assetSymbol: 'BTC' as Currency,
    sourceAssetId: 'test:btc',
    targetAssetId: 'test:btc',
    sourceAmount: parseDecimal('1.0'),
    targetAmount: parseDecimal('1.0'),
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.85'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status,
    reviewedBy,
    reviewedAt,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    metadata: undefined,
  });

  const mockSourceTx = {
    id: 1,
    source: 'kraken',
    externalId: 'WITHDRAWAL-123',
  };

  const mockTargetTx = {
    id: 2,
    source: 'blockchain:bitcoin',
    externalId: 'abc123',
  };

  describe('execute', () => {
    it('should successfully reject a suggested link', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(ok(true));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(rejectResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkQueries.findById).toHaveBeenCalledWith('link-123');
      expect(mockLinkQueries.updateStatus).toHaveBeenCalledWith('link-123', 'rejected', 'cli-user');
    });

    it('should write unlink_override event after successful reject', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(ok(true));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      await handler.execute(params);

      // Sorted fingerprints: blockchain:bitcoin:abc123 < kraken:WITHDRAWAL-123
      expect(mockOverrideStore.append).toHaveBeenCalledWith({
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          link_fingerprint: 'link:blockchain:bitcoin:abc123:kraken:WITHDRAWAL-123:BTC',
        },
      });
    });

    it('should not fail if override store write fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(ok(true));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });
      mockOverrideStore.append.mockResolvedValue(err(new Error('Write failed')));

      const result = await handler.execute(params);

      // Command should still succeed even if override write fails
      expect(result.isOk()).toBe(true);
    });

    it('should handle already rejected link (idempotent)', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const rejectedLink = createMockLink(123, 'rejected', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkQueries.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      // Should not call updateStatus for already rejected links
      expect(mockLinkQueries.updateStatus).not.toHaveBeenCalled();
      // Should not write override for idempotent no-op
      expect(mockOverrideStore.append).not.toHaveBeenCalled();
    });

    it('should successfully reject a confirmed link (override auto-confirmation)', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const confirmedLink = createMockLink(123, 'confirmed', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkQueries.findById.mockResolvedValue(ok(confirmedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(ok(true));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      expect(mockLinkQueries.updateStatus).toHaveBeenCalledWith('link-123', 'rejected', 'cli-user');
    });

    it('should return error if link not found', async () => {
      const params: LinksRejectParams = {
        linkId: 999,
      };

      mockLinkQueries.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');

      expect(mockLinkQueries.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');

      expect(mockLinkQueries.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(err(new Error('Update failed')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.updateStatus.mockResolvedValue(ok(false));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to update link');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });
  });
});
