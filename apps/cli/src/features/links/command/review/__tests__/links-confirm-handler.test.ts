import type { OverrideStore } from '@exitbook/data/overrides';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConfirmableTransferFixture,
  createMockDataContext,
  createMockLink,
  createMockLinkRepository,
  createMockOverrideStore,
  createMockTransactionObjects,
  createMockTransactionRepository,
} from '../../../__tests__/test-utils.js';
import { LinksReviewHandler, type LinksReviewParams } from '../links-review-handler.js';

const PROFILE_ID = 1;
const PROFILE_KEY = 'default';

describe('LinksConfirmHandler', () => {
  let handler: LinksReviewHandler;
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

    handler = new LinksReviewHandler(mockDb, PROFILE_ID, PROFILE_KEY, mockOverrideStore as unknown as OverrideStore);
  });

  const { source: mockSourceTx, target: mockTargetTx } = createMockTransactionObjects();

  describe('execute', () => {
    it('should successfully confirm a suggested link', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture();
      const suggestedLink = fixture.link;

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      const result = await handler.execute(params, 'confirm');

      const confirmResult = assertOk(result);
      expect(confirmResult.linkId).toBe(123);
      expect(confirmResult.affectedLinkCount).toBe(1);
      expect(confirmResult.affectedLinkIds).toEqual([123]);
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');
      expect(confirmResult.reviewedAt).toBeInstanceOf(Date);

      expect(mockLinkRepository.findById).toHaveBeenCalledWith(123, PROFILE_ID);
      expect(mockLinkRepository.updateStatuses).toHaveBeenCalledWith([123], 'confirmed', 'cli-user', expect.any(Map));
    });

    it('should write link_override event after successful confirm', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture();
      const suggestedLink = fixture.link;
      const expectedResolvedLinkFingerprint =
        `resolved-link:v1:${suggestedLink.sourceMovementFingerprint}:${suggestedLink.targetMovementFingerprint}:` +
        `${suggestedLink.sourceAssetId}:${suggestedLink.targetAssetId}`;

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });

      await handler.execute(params, 'confirm');

      const appendCall = mockOverrideStore.append.mock.calls[0] as [unknown] | undefined;
      expect(appendCall).toBeDefined();
      expect(appendCall?.[0]).toMatchObject({
        scope: 'link',
        payload: {
          type: 'link_override',
          action: 'confirm',
          link_type: 'transfer',
          source_fingerprint: 'txfp:kraken:1:WITHDRAWAL-123',
          target_fingerprint: 'txfp:bitcoin:2:abc123',
          asset: 'BTC',
          resolved_link_fingerprint: expectedResolvedLinkFingerprint,
          source_asset_id: 'exchange:source:btc',
          target_asset_id: 'blockchain:target:btc',
          source_movement_fingerprint: suggestedLink.sourceMovementFingerprint,
          target_movement_fingerprint: suggestedLink.targetMovementFingerprint,
          source_amount: '1',
          target_amount: '1',
        },
      });
    });

    it('should not fail if override store write fails', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture();
      const suggestedLink = fixture.link;

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));
      mockTransactionRepository.findById.mockImplementation((id: number) => {
        if (id === 1) return Promise.resolve(ok(mockSourceTx));
        if (id === 2) return Promise.resolve(ok(mockTargetTx));
        return Promise.resolve(ok(undefined));
      });
      mockOverrideStore.append.mockResolvedValue(err(new Error('Write failed')));

      const result = await handler.execute(params, 'confirm');

      expect(result.isOk()).toBe(true);
    });

    it('should handle already confirmed link (idempotent)', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const confirmedLink = createMockLink(123, {
        status: 'confirmed',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([confirmedLink]));

      const result = await handler.execute(params, 'confirm');

      const confirmResult = assertOk(result);
      expect(confirmResult.linkId).toBe(123);
      expect(confirmResult.newStatus).toBe('confirmed');
      expect(confirmResult.reviewedBy).toBe('cli-user');
      expect(mockLinkRepository.updateStatuses).not.toHaveBeenCalled();
      expect(mockOverrideStore.append).not.toHaveBeenCalled();
    });

    it('should reject confirming a rejected link', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const rejectedLink = createMockLink(123, {
        status: 'rejected',
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
      });

      mockLinkRepository.findById.mockResolvedValue(ok(rejectedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([rejectedLink]));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toContain('contains rejected links');
      expect(mockLinkRepository.updateStatuses).not.toHaveBeenCalled();
    });

    it('should confirm only actionable proposal legs when the selected leg is already confirmed', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture({
        sourceAmount: '5',
        targetAmount: '10',
      });
      const confirmedLink = {
        ...fixture.link,
        id: 123,
        status: 'confirmed' as const,
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
        targetAmount: fixture.link.sourceAmount,
        metadata: {
          partialMatch: true as const,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      };
      const suggestedLink = {
        ...fixture.link,
        id: 124,
        sourceTransactionId: 3,
        sourceMovementFingerprint: 'movement:txfp:kraken:1:WITHDRAWAL-456:outflow:0',
        sourceAmount: fixture.link.sourceAmount,
        targetAmount: fixture.link.sourceAmount,
        metadata: {
          partialMatch: true as const,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      };
      const additionalSourceTx = {
        ...fixture.sourceTransaction,
        id: 3,
        txFingerprint: 'txfp:kraken:1:WITHDRAWAL-456',
        movements: {
          inflows: fixture.sourceTransaction.movements.inflows,
          outflows: [
            {
              ...fixture.sourceTransaction.movements.outflows?.[0],
              movementFingerprint: 'movement:txfp:kraken:1:WITHDRAWAL-456:outflow:0',
            },
          ],
        },
      };

      mockLinkRepository.findById.mockResolvedValue(ok(confirmedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([confirmedLink, suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(1));
      mockTransactionRepository.findAll.mockResolvedValue(
        ok([fixture.sourceTransaction, additionalSourceTx, fixture.targetTransaction])
      );
      mockTransactionRepository.findById.mockImplementation((id: number) => {
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

      const result = await handler.execute(params, 'confirm');

      const confirmResult = assertOk(result);
      expect(confirmResult.affectedLinkIds).toEqual([124]);
      expect(confirmResult.affectedLinkCount).toBe(1);
      expect(mockLinkRepository.updateStatuses).toHaveBeenCalledWith([124], 'confirmed', 'cli-user', expect.any(Map));
      expect(mockOverrideStore.append).toHaveBeenCalledTimes(1);
    });

    it('should return error if link not found', async () => {
      const params: LinksReviewParams = {
        linkId: 999,
      };

      mockLinkRepository.findById.mockResolvedValue(ok(undefined));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toContain('not found');
      expect(mockLinkRepository.updateStatuses).not.toHaveBeenCalled();
    });

    it('should return error if findById fails', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toBe('Database error');
      expect(mockLinkRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should return error if updateStatus fails', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture();
      const suggestedLink = fixture.link;

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(err(new Error('Update failed')));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toBe('Update failed');
    });

    it('should return error if updateStatus returns false', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture();
      const suggestedLink = fixture.link;

      mockLinkRepository.findById.mockResolvedValue(ok(suggestedLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([suggestedLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(0));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toContain('Failed to update transfer proposal');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      mockLinkRepository.findById.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toContain('Unexpected error');
    });

    it('should reject confirming a partial link that does not fully reconcile the target movement', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture({
        sourceAmount: '4',
        targetAmount: '10',
      });
      const partialLink = {
        ...fixture.link,
        sourceAmount: fixture.link.sourceAmount,
        targetAmount: fixture.link.sourceAmount,
        metadata: {
          partialMatch: true as const,
          fullSourceAmount: '4',
          fullTargetAmount: '10',
          consumedAmount: '4',
        },
      };

      mockLinkRepository.findById.mockResolvedValue(ok(partialLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([partialLink]));
      mockTransactionRepository.findAll.mockResolvedValue(ok(fixture.transactions));

      const result = await handler.execute(params, 'confirm');

      const error = assertErr(result);
      expect(error.message).toContain('cannot be confirmed');
      expect(error.message).toContain('does not reconcile with accounting movement amount');
      expect(mockLinkRepository.updateStatuses).not.toHaveBeenCalled();
    });

    it('should confirm all related proposal legs together', async () => {
      const params: LinksReviewParams = {
        linkId: 123,
      };

      const fixture = createConfirmableTransferFixture({
        sourceAmount: '5',
        targetAmount: '10',
      });
      const firstLink = {
        ...fixture.link,
        id: 123,
        sourceAmount: fixture.link.sourceAmount,
        targetAmount: fixture.link.sourceAmount,
        metadata: {
          partialMatch: true as const,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      };
      const secondLink = {
        ...fixture.link,
        id: 124,
        sourceTransactionId: 3,
        sourceMovementFingerprint: 'movement:txfp:kraken:1:WITHDRAWAL-456:outflow:0',
        sourceAmount: fixture.link.sourceAmount,
        targetAmount: fixture.link.sourceAmount,
        metadata: {
          partialMatch: true as const,
          fullSourceAmount: '5',
          fullTargetAmount: '10',
          consumedAmount: '5',
          transferProposalKey: 'partial-target:v1:target',
        },
      };
      const additionalSourceTx = {
        ...fixture.sourceTransaction,
        id: 3,
        txFingerprint: 'txfp:kraken:1:WITHDRAWAL-456',
        movements: {
          inflows: fixture.sourceTransaction.movements.inflows,
          outflows: [
            {
              ...fixture.sourceTransaction.movements.outflows?.[0],
              movementFingerprint: 'movement:txfp:kraken:1:WITHDRAWAL-456:outflow:0',
            },
          ],
        },
      };

      mockLinkRepository.findById.mockResolvedValue(ok(firstLink));
      mockLinkRepository.findAll.mockResolvedValue(ok([firstLink, secondLink]));
      mockLinkRepository.updateStatuses.mockResolvedValue(ok(2));
      mockTransactionRepository.findAll.mockResolvedValue(
        ok([fixture.sourceTransaction, additionalSourceTx, fixture.targetTransaction])
      );
      mockTransactionRepository.findById.mockImplementation((id: number) => {
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

      const result = await handler.execute(params, 'confirm');

      const confirmResult = assertOk(result);
      expect(confirmResult.affectedLinkIds).toEqual([123, 124]);
      expect(confirmResult.affectedLinkCount).toBe(2);
      expect(mockLinkRepository.updateStatuses).toHaveBeenCalledWith(
        [123, 124],
        'confirmed',
        'cli-user',
        expect.any(Map)
      );
      expect(mockOverrideStore.append).toHaveBeenCalledTimes(2);
    });
  });
});
