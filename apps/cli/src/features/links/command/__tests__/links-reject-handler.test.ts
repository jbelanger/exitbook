import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { OverrideStore } from '@exitbook/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockLinkRepository,
  createMockTransactionRepository,
  createMockOverrideStore,
  createMockDataContext,
  createMockTransactionObjects,
  createMockLink,
} from '../../__tests__/test-utils.ts';
import { LinksRejectHandler, type LinksRejectParams } from '../links-reject-handler.ts';

describe('LinksRejectHandler', () => {
  let handler: LinksRejectHandler;
  let mockLinkQueries: ReturnType<typeof createMockLinkRepository>;
  let mockTransactionQueries: ReturnType<typeof createMockTransactionRepository>;
  let mockOverrideStore: ReturnType<typeof createMockOverrideStore>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLinkQueries = createMockLinkRepository();
    mockTransactionQueries = createMockTransactionRepository();
    mockOverrideStore = createMockOverrideStore();

    const mockDb = createMockDataContext({
      transactionLinks: mockLinkQueries,
      transactions: mockTransactionQueries,
    });

    handler = new LinksRejectHandler(mockDb, mockOverrideStore as unknown as OverrideStore);
  });

  const { source: mockSourceTx, target: mockTargetTx } = createMockTransactionObjects();

  describe('execute', () => {
    it('should successfully reject a suggested link', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.affectedLinkCount).toBe(1);
      expect(rejectResult.affectedLinkIds).toEqual([123]);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(rejectResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkQueries.findById).toHaveBeenCalledWith(123);
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123], 'rejected', 'cli-user');
    });

    it('should write unlink_override event after successful reject', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      await handler.execute(params);

      const appendCall = mockOverrideStore.append.mock.calls[0] as [unknown] | undefined;
      expect(appendCall).toBeDefined();

      // Unlink payload only stores the resolved link fingerprint, so tx fingerprint sort order is irrelevant here.
      expect(appendCall?.[0]).toMatchObject({
        scope: 'unlink',
        payload: {
          type: 'unlink_override',
          resolved_link_fingerprint:
            'resolved-link:v1:movement:exchange:source:1:btc:outflow:0:movement:blockchain:target:2:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
        },
      });
    });

    it('should not fail if override store write fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(1));
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

      const rejectedLink = createMockLink(123, {
        status: 'rejected',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkQueries.findById.mockResolvedValue(ok(rejectedLink));

      const result = await handler.execute(params);

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      // Should not call updateStatus for already rejected links
      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
      // Should not write override for idempotent no-op
      expect(mockOverrideStore.append).not.toHaveBeenCalled();
    });

    it('should successfully reject a confirmed link (override auto-confirmation)', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const confirmedLink = createMockLink(123, {
        status: 'confirmed',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkQueries.findById.mockResolvedValue(ok(confirmedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([confirmedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');

      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123], 'rejected', 'cli-user');
    });

    it('should return error if link not found', async () => {
      const params: LinksRejectParams = {
        linkId: 999,
      };

      mockLinkQueries.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('not found');

      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Database error');

      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(err(new Error('Update failed')));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(0));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('Failed to update review group');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toBe('Unexpected error');
    });

    it('should reject all related proposal legs together', async () => {
      const params: LinksRejectParams = {
        linkId: 123,
      };

      const firstLink = createMockLink(123, {
        status: 'suggested',
        metadata: {
          partialMatch: true,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          reviewGroupKey: 'partial-target:v1:target',
        },
      });
      const secondLink = createMockLink(124, {
        sourceTransactionId: 3,
        status: 'suggested',
        metadata: {
          partialMatch: true,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          reviewGroupKey: 'partial-target:v1:target',
        },
      });

      mockLinkQueries.findById.mockResolvedValue(ok(firstLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([firstLink, secondLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(2));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        if (id === 3) {
          return Promise.resolve(
            ok({
              ...mockSourceTx,
              id: 3,
              externalId: 'WITHDRAWAL-456',
            })
          );
        }
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params);

      const rejectResult = assertOk(result);
      expect(rejectResult.affectedLinkIds).toEqual([123, 124]);
      expect(rejectResult.affectedLinkCount).toBe(2);
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123, 124], 'rejected', 'cli-user');
      expect(mockOverrideStore.append).toHaveBeenCalledTimes(2);
    });
  });
});
