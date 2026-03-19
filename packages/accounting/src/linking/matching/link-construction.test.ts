import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createLinkableMovement } from '../shared/test-utils.js';
import type { PotentialMatch } from '../shared/types.js';

import { createTransactionLink } from './link-construction.js';

describe('link-construction', () => {
  describe('createTransactionLink', () => {
    it('should create a valid transaction link', () => {
      const match: PotentialMatch = {
        sourceMovement: createLinkableMovement({ id: 1 }),
        targetMovement: createLinkableMovement({
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
      expect(link.impliedFeeAmount?.toFixed()).toBe('0.0005');
      expect(link.metadata).toBeDefined();
    });

    it('should create suggested link without reviewedBy/reviewedAt', () => {
      const match: PotentialMatch = {
        sourceMovement: createLinkableMovement({ id: 1 }),
        targetMovement: createLinkableMovement({
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
        sourceMovement: createLinkableMovement({ id: 1 }),
        targetMovement: createLinkableMovement({
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
        sourceMovement: createLinkableMovement({
          id: 1,
          sourceName: 'cardano',
          sourceType: 'blockchain',
          timestamp: new Date('2024-07-25T20:32:02.000Z'),
          assetSymbol: 'ADA' as Currency,
          amount: parseDecimal('2669.193991'),
          direction: 'out',
          blockchainTxHash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        }),
        targetMovement: createLinkableMovement({
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
        sourceMovement: createLinkableMovement(),
        targetMovement: createLinkableMovement({
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
        sourceMovement: createLinkableMovement({ id: 1 }),
        targetMovement: createLinkableMovement({
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
      expect(link.impliedFeeAmount?.toFixed()).toBe('0.05');
    });

    it('should use consumed amounts and partial metadata for partial match', () => {
      const source = createLinkableMovement({ id: 1, amount: parseDecimal('10'), direction: 'out' });
      const target = createLinkableMovement({
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
      expect(link.metadata?.['transferProposalKey']).toBe(`partial-source:v1:${source.movementFingerprint}`);
      expect(link.impliedFeeAmount).toBeUndefined();
    });

    it('should not produce an implied fee for N:1 partial match', () => {
      const source = createLinkableMovement({ id: 1, amount: parseDecimal('5'), direction: 'out' });
      const target = createLinkableMovement({
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
      expect(link.impliedFeeAmount).toBeUndefined();
      expect(link.metadata?.['partialMatch']).toBe(true);
      expect(link.metadata?.['transferProposalKey']).toBe(`partial-target:v1:${target.movementFingerprint}`);
    });

    it('should include variance metadata for 1:1 match (no consumed amounts)', () => {
      const source = createLinkableMovement({ id: 1, amount: parseDecimal('1.0'), direction: 'out' });
      const target = createLinkableMovement({
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
      expect(link.impliedFeeAmount?.toFixed()).toBe('0.001');
      expect(link.metadata?.['partialMatch']).toBeUndefined();
    });
  });
});
