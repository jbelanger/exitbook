import { describe, expect, it } from 'vitest';

import { CostBasisCommandOptionsSchema } from './cost-basis-option-schemas.js';

describe('CostBasisCommandOptionsSchema', () => {
  it('applies normalized method/jurisdiction validation', () => {
    const result = CostBasisCommandOptionsSchema.safeParse({
      method: 'AVERAGE-COST',
      jurisdiction: 'us',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('Canada');
  });
});
