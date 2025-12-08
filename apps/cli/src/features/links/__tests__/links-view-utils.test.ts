import type { TransactionLink } from '@exitbook/accounting';
import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { filterLinksByConfidence, formatLinkInfo, mapTransactionToDetails } from '../links-view-utils.js';

describe('links-view-utils', () => {
  const createMockLink = (
    id: string,
    confidenceScore: number,
    status: 'suggested' | 'confirmed' | 'rejected' = 'suggested'
  ): TransactionLink => ({
    id,
    sourceTransactionId: 1,
    targetTransactionId: 2,
    asset: 'BTC',
    sourceAmount: parseDecimal('1.0'),
    targetAmount: parseDecimal('1.0'),
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal(confidenceScore.toString()),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status,
    reviewedBy: undefined,
    reviewedAt: undefined,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    metadata: undefined,
  });

  const createMockTransaction = (id: number): UniversalTransaction => ({
    id,
    externalId: `tx-${id}`,
    source: 'test-source',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: Date.parse('2024-01-01T12:00:00Z'),
    status: 'success',
    from: '0x1234567890abcdef1234567890abcdef12345678',
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    movements: {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: parseDecimal('1.0'),
          netAmount: parseDecimal('0.999'),
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
  });

  describe('filterLinksByConfidence', () => {
    it('should return all links when no filters provided', () => {
      const links = [createMockLink('link-1', 0.5), createMockLink('link-2', 0.8), createMockLink('link-3', 0.95)];

      const result = filterLinksByConfidence(links);

      expect(result).toHaveLength(3);
      expect(result).toEqual(links);
    });

    it('should filter by minimum confidence', () => {
      const links = [createMockLink('link-1', 0.5), createMockLink('link-2', 0.8), createMockLink('link-3', 0.95)];

      const result = filterLinksByConfidence(links, 0.7);

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('link-2');
      expect(result[1]?.id).toBe('link-3');
    });

    it('should filter by maximum confidence', () => {
      const links = [createMockLink('link-1', 0.5), createMockLink('link-2', 0.8), createMockLink('link-3', 0.95)];

      const result = filterLinksByConfidence(links, undefined, 0.85);

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('link-1');
      expect(result[1]?.id).toBe('link-2');
    });

    it('should filter by both minimum and maximum confidence', () => {
      const links = [createMockLink('link-1', 0.5), createMockLink('link-2', 0.8), createMockLink('link-3', 0.95)];

      const result = filterLinksByConfidence(links, 0.7, 0.85);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('link-2');
    });

    it('should return empty array when no links match filters', () => {
      const links = [createMockLink('link-1', 0.5), createMockLink('link-2', 0.8)];

      const result = filterLinksByConfidence(links, 0.9);

      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = filterLinksByConfidence([]);

      expect(result).toHaveLength(0);
    });
  });

  describe('mapTransactionToDetails', () => {
    it('should map UniversalTransaction to TransactionDetails', () => {
      const tx = createMockTransaction(123);

      const result = mapTransactionToDetails(tx);

      expect(result).toEqual({
        id: 123,
        external_id: 'tx-123',
        source_name: 'test-source',
        timestamp: '2024-01-01T12:00:00Z',
        from_address: '0x1234567890abcdef1234567890abcdef12345678',
        to_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        movements_inflows: [
          {
            asset: 'BTC',
            grossAmount: parseDecimal('1.0'),
            netAmount: parseDecimal('0.999'),
          },
        ],
        movements_outflows: [],
      });
    });

    it('should handle transactions with empty movements', () => {
      const tx: UniversalTransaction = {
        id: 456,
        externalId: 'tx-456',
        source: 'test-source',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        from: undefined,
        to: undefined,
        movements: {
          inflows: [],
          outflows: [],
        },
        fees: [],
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };

      const result = mapTransactionToDetails(tx);

      expect(result).toEqual({
        id: 456,
        external_id: 'tx-456',
        source_name: 'test-source',
        timestamp: '2024-01-01T12:00:00Z',
        from_address: undefined,
        to_address: undefined,
        movements_inflows: [],
        movements_outflows: [],
      });
    });

    it('should handle transactions with undefined movements arrays', () => {
      const tx: UniversalTransaction = {
        id: 789,
        externalId: 'tx-789',
        source: 'test-source',
        datetime: '2024-01-01T12:00:00Z',
        timestamp: Date.parse('2024-01-01T12:00:00Z'),
        status: 'success',
        movements: {},
        fees: [],
        operation: {
          category: 'transfer',
          type: 'deposit',
        },
      };

      const result = mapTransactionToDetails(tx);

      expect(result.id).toBe(789);
      expect(result.movements_inflows).toEqual([]);
      expect(result.movements_outflows).toEqual([]);
    });
  });

  describe('formatLinkInfo', () => {
    it('should format link without transaction details', () => {
      const link = createMockLink('link-123', 0.85);

      const result = formatLinkInfo(link);

      expect(result).toEqual({
        id: 'link-123',
        source_transaction_id: 1,
        target_transaction_id: 2,
        link_type: 'exchange_to_blockchain',
        confidence_score: '0.85',
        match_criteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.99'),
          timingValid: true,
          timingHours: 1,
          addressMatch: true,
        },
        status: 'suggested',
        reviewed_by: undefined,
        reviewed_at: undefined,
        created_at: '2024-01-01T12:00:00.000Z',
        updated_at: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should format link with source transaction details', () => {
      const link = createMockLink('link-123', 0.85);
      const sourceTx = createMockTransaction(1);

      const result = formatLinkInfo(link, sourceTx);

      expect(result.source_transaction).toBeDefined();
      expect(result.source_transaction?.id).toBe(1);
      expect(result.source_transaction?.external_id).toBe('tx-1');
      expect(result.target_transaction).toBeUndefined();
    });

    it('should format link with target transaction details', () => {
      const link = createMockLink('link-123', 0.85);
      const targetTx = createMockTransaction(2);

      const result = formatLinkInfo(link, undefined, targetTx);

      expect(result.source_transaction).toBeUndefined();
      expect(result.target_transaction).toBeDefined();
      expect(result.target_transaction?.id).toBe(2);
      expect(result.target_transaction?.external_id).toBe('tx-2');
    });

    it('should format link with both transaction details', () => {
      const link = createMockLink('link-123', 0.85);
      const sourceTx = createMockTransaction(1);
      const targetTx = createMockTransaction(2);

      const result = formatLinkInfo(link, sourceTx, targetTx);

      expect(result.source_transaction).toBeDefined();
      expect(result.source_transaction?.id).toBe(1);
      expect(result.target_transaction).toBeDefined();
      expect(result.target_transaction?.id).toBe(2);
    });

    it('should format confirmed link with review information', () => {
      const link: TransactionLink = {
        ...createMockLink('link-123', 0.85, 'confirmed'),
        reviewedBy: 'cli-user',
        reviewedAt: new Date('2024-01-02T14:30:00Z'),
      };

      const result = formatLinkInfo(link);

      expect(result.status).toBe('confirmed');
      expect(result.reviewed_by).toBe('cli-user');
      expect(result.reviewed_at).toBe('2024-01-02T14:30:00.000Z');
    });

    it('should use toFixed() for confidence score', () => {
      const link = createMockLink('link-123', 0.123456789);

      const result = formatLinkInfo(link);

      // toFixed() without parameters should preserve full precision
      expect(result.confidence_score).toBe('0.123456789');
    });
  });
});
