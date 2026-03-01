import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { calculateConfidenceScore } from '../candidate-scoring.js';
import { allocateMatches } from '../match-allocation.js';
import { DEFAULT_MATCHING_CONFIG } from '../matching-utils.js';
import type { MatchCriteria, MatchingConfig, PotentialMatch } from '../types.js';

import { createCandidate } from './test-utils.js';

const config: MatchingConfig = {
  ...DEFAULT_MATCHING_CONFIG,
  autoConfirmThreshold: parseDecimal('0.95'),
};

function createMatch(overrides: Partial<PotentialMatch> & { sourceId: number; targetId: number }): PotentialMatch {
  const { sourceId, targetId, ...rest } = overrides;
  return {
    sourceTransaction: createCandidate({ id: sourceId, direction: 'out' }),
    targetTransaction: createCandidate({ id: targetId, direction: 'in' }),
    confidenceScore: parseDecimal('0.9'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.98'),
      timingValid: true,
      timingHours: 1,
    },
    linkType: 'exchange_to_blockchain',
    ...rest,
  };
}

describe('allocateMatches invariants', () => {
  it('no target appears in more than one output match', () => {
    const matches: PotentialMatch[] = [
      createMatch({ sourceId: 1, targetId: 10, confidenceScore: parseDecimal('0.95') }),
      createMatch({ sourceId: 2, targetId: 10, confidenceScore: parseDecimal('0.85') }),
      createMatch({ sourceId: 3, targetId: 11, confidenceScore: parseDecimal('0.80') }),
    ];

    const result = allocateMatches(matches, config);
    const all = [...result.confirmed, ...result.suggested];
    const targetIds = all.map((m) => m.targetTransaction.id);
    expect(new Set(targetIds).size).toBe(targetIds.length);
  });

  it('no source appears in more than one non-hash match', () => {
    const matches: PotentialMatch[] = [
      createMatch({ sourceId: 1, targetId: 10, confidenceScore: parseDecimal('0.95') }),
      createMatch({ sourceId: 1, targetId: 11, confidenceScore: parseDecimal('0.90') }),
      createMatch({ sourceId: 2, targetId: 12, confidenceScore: parseDecimal('0.85') }),
    ];

    const result = allocateMatches(matches, config);
    const all = [...result.confirmed, ...result.suggested];
    const nonHashSourceIds = all.filter((m) => m.matchCriteria.hashMatch !== true).map((m) => m.sourceTransaction.id);
    expect(new Set(nonHashSourceIds).size).toBe(nonHashSourceIds.length);
  });

  it('output is a subset of input (no synthesized matches)', () => {
    const matches: PotentialMatch[] = [
      createMatch({ sourceId: 1, targetId: 10, confidenceScore: parseDecimal('0.95') }),
      createMatch({ sourceId: 2, targetId: 11, confidenceScore: parseDecimal('0.80') }),
      createMatch({ sourceId: 3, targetId: 12, confidenceScore: parseDecimal('0.75') }),
    ];

    const result = allocateMatches(matches, config);
    const all = [...result.confirmed, ...result.suggested];

    for (const output of all) {
      const found = matches.some(
        (m) =>
          m.sourceTransaction.id === output.sourceTransaction.id &&
          m.targetTransaction.id === output.targetTransaction.id
      );
      expect(found).toBe(true);
    }
  });

  it('deterministic output for shuffled input with equal-confidence matches', () => {
    const base = {
      confidenceScore: parseDecimal('1.0'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 0.5,
        hashMatch: true,
      } satisfies MatchCriteria,
    };

    // Source has amount=3 so capacity covers all three targets (amount=1 each)
    const matchA = createMatch({ sourceId: 1, targetId: 10, ...base });
    matchA.sourceTransaction = createCandidate({ id: 1, direction: 'out', amount: parseDecimal('3') });
    const matchB = createMatch({ sourceId: 1, targetId: 11, ...base });
    matchB.sourceTransaction = matchA.sourceTransaction;
    const matchC = createMatch({ sourceId: 1, targetId: 12, ...base });
    matchC.sourceTransaction = matchA.sourceTransaction;

    const order1 = allocateMatches([matchA, matchB, matchC], config);
    const order2 = allocateMatches([matchC, matchA, matchB], config);
    const order3 = allocateMatches([matchB, matchC, matchA], config);

    const toIds = (r: { confirmed: PotentialMatch[]; suggested: PotentialMatch[] }) =>
      [...r.confirmed, ...r.suggested].map((m) => m.targetTransaction.id).sort();

    expect(toIds(order1)).toEqual(toIds(order2));
    expect(toIds(order2)).toEqual(toIds(order3));
  });

  it('releases capacity when a 1:1 match fails validation, allowing retry', () => {
    // Bug scenario: source #1 matches target #2 first (higher confidence),
    // but that match fails validation after 1:1 restoration (target > source).
    // The capacity should be released so source #1 can match target #3 in a retry pass.
    const source1 = createCandidate({
      id: 1,
      direction: 'out',
      amount: parseDecimal('100'),
      sourceName: 'exchange-a',
      sourceType: 'exchange',
    });

    // Target with amount > source — will fail validation after 1:1 restoration
    const target2 = createCandidate({
      id: 2,
      direction: 'in',
      amount: parseDecimal('200'),
      timestamp: new Date('2024-01-01T13:00:00Z'),
      sourceName: 'blockchain-a',
      sourceType: 'blockchain',
    });

    // Valid target
    const target3 = createCandidate({
      id: 3,
      direction: 'in',
      amount: parseDecimal('99.5'),
      timestamp: new Date('2024-01-01T13:00:00Z'),
      sourceName: 'blockchain-b',
      sourceType: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      // Higher confidence — processed first, accepted in pass 1, rejected in restoration
      createMatch({
        sourceId: 1,
        targetId: 2,
        confidenceScore: parseDecimal('0.95'),
        sourceTransaction: source1,
        targetTransaction: target2,
      }),
      // Lower confidence — rejected_no_capacity in pass 1, picked up in retry pass
      createMatch({
        sourceId: 1,
        targetId: 3,
        confidenceScore: parseDecimal('0.90'),
        sourceTransaction: source1,
        targetTransaction: target3,
      }),
    ];

    const result = allocateMatches(matches, config);
    const all = [...result.confirmed, ...result.suggested];

    // The invalid match (#1→#2) should be rejected
    expect(all.some((m) => m.targetTransaction.id === 2)).toBe(false);

    // The valid match (#1→#3) should succeed via retry pass
    expect(all.some((m) => m.targetTransaction.id === 3)).toBe(true);

    // Decision trail should show validation rejection
    expect(result.decisions.some((d) => d.targetId === 2 && d.action === 'rejected_validation')).toBe(true);
  });

  it('calculateConfidenceScore always returns [0, 1] for valid criteria', () => {
    const testCases: MatchCriteria[] = [
      {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 0,
        addressMatch: true,
      },
      { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: false, timingHours: 100 },
      { assetMatch: true, amountSimilarity: parseDecimal('0'), timingValid: true, timingHours: 24 },
      {
        assetMatch: false,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 0,
        addressMatch: true,
      },
      {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: true,
        timingHours: 0.5,
        addressMatch: false,
      },
      {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.95'),
        timingValid: true,
        timingHours: 0.5,
        addressMatch: undefined,
      },
    ];

    for (const criteria of testCases) {
      const score = calculateConfidenceScore(criteria);
      expect(score.gte(0)).toBe(true);
      expect(score.lte(1)).toBe(true);
    }
  });
});
