import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  LinkingResultSchema,
  LinkStatusSchema,
  LinkTypeSchema,
  MatchCriteriaSchema,
  MatchingConfigSchema,
  PotentialMatchSchema,
  TransactionCandidateSchema,
  TransactionLinkSchema,
} from '../schemas.js';

describe('schemas', () => {
  describe('LinkTypeSchema', () => {
    it('should validate valid link types', () => {
      expect(LinkTypeSchema.parse('exchange_to_blockchain')).toBe('exchange_to_blockchain');
      expect(LinkTypeSchema.parse('blockchain_to_blockchain')).toBe('blockchain_to_blockchain');
      expect(LinkTypeSchema.parse('exchange_to_exchange')).toBe('exchange_to_exchange');
    });

    it('should reject invalid link types', () => {
      expect(() => LinkTypeSchema.parse('invalid')).toThrow();
      expect(() => LinkTypeSchema.parse('')).toThrow();
    });
  });

  describe('LinkStatusSchema', () => {
    it('should validate valid statuses', () => {
      expect(LinkStatusSchema.parse('suggested')).toBe('suggested');
      expect(LinkStatusSchema.parse('confirmed')).toBe('confirmed');
      expect(LinkStatusSchema.parse('rejected')).toBe('rejected');
    });

    it('should reject invalid statuses', () => {
      expect(() => LinkStatusSchema.parse('pending')).toThrow();
      expect(() => LinkStatusSchema.parse('active')).toThrow();
    });
  });

  describe('MatchCriteriaSchema', () => {
    it('should validate complete match criteria', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: true,
        timingHours: 1.5,
        addressMatch: true,
      };

      const result = MatchCriteriaSchema.parse(criteria);
      expect(result.assetMatch).toBe(true);
      expect(result.amountSimilarity).toBeInstanceOf(Decimal);
      expect(result.amountSimilarity.toFixed()).toBe('0.95');
      expect(result.timingValid).toBe(true);
      expect(result.timingHours).toBe(1.5);
      expect(result.addressMatch).toBe(true);
    });

    it('should validate criteria without optional addressMatch', () => {
      const criteria = {
        assetMatch: false,
        amountSimilarity: parseDecimal('0.85'),
        timingValid: true,
        timingHours: 2.0,
      };

      const result = MatchCriteriaSchema.parse(criteria);
      expect(result.assetMatch).toBe(false);
      expect(result.amountSimilarity.toFixed()).toBe('0.85');
      expect(result.addressMatch).toBeUndefined();
    });

    it('should convert string amountSimilarity to Decimal', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: '0.99',
        timingValid: true,
        timingHours: 0.5,
      };

      const result = MatchCriteriaSchema.parse(criteria);
      expect(result.amountSimilarity).toBeInstanceOf(Decimal);
      expect(result.amountSimilarity.toFixed()).toBe('0.99');
    });

    it('should reject invalid criteria', () => {
      expect(() =>
        MatchCriteriaSchema.parse({
          assetMatch: 'yes', // should be boolean
          amountSimilarity: parseDecimal('0.95'),
          timingValid: true,
          timingHours: 1.5,
        })
      ).toThrow();

      expect(() =>
        MatchCriteriaSchema.parse({
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          // missing required fields
        })
      ).toThrow();
    });
  });

  describe('TransactionLinkSchema', () => {
    it('should validate complete transaction link', () => {
      const link = {
        id: 'link-123',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        asset: 'BTC',
        sourceAmount: parseDecimal('1.0'),
        targetAmount: parseDecimal('0.9995'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1.0'),
          timingValid: true,
          timingHours: 1.5,
          addressMatch: true,
        },
        status: 'confirmed',
        reviewedBy: 'user-123',
        reviewedAt: new Date('2024-01-02T12:00:00Z'),
        createdAt: new Date('2024-01-01T12:00:00Z'),
        updatedAt: new Date('2024-01-02T12:00:00Z'),
        metadata: { note: 'manual review' },
      };

      const result = TransactionLinkSchema.parse(link);
      expect(result.id).toBe('link-123');
      expect(result.sourceTransactionId).toBe(1);
      expect(result.targetTransactionId).toBe(2);
      expect(result.asset).toBe('BTC');
      expect(result.sourceAmount).toBeInstanceOf(Decimal);
      expect(result.sourceAmount.toFixed()).toBe('1');
      expect(result.targetAmount).toBeInstanceOf(Decimal);
      expect(result.targetAmount.toFixed()).toBe('0.9995');
      expect(result.linkType).toBe('exchange_to_blockchain');
      expect(result.confidenceScore).toBeInstanceOf(Decimal);
      expect(result.status).toBe('confirmed');
      expect(result.reviewedBy).toBe('user-123');
      expect(result.reviewedAt).toBeInstanceOf(Date);
      expect(result.metadata).toEqual({ note: 'manual review' });
    });

    it('should validate link without optional fields', () => {
      const link = {
        id: 'link-456',
        sourceTransactionId: 3,
        targetTransactionId: 4,
        asset: 'ETH',
        sourceAmount: '10.0',
        targetAmount: '9.98',
        linkType: 'blockchain_to_blockchain',
        confidenceScore: '0.88',
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: '0.95',
          timingValid: true,
          timingHours: 0.5,
        },
        status: 'suggested',
        createdAt: new Date('2024-01-01T12:00:00Z'),
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      };

      const result = TransactionLinkSchema.parse(link);
      expect(result.confidenceScore).toBeInstanceOf(Decimal);
      expect(result.confidenceScore.toFixed()).toBe('0.88');
      expect(result.sourceAmount).toBeInstanceOf(Decimal);
      expect(result.sourceAmount.toFixed()).toBe('10');
      expect(result.targetAmount).toBeInstanceOf(Decimal);
      expect(result.targetAmount.toFixed()).toBe('9.98');
      expect(result.reviewedBy).toBeUndefined();
      expect(result.reviewedAt).toBeUndefined();
      expect(result.metadata).toBeUndefined();
    });

    it('should reject invalid link', () => {
      expect(() =>
        TransactionLinkSchema.parse({
          id: 'link-123',
          sourceTransactionId: 'not-a-number',
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('0.95'),
          matchCriteria: {},
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow();
    });
  });

  describe('TransactionCandidateSchema', () => {
    it('should validate complete transaction candidate', () => {
      const candidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        asset: 'BTC',
        amount: parseDecimal('1.5'),
        direction: 'out',
        fromAddress: 'addr123',
        toAddress: 'addr456',
      };

      const result = TransactionCandidateSchema.parse(candidate);
      expect(result.id).toBe(1);
      expect(result.sourceId).toBe('kraken');
      expect(result.sourceType).toBe('exchange');
      expect(result.externalId).toBe('W123');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.asset).toBe('BTC');
      expect(result.amount).toBeInstanceOf(Decimal);
      expect(result.amount.toFixed()).toBe('1.5');
      expect(result.direction).toBe('out');
    });

    it('should validate blockchain candidate', () => {
      const candidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T13:00:00Z'),
        asset: 'BTC',
        amount: '1.5',
        direction: 'in',
        toAddress: 'bc1q...',
      };

      const result = TransactionCandidateSchema.parse(candidate);
      expect(result.sourceType).toBe('blockchain');
      expect(result.amount).toBeInstanceOf(Decimal);
      expect(result.fromAddress).toBeUndefined();
    });

    it('should validate neutral direction', () => {
      const candidate = {
        id: 3,
        sourceId: 'test',
        sourceType: 'exchange',
        timestamp: new Date(),
        asset: 'ETH',
        amount: parseDecimal('0.5'),
        direction: 'neutral',
      };

      const result = TransactionCandidateSchema.parse(candidate);
      expect(result.direction).toBe('neutral');
    });

    it('should reject invalid direction', () => {
      expect(() =>
        TransactionCandidateSchema.parse({
          id: 1,
          sourceId: 'test',
          sourceType: 'exchange',
          timestamp: new Date(),
          asset: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'invalid',
        })
      ).toThrow();
    });

    it('should reject invalid source type', () => {
      expect(() =>
        TransactionCandidateSchema.parse({
          id: 1,
          sourceId: 'test',
          sourceType: 'wallet',
          timestamp: new Date(),
          asset: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'in',
        })
      ).toThrow();
    });
  });

  describe('PotentialMatchSchema', () => {
    const createMockCandidate = (overrides = {}) => ({
      id: 1,
      sourceId: 'test',
      sourceType: 'exchange' as const,
      timestamp: new Date(),
      asset: 'BTC',
      amount: parseDecimal('1.0'),
      direction: 'out' as const,
      ...overrides,
    });

    it('should validate complete potential match', () => {
      const match = {
        sourceTransaction: createMockCandidate({ id: 1, direction: 'out' as const }),
        targetTransaction: createMockCandidate({ id: 2, direction: 'in' as const }),
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1.0'),
          timingValid: true,
          timingHours: 1.0,
          addressMatch: true,
        },
        linkType: 'exchange_to_blockchain',
      };

      const result = PotentialMatchSchema.parse(match);
      expect(result.sourceTransaction.id).toBe(1);
      expect(result.targetTransaction.id).toBe(2);
      expect(result.confidenceScore).toBeInstanceOf(Decimal);
      expect(result.linkType).toBe('exchange_to_blockchain');
    });

    it('should validate match with string Decimal values', () => {
      const match = {
        sourceTransaction: createMockCandidate({ amount: '1.5' }),
        targetTransaction: createMockCandidate({ amount: '1.5' }),
        confidenceScore: '0.90',
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: '0.98',
          timingValid: true,
          timingHours: 2.5,
        },
        linkType: 'blockchain_to_blockchain',
      };

      const result = PotentialMatchSchema.parse(match);
      expect(result.confidenceScore).toBeInstanceOf(Decimal);
      expect(result.confidenceScore.toFixed()).toBe('0.9');
      expect(result.matchCriteria.amountSimilarity.toFixed()).toBe('0.98');
    });
  });

  describe('MatchingConfigSchema', () => {
    it('should validate complete matching config', () => {
      const config = {
        maxTimingWindowHours: 24,
        minAmountSimilarity: parseDecimal('0.95'),
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.maxTimingWindowHours).toBe(24);
      expect(result.minAmountSimilarity).toBeInstanceOf(Decimal);
      expect(result.minConfidenceScore).toBeInstanceOf(Decimal);
      expect(result.autoConfirmThreshold).toBeInstanceOf(Decimal);
    });

    it('should validate config with string Decimals', () => {
      const config = {
        maxTimingWindowHours: 48,
        minAmountSimilarity: '0.90',
        minConfidenceScore: '0.60',
        autoConfirmThreshold: '0.98',
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minAmountSimilarity).toBeInstanceOf(Decimal);
      expect(result.minAmountSimilarity.toFixed()).toBe('0.9');
      expect(result.minConfidenceScore.toFixed()).toBe('0.6');
      expect(result.autoConfirmThreshold.toFixed()).toBe('0.98');
    });

    it('should reject negative maxTimingWindowHours', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: -1,
          minAmountSimilarity: parseDecimal('0.95'),
          minConfidenceScore: parseDecimal('0.7'),
          autoConfirmThreshold: parseDecimal('0.95'),
        })
      ).toThrow();
    });

    it('should reject zero maxTimingWindowHours', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: 0,
          minAmountSimilarity: parseDecimal('0.95'),
          minConfidenceScore: parseDecimal('0.7'),
          autoConfirmThreshold: parseDecimal('0.95'),
        })
      ).toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: 24,
          minAmountSimilarity: parseDecimal('0.95'),
          // missing fields
        })
      ).toThrow();
    });
  });

  describe('LinkingResultSchema', () => {
    const createMockCandidate = (id: number) => ({
      id,
      sourceId: 'test',
      sourceType: 'exchange' as const,
      timestamp: new Date(),
      asset: 'BTC',
      amount: parseDecimal('1.0'),
      direction: 'out' as const,
    });

    const createMockMatch = (sourceId: number, targetId: number) => ({
      sourceTransaction: createMockCandidate(sourceId),
      targetTransaction: createMockCandidate(targetId),
      confidenceScore: parseDecimal('0.85'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: true,
        timingHours: 1.5,
      },
      linkType: 'exchange_to_blockchain' as const,
    });

    const createMockLink = (id: string, sourceId: number, targetId: number) => ({
      id,
      sourceTransactionId: sourceId,
      targetTransactionId: targetId,
      asset: 'BTC',
      sourceAmount: parseDecimal('1.0'),
      targetAmount: parseDecimal('1.0'),
      linkType: 'exchange_to_blockchain' as const,
      confidenceScore: parseDecimal('0.95'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 1.0,
      },
      status: 'confirmed' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should validate complete linking result', () => {
      const result = {
        suggestedLinks: [createMockMatch(1, 2), createMockMatch(3, 4)],
        confirmedLinks: [createMockLink('link-1', 5, 6)],
        totalSourceTransactions: 10,
        totalTargetTransactions: 15,
        matchedTransactionCount: 3,
        unmatchedSourceCount: 7,
        unmatchedTargetCount: 12,
      };

      const parsed = LinkingResultSchema.parse(result);
      expect(parsed.suggestedLinks).toHaveLength(2);
      expect(parsed.confirmedLinks).toHaveLength(1);
      expect(parsed.totalSourceTransactions).toBe(10);
      expect(parsed.totalTargetTransactions).toBe(15);
      expect(parsed.matchedTransactionCount).toBe(3);
      expect(parsed.unmatchedSourceCount).toBe(7);
      expect(parsed.unmatchedTargetCount).toBe(12);
    });

    it('should validate result with empty arrays', () => {
      const result = {
        suggestedLinks: [],
        confirmedLinks: [],
        totalSourceTransactions: 5,
        totalTargetTransactions: 5,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 5,
        unmatchedTargetCount: 5,
      };

      const parsed = LinkingResultSchema.parse(result);
      expect(parsed.suggestedLinks).toHaveLength(0);
      expect(parsed.confirmedLinks).toHaveLength(0);
      expect(parsed.matchedTransactionCount).toBe(0);
    });

    it('should reject invalid counts', () => {
      expect(() =>
        LinkingResultSchema.parse({
          suggestedLinks: [],
          confirmedLinks: [],
          totalSourceTransactions: 'not-a-number',
          totalTargetTransactions: 5,
          matchedTransactionCount: 0,
          unmatchedSourceCount: 5,
          unmatchedTargetCount: 5,
        })
      ).toThrow();
    });

    it('should accept non-negative counts', () => {
      const result = {
        suggestedLinks: [],
        confirmedLinks: [],
        totalSourceTransactions: 0,
        totalTargetTransactions: 0,
        matchedTransactionCount: 0,
        unmatchedSourceCount: 0,
        unmatchedTargetCount: 0,
      };

      const parsed = LinkingResultSchema.parse(result);
      expect(parsed.totalSourceTransactions).toBe(0);
    });
  });

  describe('Decimal transformation', () => {
    it('should transform string to Decimal', () => {
      const config = {
        maxTimingWindowHours: 24,
        minAmountSimilarity: '0.95',
        minConfidenceScore: '0.7',
        autoConfirmThreshold: '0.95',
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minAmountSimilarity).toBeInstanceOf(Decimal);
      expect(result.minAmountSimilarity.toFixed()).toBe('0.95');
    });

    it('should keep Decimal as Decimal', () => {
      const decimalValue = parseDecimal('0.95');
      const config = {
        maxTimingWindowHours: 24,
        minAmountSimilarity: decimalValue,
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minAmountSimilarity).toBeInstanceOf(Decimal);
      expect(result.minAmountSimilarity).toBe(decimalValue);
    });

    it('should handle scientific notation strings', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: '1e-6',
        timingValid: true,
        timingHours: 1.5,
      };

      const result = MatchCriteriaSchema.parse(criteria);
      expect(result.amountSimilarity).toBeInstanceOf(Decimal);
      expect(result.amountSimilarity.toFixed()).toBe('0.000001');
    });

    it('should handle very large numbers', () => {
      const candidate = {
        id: 1,
        sourceId: 'test',
        sourceType: 'exchange' as const,
        timestamp: new Date(),
        asset: 'SHIB',
        amount: '1000000000000',
        direction: 'in' as const,
      };

      const result = TransactionCandidateSchema.parse(candidate);
      expect(result.amount).toBeInstanceOf(Decimal);
      expect(result.amount.toFixed()).toBe('1000000000000');
    });
  });
});
