import { describe, expect, it } from 'vitest';

import { resolveLinkReviewScope } from '../links-review-utils.js';

import { createMockLink } from './test-utils.js';

describe('resolveLinkReviewScope', () => {
  it('groups links by reviewGroupKey when present', () => {
    const first = createMockLink(1, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
        reviewGroupKey: 'partial-target:v1:target',
      },
    });
    const second = createMockLink(2, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
        reviewGroupKey: 'partial-target:v1:target',
      },
    });
    const third = createMockLink(3, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '5',
        consumedAmount: '5',
        reviewGroupKey: 'partial-source:v1:other',
      },
    });

    const scope = resolveLinkReviewScope(first, [first, second, third]);

    expect(scope.reviewGroupKey).toBe('partial-target:v1:target');
    expect(scope.links.map((link) => link.id)).toEqual([1, 2]);
  });

  it('falls back to shared target movement closure for legacy partial groups', () => {
    const first = createMockLink(1, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
      },
    });
    const second = createMockLink(2, {
      sourceMovementFingerprint: 'movement:exchange:source:2:btc:outflow:0',
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
      },
    });

    const scope = resolveLinkReviewScope(first, [first, second]);

    expect(scope.reviewGroupKey).toBeUndefined();
    expect(scope.links.map((link) => link.id)).toEqual([1, 2]);
  });
});
