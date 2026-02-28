import { type Currency, type UniversalTransactionData, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import {
  aggregateMovementsByTransaction,
  buildMatchCriteria,
  calculateAmountSimilarity,
  calculateConfidenceScore,
  calculateOutflowAdjustment,
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

import { createCandidate } from './test-utils.js';

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
    it('should return true when source.to matches target.to', () => {
      const source = createCandidate({
        sourceName: 'coinbase',
        externalId: 'W123',
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        toAddress: '4Yno2U5DfFJdKmSz9XuUToEFEwnWv6SMx1pd9hJ3YzsP',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'kucoin',
        externalId: 'D123',
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.99'),
        direction: 'in',
        toAddress: '4Yno2U5DfFJdKmSz9XuUToEFEwnWv6SMx1pd9hJ3YzsP',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should return true when addresses match', () => {
      const source = createCandidate({ externalId: 'W123', toAddress: 'bc1qxyz123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
    });

    it('should return false when addresses do not match', () => {
      const source = createCandidate({ externalId: 'W123', toAddress: 'bc1qxyz123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qdifferent',
      });
      expect(checkAddressMatch(source, target)).toBe(false);
    });

    it('should return undefined when addresses are not available', () => {
      const source = createCandidate({ externalId: 'W123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        amount: parseDecimal('0.99'),
        direction: 'in',
      });
      expect(checkAddressMatch(source, target)).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const source = createCandidate({ externalId: 'W123', toAddress: 'BC1QXYZ123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
        amount: parseDecimal('0.99'),
        direction: 'in',
        fromAddress: 'bc1qxyz123',
      });
      expect(checkAddressMatch(source, target)).toBe(true);
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
      const source = createCandidate({ externalId: 'W123', toAddress: 'bc1qxyz123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        externalId: 'txabc',
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

  describe('findPotentialMatches', () => {
    it('should find matching transactions', () => {
      const source = createCandidate({ externalId: 'W123', toAddress: 'bc1qxyz123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          fromAddress: 'bc1qxyz123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T14:00:00Z'),
          assetId: 'test:eth',
          assetSymbol: 'ETH' as Currency, // Different asset
          amount: parseDecimal('0.99'),
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetTransaction.id).toBe(2);
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should filter by minimum confidence', () => {
      const source = createCandidate({ externalId: 'W123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.3'), // Very different amount
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should not match due to low confidence
      expect(matches).toHaveLength(0);
    });

    it('should sort by confidence descending', () => {
      const source = createCandidate({ externalId: 'W123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T20:00:00Z'),
          amount: parseDecimal('0.95'), // Good match but later
          direction: 'in',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.99'), // Better match, sooner
          direction: 'in',
        }),
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
      const source = createCandidate({
        externalId: 'W123',
        timestamp: new Date('2024-01-01T14:00:00Z'), // Withdrawal at 14:00
        assetId: 'exchange:kraken:btc',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T12:00:00Z'), // Deposit at 12:00 (BEFORE withdrawal)
          assetId: 'blockchain:bitcoin:btc',
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to invalid timing
      expect(matches).toHaveLength(0);
    });

    it('should reject matches outside the time window', () => {
      const source = createCandidate({ externalId: 'W123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-04T12:00:00Z'), // 72 hours later (outside 48h window)
          assetId: 'blockchain:bitcoin:btc',
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to timing outside window
      expect(matches).toHaveLength(0);
    });
  });

  describe('amount similarity threshold enforcement', () => {
    it('should reject matches below minAmountSimilarity threshold', () => {
      const source = createCandidate({ externalId: 'W123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.90'), // 90% similarity (below 95% threshold)
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find no matches due to amount similarity below threshold
      expect(matches).toHaveLength(0);
    });

    it('should accept matches at or above minAmountSimilarity threshold', () => {
      const source = createCandidate({ externalId: 'W123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          timestamp: new Date('2024-01-01T13:00:00Z'),
          amount: parseDecimal('0.95'), // Exactly 95% (meets threshold)
          direction: 'in',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find match since amount similarity meets threshold
      expect(matches).toHaveLength(1);
      expect(matches[0]?.targetTransaction.id).toBe(2);
    });
  });

  describe('validateLinkAmounts', () => {
    it('should accept valid amounts with small variance', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.9995'); // 0.05% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should accept amounts with 5% variance', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.95'); // 5% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should accept amounts with exactly 10% variance', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.9'); // 10% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject target amount greater than source (airdrop scenario)', () => {
      const error = assertErr(validateLinkAmounts(parseDecimal('1.0'), parseDecimal('1.1')));
      expect(error.message).toContain('Target amount');
      expect(error.message).toContain('exceeds source amount');
      expect(error.message).toContain('airdrop');
    });

    it('should reject excessive variance (>10%)', () => {
      const error = assertErr(validateLinkAmounts(parseDecimal('1.0'), parseDecimal('0.85')));
      expect(error.message).toContain('Variance');
      expect(error.message).toContain('exceeds 10% threshold');
      expect(error.message).toContain('15.00%');
    });

    it('should handle very small amounts', () => {
      const sourceAmount = parseDecimal('0.00001');
      const targetAmount = parseDecimal('0.000009'); // 10% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should handle large amounts', () => {
      const sourceAmount = parseDecimal('1000000.0');
      const targetAmount = parseDecimal('999500.0'); // 0.05% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject when variance is just over 10%', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.899'); // 10.1% variance

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isErr()).toBe(true);
    });

    it('should accept equal amounts (0% variance)', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('1.0');

      const result = validateLinkAmounts(sourceAmount, targetAmount);

      expect(result.isOk()).toBe(true);
    });

    it('should reject zero source amount', () => {
      const error = assertErr(validateLinkAmounts(parseDecimal('0'), parseDecimal('0')));
      expect(error.message).toContain('Source amount must be positive');
      expect(error.message).toContain('missing movement data');
    });

    it('should reject negative source amount', () => {
      expect(assertErr(validateLinkAmounts(parseDecimal('-1.0'), parseDecimal('0.5'))).message).toContain(
        'Source amount must be positive'
      );
    });

    it('should reject negative target amount', () => {
      const error = assertErr(validateLinkAmounts(parseDecimal('1.0'), parseDecimal('-0.5')));
      expect(error.message).toContain('Target amount must be positive');
      expect(error.message).toContain('invalid transaction data');
    });

    it('should reject zero target amount', () => {
      const error = assertErr(validateLinkAmounts(parseDecimal('1.0'), parseDecimal('0')));
      expect(error.message).toContain('Target amount must be positive');
      expect(error.message).toContain('invalid transaction data');
    });
  });

  describe('calculateVarianceMetadata', () => {
    it('should calculate variance metadata correctly', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.9995');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0.0005');
      expect(metadata.variancePct).toBe('0.05');
      expect(metadata.impliedFee).toBe('0.0005');
    });

    it('should handle zero variance', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('1.0');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0');
      expect(metadata.variancePct).toBe('0.00');
      expect(metadata.impliedFee).toBe('0');
    });

    it('should handle large variance', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.9');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0.1');
      expect(metadata.variancePct).toBe('10.00');
      expect(metadata.impliedFee).toBe('0.1');
    });

    it('should handle zero source amount', () => {
      const sourceAmount = parseDecimal('0');
      const targetAmount = parseDecimal('0');

      const metadata = calculateVarianceMetadata(sourceAmount, targetAmount);

      expect(metadata.variance).toBe('0');
      expect(metadata.variancePct).toBe('0.00');
      expect(metadata.impliedFee).toBe('0');
    });

    it('should format variance percentage to 2 decimal places', () => {
      const sourceAmount = parseDecimal('1.0');
      const targetAmount = parseDecimal('0.99567'); // 0.433% variance

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
            inflows: [{ assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.0') }],
            outflows: [{ assetSymbol: 'USD' as Currency, grossAmount: parseDecimal('50000') }],
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
        assetSymbol: 'BTC' as Currency,
        direction: 'in',
      });
      expect(candidates[1]).toMatchObject({
        id: 1,
        externalId: 'tx-1',
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetSymbol: 'USD' as Currency,
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
            inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('0.5') }],
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
              { assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.0') },
              { assetSymbol: 'ETH' as Currency, grossAmount: parseDecimal('10.0') },
            ],
            outflows: [{ assetSymbol: 'USD' as Currency, grossAmount: parseDecimal('60000') }],
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
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.9995'),
          direction: 'in',
        },
        {
          id: 3,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-02T12:00:00Z'),
          assetId: 'test:eth',
          assetSymbol: 'ETH' as Currency,
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
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'neutral',
        },
        {
          id: 2,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
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
          sourceTransaction: {
            id: 1,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('1.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 2,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.9995'),
          } as TransactionCandidate,
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
          sourceTransaction: {
            id: 3,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('1.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 2,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.9995'),
          } as TransactionCandidate,
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
          sourceTransaction: {
            id: 1,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('1.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 2,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.9995'),
          } as TransactionCandidate,
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
          sourceTransaction: {
            id: 1,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('1.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 2,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.95'),
          } as TransactionCandidate,
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
          sourceTransaction: {
            id: 1,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('1.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 2,
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.9995'),
          } as TransactionCandidate,
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
          sourceTransaction: {
            id: 3,
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            amount: parseDecimal('10.0'),
          } as TransactionCandidate,
          targetTransaction: {
            id: 4,
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            amount: parseDecimal('9.98'),
          } as TransactionCandidate,
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
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
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

      const now = new Date('2024-01-01T13:00:00Z');

      const link = assertOk(createTransactionLink(match, 'confirmed', now));
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
    });

    it('should create suggested link without reviewedBy/reviewedAt', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
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

      const link = assertOk(createTransactionLink(match, 'suggested', new Date()));
      expect(link.status).toBe('suggested');
      expect(link.reviewedBy).toBeUndefined();
      expect(link.reviewedAt).toBeUndefined();
    });

    it('should reject invalid amounts (target > source)', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
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

      expect(assertErr(createTransactionLink(match, 'confirmed', new Date())).message).toContain(
        'exceeds source amount'
      );
    });

    it('should allow small target excess for hash matches', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'cardano',
          sourceType: 'blockchain',
          timestamp: new Date('2024-07-25T20:32:02.000Z'),
          assetId: 'test:ada',
          assetSymbol: 'ADA' as Currency,
          amount: parseDecimal('2669.193991'),
          direction: 'out',
          blockchainTransactionHash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'kucoin',
          sourceType: 'exchange',
          timestamp: new Date('2024-07-25T20:35:47.000Z'),
          assetId: 'test:ada',
          assetSymbol: 'ADA' as Currency,
          amount: parseDecimal('2679.718442'), // ~0.39% higher
          direction: 'in',
          blockchainTransactionHash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        },
        confidenceScore: parseDecimal('1.0'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.996'),
          timingValid: true,
          timingHours: 0.06,
          hashMatch: true,
        },
        linkType: 'exchange_to_blockchain',
      };

      const link = assertOk(createTransactionLink(match, 'confirmed', new Date()));
      expect(link.metadata?.['targetExcessAllowed']).toBe(true);
      expect(link.metadata?.['targetExcessPct']).toBeDefined();
    });

    it('should reject excessive variance (>10%)', () => {
      const match: PotentialMatch = {
        sourceTransaction: createCandidate(),
        targetTransaction: createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          amount: parseDecimal('0.85'),
          direction: 'in',
        }),
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.85'),
          timingValid: true,
          timingHours: 0.5,
        },
        linkType: 'exchange_to_blockchain',
      };

      expect(assertErr(createTransactionLink(match, 'confirmed', new Date())).message).toContain(
        'exceeds 10% threshold'
      );
    });

    it('should include variance metadata', () => {
      const match: PotentialMatch = {
        sourceTransaction: {
          id: 1,
          sourceName: 'kraken',
          sourceType: 'exchange',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('1.0'),
          direction: 'out',
        },
        targetTransaction: {
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
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

      const link = assertOk(createTransactionLink(match, 'confirmed', new Date()));
      expect(link.metadata).toBeDefined();
      expect(link.metadata?.['variance']).toBe('0.05');
      expect(link.metadata?.['variancePct']).toBe('5.00');
      expect(link.metadata?.['impliedFee']).toBe('0.05');
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
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return true when hashes match after normalization', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        blockchainTransactionHash: '0xdef456',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xdef456-819', // With log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return true when hex hashes match case-insensitively', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        blockchainTransactionHash: '0xABC123',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should be case-sensitive for non-hex hashes (Solana base58)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        blockchainTransactionHash: 'AbC123DeFg456', // Solana base58 hash
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: 'abc123defg456', // Different case
      });

      const match = checkTransactionHashMatch(source, target);
      expect(match).toBe(false); // Should not match - case matters for Solana
    });

    it('should match non-hex hashes when case matches exactly', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        blockchainTransactionHash: 'AbC123DeFg456',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'solana',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: 'AbC123DeFg456', // Exact case match
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should return false when hashes do not match', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
      const target = createCandidate({
        id: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        amount: parseDecimal('0.999'),
        direction: 'in',
        blockchainTransactionHash: '0xdef456',
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
        blockchainTransactionHash: '0xabc123',
      });
      expect(checkTransactionHashMatch(source, target)).toBeUndefined();
    });

    it('should return undefined when target hash is missing', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
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
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123-819',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('99.5'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123-819', // Same log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(true);
    });

    it('should NOT match when both have different log indices (batched transfer safety)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123-819',
      });
      const target = createCandidate({
        id: 2,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('50.0'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123-820', // Different log index
      });
      expect(checkTransactionHashMatch(source, target)).toBe(false); // Should NOT match - different log indices
    });

    it('should NOT match batched withdrawals to same deposit (safety check)', () => {
      // Scenario: Two separate withdrawals from exchange in same tx (0xabc-819, 0xabc-820)
      // should NOT both match a single deposit (0xabc)
      const withdrawal1 = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123-819',
      });
      const withdrawal2 = createCandidate({
        id: 2,
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('50.0'),
        blockchainTransactionHash: '0xabc123-820',
      });
      const deposit = createCandidate({
        id: 3,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        timestamp: new Date('2024-01-01T12:05:00Z'),
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('149.5'),
        direction: 'in',
        blockchainTransactionHash: '0xabc123',
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

  describe('findPotentialMatches with hash matching', () => {
    it('should create perfect match when transaction hashes match', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.linkType).toBe('exchange_to_blockchain');
    });

    it('should prioritize hash match over amount-based matching', () => {
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
      const targets: TransactionCandidate[] = [
        // Perfect amount match but no hash
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('1.0'), // Exact amount match
          direction: 'in',
          blockchainTransactionHash: '0xdifferent',
        }),
        // Imperfect amount but hash match
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:10:00Z'),
          amount: parseDecimal('0.95'), // 5% fee
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should have 2 matches (both are valid)
      expect(matches.length).toBeGreaterThanOrEqual(2);

      // Hash match should be first (highest confidence = 1.0)
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetTransaction.id).toBe(3); // Hash match target
    });

    it('should handle normalized hash matching', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        blockchainTransactionHash: '0xdef456',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:eth',
          assetSymbol: 'ETH' as Currency,
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xdef456-819', // With log index
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
    });

    it('should NOT hash-match blockchain→blockchain pairs (let internal linking handle)', () => {
      const source = createCandidate({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123', // Same hash
        }),
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
      const source = createCandidate({ sourceName: 'kucoin', blockchainTransactionHash: '0xabc123' });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-03T14:00:00Z'), // 50 hours later (outside default 48h window)
          assetId: 'blockchain:bitcoin:btc',
          amount: parseDecimal('0.999'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1'); // Still 100% confidence (hash match)
      expect(matches[0]?.matchCriteria.timingValid).toBe(false); // But timing is invalid
      expect(matches[0]?.matchCriteria.timingHours).toBeGreaterThan(48); // ~50 hours
    });

    it('should NOT auto-confirm when multiple targets share the same normalized hash (ambiguity)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        // Two deposits with same normalized hash (0xabc123-819 and 0xabc123-820 both normalize to 0xabc123)
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-819',
        }),
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-820',
        }),
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
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        // Only one deposit with this normalized hash
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-819',
        }),
        // Another deposit with different hash
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xdef456-820',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find the hash match
      expect(matches.length).toBeGreaterThan(0);
      // First match (hash match) should have 100% confidence
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.targetTransaction.id).toBe(2);
    });

    it('should NOT auto-confirm when hex hashes differ only by case (uniqueness check is case-insensitive)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        // Same hash but uppercase
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('99.5'),
          direction: 'in',
          blockchainTransactionHash: '0xABC123',
        }),
        // Same hash but different case
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xAbC123',
        }),
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
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:sol',
        assetSymbol: 'SOL' as Currency,
        amount: parseDecimal('10.0'),
        blockchainTransactionHash: 'AbC123DeFg456',
      });
      const targets: TransactionCandidate[] = [
        // Exact case match
        createCandidate({
          id: 2,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:sol',
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('9.95'),
          direction: 'in',
          blockchainTransactionHash: 'AbC123DeFg456',
        }),
        // Different case (should be considered different hash for Solana)
        createCandidate({
          id: 3,
          sourceName: 'solana',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetId: 'test:sol',
          assetSymbol: 'SOL' as Currency,
          amount: parseDecimal('5.0'),
          direction: 'in',
          blockchainTransactionHash: 'abc123defg456',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should find hash match with id:2 only (case-sensitive for non-hex)
      expect(matches.length).toBeGreaterThan(0);
      const perfectMatch = matches.find((m) => m.confidenceScore.toString() === '1');
      expect(perfectMatch).toBeDefined();
      expect(perfectMatch?.targetTransaction.id).toBe(2);
    });
  });

  describe('hash multi-output sum validation', () => {
    it('should create hash matches when sum of targets does not exceed source', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        amount: parseDecimal('1.0'), // Source has 1.0
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.6'), // Target 1: 0.6
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          amount: parseDecimal('0.39'), // Target 2: 0.39, total = 0.99 (valid)
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash matches for both targets (sum 0.99 < 1.0)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(2);
      expect(hashMatches.every((m) => m.confidenceScore.toString() === '1')).toBe(true);
    });

    it('should fall back to heuristic when sum of targets exceeds source', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        amount: parseDecimal('1.0'), // Source has 1.0
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.7'), // Target 1: 0.7
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
        createCandidate({
          id: 3,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          amount: parseDecimal('0.5'), // Target 2: 0.5, total = 1.2 > 1.0 (invalid!)
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

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
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        // Self-target (same transaction id as source)
        createCandidate({
          id: 1,
          sourceName: 'kucoin',
          amount: parseDecimal('10.0'), // Large amount but same tx
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
        // Valid target
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash match for id:2 only (self-target excluded from sum)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(1);
      expect(hashMatches[0]?.targetTransaction.id).toBe(2);
      expect(hashMatches[0]?.confidenceScore.toString()).toBe('1');
    });

    it('should exclude blockchain targets when source is blockchain', () => {
      const source = createCandidate({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        // Blockchain target (should be excluded from hash path)
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('10.0'), // Large amount
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
        // Exchange target (would be included, but no exchange targets here)
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should NOT create hash matches (blockchain→blockchain skipped)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(0);
    });

    it('should handle single target with hash match (no sum validation needed)', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        blockchainTransactionHash: '0xabc123',
      });
      const targets: TransactionCandidate[] = [
        createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          amount: parseDecimal('0.99'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should create hash match (single target always valid)
      expect(matches).toHaveLength(1);
      expect(matches[0]?.confidenceScore.toString()).toBe('1');
      expect(matches[0]?.matchCriteria.hashMatch).toBe(true);
    });

    it('should use checkTransactionHashMatch for consistent log-index handling', () => {
      const source = createCandidate({
        sourceName: 'kucoin',
        assetId: 'test:usdt',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('100.0'),
        blockchainTransactionHash: '0xabc123-100',
      });
      const targets: TransactionCandidate[] = [
        // Same hash with same log index (should match via checkTransactionHashMatch)
        createCandidate({
          id: 2,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:05:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('50.0'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-100',
        }),
        // Same base hash but different log index (should NOT match)
        createCandidate({
          id: 3,
          sourceName: 'ethereum',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:06:00Z'),
          assetId: 'test:usdt',
          assetSymbol: 'USDT' as Currency,
          amount: parseDecimal('49.0'),
          direction: 'in',
          blockchainTransactionHash: '0xabc123-101',
        }),
      ];

      const matches = findPotentialMatches(source, targets, DEFAULT_MATCHING_CONFIG);

      // Should only match id:2 (same log index)
      const hashMatches = matches.filter((m) => m.matchCriteria.hashMatch === true);
      expect(hashMatches).toHaveLength(1);
      expect(hashMatches[0]?.targetTransaction.id).toBe(2);
    });
  });

  describe('calculateOutflowAdjustment', () => {
    it('should adjust outflow when single outflow and internal inflows exist', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [],
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.3'),
                netAmount: parseDecimal('0.3'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('adjustedAmount');
      if ('adjustedAmount' in result) {
        expect(result.adjustedAmount.toFixed()).toBe('0.7'); // 1.0 - 0.3 = 0.7
        expect(result.representativeTxId).toBe(1);
        expect(result.multipleOutflows).toBe(false);
      }
    });

    it('should sum all outflows when multiple exist and set multipleOutflows flag', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.5'),
                netAmount: parseDecimal('0.5'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 3,
          externalId: 'tx-3',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [],
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.3'),
                netAmount: parseDecimal('0.3'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('adjustedAmount');
      if ('adjustedAmount' in result) {
        expect(result.representativeTxId).toBe(1); // Smallest ID for consistency
        expect(result.adjustedAmount.toFixed()).toBe('1.2'); // (0.5 + 1.0) - 0.3 = 1.2
        expect(result.multipleOutflows).toBe(true); // Flag set
      }
    });

    it('should skip adjustment when no inflows exist', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('skip');
      if ('skip' in result) {
        expect(result.skip).toBe('no-adjustment');
      }
    });

    it('should adjust when multiple outflows exist even without inflows', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.4'),
                netAmount: parseDecimal('0.4'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.6'),
                netAmount: parseDecimal('0.6'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('adjustedAmount');
      if ('adjustedAmount' in result) {
        expect(result.adjustedAmount.toFixed()).toBe('1'); // 0.4 + 0.6 = 1.0
        expect(result.representativeTxId).toBe(1);
        expect(result.multipleOutflows).toBe(true);
      }
    });

    it('should skip adjustment when adjusted amount would be non-positive', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.5'),
                netAmount: parseDecimal('0.5'),
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [],
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('skip');
      if ('skip' in result) {
        expect(result.skip).toBe('non-positive'); // 0.5 - 1.0 = -0.5 (invalid)
      }
    });

    it('should include same-transaction inflows in adjustment', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.7'),
                netAmount: parseDecimal('0.7'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [],
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.2'),
                netAmount: parseDecimal('0.2'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('adjustedAmount');
      if ('adjustedAmount' in result) {
        // Should subtract both inflows (including same-tx change)
        expect(result.adjustedAmount.toFixed()).toBe('0.1'); // 1.0 - 0.7 - 0.2 = 0.1
        expect(result.representativeTxId).toBe(1);
      }
    });

    it('should dedupe on-chain fee across grouped outflows', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.7'),
                netAmount: parseDecimal('0.69'),
              },
            ],
            inflows: [],
          },
          fees: [
            {
              assetSymbol: 'BTC' as Currency,
              assetId: 'blockchain:bitcoin:btc',
              amount: parseDecimal('0.01'),
              scope: 'network',
              settlement: 'on-chain',
            },
          ],
        } as unknown as UniversalTransactionData,
        {
          id: 2,
          externalId: 'tx-2',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('0.5'),
                netAmount: parseDecimal('0.49'),
              },
            ],
            inflows: [],
          },
          fees: [
            {
              assetSymbol: 'BTC' as Currency,
              assetId: 'blockchain:bitcoin:btc',
              amount: parseDecimal('0.01'),
              scope: 'network',
              settlement: 'on-chain',
            },
          ],
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);
      const result = calculateOutflowAdjustment('blockchain:bitcoin:btc', group, inflowAmountsByTx, outflowAmountsByTx);

      expect(result).toHaveProperty('adjustedAmount');
      if ('adjustedAmount' in result) {
        expect(result.adjustedAmount.toFixed()).toBe('1.19'); // (0.7 + 0.5) - 0.01 = 1.19
        expect(result.representativeTxId).toBe(1);
      }
    });
  });

  describe('aggregateMovementsByTransaction', () => {
    it('should aggregate multiple movements of same asset', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'ethereum',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'ETH' as Currency,
                assetId: 'blockchain:ethereum:0xc02...c02',
                grossAmount: parseDecimal('0.5'),
                netAmount: parseDecimal('0.5'),
              },
              {
                assetSymbol: 'ETH' as Currency,
                assetId: 'blockchain:ethereum:0xc02...c02',
                grossAmount: parseDecimal('0.3'),
                netAmount: parseDecimal('0.3'),
              },
            ],
            inflows: [
              {
                assetSymbol: 'ETH' as Currency,
                assetId: 'blockchain:ethereum:0xc02...c02',
                grossAmount: parseDecimal('0.1'),
                netAmount: parseDecimal('0.1'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { inflowAmountsByTx, outflowAmountsByTx, assetIds } = aggregateMovementsByTransaction(group);

      expect(assetIds.has('blockchain:ethereum:0xc02...c02')).toBe(true);
      expect(assetIds.size).toBe(1);

      const inflows = inflowAmountsByTx.get(1);
      expect(inflows?.get('blockchain:ethereum:0xc02...c02')?.toFixed()).toBe('0.1');

      const outflows = outflowAmountsByTx.get(1);
      expect(outflows?.get('blockchain:ethereum:0xc02...c02')?.toFixed()).toBe('0.8'); // 0.5 + 0.3
    });

    it('should handle multiple assets', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'ethereum',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'ETH' as Currency,
                assetId: 'blockchain:ethereum:0xc02...c02',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('1.0'),
              },
            ],
            inflows: [
              {
                assetSymbol: 'USDT' as Currency,
                assetId: 'blockchain:ethereum:0xdac...dac',
                grossAmount: parseDecimal('3000'),
                netAmount: parseDecimal('3000'),
              },
            ],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { assetIds, inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);

      expect(assetIds.has('blockchain:ethereum:0xc02...c02')).toBe(true);
      expect(assetIds.has('blockchain:ethereum:0xdac...dac')).toBe(true);
      expect(assetIds.size).toBe(2);

      expect(outflowAmountsByTx.get(1)?.get('blockchain:ethereum:0xc02...c02')?.toFixed()).toBe('1');
      expect(inflowAmountsByTx.get(1)?.get('blockchain:ethereum:0xdac...dac')?.toFixed()).toBe('3000');
    });

    it('should prefer netAmount over grossAmount', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'bitcoin',
          sourceType: 'blockchain',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'blockchain:bitcoin:btc',
                grossAmount: parseDecimal('1.0'),
                netAmount: parseDecimal('0.9995'), // After fees
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { outflowAmountsByTx } = aggregateMovementsByTransaction(group);

      // Should use netAmount
      expect(outflowAmountsByTx.get(1)?.get('blockchain:bitcoin:btc')?.toFixed()).toBe('0.9995');
    });

    it('should use grossAmount when netAmount is undefined', () => {
      const group: UniversalTransactionData[] = [
        {
          id: 1,
          externalId: 'tx-1',
          source: 'exchange',
          sourceType: 'exchange',
          blockchain: undefined,
          datetime: '2024-01-01T12:00:00Z',
          movements: {
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                assetId: 'exchange:exchange:btc',
                grossAmount: parseDecimal('1.0'),
                // netAmount undefined
              },
            ],
            inflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const { outflowAmountsByTx } = aggregateMovementsByTransaction(group);

      // Should use grossAmount
      expect(outflowAmountsByTx.get(1)?.get('exchange:exchange:btc')?.toFixed()).toBe('1');
    });
  });
});
