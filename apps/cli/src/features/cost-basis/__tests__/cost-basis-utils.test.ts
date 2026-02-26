import { describe, expect, it } from 'vitest';

import { buildCostBasisParamsFromFlags, type CostBasisCommandOptions } from '../cost-basis-utils.js';

describe('buildCostBasisParamsFromFlags', () => {
  it('should error if method is missing', () => {
    const options: CostBasisCommandOptions = {
      jurisdiction: 'US',
      taxYear: 2024,
    };

    const result = buildCostBasisParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('--method is required');
    }
  });

  it('should error if jurisdiction is missing', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      taxYear: 2024,
    };

    const result = buildCostBasisParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('--jurisdiction is required');
    }
  });

  it('should error if tax year is missing', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'US',
    };

    const result = buildCostBasisParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('--tax-year is required');
    }
  });

  it('should delegate to buildCostBasisParams when all required fields present', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'US',
      taxYear: 2024,
    };

    const result = buildCostBasisParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.method).toBe('fifo');
      expect(result.value.config.jurisdiction).toBe('US');
      expect(result.value.config.taxYear).toBe(2024);
      expect(result.value.config.currency).toBe('USD');
      expect(result.value.config.startDate).toBeInstanceOf(Date);
      expect(result.value.config.endDate).toBeInstanceOf(Date);
    }
  });

  it('should pass through fiatCurrency and date overrides', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'CA',
      taxYear: 2024,
      fiatCurrency: 'EUR',
      startDate: '2024-06-01',
      endDate: '2024-12-31',
    };

    const result = buildCostBasisParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.currency).toBe('EUR');
      expect(result.value.config.startDate?.toISOString().split('T')[0]).toBe('2024-06-01');
      expect(result.value.config.endDate?.toISOString().split('T')[0]).toBe('2024-12-31');
    }
  });
});
