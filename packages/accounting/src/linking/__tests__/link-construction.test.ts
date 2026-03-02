import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { calculateVarianceMetadata, createTransactionLink, validateLinkAmounts } from '../link-construction.js';
import type { PotentialMatch } from '../types.js';

import { createCandidate } from './test-utils.js';

describe('link-construction', () => {
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

  describe('createTransactionLink', () => {
    it('should create a valid transaction link', () => {
      const match: PotentialMatch = {
        sourceMovement: createCandidate({ id: 1 }),
        targetMovement: createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          amount: parseDecimal('0.9995'),
          direction: 'in',
        }),
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
        sourceMovement: createCandidate({ id: 1 }),
        targetMovement: createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          amount: parseDecimal('0.95'),
          direction: 'in',
        }),
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
        sourceMovement: createCandidate({ id: 1 }),
        targetMovement: createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          amount: parseDecimal('1.5'),
          direction: 'in',
        }),
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
        sourceMovement: createCandidate({
          id: 1,
          sourceName: 'cardano',
          sourceType: 'blockchain',
          timestamp: new Date('2024-07-25T20:32:02.000Z'),
          assetSymbol: 'ADA' as Currency,
          amount: parseDecimal('2669.193991'),
          direction: 'out',
          blockchainTxHash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        }),
        targetMovement: createCandidate({
          id: 2,
          sourceName: 'kucoin',
          sourceType: 'exchange',
          timestamp: new Date('2024-07-25T20:35:47.000Z'),
          assetSymbol: 'ADA' as Currency,
          amount: parseDecimal('2679.718442'), // ~0.39% higher
          direction: 'in',
          blockchainTxHash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        }),
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
        sourceMovement: createCandidate(),
        targetMovement: createCandidate({
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
        sourceMovement: createCandidate({ id: 1 }),
        targetMovement: createCandidate({
          id: 2,
          sourceName: 'bitcoin',
          sourceType: 'blockchain',
          timestamp: new Date('2024-01-01T12:30:00Z'),
          amount: parseDecimal('0.95'),
          direction: 'in',
        }),
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

    it('should use consumed amounts and partial metadata for partial match', () => {
      const source = createCandidate({ id: 1, amount: parseDecimal('10'), direction: 'out' });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('5'),
        direction: 'in',
        sourceName: 'blockchain',
        sourceType: 'blockchain',
      });

      const match: PotentialMatch = {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.9'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
        consumedAmount: parseDecimal('5'),
      };

      const link = assertOk(createTransactionLink(match, 'confirmed', new Date()));
      expect(link.sourceAmount.toFixed()).toBe('5');
      expect(link.targetAmount.toFixed()).toBe('5');
      expect(link.metadata?.['partialMatch']).toBe(true);
      expect(link.metadata?.['fullSourceAmount']).toBe('10');
      expect(link.metadata?.['fullTargetAmount']).toBe('5');
      expect(link.metadata?.['consumedAmount']).toBe('5');
      expect(link.metadata?.['impliedFee']).toBeUndefined();
    });

    it('should not produce negative impliedFee for N:1 partial match', () => {
      const source = createCandidate({ id: 1, amount: parseDecimal('5'), direction: 'out' });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('10'),
        direction: 'in',
        sourceName: 'blockchain',
        sourceType: 'blockchain',
      });

      const match: PotentialMatch = {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
        consumedAmount: parseDecimal('5'),
      };

      const link = assertOk(createTransactionLink(match, 'confirmed', new Date()));
      expect(link.metadata?.['impliedFee']).toBeUndefined();
      expect(link.metadata?.['partialMatch']).toBe(true);
    });

    it('should include variance metadata for 1:1 match (no consumed amounts)', () => {
      const source = createCandidate({ id: 1, amount: parseDecimal('1.0'), direction: 'out' });
      const target = createCandidate({
        id: 2,
        amount: parseDecimal('0.999'),
        direction: 'in',
        sourceName: 'blockchain',
        sourceType: 'blockchain',
      });

      const match: PotentialMatch = {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.999'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      };

      const link = assertOk(createTransactionLink(match, 'confirmed', new Date()));
      expect(link.sourceAmount.toFixed()).toBe('1');
      expect(link.targetAmount.toFixed()).toBe('0.999');
      expect(link.metadata?.['impliedFee']).toBe('0.001');
      expect(link.metadata?.['partialMatch']).toBeUndefined();
    });
  });
});
