import { TransactionLinkRepository, type TransactionLink } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinksRejectHandler } from '../links-reject-handler.ts';
import type { LinksRejectParams } from '../links-reject-handler.ts';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    TransactionRepository: vi.fn(),
  };
});

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/accounting')>('@exitbook/accounting');
  return {
    ...actual,
    TransactionLinkRepository: vi.fn(),
  };
});

describe('LinksRejectHandler', () => {
  let mockLinkRepository: {
    findById: Mock;
    updateStatus: Mock;
  };
  let mockTransactionRepository: Record<string, never>;
  let handler: LinksRejectHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock link repository
    mockLinkRepository = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };

    // Mock transaction repository (not used in reject, but required by constructor)
    mockTransactionRepository = {};

    // Setup mocks
    (TransactionRepository as unknown as Mock).mockImplementation(() => mockTransactionRepository);

    (TransactionLinkRepository as unknown as Mock).mockImplementation(() => mockLinkRepository);

    handler = new LinksRejectHandler(
      mockLinkRepository as unknown as TransactionLinkRepository,
      mockTransactionRepository as unknown as TransactionRepository
    );
  });

  const createMockLink = (
    id: string,
    status: 'suggested' | 'confirmed' | 'rejected',
    reviewedBy?: string,
    reviewedAt?: Date
  ): TransactionLink => ({
    id,
    sourceTransactionId: 1,
    targetTransactionId: 2,
    asset: 'BTC',
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

  describe('execute', () => {
    it('should successfully reject a suggested link', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      const suggestedLink = createMockLink('link-123', 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe('link-123');
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(rejectResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkRepository.findById).toHaveBeenCalledWith('link-123');
      expect(mockLinkRepository.updateStatus).toHaveBeenCalledWith('link-123', 'rejected', 'cli-user');
    });

    it('should handle already rejected link (idempotent)', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      const rejectedLink = createMockLink('link-123', 'rejected', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe('link-123');
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      // Should not call updateStatus for already rejected links
      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should successfully reject a confirmed link (override auto-confirmation)', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      const confirmedLink = createMockLink('link-123', 'confirmed', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const rejectResult = result._unsafeUnwrap();
      expect(rejectResult.linkId).toBe('link-123');
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      expect(mockLinkRepository.updateStatus).toHaveBeenCalledWith('link-123', 'rejected', 'cli-user');
    });

    it('should return error if link not found', async () => {
      const params: LinksRejectParams = {
        linkId: 'non-existent-link',
      };

      // eslint-disable-next-line unicorn/no-useless-undefined -- Explicit for clarity
      mockLinkRepository.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      mockLinkRepository.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      const suggestedLink = createMockLink('link-123', 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(err(new Error('Update failed')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      const suggestedLink = createMockLink('link-123', 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(false));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to update link');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksRejectParams = {
        linkId: 'link-123',
      };

      mockLinkRepository.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });
  });

  describe('destroy', () => {
    it('should cleanup resources without errors', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
