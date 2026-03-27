import type { MatchCriteria } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createLinkableMovement } from '../../shared/test-utils.js';
import type { MatchingConfig, PotentialMatch } from '../../shared/types.js';
import type { LinkableMovement } from '../linkable-movement.js';
import { allocateMatches, shouldAutoConfirm } from '../match-allocation.js';
import { buildMatchingConfig } from '../matching-config.js';

const config: MatchingConfig = {
  ...buildMatchingConfig(),
  autoConfirmThreshold: parseDecimal('0.95'),
};

function createMatch(overrides: Partial<PotentialMatch> & { sourceId: number; targetId: number }): PotentialMatch {
  const { sourceId, targetId, ...rest } = overrides;
  return {
    sourceMovement: createLinkableMovement({ id: sourceId, direction: 'out' }),
    targetMovement: createLinkableMovement({ id: targetId, direction: 'in' }),
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
    const targetIds = all.map((m) => m.targetMovement.id);
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
    const nonHashSourceIds = all.filter((m) => m.matchCriteria.hashMatch !== true).map((m) => m.sourceMovement.id);
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
        (m) => m.sourceMovement.id === output.sourceMovement.id && m.targetMovement.id === output.targetMovement.id
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
    matchA.sourceMovement = createLinkableMovement({ id: 1, direction: 'out', amount: parseDecimal('3') });
    const matchB = createMatch({ sourceId: 1, targetId: 11, ...base });
    matchB.sourceMovement = matchA.sourceMovement;
    const matchC = createMatch({ sourceId: 1, targetId: 12, ...base });
    matchC.sourceMovement = matchA.sourceMovement;

    const order1 = allocateMatches([matchA, matchB, matchC], config);
    const order2 = allocateMatches([matchC, matchA, matchB], config);
    const order3 = allocateMatches([matchB, matchC, matchA], config);

    const toIds = (r: { confirmed: PotentialMatch[]; suggested: PotentialMatch[] }) =>
      [...r.confirmed, ...r.suggested].map((m) => m.targetMovement.id).sort();

    expect(toIds(order1)).toEqual(toIds(order2));
    expect(toIds(order2)).toEqual(toIds(order3));
  });

  it('releases capacity when a 1:1 match fails validation, allowing retry', () => {
    // Bug scenario: source #1 matches target #2 first (higher confidence),
    // but that match fails validation after 1:1 restoration (target > source).
    // The capacity should be released so source #1 can match target #3 in a retry pass.
    const source1 = createLinkableMovement({
      id: 1,
      direction: 'out',
      amount: parseDecimal('100'),
      platformKey: 'exchange-a',
      platformKind: 'exchange',
    });

    // Target with amount > source — will fail validation after 1:1 restoration
    const target2 = createLinkableMovement({
      id: 2,
      direction: 'in',
      amount: parseDecimal('200'),
      timestamp: new Date('2024-01-01T13:00:00Z'),
      platformKey: 'blockchain-a',
      platformKind: 'blockchain',
    });

    // Valid target
    const target3 = createLinkableMovement({
      id: 3,
      direction: 'in',
      amount: parseDecimal('99.5'),
      timestamp: new Date('2024-01-01T13:00:00Z'),
      platformKey: 'blockchain-b',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      // Higher confidence — processed first, accepted in pass 1, rejected in restoration
      createMatch({
        sourceId: 1,
        targetId: 2,
        confidenceScore: parseDecimal('0.95'),
        sourceMovement: source1,
        targetMovement: target2,
      }),
      // Lower confidence — rejected_no_capacity in pass 1, picked up in retry pass
      createMatch({
        sourceId: 1,
        targetId: 3,
        confidenceScore: parseDecimal('0.90'),
        sourceMovement: source1,
        targetMovement: target3,
      }),
    ];

    const result = allocateMatches(matches, config);
    const all = [...result.confirmed, ...result.suggested];

    // The invalid match (#1→#2) should be rejected
    expect(all.some((m) => m.targetMovement.id === 2)).toBe(false);

    // The valid match (#1→#3) should succeed via retry pass
    expect(all.some((m) => m.targetMovement.id === 3)).toBe(true);

    // Decision trail should show validation rejection
    expect(result.decisions.some((d) => d.targetId === 2 && d.action === 'rejected_validation')).toBe(true);
  });
});

