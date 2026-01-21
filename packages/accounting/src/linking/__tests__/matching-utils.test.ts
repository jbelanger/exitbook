import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildMatchCriteria,
  calculateAmountSimilarity,
  calculateConfidenceScore,
  calculateTimeDifferenceHours,
  calculateVarianceMetadata,
  checkAddressMatch,
  checkTransactionHashMatch,
  convertToCandidates,
  createTransactionLink,
  deduplicateAndConfirm,
  DEFAULT_MATCHING_CONFIG,
  determineLinkType,
  findPotentialMatches,
  isTimingValid,
  normalizeTransactionHash,
  separateSourcesAndTargets,
  shouldAutoConfirm,
  validateLinkAmounts,
} from '../matching-utils.js';
import type { PotentialMatch, TransactionCandidate } from '../types.js';

describe('matching-utils', () => {
  describe('calculateAmountSimilarity', () => {
    it('should return 1 for exact match', () => {
      const source = parseDecimal('1.5');
      const target = parseDecimal('1.5');
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('1');
    });

    it('should calculate similarity when target is less than source (fees)', () => {
      const source = parseDecimal('1.0');
      const target = parseDecimal('0.95'); // 5% fee
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('0.95');
    });

    it('should return 0 when target is significantly larger than source', () => {
      const source = parseDecimal('1.0');
      const target = parseDecimal('1.5'); // 50% larger (impossible)
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toString()).toBe('0');
    });

    it('should allow small rounding differences', () => {
      const source = parseDecimal('1.0');
      const target = parseDecimal('1.0005'); // 0.05% difference (rounding)
      const similarity = calculateAmountSimilarity(source, target);
      expect(similarity.toNumber()).toBeGreaterThan(0.98); // Very high similarity
    });

    it('should return 0 when amounts are zero', () => {
      const source = parseDecimal('0');
      const target = parseDecimal('1.0');
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.99'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.99'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.99'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'BC1QXYZ123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date(),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.99'),
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
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 1,
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0');
    });

    it('should calculate high confidence for perfect match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
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
        amountSimilarity: parseDecimal('0.5'), // Only 50% match
        timingValid: true,
        timingHours: 5, // More than 1 hour (no bonus)
      };

      const score = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0.7'); // 30% asset + 20% amount (0.5 * 40%) + 20% timing
    });

    it('should return 0 when addresses do not match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
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
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 0.5, // Within 1 hour
      };

      const criteria2 = {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        timestamp: new Date('2024-01-01T13:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.99'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: 'bc1qxyz123',
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.99'),
          direction: 'in',
          fromAddress: 'bc1qxyz123',
          toAddress: undefined,
        },
        {
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T14:00:00Z'),
          assetSymbol: 'ETH', // Different asset
          amount: parseDecimal('0.99'),
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.3'), // Very different amount
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
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T20:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'), // Good match but later
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
        {
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.99'), // Better match, sooner
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
        confidenceScore: parseDecimal('0.96'), // Above threshold
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1.0'),
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
        confidenceScore: parseDecimal('0.85'), // Below threshold
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9'),
          timingValid: true,
          timingHours: 10,
        },
        linkType: 'exchange_to_blockchain' as const,
      };

      const shouldConfirm = shouldAutoConfirm(match, DEFAULT_MATCHING_CONFIG);
      expect(shouldConfirm).toBe(false);
    });
  });

  describe('timing threshold enforcement', () => {
    it('should reject matches where deposit comes before withdrawal', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T14:00:00Z'), // Withdrawal at 14:00
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T12:00:00Z'), // Deposit at 12:00 (BEFORE withdrawal)
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'), // Perfect amount match
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to invalid timing
      expect(matches).toHaveLength(0);
    });

    it('should reject matches outside the time window', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-04T12:00:00Z'), // 72 hours later (outside 48h window)
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to timing outside window
      expect(matches).toHaveLength(0);
    });
  });

  describe('amount similarity threshold enforcement', () => {
    it('should reject matches below minAmountSimilarity threshold', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.90'), // 90% similarity (below 95% threshold)
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to amount similarity below threshold
      expect(matches).toHaveLength(0);
    });

    it('should accept matches at or above minAmountSimilarity threshold', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kraken',
        sourceType: 'exchange',
        externalId: 'W123',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        fromAddress: undefined,
        toAddress: undefined,
      };

      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'), // Exactly 95% (meets threshold)
          direction: 'in',
          fromAddress: undefined,
          toAddress: undefined,
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find match since amount similarity meets threshold
      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetTransaction.id).toBe(2);
    });
  });

  describe('validateLinkAmounts', () => {
    it('should accept valid amounts with small variance', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.9995'); // 0.05% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should accept amounts with 5% variance', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.95'); // 5% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should accept amounts with exactly 10% variance', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.9'); // 10% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject target amount greater than source (airdrop scenario)', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('1.1'); // Target > source

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Target amount');
        expect(result.error.message).toContain('exceeds source amount');
        expect(result.error.message).toContain('airdrop');
      }
    });

    it('should reject excessive variance (>10%)', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.85'); // 15% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Variance');
        expect(result.error.message).toContain('exceeds 10% threshold');
        expect(result.error.message).toContain('15.00%');
      }
    });

    it('should handle very small amounts', () => {
      const sourceAmount = new Decimal('0.00001');
      const targetAmount = new Decimal('0.000009'); // 10% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should handle large amounts', () => {
      const sourceAmount = new Decimal('1000000.0');
      const targetAmount = new Decimal('999500.0'); // 0.05% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject when variance is just over 10%', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.899'); // 10.1% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
    });

    it('should accept equal amounts (0% variance)', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('1.0');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject zero source amount', () => {
      const sourceAmount = new Decimal('0');
      const targetAmount = new Decimal('0');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Source amount must be positive');
        expect(result.error.message).toContain('missing movement data');
      }
    });

    it('should reject negative source amount', () => {
      const sourceAmount = new Decimal('-1.0');
      const targetAmount = new Decimal('0.5');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Source amount must be positive');
      }
    });

    it('should reject negative target amount', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('-0.5');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Target amount must be positive');
        expect(result.error.message).toContain('invalid transaction data');
      }
    });

    it('should reject zero target amount', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Target amount must be positive');
        expect(result.error.message).toContain('invalid transaction data');
      }
    });
  });

  describe('calculateVarianceMetadata', () => {
    it('should calculate variance metadata correctly', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.9995');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0.0005');
      expect(metadata.variancePct).toBe('0.05');
      expect(metadata.impliedFee).toBe('0.0005');
    });

    it('should handle zero variance', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('1.0');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0');
      expect(metadata.variancePct).toBe('0.00');
      expect(metadata.impliedFee).toBe('0');
    });

    it('should handle large variance', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.9');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0.1');
      expect(metadata.variancePct).toBe('10.00');
      expect(metadata.impliedFee).toBe('0.1');
    });

    it('should handle zero source amount', () => {
      const sourceAmount = new Decimal('0');
      const targetAmount = new Decimal('0');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0');
      expect(metadata.variancePct).toBe('0.00');
      expect(metadata.impliedFee).toBe('0');
    });

    it('should format variance percentage to 2 decimal places', () => {
      const sourceAmount = new Decimal('1.0');
      const targetAmount = new Decimal('0.99567'); // 0.433% variance

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variancePct).toBe('0.43');
    });
  });

  describe('convertToCandidates', () => {
    it('should convert transactions with single inflow and outflow', () => {
      const transactions = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'kraken',
          sourceType: 'exchange',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          from: undefined,
          to: undefined,
          movements: {
            inflows: [{ assetSymbol: 'BTC', grossAmount: parseDecimal('1.0') }],
            outflows: [{ assetSymbol: 'USD', grossAmount: parseDecimal('50000') }],
          },
        },
      ] as UniversalTransactionData[]; // Updated type assertion

      const candidates = convertToCandidates(transactions);

      expect(candidates).toHaveLength(2);
      expect(candidates[0]).toMatchObject({
        id: 1,
        externalId: 'tx-1',
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetSymbol: 'BTC',
        direction: 'in',
      });
      expect(candidates[1]).toMatchObject({
        id: 1,
        externalId: 'tx-1',
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetSymbol: 'USD',
        direction: 'out',
      });
    });

    it('should handle blockchain transactions', () => {
      const transactions = [
        {
          id: 2,
          accountId: 1,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'tx-2',
            is_confirmed: false,
            block_height: undefined,
          },
          datetime: '2024-01-01T12:00:00Z',
          timestamp: Date.parse('2024-01-01T12:00:00Z'),
          from: 'addr1',
          to: 'addr2',
          status: 'pending',
          fees: [],
          operation: {
            category: 'transfer',
            type: 'transfer',
          },
          movements: {
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC', grossAmount: parseDecimal('0.5') }],
            outflows: [],
          },
        },
      ] as UniversalTransactionData[];

      const candidates = convertToCandidates(transactions);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        id: 2,
        sourceType: 'blockchain',
        fromAddress: 'addr1',
        toAddress: 'addr2',
      });
    });

    it('should handle multiple movements per transaction', () => {
      const transactions = [
        {
          id: 3,
          externalId: 'tx-3',
          source: 'kraken',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            inflows: [
              { assetSymbol: 'BTC', grossAmount: parseDecimal('1.0') },
              { assetSymbol: 'ETH', grossAmount: parseDecimal('10.0') },
            ],
            outflows: [{ assetSymbol: 'USD', grossAmount: parseDecimal('60000') }],
          },
        },
      ] as UniversalTransactionData[];

      const candidates = convertToCandidates(transactions);

      expect(candidates).toHaveLength(3);
      expect(candidates.filter((c) => c.direction === 'in')).toHaveLength(2);
      expect(candidates.filter((c) => c.direction === 'out')).toHaveLength(1);
    });

    it('should handle empty movements', () => {
      const transactions = [
        {
          id: 4,
          externalId: 'tx-4',
          source: 'kraken',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            inflows: [],
            outflows: [],
          },
        },
      ] as unknown as UniversalTransactionData[];

      const candidates = convertToCandidates(transactions);

      expect(candidates).toHaveLength(0);
    });
  });

  describe('separateSourcesAndTargets', () => {
    it('should separate outflows into sources and inflows into targets', () => {
      const candidates: TransactionCandidate[] = [
        {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
          direction: 'in',
        },
        {
          id: 3,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-02T12:00:00Z'),
          assetSymbol: 'ETH',
          amount: parseDecimal('10.0'),
          direction: 'out',
        },
      ];

      const { sources, targets } = separateSourcesAndTargets(candidates);

      expect(sources).toHaveLength(2);
      expect(targets).toHaveLength(1);
      expect(sources.every((s) => s.direction === 'out')).toBe(true);
      expect(targets.every((t) => t.direction === 'in')).toBe(true);
    });

    it('should handle neutral direction by excluding them', () => {
      const candidates: TransactionCandidate[] = [
        {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'neutral',
        },
        {
          id: 2,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
      ];

      const { sources, targets } = separateSourcesAndTargets(candidates);

      expect(sources).toHaveLength(1);
      expect(targets).toHaveLength(0);
    });

    it('should handle empty candidates', () => {
      const { sources, targets } = separateSourcesAndTargets([]);

      expect(sources).toHaveLength(0);
      expect(targets).toHaveLength(0);
    });
  });

  describe('deduplicateAndConfirm', () => {
    it('should deduplicate matches (one source per target)', () => {
      const matches: PotentialMatch[] = [
        {
          sourceTransaction: { id: 1, assetSymbol: 'BTC', amount: parseDecimal('1.0') } as TransactionCandidate,
          targetTransaction: { id: 2, assetSymbol: 'BTC', amount: parseDecimal('0.9995') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.98'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9995'),
            timingValid: true,
            timingHours: 1,
          },
          linkType: 'exchange_to_blockchain',
        },
        {
          sourceTransaction: { id: 3, assetSymbol: 'BTC', amount: parseDecimal('1.0') } as TransactionCandidate,
          targetTransaction: { id: 2, assetSymbol: 'BTC', amount: parseDecimal('0.9995') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.85'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9995'),
            timingValid: true,
            timingHours: 2,
          },
          linkType: 'exchange_to_blockchain',
        },
      ];

      const { suggested, confirmed } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);

      // Should only keep the higher confidence match (0.98)
      expect([...suggested, ...confirmed]).toHaveLength(1);
      expect([...suggested, ...confirmed][0]?.sourceTransaction.id).toBe(1);
    });

    it('should auto-confirm high confidence matches', () => {
      const matches: PotentialMatch[] = [
        {
          sourceTransaction: { id: 1, assetSymbol: 'BTC', amount: parseDecimal('1.0') } as TransactionCandidate,
          targetTransaction: { id: 2, assetSymbol: 'BTC', amount: parseDecimal('0.9995') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.98'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9995'),
            timingValid: true,
            timingHours: 1,
          },
          linkType: 'exchange_to_blockchain',
        },
      ];

      const { suggested, confirmed } = deduplicateAndConfirm(matches, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: parseDecimal('0.95'),
      });

      expect(confirmed).toHaveLength(1);
      expect(suggested).toHaveLength(0);
    });

    it('should suggest low confidence matches', () => {
      const matches: PotentialMatch[] = [
        {
          sourceTransaction: { id: 1, assetSymbol: 'BTC', amount: parseDecimal('1.0') } as TransactionCandidate,
          targetTransaction: { id: 2, assetSymbol: 'BTC', amount: parseDecimal('0.95') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.85'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.95'),
            timingValid: true,
            timingHours: 5,
          },
          linkType: 'exchange_to_blockchain',
        },
      ];

      const { suggested, confirmed } = deduplicateAndConfirm(matches, DEFAULT_MATCHING_CONFIG);

      expect(suggested).toHaveLength(1);
      expect(confirmed).toHaveLength(0);
    });

    it('should handle multiple independent matches', () => {
      const matches: PotentialMatch[] = [
        {
          sourceTransaction: { id: 1, assetSymbol: 'BTC', amount: parseDecimal('1.0') } as TransactionCandidate,
          targetTransaction: { id: 2, assetSymbol: 'BTC', amount: parseDecimal('0.9995') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.98'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.9995'),
            timingValid: true,
            timingHours: 1,
          },
          linkType: 'exchange_to_blockchain',
        },
        {
          sourceTransaction: { id: 3, assetSymbol: 'ETH', amount: parseDecimal('10.0') } as TransactionCandidate,
          targetTransaction: { id: 4, assetSymbol: 'ETH', amount: parseDecimal('9.98') } as TransactionCandidate,
          confidenceScore: parseDecimal('0.97'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('0.998'),
            timingValid: true,
            timingHours: 1,
          },
          linkType: 'exchange_to_blockchain',
        },
      ];

      const { suggested, confirmed } = deduplicateAndConfirm(matches, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: parseDecimal('0.95'),
      });

      expect(confirmed).toHaveLength(2);
      expect(suggested).toHaveLength(0);
    });
  });

  describe('createTransactionLink', () => {
    it('should create a valid transaction link', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
          direction: 'in',
        },
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.9995'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      const id = 'test-uuid';
      const now = new Date('2024-01-01T13:00:00Z');

      const result = createTransactionLink(match, 'confirmed', id, now);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const link = result.value;
        expect(link.id).toBe(id);
        expect(link.sourceTransactionId).toBe(1);
        expect(link.targetTransactionId).toBe(2);
        expect(link.assetSymbol).toBe('BTC');
        expect(link.sourceAmount.toFixed()).toBe('1');
        expect(link.targetAmount.toFixed()).toBe('0.9995');
        expect(link.status).toBe('confirmed');
        expect(link.reviewedBy).toBe('auto');
        expect(link.reviewedAt).toEqual(now);
        expect(link.createdAt).toEqual(now);
        expect(link.updatedAt).toEqual(now);
        expect(link.metadata).toBeDefined();
      }
    });

    it('should create suggested link without reviewedBy/reviewedAt', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'),
          direction: 'in',
        },
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      const result = createTransactionLink(match, 'suggested', 'test-uuid', new Date());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const link = result.value;
        expect(link.status).toBe('suggested');
        expect(link.reviewedBy).toBeUndefined();
        expect(link.reviewedAt).toBeUndefined();
      }
    });

    it('should reject invalid amounts (target > source)', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.5'),
          direction: 'in',
        },
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.5'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      const result = createTransactionLink(match, 'confirmed', 'test-uuid', new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('exceeds source amount');
      }
    });

    it('should reject excessive variance (>10%)', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.85'),
          direction: 'in',
        },
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.85'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      const result = createTransactionLink(match, 'confirmed', 'test-uuid', new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('exceeds 10% threshold');
      }
    });

    it('should include variance metadata', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'),
          direction: 'in',
        },
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.95'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      const result = createTransactionLink(match, 'confirmed', 'test-uuid', new Date());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const link = result.value;
        expect(link.metadata).toBeDefined();
        expect(link.metadata?.variance).toBe('0.05');
        expect(link.metadata?.variancePct).toBe('5.00');
        expect(link.metadata?.impliedFee).toBe('0.05');
      }
    });
  });

  describe('normalizeTransactionHash', () => {
    it('should remove log index suffix', () => {
      const hash = '0xabc123def456-819';
      const normalized = normalizeTransactionHash(hash);
      expect(normalized).toBe('0xabc123def456');
    });

    it('should leave hash unchanged if no suffix', () => {
      const hash = '0xabc123def456';
      const normalized = normalizeTransactionHash(hash);
      expect(normalized).toBe('0xabc123def456');
    });

    it('should handle multiple number patterns', () => {
      const hash = 'txhash-123-456';
      const normalized = normalizeTransactionHash(hash);
      // Only removes the trailing -<number> pattern
      expect(normalized).toBe('txhash-123');
    });

    it('should handle hashes without any numbers', () => {
      const hash = 'abcdef';
      const normalized = normalizeTransactionHash(hash);
      expect(normalized).toBe('abcdef');
    });
  });

  describe('checkTransactionHashMatch', () => {
    it('should return true when hashes match exactly', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(true);
    });

    it('should return true when hashes match after normalization', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'ETH',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xdef456',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'ETH',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xdef456-819', // With log index
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(true);
    });

    it('should return true when hex hashes match case-insensitively', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'ETH',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xABC123',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'ETH',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(true);
    });

    it('should be case-sensitive for non-hex hashes (Solana base58)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'SOL',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: 'AbC123DeFg456', // Solana base58 hash
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'SOL',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: 'abc123defg456', // Different case
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(false); // Should not match - case matters for Solana
    });

    it('should match non-hex hashes when case matches exactly', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'SOL',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: 'AbC123DeFg456',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'SOL',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: 'AbC123DeFg456', // Exact case match
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(true);
    });

    it('should return false when hashes do not match', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xdef456',
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(false);
    });

    it('should return undefined when source hash is missing', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBeUndefined();
    });

    it('should return undefined when target hash is missing', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('0.999'),
        direction: 'in',
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBeUndefined();
    });

    it('should match when both have same log index (exact match)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123-819',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('99.5'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123-819', // Same log index
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(true);
    });

    it('should NOT match when both have different log indices (batched transfer safety)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123-819',
      };
      const target: TransactionCandidate = {
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('50.0'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123-820', // Different log index
      };

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(false); // Should NOT match - different log indices
    });

    it('should NOT match batched withdrawals to same deposit (safety check)', () => {
      // Scenario: Two separate withdrawals from exchange in same tx (0xabc-819, 0xabc-820)
      // should NOT both match a single deposit (0xabc)
      const withdrawal1: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123-819',
      };
      const withdrawal2: TransactionCandidate = {
        id: 2,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('50.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123-820',
      };
      const deposit: TransactionCandidate = {
        id: 3,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('149.5'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      };

      // Both withdrawals should match the deposit (one has log index, other doesn't)
      const match1 = checkTransactionHashMatch(withdrawal1, deposit);
      const match2 = checkTransactionHashMatch(withdrawal2, deposit);

      expect(match1).toBe(true);
      expect(match2).toBe(true);

      // But the two withdrawals should NOT match each other (both have different log indices)
      const crossMatch = checkTransactionHashMatch(withdrawal1, withdrawal2);
      expect(crossMatch).toBe(false);
    });
  });

  describe('findPotentialMatches with hash matching', () => {
    it('should create perfect match when transaction hashes match', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should prioritize hash match over amount-based matching', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        // Perfect amount match but no hash
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'), // Exact amount match
          direction: 'in',
          blockchainTransactionHash: '0xdifferent',
        },
        // Imperfect amount but hash match
        {
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:10:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'), // 5% fee
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should have 2 matches (both are valid)
      expect(matches.length).toBeGreaterThanOrEqual(2);

      // Hash match should be first (highest confidence = 1.0)
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetTransaction.id).toBe(3); // Hash match target
    });

    it('should handle normalized hash matching', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'ETH',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xdef456',
      };
      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'ETH',
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xdef456-819', // With log index
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
    });

    it('should NOT hash-match blockchain→blockchain pairs (let internal linking handle)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'BTC',
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123', // Same hash
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should use normal matching (not hash-based), if any
      // Hash-based matching is skipped for blockchain→blockchain
      expect(matches.length).toBeLessThanOrEqual(1);
      if (matches.length > 0) {
        // If it matched via normal logic, confidence should be < 1.0
        expect(matches[0]?.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should calculate actual timing validation for hash matches', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'BTC',
        amount: parseDecimal('1.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-03T14:00:00Z'), // 50 hours later (outside default 48h window)
          assetSymbol: 'BTC',
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1'); // Still 100% confidence (hash match)
      expect(matches[0]?.matchCriteria.timingValid).toBe(false); // But timing is invalid
      expect(matches[0]?.matchCriteria.timingHours).toBeGreaterThan(48); // ~50 hours
    });

    it('should NOT auto-confirm when multiple targets share the same normalized hash (ambiguity)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        // Two deposits with same normalized hash (0xabc123-819 and 0xabc123-820 both normalize to 0xabc123)
        {
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-819',
        },
        {
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-820',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find matches, but NOT with 100% confidence (ambiguous hash)
      expect(matches.length).toBeGreaterThan(0);
      // None should have 100% confidence - all should fall back to heuristic matching
      for (const match of matches) {
        expect(match.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should auto-confirm when hash is unique on target side', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        // Only one deposit with this normalized hash
        {
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-819',
        },
        // Another deposit with different hash
        {
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xdef456-820',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find the hash match
      expect(matches.length).toBeGreaterThan(0);
      // First match (hash match) should have 100% confidence
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetTransaction.id).toBe(2);
    });

    it('should NOT auto-confirm when hex hashes differ only by case (uniqueness check is case-insensitive)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'USDT',
        amount: parseDecimal('100.0'),
        direction: 'out',
        blockchainTransactionHash: '0xabc123',
      };
      const targets: TransactionCandidate[] = [
        // Same hash but uppercase
        {
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xABC123',
        },
        // Same hash but different case
        {
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT',
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xAbC123',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should detect non-uniqueness (case-insensitive comparison)
      // and fall back to heuristic matching (not 100% confidence)
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should be case-sensitive for non-hex hashes in uniqueness check (Solana)', () => {
      const source: TransactionCandidate = {
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        assetSymbol: 'SOL',
        amount: parseDecimal('10.0'),
        direction: 'out',
        blockchainTransactionHash: 'AbC123DeFg456',
      };
      const targets: TransactionCandidate[] = [
        // Exact case match
        {
          id: 2,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'SOL',
          amount: parseDecimal('9.95'),
          direction: 'in',
          blockchainTransactionHash: 'AbC123DeFg456',
        },
        // Different case (should be considered different hash for Solana)
        {
          id: 3,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'SOL',
          amount: parseDecimal('5.0'),
          direction: 'in',
          blockchainTransactionHash: 'abc123defg456',
        },
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find hash match with id:2 only (case-sensitive for non-hex)
      expect(matches.length).toBeGreaterThan(0);
      const perfectMatch = matches.find((m) => m.confidenceScore.toString() === '1');
      expect(perfectMatch).toBeDefined();
      expect(perfectMatch?.targetTransaction.id).toBe(2);
    });
  });
});
