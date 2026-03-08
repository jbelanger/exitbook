import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { OverrideStore } from '@exitbook/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinksConfirmHandler } from '../links-confirm-handler.js';
import type { LinksConfirmParams } from '../links-confirm-handler.js';

import {
  createMockDataContext,
  createMockLink,
  createMockLinkRepository,
  createMockOverrideStore,
  createMockTransactionObjects,
  createMockTransactionRepository,
} from './test-utils.js';

describe('LinksConfirmHandler', () => {
  let handler: LinksConfirmHandler;
  let mockLinkRepository: ReturnType<typeof createMockLinkRepository>;
  let mockTransactionRepository: ReturnType<typeof createMockTransactionRepository>;
  let mockOverrideStore: ReturnType<typeof createMockOverrideStore>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLinkRepository = createMockLinkRepository();
    mockTransactionRepository = createMockTransactionRepository();
    mockOverrideStore = createMockOverrideStore();

    const mockDb = createMockDataContext({
      transactionLinks: mockLinkRepository,
      transactions: mockTransactionRepository,
    });

    handler = new LinksConfirmHandler(mockDb, mockOverrideStore as unknown as OverrideStore);
  });

  const { source: mockSourceTx, target: mockTargetTx } = createMockTransactionObjects();

  describe('execute', () => {
    it('should successfully confirm a suggested link', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(true));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      const confirmResult = assertOk(result);
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

      const suggestedLink = createMockLink(123, { status: 'suggested' });

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

      const suggestedLink = createMockLink(123, { status: 'suggested' });

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

      const confirmedLink = createMockLink(123, {
        status: 'confirmed',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));

      const result = await handler.execute(params);

      const confirmResult = assertOk(result);
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

      const rejectedLink = createMockLink(123, {
        status: 'rejected',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkRepository.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('previously rejected');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if link not found', async () => {
      const params: LinksConfirmParams = {
        linkId: 999,
      };

      mockLinkRepository.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('not found');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Database error');

      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(err(new Error('Update failed')));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.updateStatus.mockResolvedValue(ok(false));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('Failed to update link');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksConfirmParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Unexpected error');
    });
  });
});
