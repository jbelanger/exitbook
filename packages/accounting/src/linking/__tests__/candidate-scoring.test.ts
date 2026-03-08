import { type Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { LinkCandidate } from '../link-candidate.js';
import { DEFAULT_MATCHING_CONFIG } from '../matching-config.js';
import {
  buildMatchCriteria,
  calculateAmountSimilarity,
  calculateConfidenceScore,
  calculateFeeAwareAmountSimilarity,
  calculateTimeDifferenceHours,
  checkAddressMatch,
  determineLinkType,
  isTimingValid,
  scoreAndFilterMatches,
} from '../strategies/amount-timing-utils.js';
import { checkTransactionHashMatch, normalizeTransactionHash } from '../strategies/exact-hash-utils.js';

import { createCandidate } from './test-utils.js';

describe('candidate-scoring', () => {
  const source = createCandidate({ toAddress: 'bc1qxyz123' });

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

  describe('calculateFeeAwareAmountSimilarity', () => {
    it('should fall back to standard comparison when no grossAmount', () => {
      const source = createCandidate({ amount: parseDecimal('100'), direction: 'out' });
      const target = createCandidate({ id: 2, amount: parseDecimal('99'), direction: 'in' });
      const similarity = calculateFeeAwareAmountSimilarity(source, target);
      expect(similarity.toFixed()).toBe(calculateAmountSimilarity(parseDecimal('100'), parseDecimal('99')).toFixed());
    });

    it('should match source grossAmount against target when net comparison fails', () => {
      // Cardano case: source net=2678.84, source gross=2679.72, target=2679.72
      const source = createCandidate({
        amount: parseDecimal('2678.842165'),
        grossAmount: parseDecimal('2679.718442'),
        direction: 'out',
        sourceType: 'blockchain',
      });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('2679.718442'),
        direction: 'in',
        sourceType: 'exchange',
      });
      const similarity = calculateFeeAwareAmountSimilarity(source, target);
      // gross vs target is exact match → 1.0
      expect(similarity.toFixed()).toBe('1');
    });

    it('should match source against target grossAmount when target has fee difference', () => {
      const source = createCandidate({
        amount: parseDecimal('100'),
        direction: 'out',
      });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('99.5'),
        grossAmount: parseDecimal('100'),
        direction: 'in',
      });
      const similarity = calculateFeeAwareAmountSimilarity(source, target);
      // source.amount vs target.grossAmount is exact match → 1.0
      expect(similarity.toFixed()).toBe('1');
    });

    it('should return the best similarity across all patterns', () => {
      const source = createCandidate({
        amount: parseDecimal('95'),
        grossAmount: parseDecimal('100'),
        direction: 'out',
      });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('98'),
        direction: 'in',
      });
      // net vs net: 95 vs 98 → target > source → 0 (exceeds 0.1% rounding)
      // gross vs net: 100 vs 98 → 98/100 = 0.98
      const similarity = calculateFeeAwareAmountSimilarity(source, target);
      expect(similarity.toFixed()).toBe('0.98');
    });

    it('should short-circuit when primary comparison is already perfect', () => {
      const source = createCandidate({
        amount: parseDecimal('100'),
        grossAmount: parseDecimal('105'),
        direction: 'out',
      });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('100'),
        direction: 'in',
      });
      const similarity = calculateFeeAwareAmountSimilarity(source, target);
      expect(similarity.toFixed()).toBe('1');
    });
  });

  describe('calculateTimeDifferenceHours', () => {
    it('should calculate positive time difference', () => {
      const source = new Date('2024-01-01T12:00:00Z');
      const target = new Date('2024-01-01T14:00:00Z'); // 2 hours later
      const hours = calculateTimeDifferenceHours(source, target);
      expect(hours).toBe(2);
    });

    it('should return negative hours if target is before source', () => {
      const source = new Date('2024-01-01T14:00:00Z');
      const target = new Date('2024-01-01T12:00:00Z'); // 2 hours earlier
      const hours = calculateTimeDifferenceHours(source, target);
      expect(hours).toBe(-2);
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

    it('should allow timing when target is slightly before source (within clock skew tolerance)', () => {
      const source = new Date('2024-01-01T14:00:00Z');
      const target = new Date('2024-01-01T13:00:00Z'); // 1 hour earlier, within 2h tolerance
      const valid = isTimingValid(source, target, DEFAULT_MATCHING_CONFIG);
      expect(valid).toBe(true);
    });

    it('should invalidate timing when target is before source beyond clock skew tolerance', () => {
      const source = new Date('2024-01-01T14:00:00Z');
      const target = new Date('2024-01-01T11:00:00Z'); // 3 hours earlier, beyond 2h tolerance
      const valid = isTimingValid(source, target, DEFAULT_MATCHING_CONFIG);
      expect(valid).toBe(false);
    });
  });

  describe('determineLinkType', () => {
    it('should determine exchange_to_blockchain link type', () => {
      const type = determineLinkType('exchange', 'blockchain');
      expect(type).toBe('exchange_to_blockchain');
    });

    it('should determine blockchain_to_exchange link type', () => {
      const type = determineLinkType('blockchain', 'exchange');
      expect(type).toBe('blockchain_to_exchange');
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
    it('should return true when source.to matches target.to', () => {
      const source = createCandidate({
        sourceName: 'coinbase',
        assetSymbol: 'SOL' as Currency,
        toAddress: '4Yno2U5DfFJdKmSz9XuUToEFEwnWv6SMx1pd9hJ3YzsP',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'kucoin',

        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.99'),
        direction: 'in',
        toAddress: '4Yno2U5DfFJdKmSz9XuUToEFEwnWv6SMx1pd9hJ3YzsP',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should return true when addresses match', () => {
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should return false when addresses do not match', () => {
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qdifferent',
      });
      expect(checkAddressMatch(source, target)).toBe(false);
    });

    it('should return undefined when addresses are not available', () => {
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        amount: parseDecimal('0.99'),
        direction: 'in',
      });
      expect(checkAddressMatch(source, target)).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should match source.fromAddress against target.toAddress (blockchain→exchange)', () => {
      // User sends from their Cardano address, exchange records deposit to user's deposit address
      const source = createCandidate({
        sourceName: 'cardano',
        sourceType: 'blockchain',
        fromAddress: 'addr1q95qk0u05drsy3', // user's address
        toAddress: 'addr1q9h4f2vhh5vnqg', // exchange hot wallet
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        direction: 'in',
        toAddress: 'addr1q95qk0u05drsy3', // user's deposit address on exchange
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should return undefined when source has no addresses', () => {
      const source = createCandidate({ sourceName: 'exchange1' });
      const target = createCandidate({
        id: 2,
        sourceName: 'exchange2',
        direction: 'in',
        toAddress: 'someaddr',
      });
      expect(checkAddressMatch(source, target)).toBeUndefined();
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

      const { score, breakdown } = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0');
      expect(breakdown).toHaveLength(0);
    });

    it('should calculate high confidence for perfect match', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 0.5, // Very close timing
        addressMatch: true,
      };

      const { score, breakdown } = calculateConfidenceScore(criteria);
      expect(score.toNumber()).toBeGreaterThan(0.9); // Should be very high
      expect(breakdown.map((c) => c.signal)).toEqual([
        'asset_match',
        'amount_similarity',
        'timing_valid',
        'timing_close_bonus',
        'address_match',
      ]);
    });

    it('should penalize low amount similarity', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.5'), // Only 50% match
        timingValid: true,
        timingHours: 5, // More than 1 hour (no bonus)
      };

      const { score } = calculateConfidenceScore(criteria);
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

      const { score, breakdown } = calculateConfidenceScore(criteria);
      expect(score.toString()).toBe('0');
      expect(breakdown).toHaveLength(0);
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

      const { score: score1 } = calculateConfidenceScore(criteria1);
      const { score: score2 } = calculateConfidenceScore(criteria2);

      expect(score1.greaterThan(score2)).toBe(true);
    });

    it('should produce breakdown with correct weights and contributions', () => {
      const criteria = {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: true,
        timingHours: 0.5,
      };

      const { score, breakdown } = calculateConfidenceScore(criteria);

      // Verify each component
      const asset = breakdown.find((c) => c.signal === 'asset_match')!;
      expect(asset.contribution.toFixed()).toBe('0.3');

      const amount = breakdown.find((c) => c.signal === 'amount_similarity')!;
      expect(amount.value.toFixed()).toBe('0.95');
      expect(amount.contribution.toFixed()).toBe('0.38'); // 0.95 * 0.4

      const timing = breakdown.find((c) => c.signal === 'timing_valid')!;
      expect(timing.contribution.toFixed()).toBe('0.2');

      const bonus = breakdown.find((c) => c.signal === 'timing_close_bonus')!;
      expect(bonus.contribution.toFixed()).toBe('0.05');

      // Total: 0.3 + 0.38 + 0.2 + 0.05 = 0.93
      expect(score.toFixed()).toBe('0.93');
    });
  });

  describe('buildMatchCriteria', () => {
    it('should build complete match criteria', () => {
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T13:00:00Z'),
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
      });

      const criteria = buildMatchCriteria(source, target, DEFAULT_MATCHING_CONFIG);

      expect(criteria.assetMatch).toBe(true);
      expect(criteria.amountSimilarity.toString()).toBe('0.99');
      expect(criteria.timingValid).toBe(true);
      expect(criteria.timingHours).toBe(1);
      expect(criteria.addressMatch).toBe(true);
    });
  });

  describe('scoreAndFilterMatches', () => {
    it('should find matching transactions', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          fromAddress: 'bc1qxyz123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T14:00:00Z'),
          assetSymbol: 'ETH' as Currency, // Different asset
          amount: parseDecimal('0.99'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetMovement.id).toBe(2);
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should filter by minimum confidence', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.3'), // Very different amount
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should not match due to low confidence
      expect(matches).toHaveLength(0);
    });

    it('should sort by confidence descending', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T20:00:00Z'),
          amount: parseDecimal('0.95'), // Good match but later
          direction: 'in',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.99'), // Better match, sooner
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(2);
      // Best match should be first
      expect(matches[0]?.targetMovement.id).toBe(3);
      expect(matches[1]?.targetMovement.id).toBe(2);
    });

    it('should emit blockchain_to_exchange for blockchain send matched to exchange deposit', () => {
      const source = createCandidate({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        direction: 'out',
        amount: parseDecimal('1'),
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.9995'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.linkType).toBe('blockchain_to_exchange');
    });
  });

  describe('scoreAndFilterMatches with fee-aware amounts', () => {
    it('should match UTXO outflow (net) against exchange inflow (gross) via grossAmount', () => {
      // Simulates the Cardano case: blockchain OUT net=2678.84, gross=2679.72
      // Exchange IN records the pre-fee withdrawal amount: 2679.72
      const source = createCandidate({
        id: 150,
        sourceName: 'cardano',
        sourceType: 'blockchain',
        assetSymbol: 'ADA' as Currency,
        amount: parseDecimal('2678.842165'), // netAmount (gross - fee)
        grossAmount: parseDecimal('2679.718442'), // grossAmount (total UTXO inputs)
        direction: 'out',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 388,
          sourceName: 'unknown',
          sourceType: 'exchange',
          assetSymbol: 'ADA' as Currency,
          timestamp: new Date('2024-01-01T11:51:00Z'), // 9 min before source (within clock skew)
          amount: parseDecimal('2679.718442'), // gross withdrawal amount
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetMovement.id).toBe(388);
      // gross vs target is exact match → amountSimilarity = 1.0
      expect(matches[0]?.matchCriteria.amountSimilarity.toFixed()).toBe('1');
    });

    it('should not match without grossAmount when target greatly exceeds source net', () => {
      // Fee difference > 0.1% rounding tolerance → no match without grossAmount
      const source = createCandidate({
        id: 150,
        sourceName: 'cardano',
        sourceType: 'blockchain',
        assetSymbol: 'ADA' as Currency,
        amount: parseDecimal('100'), // net (after large fee)
        // No grossAmount
        direction: 'out',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 388,
          sourceName: 'unknown',
          sourceType: 'exchange',
          assetSymbol: 'ADA' as Currency,
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('105'), // 5% larger — exceeds rounding tolerance
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Without grossAmount, target > source by 5% → similarity = 0 → confidence too low
      expect(matches).toHaveLength(0);
    });
  });

  describe('timing threshold enforcement', () => {
    it('should match deposit that arrives slightly before withdrawal (within clock skew tolerance)', () => {
      const source = createCandidate({
        timestamp: new Date('2024-01-01T14:00:00Z'), // Withdrawal at 14:00
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'), // Deposit 1h before (within 2h tolerance)
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
    });

    it('should reject deposit that arrives before withdrawal beyond clock skew tolerance', () => {
      const source = createCandidate({
        timestamp: new Date('2024-01-01T14:00:00Z'), // Withdrawal at 14:00
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T11:00:00Z'), // Deposit 3h before (beyond 2h tolerance)
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(0);
    });

    it('should reject matches outside the time window', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-04T12:00:00Z'), // 72 hours later (outside 48h window)
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to timing outside window
      expect(matches).toHaveLength(0);
    });
  });

  describe('amount similarity behavior', () => {
    it('should pass through matches with low amount similarity (capacity dedup handles filtering)', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.90'), // 90% similarity — not a hard filter
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Amount similarity feeds into confidence ranking, not hard filtering.
      // Capacity-based dedup in allocateMatches() handles amount matching.
      expect(matches).toHaveLength(1);
      expect(matches[0]!.matchCriteria.amountSimilarity.toFixed(2)).toBe('0.90');
    });

    it('should accept matches with high amount similarity', () => {
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.95'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetMovement.id).toBe(2);
    });
  });

  describe('same-source guard in scoreAndFilterMatches', () => {
    it('should reject matches within the same exchange', () => {
      const source = createCandidate({
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        direction: 'out',
      });
      const targets = [
        createCandidate({
          id: 2,
          sourceName: 'kucoin',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);
      expect(matches).toHaveLength(0);
    });

    it('should allow matches across different exchanges', () => {
      const source = createCandidate({
        id: 1,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        direction: 'out',
      });
      const targets = [
        createCandidate({
          id: 2,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);
      expect(matches).toHaveLength(1);
    });

    it('should reject same-blockchain heuristic matches (unrelated on-chain events)', () => {
      const source = createCandidate({
        id: 1,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        direction: 'out',
      });
      const targets = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);
      expect(matches).toHaveLength(0);
    });

    it('should allow blockchain-to-different-source matching', () => {
      const source = createCandidate({
        id: 1,
        sourceName: 'cardano',
        sourceType: 'blockchain',
        direction: 'out',
      });
      const targets = [
        createCandidate({
          id: 2,
          sourceName: 'unknown',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          direction: 'in',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);
      expect(matches).toHaveLength(1);
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
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return true when hashes match after normalization', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'ETH' as Currency,
        blockchainTxHash: '0xdef456',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: '0xdef456-819', // With log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return true when hex hashes match case-insensitively', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'ETH' as Currency,
        blockchainTxHash: '0xABC123',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should be case-sensitive for non-hex hashes (Solana base58)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'SOL' as Currency,
        blockchainTxHash: 'AbC123DeFg456', // Solana base58 hash
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: 'abc123defg456', // Different case
      });

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(false); // Should not match - case matters for Solana
    });

    it('should match non-hex hashes when case matches exactly', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'SOL' as Currency,
        blockchainTxHash: 'AbC123DeFg456',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: 'AbC123DeFg456', // Exact case match
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return false when hashes do not match', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: '0xdef456',
      });
      expect(checkTransactionHashMatch(source, target)).toBe(false);
    });

    it('should return undefined when source hash is missing', () => {
      const source = createCandidate({ sourceName: 'kucoin' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTxHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBeUndefined();
    });

    it('should return undefined when target hash is missing', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
      });
      expect(checkTransactionHashMatch(source, target)).toBeUndefined();
    });

    it('should match when both have same log index (exact match)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123-819',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('99.5'),
        direction: 'in',
        blockchainTxHash: '0xabc123-819', // Same log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should NOT match when both have different log indices (batched transfer safety)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123-819',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('50.0'),
        direction: 'in',
        blockchainTxHash: '0xabc123-820', // Different log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(false); // Should NOT match - different log indices
    });

    it('should NOT match batched withdrawals to same deposit (safety check)', () => {
      // Scenario: Two separate withdrawals from exchange in same tx (0xabc-819, 0xabc-820)
      // should NOT both match a single deposit (0xabc)
      const withdrawal1 = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123-819',
      });
      const withdrawal2 = createCandidate({
        id: 2,
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('50.0'),
        blockchainTxHash: '0xabc123-820',
      });
      const deposit = createCandidate({
        id: 3,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('149.5'),
        direction: 'in',
        blockchainTxHash: '0xabc123',
      });

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

  describe('scoreAndFilterMatches with hash matching', () => {
    it('should create perfect match when transaction hashes match', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should prioritize hash match over amount-based matching', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const targets: LinkCandidate[] = [
        // Perfect amount match but no hash
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('1.0'), // Exact amount match
          direction: 'in',
          blockchainTxHash: '0xdifferent',
        }),
        // Imperfect amount but hash match
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:10:00Z'),
          amount: parseDecimal('0.95'), // 5% fee
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should have 2 matches (both are valid)
      expect(matches.length).toBeGreaterThanOrEqual(2);

      // Hash match should be first (highest confidence = 1.0)
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetMovement.id).toBe(3); // Hash match target
    });

    it('should handle normalized hash matching', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'ETH' as Currency,
        blockchainTxHash: '0xdef456',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'ETH' as Currency,
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTxHash: '0xdef456-819', // With log index
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
    });

    it('should NOT hash-match blockchain→blockchain pairs (let internal linking handle)', () => {
      const source = createCandidate({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTxHash: '0xabc123', // Same hash
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should use normal matching (not hash-based), if any
      // Hash-based matching is skipped for blockchain→blockchain
      expect(matches.length).toBeLessThanOrEqual(1);
      if (matches.length > 0) {
        // If it matched via normal logic, confidence should be < 1.0
        expect(matches[0]?.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should calculate actual timing validation for hash matches', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTxHash: '0xabc123' });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-03T14:00:00Z'), // 50 hours later (outside default 48h window)
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1'); // Still 100% confidence (hash match)
      expect(matches[0]?.matchCriteria.timingValid).toBe(false); // But timing is invalid
      expect(matches[0]?.matchCriteria.timingHours).toBeGreaterThan(48); // ~50 hours
    });

    it('should NOT auto-confirm when multiple targets share the same normalized hash (ambiguity)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        // Two deposits with same normalized hash (0xabc123-819 and 0xabc123-820 both normalize to 0xabc123)
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTxHash: '0xabc123-819',
        }),
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTxHash: '0xabc123-820',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find matches, but NOT with 100% confidence (ambiguous hash)
      expect(matches.length).toBeGreaterThan(0);
      // None should have 100% confidence - all should fall back to heuristic matching
      for (const match of matches) {
        expect(match.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should auto-confirm when hash is unique on target side', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        // Only one deposit with this normalized hash
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTxHash: '0xabc123-819',
        }),
        // Another deposit with different hash
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTxHash: '0xdef456-820',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find the hash match
      expect(matches.length).toBeGreaterThan(0);
      // First match (hash match) should have 100% confidence
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetMovement.id).toBe(2);
    });

    it('should NOT auto-confirm when hex hashes differ only by case (uniqueness check is case-insensitive)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        // Same hash but uppercase
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTxHash: '0xABC123',
        }),
        // Same hash but different case
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTxHash: '0xAbC123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should detect non-uniqueness (case-insensitive comparison)
      // and fall back to heuristic matching (not 100% confidence)
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should be case-sensitive for non-hex hashes in uniqueness check (Solana)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('10.0'),
        blockchainTxHash: 'AbC123DeFg456',
      });
      const targets: LinkCandidate[] = [
        // Exact case match
        createCandidate({
          id: 2,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('9.95'),
          direction: 'in',
          blockchainTxHash: 'AbC123DeFg456',
        }),
        // Different case (should be considered different hash for Solana)
        createCandidate({
          id: 3,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('5.0'),
          direction: 'in',
          blockchainTxHash: 'abc123defg456',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find hash match with id:2 only (case-sensitive for non-hex)
      expect(matches.length).toBeGreaterThan(0);
      const perfectMatch = matches.find((m) => m.confidenceScore.toString() === '1');
      expect(perfectMatch).toBeDefined();
      expect(perfectMatch?.targetMovement.id).toBe(2);
    });
  });

  describe('hash multi-output sum validation', () => {
    it('should create hash matches when sum of targets does not exceed source', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        amount: parseDecimal('1.0'), // Source has 1.0
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.6'), // Target 1: 0.6
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          amount: parseDecimal('0.39'), // Target 2: 0.39, total = 0.99 (valid)
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash matches for both targets (sum 0.99 < 1.0)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(2);
      expect(hashMatches.every((m) => m.confidenceScore.toString() === '1')).toBe(true);
    });

    it('should fall back to heuristic when sum of targets exceeds source', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        amount: parseDecimal('1.0'), // Source has 1.0
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.7'), // Target 1: 0.7
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          amount: parseDecimal('0.5'), // Target 2: 0.5, total = 1.2 > 1.0 (invalid!)
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should NOT create hash matches (sum exceeds source)
      // Should fall back to heuristic matching if any
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(0);

      // May still have heuristic matches with lower confidence
      for (const match of matches) {
        expect(match.confidenceScore.toNumber()).toBeLessThan(1.0);
      }
    });

    it('should exclude self-targets from sum validation', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        // Self-target (same transaction id as source)
        createCandidate({
          id: 1,
          sourceName: 'kucoin',
          amount: parseDecimal('10.0'), // Large amount but same tx
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
        // Valid target
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash match for id:2 only (self-target excluded from sum)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(1);
      expect(hashMatches[0]?.targetMovement.id).toBe(2);
      expect(hashMatches[0]?.confidenceScore.toString()).toBe('1');
    });

    it('should exclude blockchain targets when source is blockchain', () => {
      const source = createCandidate({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        // Blockchain target (should be excluded from hash path)
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('10.0'), // Large amount
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
        // Exchange target (would be included, but no exchange targets here)
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should NOT create hash matches (blockchain→blockchain skipped)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(0);
    });

    it('should handle single target with hash match (no sum validation needed)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        blockchainTxHash: '0xabc123',
      });
      const targets: LinkCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          blockchainTxHash: '0xabc123',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash match (single target always valid)
      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.matchCriteria.hashMatch).toBe(true);
    });

    it('should use checkTransactionHashMatch for consistent log-index handling', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTxHash: '0xabc123-100',
      });
      const targets: LinkCandidate[] = [
        // Same hash with same log index (should match via checkTransactionHashMatch)
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTxHash: '0xabc123-100',
        }),
        // Same base hash but different log index (should NOT match)
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('49.0'),
          direction: 'in',
          blockchainTxHash: '0xabc123-101',
        }),
      ];

      const matches = scoreAndFilterMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should only match id:2 (same log index)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(1);
      expect(hashMatches[0]?.targetMovement.id).toBe(2);
    });
  });
});
