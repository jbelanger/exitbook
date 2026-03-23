import { describe, expect, it } from 'vitest';

import { PortfolioCommandOptionsSchema } from './portfolio-option-schemas.js';

describe('PortfolioCommandOptionsSchema', () => {
  it('accepts mixed-case valid combinations after normalization', () => {
    const result = PortfolioCommandOptionsSchema.safeParse({
      method: 'AVERAGE-COST',
      jurisdiction: 'ca',
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid combinations using accounting validation', () => {
    const result = PortfolioCommandOptionsSchema.safeParse({
      method: 'fifo',
      jurisdiction: 'ca',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('average-cost');
  });
});