describe('shouldAutoConfirm', () => {
  it('should auto-confirm high confidence matches', () => {
    const match: PotentialMatch = {
      sourceMovement: {} as LinkableMovement,
      targetMovement: {} as LinkableMovement,
      confidenceScore: parseDecimal('0.96'), // Above threshold
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1.0'),
        timingValid: true,
        timingHours: 1,
      },
      linkType: 'exchange_to_blockchain',
    };

    const shouldConfirm = shouldAutoConfirm(match, buildMatchingConfig());
    expect(shouldConfirm).toBe(true);
  });

  it('should not auto-confirm low confidence matches', () => {
    const match: PotentialMatch = {
      sourceMovement: {} as LinkableMovement,
      targetMovement: {} as LinkableMovement,
      confidenceScore: parseDecimal('0.85'), // Below threshold
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('0.9'),
        timingValid: true,
        timingHours: 10,
      },
      linkType: 'exchange_to_blockchain',
    };

    const shouldConfirm = shouldAutoConfirm(match, buildMatchingConfig());
    expect(shouldConfirm).toBe(false);
  });
});

describe('allocateMatches scenarios', () => {
  it('should deduplicate matches (one source per target)', () => {
    const matches: PotentialMatch[] = [
      {
        sourceMovement: {
          id: 1,
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 2,
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
        } as LinkableMovement,
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
        sourceMovement: {
          id: 3,
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 2,
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
        } as LinkableMovement,
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

    const { suggested, confirmed } = allocateMatches(matches, buildMatchingConfig());

    // Should only keep the higher confidence match (0.98)
    expect([...suggested, ...confirmed]).toHaveLength(1);
    expect([...suggested, ...confirmed][0]?.sourceMovement.id).toBe(1);
  });

  it('should auto-confirm high confidence matches', () => {
    const matches: PotentialMatch[] = [
      {
        sourceMovement: {
          id: 1,
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 2,
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
        } as LinkableMovement,
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

    const { suggested, confirmed } = allocateMatches(matches, {
      ...buildMatchingConfig(),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(confirmed).toHaveLength(1);
    expect(suggested).toHaveLength(0);
  });

  it('should suggest low confidence matches', () => {
    const matches: PotentialMatch[] = [
      {
        sourceMovement: {
          id: 1,
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 2,
          assetSymbol: 'BTC',
          amount: parseDecimal('0.95'),
        } as LinkableMovement,
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

    const { suggested, confirmed } = allocateMatches(matches, buildMatchingConfig());

    expect(suggested).toHaveLength(1);
    expect(confirmed).toHaveLength(0);
  });

  it('should handle multiple independent matches', () => {
    const matches: PotentialMatch[] = [
      {
        sourceMovement: {
          id: 1,
          assetSymbol: 'BTC',
          amount: parseDecimal('1.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 2,
          assetSymbol: 'BTC',
          amount: parseDecimal('0.9995'),
        } as LinkableMovement,
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
        sourceMovement: {
          id: 3,
          assetSymbol: 'ETH',
          amount: parseDecimal('10.0'),
        } as LinkableMovement,
        targetMovement: {
          id: 4,
          assetSymbol: 'ETH',
          amount: parseDecimal('9.98'),
        } as LinkableMovement,
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

    const { suggested, confirmed } = allocateMatches(matches, {
      ...buildMatchingConfig(),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    expect(confirmed).toHaveLength(2);
    expect(suggested).toHaveLength(0);
  });

  it('should split one source across two targets (1:N)', () => {
    const source = createLinkableMovement({ id: 1, amount: parseDecimal('10'), direction: 'out' });
    const target1 = createLinkableMovement({
      id: 2,
      amount: parseDecimal('5'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });
    const target2 = createLinkableMovement({
      id: 3,
      amount: parseDecimal('5'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source,
        targetMovement: target1,
        confidenceScore: parseDecimal('0.9'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      },
      {
        sourceMovement: source,
        targetMovement: target2,
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 2 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed, suggested } = allocateMatches(matches, buildMatchingConfig());
    const all = [...confirmed, ...suggested];

    expect(all).toHaveLength(2);
    expect(all[0]!.consumedAmount?.toFixed()).toBe('5');
    expect(all[1]!.consumedAmount?.toFixed()).toBe('5');
  });

  it('should consolidate two sources into one target (N:1)', () => {
    const source1 = createLinkableMovement({ id: 1, amount: parseDecimal('5'), direction: 'out' });
    const source2 = createLinkableMovement({ id: 2, amount: parseDecimal('5'), direction: 'out' });
    const target = createLinkableMovement({
      id: 3,
      amount: parseDecimal('10'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source1,
        targetMovement: target,
        confidenceScore: parseDecimal('0.9'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      },
      {
        sourceMovement: source2,
        targetMovement: target,
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.5'), timingValid: true, timingHours: 2 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed, suggested } = allocateMatches(matches, buildMatchingConfig());
    const all = [...confirmed, ...suggested];

    expect(all).toHaveLength(2);
    expect(all[0]!.consumedAmount?.toFixed()).toBe('5');
    expect(all[1]!.consumedAmount?.toFixed()).toBe('5');
  });

  it('should reject match when consumed is below minPartialMatchFraction of larger original', () => {
    const source = createLinkableMovement({ id: 1, amount: parseDecimal('10'), direction: 'out' });
    const target = createLinkableMovement({
      id: 2,
      amount: parseDecimal('0.5'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.9'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.05'),
          timingValid: true,
          timingHours: 1,
        },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const config = { ...buildMatchingConfig(), minPartialMatchFraction: parseDecimal('0.1') };
    const { confirmed, suggested } = allocateMatches(matches, config);

    expect([...confirmed, ...suggested]).toHaveLength(0);
  });

  it('should preserve original amounts for 1:1 matches (restoration pass)', () => {
    const source = createLinkableMovement({ id: 1, amount: parseDecimal('1.0'), direction: 'out' });
    const target = createLinkableMovement({
      id: 2,
      amount: parseDecimal('0.999'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.999'),
          timingValid: true,
          timingHours: 1,
        },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed } = allocateMatches(matches, buildMatchingConfig());

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.consumedAmount).toBeUndefined();
  });

  it('should partially consume remaining capacity when exhausted', () => {
    const source = createLinkableMovement({ id: 1, amount: parseDecimal('10'), direction: 'out' });
    const target1 = createLinkableMovement({
      id: 2,
      amount: parseDecimal('6'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });
    const target2 = createLinkableMovement({
      id: 3,
      amount: parseDecimal('6'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source,
        targetMovement: target1,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.6'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      },
      {
        sourceMovement: source,
        targetMovement: target2,
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.6'), timingValid: true, timingHours: 2 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed, suggested } = allocateMatches(matches, buildMatchingConfig());
    const all = [...confirmed, ...suggested];

    expect(all).toHaveLength(2);
    expect(all[0]!.consumedAmount?.toFixed()).toBe('6');
    expect(all[1]!.consumedAmount?.toFixed()).toBe('4');
  });

  it('should keep partial matches suggested when they do not fully cover the target movement', () => {
    const source1 = createLinkableMovement({ id: 1, amount: parseDecimal('4'), direction: 'out' });
    const source2 = createLinkableMovement({ id: 2, amount: parseDecimal('3'), direction: 'out' });
    const target = createLinkableMovement({
      id: 3,
      amount: parseDecimal('10'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source1,
        targetMovement: target,
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.7'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      },
      {
        sourceMovement: source2,
        targetMovement: target,
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('0.7'), timingValid: true, timingHours: 2 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed, suggested } = allocateMatches(matches, buildMatchingConfig());

    expect(confirmed).toHaveLength(0);
    expect(suggested).toHaveLength(2);
    expect(suggested.map((match) => match.consumedAmount?.toFixed())).toEqual(['4', '3']);
  });

  it('should auto-confirm partial matches when they fully partition both sides', () => {
    const source1 = createLinkableMovement({ id: 1, amount: parseDecimal('4'), direction: 'out' });
    const source2 = createLinkableMovement({ id: 2, amount: parseDecimal('6'), direction: 'out' });
    const target = createLinkableMovement({
      id: 3,
      amount: parseDecimal('10'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source1,
        targetMovement: target,
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('1'), timingValid: true, timingHours: 1 },
        linkType: 'exchange_to_blockchain',
      },
      {
        sourceMovement: source2,
        targetMovement: target,
        confidenceScore: parseDecimal('0.98'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('1'), timingValid: true, timingHours: 2 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed, suggested } = allocateMatches(matches, buildMatchingConfig());

    expect(confirmed).toHaveLength(2);
    expect(suggested).toHaveLength(0);
    expect(confirmed.map((match) => match.consumedAmount?.toFixed())).toEqual(['4', '6']);
  });

  it('should not set consumed amounts for exact 1:1 match', () => {
    const source = createLinkableMovement({ id: 1, amount: parseDecimal('5'), direction: 'out' });
    const target = createLinkableMovement({
      id: 2,
      amount: parseDecimal('5'),
      direction: 'in',
      platformKey: 'blockchain',
      platformKind: 'blockchain',
    });

    const matches: PotentialMatch[] = [
      {
        sourceMovement: source,
        targetMovement: target,
        confidenceScore: parseDecimal('0.99'),
        matchCriteria: { assetMatch: true, amountSimilarity: parseDecimal('1'), timingValid: true, timingHours: 0.5 },
        linkType: 'exchange_to_blockchain',
      },
    ];

    const { confirmed } = allocateMatches(matches, buildMatchingConfig());

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.consumedAmount).toBeUndefined();
  });
});
