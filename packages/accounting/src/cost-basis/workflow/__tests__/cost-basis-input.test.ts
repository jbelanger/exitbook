import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCostBasisInput, validateCostBasisInput } from '../cost-basis-input.js';

describe('cost-basis-input', () => {
  describe('buildCostBasisInput', () => {
    describe('currency validation', () => {
      it('accepts valid fiat currency', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'USD',
        });

        expect(assertOk(result).currency).toBe('USD');
      });

      it('accepts CAD as valid currency', () => {
        const result = buildCostBasisInput({
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          fiatCurrency: 'CAD',
        });

        expect(assertOk(result).currency).toBe('CAD');
      });

      it('accepts EUR as valid currency', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'EUR',
        });

        expect(assertOk(result).currency).toBe('EUR');
      });

      it('accepts GBP as valid currency', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'GBP',
        });

        expect(assertOk(result).currency).toBe('GBP');
      });

      it('rejects invalid fiat currency', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'AUD',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Invalid fiat currency');
        expect(resultError.message).toContain('AUD');
        expect(resultError.message).toContain('USD, CAD, EUR, GBP');
      });

      it('does not silently coerce invalid currency to default', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'AUD',
        });

        assertErr(result);
      });

      it('uses default currency when not provided for US', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        expect(assertOk(result).currency).toBe('USD');
      });

      it('uses default currency when not provided for Canada', () => {
        const result = buildCostBasisInput({
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
        });

        expect(assertOk(result).currency).toBe('CAD');
      });
    });

    describe('date range handling', () => {
      it('accepts valid custom date range', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        const value = assertOk(result);
        expect(value.startDate.toISOString()).toBe('2024-03-01T00:00:00.000Z');
        expect(value.endDate.toISOString()).toBe('2024-09-30T00:00:00.000Z');
      });

      it('rejects startDate without endDate', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-03-01',
        });

        expect(assertErr(result).message).toContain('Both startDate and endDate must be provided together');
      });

      it('rejects endDate without startDate', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          endDate: '2024-09-30',
        });

        expect(assertErr(result).message).toContain('Both startDate and endDate must be provided together');
      });

      it('rejects invalid startDate', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: 'invalid-date',
          endDate: '2024-09-30',
        });

        expect(assertErr(result).message).toContain("Invalid startDate 'invalid-date'");
      });

      it('rejects invalid endDate', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-03-01',
          endDate: 'invalid-date',
        });

        expect(assertErr(result).message).toContain("Invalid endDate 'invalid-date'");
      });

      it('rejects startDate >= endDate', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-09-30',
          endDate: '2024-03-01',
        });

        expect(assertErr(result).message).toContain('startDate must be before endDate');
      });

      it('uses default date range when dates not provided', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        const value = assertOk(result);
        expect(value.startDate.getUTCFullYear()).toBe(2024);
        expect(value.endDate.getUTCFullYear()).toBe(2024);
      });
    });

    describe('field validation', () => {
      it('rejects invalid jurisdiction', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'INVALID',
          taxYear: 2024,
        });

        expect(assertErr(result).message).toContain("Invalid jurisdiction 'INVALID'");
      });

      it('rejects invalid method', () => {
        const result = buildCostBasisInput({
          method: 'invalid-method',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        expect(assertErr(result).message).toContain("Invalid method 'invalid-method'");
      });

      it('rejects invalid tax year string', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 'not-a-year',
        });

        expect(assertErr(result).message).toContain("Invalid tax year 'not-a-year'");
      });

      it('rejects out of range tax year', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 1900,
        });

        expect(assertErr(result).message).toContain('out of reasonable range');
      });

      it('accepts numeric string tax year', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: '2024',
        });

        expect(assertOk(result).taxYear).toBe(2024);
      });

      it('requires average-cost for Canada', () => {
        const result = buildCostBasisInput({
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
        });

        expect(assertErr(result).message).toContain('supports only average-cost');
      });

      it('rejects average-cost for non-Canada', () => {
        const result = buildCostBasisInput({
          method: 'average-cost',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        expect(assertErr(result).message).toContain('Average Cost (ACB) is only supported for Canada');
      });

      it('allows omitted method for single-method Canada', () => {
        const result = buildCostBasisInput({
          jurisdiction: 'CA',
          taxYear: 2024,
        });

        expect(assertOk(result).method).toBe('average-cost');
      });

      it('errors when method is omitted for US', () => {
        const result = buildCostBasisInput({
          jurisdiction: 'US',
          taxYear: 2024,
        });

        const error = assertErr(result);
        expect(error.message).toContain("--method is required for jurisdiction 'US'");
        expect(error.message).toContain('fifo, lifo');
      });
    });
  });

  describe('validateCostBasisInput', () => {
    it('accepts valid US parameters', () => {
      const result = validateCostBasisInput({
        method: 'fifo',
        jurisdiction: 'US',
        taxYear: 2024,
        currency: 'USD',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      assertOk(result);
    });

    it('accepts average-cost for Canada', () => {
      const result = validateCostBasisInput({
        method: 'average-cost',
        jurisdiction: 'CA',
        taxYear: 2024,
        currency: 'CAD',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      assertOk(result);
    });

    it('errors when average-cost is used with non-Canada jurisdiction', () => {
      const result = validateCostBasisInput({
        method: 'average-cost',
        jurisdiction: 'US',
        taxYear: 2024,
        currency: 'USD',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      expect(assertErr(result).message).toContain('Average Cost (ACB) is only supported for Canada');
    });

    it('errors when Canada uses fifo', () => {
      const result = validateCostBasisInput({
        method: 'fifo',
        jurisdiction: 'CA',
        taxYear: 2024,
        currency: 'CAD',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      expect(assertErr(result).message).toContain('supports only average-cost');
    });

    it('errors when specific-id is used', () => {
      const result = validateCostBasisInput({
        method: 'specific-id',
        jurisdiction: 'US',
        taxYear: 2024,
        currency: 'USD',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      expect(assertErr(result).message).toContain('not yet implemented');
    });

    it('errors for UK jurisdiction', () => {
      const result = validateCostBasisInput({
        method: 'fifo',
        jurisdiction: 'UK',
        taxYear: 2024,
        currency: 'GBP',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });

      expect(assertErr(result).message).toContain('tax rules not yet implemented');
    });
  });
});
