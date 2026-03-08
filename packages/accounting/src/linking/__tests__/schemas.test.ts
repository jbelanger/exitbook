import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  LinkCandidateSchema,
  LinkStatusSchema,
  LinkTypeSchema,
  MatchCriteriaSchema,
  MatchingConfigSchema,
  PotentialMatchSchema,
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

      expect(() =>
        MatchCriteriaSchema.parse({
          assetMatch: true,
          amountSimilarity: parseDecimal('1.01'),
          timingValid: true,
          timingHours: 1.5,
        })
      ).toThrow();

      expect(() =>
        MatchCriteriaSchema.parse({
          assetMatch: true,
          amountSimilarity: parseDecimal('-0.01'),
          timingValid: true,
          timingHours: 1.5,
        })
      ).toThrow();
    });
  });

  describe('TransactionLinkSchema', () => {
    it('should validate complete transaction link', () => {
      const link = {
        id: 123,
        sourceTransactionId: 1,
        targetTransactionId: 2,
        assetSymbol: 'BTC',
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'blockchain:bitcoin:native',
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
      expect(result.id).toBe(123);
      expect(result.sourceTransactionId).toBe(1);
      expect(result.targetTransactionId).toBe(2);
      expect(result.assetSymbol).toBe('BTC');
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
        id: 456,
        sourceTransactionId: 3,
        targetTransactionId: 4,
        assetSymbol: 'ETH',
        sourceAssetId: 'blockchain:ethereum:native',
        targetAssetId: 'blockchain:ethereum:native',
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
          id: 123,
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

      expect(() =>
        TransactionLinkSchema.parse({
          id: 123,
          sourceTransactionId: 1,
          targetTransactionId: 2,
          assetSymbol: 'BTC',
          sourceAssetId: 'exchange:kraken:btc',
          targetAssetId: 'blockchain:bitcoin:native',
          sourceAmount: parseDecimal('1.0'),
          targetAmount: parseDecimal('1.0'),
          linkType: 'exchange_to_blockchain',
          confidenceScore: parseDecimal('1.5'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 1.5,
          },
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow();
    });
  });

  describe('PotentialMatchSchema', () => {
    const createMockMovement = (overrides = {}) => ({
      id: 1,
      transactionId: 1,
      accountId: 1,
      sourceName: 'test',
      sourceType: 'exchange' as const,
      assetId: 'test:btc',
      assetSymbol: 'BTC',
      direction: 'out' as const,
      amount: parseDecimal('1.0'),
      timestamp: new Date(),
      isInternal: false,
      excluded: false,
      ...overrides,
    });

    it('should validate complete potential match', () => {
      const match = {
        sourceMovement: createMockMovement({ id: 1, transactionId: 1, direction: 'out' as const }),
        targetMovement: createMockMovement({ id: 2, transactionId: 2, direction: 'in' as const }),
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
      expect(result.sourceMovement.id).toBe(1);
      expect(result.targetMovement.id).toBe(2);
      expect(result.confidenceScore).toBeInstanceOf(Decimal);
      expect(result.linkType).toBe('exchange_to_blockchain');
    });

    it('should validate match with string Decimal values', () => {
      const match = {
        sourceMovement: createMockMovement({ amount: '1.5' }),
        targetMovement: createMockMovement({ amount: '1.5' }),
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

        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
        minPartialMatchFraction: parseDecimal('0.1'),
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.maxTimingWindowHours).toBe(24);
      expect(result.minConfidenceScore).toBeInstanceOf(Decimal);
      expect(result.autoConfirmThreshold).toBeInstanceOf(Decimal);
    });

    it('should validate config with string Decimals', () => {
      const config = {
        maxTimingWindowHours: 48,
        minConfidenceScore: '0.60',
        autoConfirmThreshold: '0.98',
        minPartialMatchFraction: '0.1',
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minConfidenceScore).toBeInstanceOf(Decimal);
      expect(result.minConfidenceScore.toFixed()).toBe('0.6');
      expect(result.autoConfirmThreshold.toFixed()).toBe('0.98');
    });

    it('should reject negative maxTimingWindowHours', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: -1,

          minConfidenceScore: parseDecimal('0.7'),
          autoConfirmThreshold: parseDecimal('0.95'),
          minPartialMatchFraction: parseDecimal('0.1'),
        })
      ).toThrow();
    });

    it('should reject zero maxTimingWindowHours', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: 0,

          minConfidenceScore: parseDecimal('0.7'),
          autoConfirmThreshold: parseDecimal('0.95'),
          minPartialMatchFraction: parseDecimal('0.1'),
        })
      ).toThrow();
    });

    it('should default clockSkewToleranceHours to 2 when omitted', () => {
      const result = MatchingConfigSchema.parse({
        maxTimingWindowHours: 24,

        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
        minPartialMatchFraction: parseDecimal('0.1'),
      });
      expect(result.clockSkewToleranceHours).toBe(2);
    });

    it('should accept explicit clockSkewToleranceHours', () => {
      const result = MatchingConfigSchema.parse({
        maxTimingWindowHours: 24,
        clockSkewToleranceHours: 4,

        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
        minPartialMatchFraction: parseDecimal('0.1'),
      });
      expect(result.clockSkewToleranceHours).toBe(4);
    });

    it('should reject negative clockSkewToleranceHours', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: 24,
          clockSkewToleranceHours: -1,

          minConfidenceScore: parseDecimal('0.7'),
          autoConfirmThreshold: parseDecimal('0.95'),
          minPartialMatchFraction: parseDecimal('0.1'),
        })
      ).toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() =>
        MatchingConfigSchema.parse({
          maxTimingWindowHours: 24,

          // missing fields
        })
      ).toThrow();
    });
  });

  describe('Decimal transformation', () => {
    it('should transform string to Decimal', () => {
      const config = {
        maxTimingWindowHours: 24,
        minConfidenceScore: '0.7',
        autoConfirmThreshold: '0.95',
        minPartialMatchFraction: '0.1',
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minConfidenceScore).toBeInstanceOf(Decimal);
      expect(result.minConfidenceScore.toFixed()).toBe('0.7');
    });

    it('should keep Decimal as Decimal', () => {
      const decimalValue = parseDecimal('0.7');
      const config = {
        maxTimingWindowHours: 24,
        minConfidenceScore: decimalValue,
        autoConfirmThreshold: parseDecimal('0.95'),
        minPartialMatchFraction: parseDecimal('0.1'),
      };

      const result = MatchingConfigSchema.parse(config);
      expect(result.minConfidenceScore).toBeInstanceOf(Decimal);
      expect(result.minConfidenceScore).toBe(decimalValue);
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
      const movement = {
        id: 1,
        transactionId: 1,
        accountId: 1,
        sourceName: 'test',
        sourceType: 'exchange' as const,
        assetId: 'test:shib',
        assetSymbol: 'SHIB',
        direction: 'in' as const,
        amount: '1000000000000',
        timestamp: new Date(),
        isInternal: false,
        excluded: false,
      };

      const result = LinkCandidateSchema.parse(movement);
      expect(result.amount).toBeInstanceOf(Decimal);
      expect(result.amount.toFixed()).toBe('1000000000000');
    });

    it('should accept optional grossAmount', () => {
      const movement = {
        id: 1,
        transactionId: 1,
        accountId: 1,
        sourceName: 'cardano',
        sourceType: 'blockchain' as const,
        assetId: 'test:ada',
        assetSymbol: 'ADA',
        direction: 'out' as const,
        amount: '2678.842165',
        grossAmount: '2679.718442',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        isInternal: false,
        excluded: false,
      };

      const result = LinkCandidateSchema.parse(movement);
      expect(result.grossAmount).toBeInstanceOf(Decimal);
      expect(result.grossAmount!.toFixed()).toBe('2679.718442');
    });

    it('should allow omitting grossAmount', () => {
      const movement = {
        id: 1,
        transactionId: 1,
        accountId: 1,
        sourceName: 'kraken',
        sourceType: 'exchange' as const,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        direction: 'out' as const,
        amount: '1.0',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        isInternal: false,
        excluded: false,
      };

      const result = LinkCandidateSchema.parse(movement);
      expect(result.grossAmount).toBeUndefined();
    });
  });
});
