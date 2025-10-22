import type { TransactionLink, TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewLinksHandler } from '../view-links-handler.ts';
import type { ViewLinksParams } from '../view-links-utils.ts';

describe('ViewLinksHandler', () => {
  let mockLinkRepo: TransactionLinkRepository;
  let handler: ViewLinksHandler;
  let mockFindAll: Mock;
  let mockTxRepo: TransactionRepository;
  let mockFindById: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFindAll = vi.fn();
    mockFindById = vi.fn();

    mockLinkRepo = {
      findAll: mockFindAll,
    } as unknown as TransactionLinkRepository;

    mockTxRepo = {
      findById: mockFindById,
    } as unknown as TransactionRepository;

    handler = new ViewLinksHandler(mockLinkRepo);
  });

  const createMockLink = (overrides: Partial<TransactionLink> = {}): TransactionLink => ({
    id: 'link-123',
    sourceTransactionId: 100,
    targetTransactionId: 200,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.85'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.95'),
      timingValid: true,
      timingHours: 1.5,
      addressMatch: false,
    },
    status: 'suggested',
    reviewedBy: undefined,
    reviewedAt: undefined,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  });

  const createMockTransaction = (overrides: Partial<UniversalTransaction> = {}): UniversalTransaction => ({
    id: 500,
    externalId: 'tx-500',
    datetime: '2024-01-15T09:00:00Z',
    timestamp: 1705312800,
    source: 'kraken',
    status: 'success',
    from: 'bc1qfromaddress0001',
    to: 'bc1qtoaddress0001',
    movements: {
      inflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('0.5'),
        },
      ],
      outflows: [
        {
          asset: 'USD',
          amount: parseDecimal('20000'),
        },
      ],
    },
    fees: {},
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    ...overrides,
  });

  describe('execute', () => {
    it('should return formatted links successfully', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ id: 'link-1', sourceTransactionId: 100 }),
        createMockLink({
          id: 'link-2',
          sourceTransactionId: 300,
          targetTransactionId: 400,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
          confidenceScore: parseDecimal('0.92'),
          createdAt: new Date('2024-01-16T10:00:00Z'),
          updatedAt: new Date('2024-01-16T10:00:00Z'),
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.links).toHaveLength(2);
      expect(value.links[0]).toEqual({
        id: 'link-1',
        source_transaction_id: 100,
        target_transaction_id: 200,
        link_type: 'exchange_to_blockchain',
        confidence_score: '0.85',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          timingValid: true,
          timingHours: 1.5,
          addressMatch: false,
        },
        status: 'suggested',
        reviewed_by: undefined,
        reviewed_at: undefined,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      });
    });

    it('should filter links by status', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({
          status: 'confirmed',
          reviewedBy: 'admin',
          reviewedAt: new Date('2024-01-15T11:00:00Z'),
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { status: 'confirmed' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith('confirmed');

      const value = result._unsafeUnwrap();
      expect(value.links[0]?.status).toBe('confirmed');
      expect(value.links[0]?.reviewed_by).toBe('admin');
      expect(value.links[0]?.reviewed_at).toBe('2024-01-15T11:00:00.000Z');
    });

    it('should filter links by minimum confidence score', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.95') }),
        createMockLink({ confidenceScore: parseDecimal('0.85') }),
        createMockLink({ confidenceScore: parseDecimal('0.75') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { minConfidence: 0.8 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.links).toHaveLength(2);
      expect(value.links[0]?.confidence_score).toBe('0.95');
      expect(value.links[1]?.confidence_score).toBe('0.85');
    });

    it('should filter links by maximum confidence score', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.95') }),
        createMockLink({ confidenceScore: parseDecimal('0.85') }),
        createMockLink({ confidenceScore: parseDecimal('0.75') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { maxConfidence: 0.9 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.links).toHaveLength(2);
      expect(value.links[0]?.confidence_score).toBe('0.85');
      expect(value.links[1]?.confidence_score).toBe('0.75');
    });

    it('should filter links by confidence range', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.95') }),
        createMockLink({ confidenceScore: parseDecimal('0.85') }),
        createMockLink({ confidenceScore: parseDecimal('0.75') }),
        createMockLink({ confidenceScore: parseDecimal('0.65') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { minConfidence: 0.7, maxConfidence: 0.9 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.links).toHaveLength(2);
      expect(value.links[0]?.confidence_score).toBe('0.85');
      expect(value.links[1]?.confidence_score).toBe('0.75');
    });

    it('should include transaction details when verbose mode is enabled', async () => {
      const mockLinks: TransactionLink[] = [createMockLink({ sourceTransactionId: 101, targetTransactionId: 202 })];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const sourceTx = createMockTransaction({
        id: 101,
        externalId: 'source-ext',
        datetime: '2024-01-15T11:00:00Z',
        from: 'bc1qsourceaddr',
        to: 'bc1qtargetaddr',
      });

      const targetTx = createMockTransaction({
        id: 202,
        externalId: 'target-ext',
        datetime: '2024-01-15T12:00:00Z',
        from: 'bc1qtargetsource',
        to: 'bc1qtargetdest',
      });

      mockFindById.mockResolvedValueOnce(ok(sourceTx));
      mockFindById.mockResolvedValueOnce(ok(targetTx));

      const verboseHandler = new ViewLinksHandler(mockLinkRepo, mockTxRepo);
      const result = await verboseHandler.execute({ verbose: true });

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(mockFindById).toHaveBeenCalledTimes(2);
      expect(mockFindById).toHaveBeenNthCalledWith(1, 101);
      expect(mockFindById).toHaveBeenNthCalledWith(2, 202);

      const link = value.links[0];
      expect(link?.source_transaction).toMatchObject({
        external_id: 'source-ext',
        from_address: 'bc1qsourceaddr',
        id: 101,
        source_id: 'kraken',
        timestamp: '2024-01-15T11:00:00Z',
        to_address: 'bc1qtargetaddr',
      });
      expect(link?.source_transaction?.movements_inflows).toEqual(sourceTx.movements?.inflows ?? []);
      expect(link?.source_transaction?.movements_outflows).toEqual(sourceTx.movements?.outflows ?? []);

      expect(link?.target_transaction).toMatchObject({
        external_id: 'target-ext',
        from_address: 'bc1qtargetsource',
        id: 202,
        source_id: 'kraken',
        timestamp: '2024-01-15T12:00:00Z',
        to_address: 'bc1qtargetdest',
      });
      expect(link?.target_transaction?.movements_inflows).toEqual(targetTx.movements?.inflows ?? []);
      expect(link?.target_transaction?.movements_outflows).toEqual(targetTx.movements?.outflows ?? []);
    });

    it('should not fetch transaction details when verbose mode is disabled', async () => {
      const mockLinks: TransactionLink[] = [createMockLink({ sourceTransactionId: 300, targetTransactionId: 400 })];

      mockFindAll.mockResolvedValue(ok(mockLinks));
      // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the real value returned
      mockFindById.mockResolvedValue(ok(undefined));

      const nonVerboseHandler = new ViewLinksHandler(mockLinkRepo, mockTxRepo);
      const result = await nonVerboseHandler.execute({ verbose: false });

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(mockFindById).not.toHaveBeenCalled();
      expect(value.links[0]?.source_transaction).toBeUndefined();
      expect(value.links[0]?.target_transaction).toBeUndefined();
    });

    it('should apply limit to results', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ id: 'link-1' }),
        createMockLink({ id: 'link-2' }),
        createMockLink({ id: 'link-3' }),
        createMockLink({ id: 'link-4' }),
        createMockLink({ id: 'link-5' }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { limit: 3 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(3);
      expect(value.links).toHaveLength(3);
      expect(value.links[0]?.id).toBe('link-1');
      expect(value.links[1]?.id).toBe('link-2');
      expect(value.links[2]?.id).toBe('link-3');
    });

    it('should ignore limit when set to 0', async () => {
      const mockLinks: TransactionLink[] = [createMockLink({ id: 'link-1' }), createMockLink({ id: 'link-2' })];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { limit: 0 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.links).toHaveLength(2);
    });

    it('should return empty array when no links found', async () => {
      mockFindAll.mockResolvedValue(ok([]));

      const params: ViewLinksParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(0);
      expect(value.links).toEqual([]);
    });

    it('should return error when repository fails', async () => {
      const error = new Error('Database connection failed');
      mockFindAll.mockResolvedValue(err(error));

      const params: ViewLinksParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(error);
    });

    it('should handle links with all optional fields defined', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({
          status: 'confirmed',
          reviewedBy: 'user123',
          reviewedAt: new Date('2024-01-15T12:00:00Z'),
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.links[0]?.reviewed_by).toBe('user123');
      expect(value.links[0]?.reviewed_at).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should handle links with all optional fields undefined', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({
          reviewedBy: undefined,
          reviewedAt: undefined,
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.links[0]?.reviewed_by).toBeUndefined();
      expect(value.links[0]?.reviewed_at).toBeUndefined();
    });

    it('should handle combined filters', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({
          status: 'suggested',
          confidenceScore: parseDecimal('0.85'),
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = {
        status: 'suggested',
        minConfidence: 0.8,
        maxConfidence: 0.9,
        limit: 10,
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith('suggested');

      const value = result._unsafeUnwrap();
      expect(value.count).toBe(1);
      expect(value.links[0]?.status).toBe('suggested');
      expect(value.links[0]?.confidence_score).toBe('0.85');
    });

    it('should handle edge case confidence scores', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.0') }),
        createMockLink({ confidenceScore: parseDecimal('1.0') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { minConfidence: 0.0, maxConfidence: 1.0 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(2);
    });

    it('should filter out links below minimum confidence', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.79') }),
        createMockLink({ confidenceScore: parseDecimal('0.80') }),
        createMockLink({ confidenceScore: parseDecimal('0.81') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { minConfidence: 0.8 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(2);
      expect(value.links[0]?.confidence_score).toBe('0.8');
      expect(value.links[1]?.confidence_score).toBe('0.81');
    });

    it('should filter out links above maximum confidence', async () => {
      const mockLinks: TransactionLink[] = [
        createMockLink({ confidenceScore: parseDecimal('0.89') }),
        createMockLink({ confidenceScore: parseDecimal('0.90') }),
        createMockLink({ confidenceScore: parseDecimal('0.91') }),
      ];

      mockFindAll.mockResolvedValue(ok(mockLinks));

      const params: ViewLinksParams = { maxConfidence: 0.9 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(2);
      expect(value.links[0]?.confidence_score).toBe('0.89');
      expect(value.links[1]?.confidence_score).toBe('0.9');
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
