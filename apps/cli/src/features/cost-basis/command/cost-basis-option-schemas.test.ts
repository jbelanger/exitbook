import { describe, expect, it } from 'vitest';

import { CostBasisCommandOptionsSchema, CostBasisExportCommandOptionsSchema } from './cost-basis-option-schemas.js';

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

describe('CostBasisExportCommandOptionsSchema', () => {
  it('strips fiat currency overrides for tax package export', () => {
    const result = CostBasisExportCommandOptionsSchema.safeParse({
      jurisdiction: 'CA',
      taxYear: '2024',
      fiatCurrency: 'EUR',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('fiatCurrency');
    }
  });
});
