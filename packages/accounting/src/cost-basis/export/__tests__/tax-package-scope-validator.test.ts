import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { validateTaxPackageScope } from '../tax-package-scope-validator.js';

describe('validateTaxPackageScope', () => {
  it('accepts a full US tax-year scope', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    const value = assertOk(result);
    expect(value.filingScope).toBe('full_tax_year');
    expect(value.requiredStartDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(value.requiredEndDate.toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('rejects asset-scoped export requests', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
      asset: 'BTC',
    });

    const error = assertErr(result);
    expect(error.code).toBe('PARTIAL_SCOPE');
    expect(error.message).toContain('--asset');
  });

  it('rejects custom date windows even when a config is otherwise valid', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
      hasCustomDateWindow: true,
    });

    const error = assertErr(result);
    expect(error.code).toBe('PARTIAL_SCOPE');
    expect(error.message).toContain('custom date windows');
  });

  it('rejects ranges that do not match the default filing-year window', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-02-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    const error = assertErr(result);
    expect(error.code).toBe('PARTIAL_SCOPE');
    expect(error.message).toContain('full default tax-year date range');
  });

  it('rejects unsupported jurisdictions in v1', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'UK',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    const error = assertErr(result);
    expect(error.code).toBe('UNSUPPORTED_JURISDICTION');
    expect(error.message).toContain('only CA and US');
  });

  it('rejects non-average-cost Canada exports', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'CA',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    const error = assertErr(result);
    expect(error.code).toBe('UNSUPPORTED_METHOD_FOR_JURISDICTION');
    expect(error.message).toContain('requires average-cost');
  });

  it('rejects average-cost for US exports', () => {
    const result = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'average-cost',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    const error = assertErr(result);
    expect(error.code).toBe('UNSUPPORTED_METHOD_FOR_JURISDICTION');
    expect(error.message).toContain('does not support average-cost');
  });
});
