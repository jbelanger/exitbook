import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCHING_CONFIG } from '../matching/matching-config.js';

import { AmountTimingStrategy } from './amount-timing-strategy.js';
import { createImpossibleMultiSourceAdaHashPartialScenario } from './test-utils.js';

describe('AmountTimingStrategy', () => {
  it('suppresses multi-source hash partial suggestions that cannot survive same-hash fee deduplication', () => {
    const strategy = new AmountTimingStrategy();
    const { sources, targets } = createImpossibleMultiSourceAdaHashPartialScenario();

    const result = assertOk(strategy.execute(sources, targets, DEFAULT_MATCHING_CONFIG));

    expect(result.links).toHaveLength(0);
  });
});
