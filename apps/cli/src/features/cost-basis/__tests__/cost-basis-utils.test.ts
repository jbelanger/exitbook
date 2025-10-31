import { describe, expect, it } from 'vitest';

import { buildCostBasisParamsFromFlags, type CostBasisCommandOptions } from '../cost-basis-utils.ts';

describe('Cost Basis Utils', () => {
  describe('buildCostBasisParamsFromFlags', () => {
    describe('currency validation', () => {
      it('should accept valid fiat currency', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'USD',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('USD');
        }
      });

      it('should accept CAD as valid currency', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
          fiatCurrency: 'CAD',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('CAD');
        }
      });

      it('should accept EUR as valid currency', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'EUR',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('EUR');
        }
      });

      it('should accept GBP as valid currency', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'GBP',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('GBP');
        }
      });

      it('should reject invalid fiat currency (AUD) and return error', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'AUD', // Invalid - not in the list
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid fiat currency');
          expect(result.error.message).toContain('AUD');
          expect(result.error.message).toContain('USD, CAD, EUR, GBP');
        }
      });

      it('should reject invalid fiat currency (JPY) and return error', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
          fiatCurrency: 'JPY', // Invalid
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid fiat currency');
          expect(result.error.message).toContain('JPY');
        }
      });

      it('should reject invalid fiat currency (BTC) and return error', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'BTC', // Crypto, not fiat
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid fiat currency');
          expect(result.error.message).toContain('BTC');
        }
      });

      it('should use default currency when not provided (US -> USD)', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          // No fiatCurrency provided
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('USD');
        }
      });

      it('should use default currency when not provided (CA -> CAD)', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
          // No fiatCurrency provided
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.currency).toBe('CAD');
        }
      });

      it('should NOT silently coerce invalid currency to default', () => {
        // This is the critical test for the bug fix
        // Previously, this would silently return 'USD' instead of an error
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'AUD', // Invalid
        };

        const result = buildCostBasisParamsFromFlags(options);

        // Must fail with error, not silently default to USD
        expect(result.isErr()).toBe(true);
        if (result.isOk()) {
          // This should NOT happen - if it does, the bug is back
          throw new Error('Expected error but got success with currency: ' + result.value.config.currency);
        }
      });
    });

    describe('date range handling', () => {
      it('should use default tax year dates when custom dates not provided', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          // Critical bug fix test: dates must be defined (not undefined)
          // This ensures the bug where interactive flow crashed is fixed
          expect(result.value.config.startDate).toBeDefined();
          expect(result.value.config.endDate).toBeDefined();
          expect(result.value.config.startDate).toBeInstanceOf(Date);
          expect(result.value.config.endDate).toBeInstanceOf(Date);
          // Verify end date is after start date
          expect(result.value.config.endDate!.getTime()).toBeGreaterThan(result.value.config.startDate!.getTime());
        }
      });

      it('should use custom dates when provided', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
          endDate: '2024-12-31',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.config.startDate?.toISOString().split('T')[0]).toBe('2024-06-01');
          expect(result.value.config.endDate?.toISOString().split('T')[0]).toBe('2024-12-31');
        }
      });

      it('should error if only start date provided', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
          // endDate missing
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Both --start-date and --end-date must be provided together');
        }
      });

      it('should error if only end date provided', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          endDate: '2024-12-31',
          // startDate missing
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Both --start-date and --end-date must be provided together');
        }
      });

      it('should error if start date is after end date', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-12-31',
          endDate: '2024-01-01',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('start-date must be before');
        }
      });

      it('should error if dates are equal', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
          endDate: '2024-06-01',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('start-date must be before');
        }
      });
    });

    describe('required fields validation', () => {
      it('should error if method is missing', () => {
        const options: CostBasisCommandOptions = {
          jurisdiction: 'US',
          taxYear: 2024,
          // method missing
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
          // jurisdiction missing
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
          // taxYear missing
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('--tax-year is required');
        }
      });

      it('should error if method is invalid', () => {
        const options: CostBasisCommandOptions = {
          method: 'random',
          jurisdiction: 'US',
          taxYear: 2024,
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid method');
          expect(result.error.message).toContain('random');
        }
      });

      it('should error if jurisdiction is invalid', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'AU',
          taxYear: 2024,
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid jurisdiction');
          expect(result.error.message).toContain('AU');
        }
      });

      it('should error if tax year is invalid (non-numeric)', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 'invalid',
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid tax year');
        }
      });

      it('should error if tax year is out of range (too old)', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 1999,
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('out of reasonable range');
        }
      });

      it('should error if tax year is out of range (too far future)', () => {
        const options: CostBasisCommandOptions = {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2101,
        };

        const result = buildCostBasisParamsFromFlags(options);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('out of reasonable range');
        }
      });
    });
  });
});
