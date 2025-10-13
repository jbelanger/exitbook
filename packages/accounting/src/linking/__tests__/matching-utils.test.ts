import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildMatchCriteria,
  calculateAmountSimilarity,
  calculateConfidenceScore,
  calculateTimeDifferenceHours,
  checkAddressMatch,
  DEFAULT_MATCHING_CONFIG,
  determineLinkType,
  findPotentialMatches,
  isTimingValid,
  shouldAutoConfirm,
} from '../matching-utils.js';
import type { TransactionCandidate } from '../types.js';

describe('matching-utils', () => {
  describe('calculateAmountSimilarity', () => {
    it('should return 1 for exact match', () => {
      const source = new Decimal('1.5');
      const target = new Decimal('1.5');
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('1');
    });

    it('should calculate similarity when target is less than source (fees)', () => {
      const source = new Decimal('1.0');
      const target = new Decimal('0.95'); // 5% fee
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('0.95');
    });

    it('should return 0 when target is significantly larger than source', () => {
      const source = new Decimal('1.0');
      const target = new Decimal('1.5'); // 50% larger (impossible)
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('0');
    });

    it('should allow small rounding differences', () => {
      const source = new Decimal('1.0');
      const target = new Decimal('1.0005'); // 0.05% difference (rounding)
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toNumber()).toBeGreaterThan(0.98); // Very high similarity
    });

    it('should return 0 when amounts are zero', () => {
      const source = new Decimal('0');
      const target = new Decimal('1.0');
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('0');
    });
  });

  describe('calculateTimeDifferenceHours', () => {
    it('should calculate positive time difference', () => {
      const source = new Date('2024-01-01T12:00:00Z');
      const target = new Date('2024-01-01T14:00:00Z'); // 2 hours later
      const hours = calculateTimeDifferenceHours(source, target);
      expect(hours).toBe(2);
    });

    it('should return Infinity if target is before source', () => {
      const source = new Date('2024-01-01T14:00:00Z');
      const target = new Date('2024-01-01T12:00:00Z'); // Earlier
      const hours = calculateTimeDifferenceHours(source, target);
      expect(hours).toBe(Infinity);
    });

    it('should return 0 for same time', () => {
      const source = new Date('2024-01-01T12:00:00Z');
      const target = new Date('2024-01-01T12:00:00Z');
      const hours = calculateTimeDifferenceHours(source, target);
      expect(hours).toBe(0);
    });
  });

  describe('isTimingValid', () => {
    it('should validate timing within window', () => {
      const source = new Date('2024-01-01T12:00:00Z');
      const target = new Date('2024-01-01T14:00:00Z'); // 2 hours later
      const valid = isTimingValid(source, target, DEFAULT_MATCHING_CONFIG);
      expect(valid).toBe(true);
    });

    it('should invalidate timing outside window', () => {
      const source = new Date('2024-01-01T12:00:00Z');
      const target = new Date('2024-01-03T14:00:00Z'); // 50 hours later
      const valid = isTimingValid(source, target, DEFAULT_MATCHING_CONFIG);
      expect(valid).toBe(false);
    });

    it('should invalidate timing when target is before source', () => {
      const source = new Date('2024-01-01T14:00:00Z');
      const target = new Date('2024-01-01T12:00:00Z');
      const valid = isTimingValid(source, target, DEFAULT_MATCHING_CONFIG);
      expect(valid).toBe(false);
    });
  });

  describe('determineLinkType', () => {
    it('should determine exchange_to_blockchain link type', () => {
      const type = determineLinkType('exchange', 'blockchain');
      expect(type).toBe('exchange_to_blockchain');
    });

    it('should determine blockchain_to_blockchain link type', () => {
      const type = determineLinkType('blockchain', 'blockchain');
      expect(type).toBe('blockchain_to_blockchain');
    });

    it('should determine exchange_to_exchange link type', () => {
      const type = determineLinkType('exchange', 'exchange');
      expect(type).toBe('exchange_to_exchange');
    });
  });

  describe('checkAddressMatch', () => {
    it('should return true when addresses match', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
        toAddress: undefined,
      };

      const match = checkAddressMatch(source, target);
      expect(match).toBe(true);
    });

    it('should return false when addresses do not match', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qdifferent',
        toAddress: undefined,
      };

      const match = checkAddressMatch(source, target);
      expect(match).toBe(false);
    });

    it('should return undefined when addresses are not available', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('0.99'),
        direction: 'in',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const match = checkAddressMatch(source, target);
      expect(match).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'BC1QXYZ123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        asset: 'BTC',
        amount: new Decimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
        toAddress: undefined,
      };

      const match = checkAddressMatch(source, target);
      expect(match).toBe(true);
    });
  });

  describe('calculateConfidenceScore', () => {
    it('should return 0 when assets do not match', () => {
      const criteria = {
        assetMatch: false,
        amountSimilarity: new Decimal('1.0'),
        timingValid: true,
        timingHours: 1,
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0');
    });

    it('should calculate high confidence for perfect match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: new Decimal('1.0'),
        timingValid: true,
        timingHours: 0.5, // Very close timing
        addressMatch: true,
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toNumber()).toBeGreaterThan(0.9); // Should be very high
    });

    it('should penalize low amount similarity', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: new Decimal('0.5'), // Only 50% match
        timingValid: true,
        timingHours: 5, // More than 1 hour (no bonus)
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0.7'); // 30% asset + 20% amount (0.5 * 40%) + 20% timing
    });

    it('should return 0 when addresses do not match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: new Decimal('1.0'),
        timingValid: true,
        timingHours: 1,
        addressMatch: false, // Addresses explicitly do not match
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0');
    });

    it('should bonus for very close timing', () => {
      const criteria1 = {
        assetMatch: true,
        amountSimilarity: new Decimal('1.0'),
        timingValid: true,
        timingHours: 0.5, // Within 1 hour
      };

      const criteria2 = {
        assetMatch: true,
        amountSimilarity: new Decimal('1.0'),
        timingValid: true,
        timingHours: 5, // More than 1 hour
      };

      const score1 = calculateConfidenceScore(criteria1);
      const score2 = calculateConfidenceScore(criteria2);

      expect(score1.greaterThan(score2)).toBe(true);
    });
  });

  describe('buildMatchCriteria', () => {
    it('should build complete match criteria', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date('2024-01-01T13:00:00Z'),
        asset: 'BTC',
        amount: new Decimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
        toAddress: undefined,
      };

      const criteria = buildMatchCriteria(source, target, DEFAULT_MATCHING_CONFIG);

      expect(criteria.assetMatch).toBe(true);
      expect(criteria.amountSimilarity.toString()).toBe('0.99');
      expect(criteria.timingValid).toBe(true);
      expect(criteria.timingHours).toBe(1);
      expect(criteria.addressMatch).toBe(true);
    });
  });

  describe('findPotentialMatches', () => {
    it('should find matching transactions', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          asset: 'BTC',
          amount: new Decimal('0.99'),
          direction: 'in',
          fromAddress: 'bc1qxyz123',
          toAddress: undefined,
        },
        {
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T14:00:00Z'),
          asset: 'ETH', // Different asset
          amount: new Decimal('0.99'),
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetTransaction.id).toBe(2);
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should filter by minimum confidence', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          asset: 'BTC',
          amount: new Decimal('0.3'), // Very different amount
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should not match due to low confidence
      expect(matches).toHaveLength(0);
    });

    it('should sort by confidence descending', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceId: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        asset: 'BTC',
        amount: new Decimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T20:00:00Z'),
          asset: 'BTC',
          amount: new Decimal('0.95'), // Good match but later
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
        {
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          asset: 'BTC',
          amount: new Decimal('0.99'), // Better match, sooner
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(2);
      // Best match should be first
      expect(matches[0]?.targetTransaction.id).toBe(3);
      expect(matches[1]?.targetTransaction.id).toBe(2);
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high confidence matches', () => {
      const match = {
        sourceTransaction: {} as TransactionCandidate,
        targetTransaction: {} as TransactionCandidate,
        confidenceScore: new Decimal('0.96'), // Above threshold
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('1.0'),
          timingValid: true,
          timingHours: 1,
        },
        linkType: 'exchange_to_blockchain' as const,
      };

      const shouldConfirm = shouldAutoConfirm(match, DEFAULT_MATCHING_CONFIG);
      expect(shouldConfirm).toBe(true);
    });

    it('should not auto-confirm low confidence matches', () => {
      const match = {
        sourceTransaction: {} as TransactionCandidate,
        targetTransaction: {} as TransactionCandidate,
        confidenceScore: new Decimal('0.85'), // Below threshold
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.9'),
          timingValid: true,
          timingHours: 10,
        },
        linkType: 'exchange_to_blockchain' as const,
      };

      const shouldConfirm = shouldAutoConfirm(match, DEFAULT_MATCHING_CONFIG);
      expect(shouldConfirm).toBe(false);
    });
  });
});
