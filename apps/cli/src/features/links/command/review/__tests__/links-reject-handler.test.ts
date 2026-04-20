import type { OverrideStore } from '@exitbook/data/overrides';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockLinkRepository,
  createMockTransactionRepository,
  createMockOverrideStore,
  createMockDataContext,
  createMockTransactionObjects,
  createMockLink,
} from '../../../__tests__/test-utils.ts';
import { LinksReviewHandler, type LinksReviewParams } from '../links-review-handler.js';

const PROFILE_ID = 1;
const PROFILE_KEY = 'default';

describe('LinksRejectHandler', () => {
  let handler: LinksReviewHandler;
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

    handler = new LinksReviewHandler(mockDb, PROFILE_ID, PROFILE_KEY, mockOverrideStore as unknown as OverrideStore);
  });

  const { source: mockSourceTx, target: mockTargetTx } = createMockTransactionObjects();

  describe('execute', () => {
    it('should successfully reject a suggested link', async () => {
      const params: LinksReviewParams = {
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

      const result = await handler.execute(params, 'reject');

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.affectedLinkCount).toBe(1);
      expect(rejectResult.affectedLinkIds).toEqual([123]);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(rejectResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkQueries.findById).toHaveBeenCalledWith(123, PROFILE_ID);
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123], 'rejected', 'cli-user', expect.any(Map));
    });

    it('should write unlink_override event batch before rejecting statuses', async () => {
      const params: LinksReviewParams = {
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

      await handler.execute(params, 'reject');

      const appendCall = mockOverrideStore.appendMany.mock.calls[0] as [unknown] | undefined;
      expect(appendCall).toBeDefined();

      expect(appendCall?.[0]).toEqual([
        expect.objectContaining({
          scope: 'unlink',
          payload: {
            type: 'unlink_override',
            resolved_link_fingerprint:
              'resolved-link:v1:movement:exchange:source:1:btc:outflow:0:movement:blockchain:target:2:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
          },
        }),
      ]);
      expect(mockLinkQueries.updateStatuses.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockOverrideStore.appendMany.mock.invocationCallOrder[0] ?? 0
      );
    });

    it('should fail before updating statuses when override batch write fails', async () => {
      const params: LinksReviewParams = {
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
      mockOverrideStore.appendMany.mockResolvedValue(err(new Error('Write failed')));

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toContain(
        'Failed to write transfer proposal override events before updating reviewed statuses'
      );
      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
    });

    it('should handle already rejected link (idempotent)', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const rejectedLink = createMockLink(123, {
        status: 'rejected',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkQueries.findById.mockResolvedValue(ok(rejectedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([rejectedLink]));

      const result = await handler.execute(params, 'reject');

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
      expect(mockOverrideStore.append).not.toHaveBeenCalled();
    });

    it('should reject only actionable proposal legs when the selected leg is already rejected', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const rejectedLink = createMockLink(123, {
        status: 'rejected',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
        metadata: {
          partialMatch: true,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      });
      const suggestedLink = createMockLink(124, {
        sourceTransactionId: 3,
        status: 'suggested',
        sourceMovementFingerprint: 'movement:exchange:source:3:btc:outflow:0',
        metadata: {
          partialMatch: true,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      });

      mockLinkQueries.findById.mockResolvedValue(ok(rejectedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([rejectedLink, suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        if (id === 3) {
          return Promise.resolve(
            ok({
              ...mockSourceTx,
              id: 3,
              txFingerprint: 'txfp:kraken:1:WITHDRAWAL-456',
            })
          );
        }
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params, 'reject');

      const rejectResult = assertOk(result);
      expect(rejectResult.affectedLinkIds).toEqual([124]);
      expect(rejectResult.affectedLinkCount).toBe(1);
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([124], 'rejected', 'cli-user', expect.any(Map));
      expect(mockOverrideStore.appendMany).toHaveBeenCalledTimes(1);
    });

    it('should successfully reject a confirmed link (override auto-confirmation)', async () => {
      const params: LinksReviewParams = {
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

      const result = await handler.execute(params, 'reject');

      const rejectResult = assertOk(result);
      expect(rejectResult.linkId).toBe(123);
      expect(rejectResult.newStatus).toBe('rejected');
      expect(rejectResult.reviewedBy).toBe('cli-user');
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123], 'rejected', 'cli-user', expect.any(Map));
    });

    it('should return error if link not found', async () => {
      const params: LinksReviewParams = {
        linkId: 999,
      };

      mockLinkQueries.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toContain('not found');
      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toBe('Database error');
      expect(mockLinkQueries.updateStatuses).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(err(new Error('Update failed')));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toContain('Update failed');
      expect(error.message).toContain('rerun "links run" to rematerialize the reviewed transfer proposal state');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const suggestedLink = createMockLink(123, { status: 'suggested' });

      mockLinkQueries.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkQueries.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkQueries.updateStatuses.mockResolvedValue(ok(0));
      mockTransactionQueries.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toContain('Failed to update transfer proposal');
      expect(error.message).toContain('rerun "links run" to rematerialize the reviewed transfer proposal state');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      mockLinkQueries.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params, 'reject');

      const error = assertErr(result);
      expect(error.message).toContain('Unexpected error');
    });

    it('should reject all related proposal legs together', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const firstLink = createMockLink(123, {
        status: 'suggested',
        metadata: {
          partialMatch: true,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
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
          transferProposalKey: 'partial-target:v1:target',
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
              txFingerprint: 'txfp:kraken:1:WITHDRAWAL-456',
            })
          );
        }
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params, 'reject');

      const rejectResult = assertOk(result);
      expect(rejectResult.affectedLinkIds).toEqual([123, 124]);
      expect(rejectResult.affectedLinkCount).toBe(2);
      expect(mockLinkQueries.updateStatuses).toHaveBeenCalledWith([123, 124], 'rejected', 'cli-user', expect.any(Map));
      expect(mockOverrideStore.appendMany).toHaveBeenCalledTimes(1);
    });
  });
});
