/* eslint-disable unicorn/no-null -- db requires explicit null */
import { DEFAULT_MATCHING_CONFIG, type TransactionLink } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import type { KyselyDB, StoredTransaction } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LinkHandler } from '../link-handler.ts';
import type { LinkHandlerParams } from '../link-utils.ts';

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
    TransactionLinkingService: vi.fn(),
  };
});

describe('LinkHandler', () => {
  let mockDatabase: KyselyDB;
  let mockTransactionRepository: {
    getTransactions: Mock;
  };
  let mockLinkRepository: {
    createBulk: Mock;
  };
  let mockLinkingService: {
    linkTransactions: Mock;
  };
  let handler: LinkHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDatabase = {} as KyselyDB;

    // Mock transaction repository
    mockTransactionRepository = {
      getTransactions: vi.fn(),
    };

    // Mock link repository
    mockLinkRepository = {
      createBulk: vi.fn(),
    };

    // Mock linking service
    mockLinkingService = {
      linkTransactions: vi.fn(),
    };

    // Setup mocks
    const { TransactionRepository } = await import('@exitbook/data');
    (TransactionRepository as unknown as Mock).mockImplementation(() => mockTransactionRepository);

    const { TransactionLinkRepository, TransactionLinkingService } = await import('@exitbook/accounting');
    (TransactionLinkRepository as unknown as Mock).mockImplementation(() => mockLinkRepository);
    (TransactionLinkingService as unknown as Mock).mockImplementation(() => mockLinkingService);

    handler = new LinkHandler(mockDatabase);
  });

  const createMockTransaction = (id: number, sourceType: string, operationType: string): StoredTransaction => ({
    id,
    external_id: `ext-${id}`,
    source_id: 'test-source',
    source_type: sourceType as 'exchange' | 'blockchain',
    import_session_id: 123,
    wallet_address_id: null,
    operation_category: 'transfer',
    operation_type: operationType as 'withdrawal' | 'deposit',
    transaction_datetime: '2024-01-01T12:00:00Z',
    transaction_status: 'confirmed',
    from_address: null,
    to_address: 'bc1q...',
    movements_inflows: operationType === 'withdrawal' ? [] : [{ asset: 'BTC', amount: parseDecimal('1.0') }],
    movements_outflows: operationType === 'withdrawal' ? [{ asset: 'BTC', amount: parseDecimal('1.0') }] : [],
    fees_total: null,
    fees_network: null,
    fees_platform: null,
    price: null,
    price_currency: null,
    note_type: null,
    note_severity: null,
    note_message: null,
    note_metadata: null,
    raw_normalized_data: '{}',
    blockchain_name: operationType === 'deposit' ? 'bitcoin' : null,
    blockchain_block_height: null,
    blockchain_transaction_hash: null,
    blockchain_is_confirmed: null,
    verified: false,
    created_at: '2024-01-01T12:00:00Z',
    updated_at: '2024-01-01T12:00:00Z',
  });

  const createMockLink = (sourceId: number, targetId: number, confidence: string): TransactionLink => ({
    id: `link-${sourceId}-${targetId}`,
    sourceTransactionId: sourceId,
    targetTransactionId: targetId,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal(confidence),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status: 'confirmed',
    reviewedBy: undefined,
    reviewedAt: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: undefined,
  });

  describe('execute', () => {
    it('should use correct minAmountSimilarity (0.95) independent of minConfidenceScore', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'), // Different from minAmountSimilarity
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'blockchain', 'deposit'),
      ];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks: [],
          suggestedLinks: [],
          totalSourceTransactions: 1,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
        })
      );

      await handler.execute(params);

      // Verify TransactionLinkingService was instantiated with correct config
      const { TransactionLinkingService } = await import('@exitbook/accounting');
      expect(TransactionLinkingService).toHaveBeenCalledWith(expect.anything(), {
        maxTimingWindowHours: 48,
        minAmountSimilarity: DEFAULT_MATCHING_CONFIG.minAmountSimilarity, // Should be 0.95
        minConfidenceScore: params.minConfidenceScore, // Should be 0.7
        autoConfirmThreshold: params.autoConfirmThreshold,
      });

      // Verify minAmountSimilarity is NOT set to minConfidenceScore
      const constructorCalls: unknown[][] = (TransactionLinkingService as unknown as Mock).mock.calls;
      expect(constructorCalls.length).toBeGreaterThan(0);
      const config = constructorCalls[0]?.[1] as typeof DEFAULT_MATCHING_CONFIG;
      expect(config).toBeDefined();
      expect(config.minAmountSimilarity.toString()).toBe('0.95');
      expect(config.minAmountSimilarity.toString()).not.toBe(params.minConfidenceScore.toString());
    });

    it('should successfully link transactions and save to database', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'blockchain', 'deposit'),
      ];

      const confirmedLinks = [createMockLink(1, 2, '0.98')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks,
          suggestedLinks: [],
          totalSourceTransactions: 1,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
        })
      );
      mockLinkRepository.createBulk.mockResolvedValue(ok(1));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const linkResult = result._unsafeUnwrap();
      expect(linkResult.confirmedLinksCount).toBe(1);
      expect(linkResult.suggestedLinksCount).toBe(0);
      expect(linkResult.totalSourceTransactions).toBe(1);
      expect(linkResult.totalTargetTransactions).toBe(1);
      expect(linkResult.unmatchedSourceCount).toBe(0);
      expect(linkResult.unmatchedTargetCount).toBe(0);
      expect(linkResult.dryRun).toBe(false);

      expect(mockTransactionRepository.getTransactions).toHaveBeenCalledOnce();
      expect(mockLinkingService.linkTransactions).toHaveBeenCalledWith(transactions);
      expect(mockLinkRepository.createBulk).toHaveBeenCalledWith(confirmedLinks);
    });

    it('should find suggested links but not auto-confirm', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'blockchain', 'deposit'),
      ];

      const suggestedLinks = [createMockLink(1, 2, '0.85')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks: [],
          suggestedLinks,
          totalSourceTransactions: 1,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const linkResult = result._unsafeUnwrap();
      expect(linkResult.confirmedLinksCount).toBe(0);
      expect(linkResult.suggestedLinksCount).toBe(1);
      expect(linkResult.unmatchedSourceCount).toBe(0);
      expect(linkResult.unmatchedTargetCount).toBe(0);

      expect(mockLinkRepository.createBulk).not.toHaveBeenCalled();
    });

    it('should not save links in dry-run mode', async () => {
      const params: LinkHandlerParams = {
        dryRun: true,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'blockchain', 'deposit'),
      ];

      const confirmedLinks = [createMockLink(1, 2, '0.98')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks,
          suggestedLinks: [],
          totalSourceTransactions: 1,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const linkResult = result._unsafeUnwrap();
      expect(linkResult.confirmedLinksCount).toBe(1);
      expect(linkResult.dryRun).toBe(true);

      expect(mockLinkRepository.createBulk).not.toHaveBeenCalled();
    });

    it('should handle no transactions gracefully', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const linkResult = result._unsafeUnwrap();
      expect(linkResult.confirmedLinksCount).toBe(0);
      expect(linkResult.suggestedLinksCount).toBe(0);
      expect(linkResult.totalSourceTransactions).toBe(0);
      expect(linkResult.totalTargetTransactions).toBe(0);

      expect(mockLinkingService.linkTransactions).not.toHaveBeenCalled();
      expect(mockLinkRepository.createBulk).not.toHaveBeenCalled();
    });

    it('should handle unmatched transactions', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'exchange', 'withdrawal'),
        createMockTransaction(3, 'blockchain', 'deposit'),
      ];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks: [],
          suggestedLinks: [],
          totalSourceTransactions: 2,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 2,
          unmatchedTargetCount: 1,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const linkResult = result._unsafeUnwrap();
      expect(linkResult.confirmedLinksCount).toBe(0);
      expect(linkResult.suggestedLinksCount).toBe(0);
      expect(linkResult.unmatchedSourceCount).toBe(2);
      expect(linkResult.unmatchedTargetCount).toBe(1);
    });

    it('should return error if parameter validation fails', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('1.5'), // Invalid
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('minConfidenceScore must be between 0 and 1');

      expect(mockTransactionRepository.getTransactions).not.toHaveBeenCalled();
    });

    it('should return error if fetching transactions fails', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');

      expect(mockLinkingService.linkTransactions).not.toHaveBeenCalled();
    });

    it('should return error if linking service fails', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [createMockTransaction(1, 'exchange', 'withdrawal')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(err(new Error('Linking algorithm failed')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Linking algorithm failed');

      expect(mockLinkRepository.createBulk).not.toHaveBeenCalled();
    });

    it('should return error if saving links fails', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const transactions = [
        createMockTransaction(1, 'exchange', 'withdrawal'),
        createMockTransaction(2, 'blockchain', 'deposit'),
      ];

      const confirmedLinks = [createMockLink(1, 2, '0.98')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));
      mockLinkingService.linkTransactions.mockReturnValue(
        ok({
          confirmedLinks,
          suggestedLinks: [],
          totalSourceTransactions: 1,
          totalTargetTransactions: 1,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
        })
      );
      mockLinkRepository.createBulk.mockResolvedValue(err(new Error('Database write error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database write error');
    });

    it('should handle exceptions gracefully', async () => {
      const params: LinkHandlerParams = {
        dryRun: false,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      mockTransactionRepository.getTransactions.mockRejectedValue(new Error('Unexpected error'));

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
