import type { TransactionLink } from '@exitbook/accounting';
import { TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinksConfirmHandler } from '../links-confirm-handler.ts';
import type { LinksConfirmParams } from '../links-confirm-handler.ts';

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

describe('LinksConfirmHandler', () => {
  let mockLinkRepository: {
    findById: Mock;
    updateStatus: Mock;
  };
  let mockTransactionRepository: Record<string, never>;
  let handler: LinksConfirmHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock link repository
    mockLinkRepository = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };

    // Mock transaction repository (not used in confirm, but required by constructor)
    mockTransactionRepository = {};

    // Setup mocks

    (TransactionRepository as unknown as Mock).mockImplementation(() => mockTransactionRepository);

    (TransactionLinkRepository as unknown as Mock).mockImplementation(() => mockLinkRepository);

    handler = new LinksConfirmHandler(
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
    it('should successfully confirm a suggested link', async () => {
      const params: LinksConfirmParams = {
        linkId: 'link-123',
      };

      const suggestedLink = createMockLink('link-123', 'suggested');

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const confirmResult = result._unsafeUnwrap();
      expect(confirmResult.linkId).toBe('link-123');
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');
      expect(confirmResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkRepository.findById).toHaveBeenCalledWith('link-123');
      expect(mockLinkRepository.updateStatus).toHaveBeenCalledWith('link-123', 'confirmed', 'cli-user');
    });

    it('should handle already confirmed link (idempotent)', async () => {
      const params: LinksConfirmParams = {
        linkId: 'link-123',
      };

      const confirmedLink = createMockLink('link-123', 'confirmed', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const confirmResult = result._unsafeUnwrap();
      expect(confirmResult.linkId).toBe('link-123');
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');

      // Should not call updateStatus for already confirmed links
      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should reject confirming a rejected link', async () => {
      const params: LinksConfirmParams = {
        linkId: 'link-123',
      };

      const rejectedLink = createMockLink('link-123', 'rejected', 'cli-user', new Date('2024-01-02T12:00:00Z'));

      mockLinkRepository.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('previously rejected');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if link not found', async () => {
      const params: LinksConfirmParams = {
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
      const params: LinksConfirmParams = {
        linkId: 'link-123',
      };

      mockLinkRepository.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksConfirmParams = {
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
      const params: LinksConfirmParams = {
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
      const params: LinksConfirmParams = {
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
