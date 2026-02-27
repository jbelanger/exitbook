import { type TransactionLink } from '@exitbook/accounting';
import { parseDecimal, type Currency } from '@exitbook/core';
import { createTransactionLinkQueries, createTransactionQueries, type OverrideStore } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinksConfirmHandler } from '../links-confirm-handler.js';
import type { LinksConfirmParams } from '../links-confirm-handler.js';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    createTransactionQueries: vi.fn(),
    createTransactionLinkQueries: vi.fn(),
  };
});

describe('LinksConfirmHandler', () => {
  let mockLinkRepository: {
    findById: Mock;
    updateStatus: Mock;
  };
  let mockTransactionRepository: {
    findById: Mock;
  };
  let mockOverrideStore: {
    append: Mock;
  };
  let handler: LinksConfirmHandler;
  const mockDb = {} as ConstructorParameters<typeof LinksConfirmHandler>[0];

  beforeEach(() => {
    vi.clearAllMocks();

    mockLinkRepository = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };

    mockTransactionRepository = {
      findById: vi.fn(),
    };

    mockOverrideStore = {
      append: vi.fn().mockResolvedValue(ok({ id: 'test-event-id' })),
    };

    (createTransactionQueries as unknown as Mock).mockReturnValue(mockTransactionRepository);
    (createTransactionLinkQueries as unknown as Mock).mockReturnValue(mockLinkRepository);

    handler = new LinksConfirmHandler(mockDb, mockOverrideStore as unknown as OverrideStore);
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
    it('should successfully confirm a suggested link', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const confirmResult = result._unsafeUnwrap();
      expect(confirmResult.linkId).toBe(123);
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');
      expect(confirmResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkRepository.findById).toHaveBeenCalledWith(123);
      expect(mockLinkRepository.updateStatus).toHaveBeenCalledWith(123, 'confirmed', 'cli-user');
    });

    it('should write link_override event after successful confirm', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      await handler.execute(params);

      expect(mockOverrideStore.append).toHaveBeenCalledWith({
        scope: 'link',
        payload: {
          type: 'link_override',
          action: 'confirm',
          link_type: 'transfer',
          source_fingerprint: 'kraken:WITHDRAWAL-123',
          target_fingerprint: 'blockchain:bitcoin:abc123',
          asset: 'BTC',
        },
      });
    });

    it('should not fail if override store write fails', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });
      mockOverrideStore.append.mockResolvedValue(err(new Error('Write failed')));

      const result = await handler.execute(params);

      // Command should still succeed even if override write fails
      expect(result.isOk()).toBe(true);
    });

    it('should handle already confirmed link (idempotent)', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const confirmedLink = createMockLink(123, 'confirmed', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const confirmResult = result._unsafeUnwrap();
      expect(confirmResult.linkId).toBe(123);
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');

      // Should not call updateStatus for already confirmed links
      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
      // Should not write override for idempotent no-op
      expect(mockOverrideStore.append).not.toHaveBeenCalled();
    });

    it('should reject confirming a rejected link', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const rejectedLink = createMockLink(123, 'rejected', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('previously rejected');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if link not found', async () => {
      const params: LinksConfirmParams = {
        linkId: 999,
      };

      mockLinkRepository.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(err(new Error('Update failed')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(false));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to update link');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });
  });
});
