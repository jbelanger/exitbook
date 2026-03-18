import { describe, expect, it } from 'vitest';

import { getDefaultDateRange } from '../cost-basis-config.js';

describe('getDefaultDateRange', () => {
  it('should return Jan 1 to Dec 31 for US jurisdiction', () => {
    const { startDate, endDate } = getDefaultDateRange(2024, 'US');

    expect(startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('should return Jan 1 to Dec 31 for CA jurisdiction', () => {
    const { startDate, endDate } = getDefaultDateRange(2024, 'CA');

    expect(startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('should return calendar year for UK jurisdiction', () => {
    const { startDate, endDate } = getDefaultDateRange(2024, 'UK');

    expect(startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('should return calendar year for EU jurisdiction', () => {
    const { startDate, endDate } = getDefaultDateRange(2024, 'EU');

    expect(startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('should handle different tax years', () => {
    const range2020 = getDefaultDateRange(2020, 'US');
    expect(range2020.startDate.getUTCFullYear()).toBe(2020);
    expect(range2020.endDate.getUTCFullYear()).toBe(2020);

    const range2025 = getDefaultDateRange(2025, 'CA');
    expect(range2025.startDate.getUTCFullYear()).toBe(2025);
    expect(range2025.endDate.getUTCFullYear()).toBe(2025);
  });
});
