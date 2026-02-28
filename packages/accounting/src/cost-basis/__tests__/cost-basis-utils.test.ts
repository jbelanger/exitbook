import type { UniversalTransactionData } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildCostBasisParams,
  filterTransactionsByDateRange,
  formatCurrency,
  getJurisdictionRules,
  transactionHasAllPrices,
  validateCostBasisParams,
  validateTransactionPrices,
} from '../cost-basis-utils.js';

describe('cost-basis-utils', () => {
  describe('buildCostBasisParams', () => {
    describe('currency validation', () => {
      it('should accept valid fiat currency', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'USD',
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('USD');
      });

      it('should accept CAD as valid currency', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
          fiatCurrency: 'CAD',
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('CAD');
      });

      it('should accept EUR as valid currency', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'EUR',
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('EUR');
      });

      it('should accept GBP as valid currency', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'GBP',
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('GBP');
      });

      it('should reject invalid fiat currency', () => {
        const result = buildCostBasisParams({
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

      it('should not silently coerce invalid currency to default', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          fiatCurrency: 'AUD',
        });

        assertErr(result);
      });

      it('should use default currency when not provided (US -> USD)', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('USD');
      });

      it('should use default currency when not provided (CA -> CAD)', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'CA',
          taxYear: 2024,
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.currency).toBe('CAD');
      });
    });

    describe('date range handling', () => {
      it('should use default tax year dates when custom dates not provided', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.startDate).toBeInstanceOf(Date);
        expect(resultValue.config.endDate).toBeInstanceOf(Date);
        expect(resultValue.config.endDate.getTime()).toBeGreaterThan(resultValue.config.startDate.getTime());
      });

      it('should use custom dates when provided', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
          endDate: '2024-12-31',
        });

        const resultValue = assertOk(result);
        expect(resultValue.config.startDate?.toISOString().split('T')[0]).toBe('2024-06-01');
        expect(resultValue.config.endDate?.toISOString().split('T')[0]).toBe('2024-12-31');
      });

      it('should error if only start date provided', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Both startDate and endDate must be provided together');
      });

      it('should error if only end date provided', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          endDate: '2024-12-31',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Both startDate and endDate must be provided together');
      });

      it('should error if start date is after end date', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-12-31',
          endDate: '2024-01-01',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('startDate must be before endDate');
      });

      it('should error if dates are equal', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: '2024-06-01',
          endDate: '2024-06-01',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('startDate must be before endDate');
      });
    });

    describe('field validation', () => {
      it('should error if method is invalid', () => {
        const result = buildCostBasisParams({
          method: 'random',
          jurisdiction: 'US',
          taxYear: 2024,
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Invalid method');
        expect(resultError.message).toContain('random');
      });

      it('should error if jurisdiction is invalid', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'AU',
          taxYear: 2024,
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Invalid jurisdiction');
        expect(resultError.message).toContain('AU');
      });

      it('should error if tax year is invalid (non-numeric)', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 'invalid',
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('Invalid tax year');
      });

      it('should error if tax year is out of range (too old)', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 1999,
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('out of reasonable range');
      });

      it('should error if tax year is out of range (too far future)', () => {
        const result = buildCostBasisParams({
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2101,
        });

        const resultError = assertErr(result);
        expect(resultError.message).toContain('out of reasonable range');
      });
    });
  });

  describe('filterTransactionsByDateRange', () => {
    it('should filter transactions within date range', () => {
      const transactions: UniversalTransactionData[] = [
        { timestamp: '2024-01-01T00:00:00Z' } as unknown as UniversalTransactionData,
        { timestamp: '2024-06-01T00:00:00Z' } as unknown as UniversalTransactionData,
        { timestamp: '2024-12-31T23:59:59Z' } as unknown as UniversalTransactionData,
        { timestamp: '2025-01-01T00:00:00Z' } as unknown as UniversalTransactionData,
      ];

      const result = filterTransactionsByDateRange(
        transactions,
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z')
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.timestamp).toBe('2024-06-01T00:00:00Z');
      expect(result[1]?.timestamp).toBe('2024-12-31T23:59:59Z');
    });

    it('should return empty array when no transactions in range', () => {
      const transactions: UniversalTransactionData[] = [
        { timestamp: '2023-01-01T00:00:00Z' } as unknown as UniversalTransactionData,
        { timestamp: '2023-12-31T00:00:00Z' } as unknown as UniversalTransactionData,
      ];

      const result = filterTransactionsByDateRange(
        transactions,
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z')
      );

      expect(result).toHaveLength(0);
    });

    it('should include transactions on boundary dates', () => {
      const transactions: UniversalTransactionData[] = [
        { timestamp: '2024-01-01T00:00:00Z' } as unknown as UniversalTransactionData,
        { timestamp: '2024-12-31T23:59:59Z' } as unknown as UniversalTransactionData,
      ];

      const result = filterTransactionsByDateRange(
        transactions,
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z')
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('transactionHasAllPrices', () => {
    it('should return true when all crypto movements have prices', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: '50000.00' }],
          outflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: '3000.00' }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(true);
    });

    it('should return false when crypto inflow is missing price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: undefined }],
          outflows: [],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(false);
    });

    it('should return false when crypto outflow is missing price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(false);
    });

    it('should return true when only fiat movements (no price needed)', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [{ assetSymbol: 'USD', amount: '1000.0', priceAtTxTime: undefined }],
          outflows: [{ assetSymbol: 'CAD', amount: '1300.0', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(true);
    });

    it('should return true when fiat and crypto both present, crypto has price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [
            { assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: '50000.00' },
            { assetSymbol: 'USD', amount: '50000.0', priceAtTxTime: undefined },
          ],
          outflows: [],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(true);
    });

    it('should return false when fiat and crypto both present, crypto missing price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [
            { assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: undefined },
            { assetSymbol: 'USD', amount: '50000.0', priceAtTxTime: undefined },
          ],
          outflows: [],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(false);
    });

    it('should handle empty inflows and outflows', () => {
      const tx: UniversalTransactionData = {
        movements: { inflows: [], outflows: [] },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(true);
    });

    it('should treat unknown currency symbols as crypto requiring price', () => {
      const tx = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'INVALID-SYM', amount: '1', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(false);
    });

    it('should treat unknown currency symbols as valid when price is present', () => {
      const tx = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'INVALID-SYM', amount: '1', priceAtTxTime: '100' }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultValue = assertOk(result);
      expect(resultValue).toBe(true);
    });

    it('should return error for empty currency symbols', () => {
      const tx = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: '', amount: '1', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      const result = transactionHasAllPrices(tx);
      const resultError = assertErr(result);
      expect(resultError.message).toContain('Unknown currency symbol');
    });
  });

  describe('validateTransactionPrices', () => {
    it('should return all valid transactions when all have prices', () => {
      const transactions: UniversalTransactionData[] = [
        {
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: '50000.00' }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          movements: {
            inflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: '3000.00' }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const result = validateTransactionPrices(transactions, 'USD');
      const resultValue = assertOk(result);
      expect(resultValue.validTransactions).toHaveLength(2);
      expect(resultValue.missingPricesCount).toBe(0);
    });

    it('should filter out transactions missing prices', () => {
      const transactions: UniversalTransactionData[] = [
        {
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: '50000.00' }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          movements: {
            inflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: undefined }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          movements: {
            inflows: [{ assetSymbol: 'SOL', amount: '100.0', priceAtTxTime: '150.00' }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const result = validateTransactionPrices(transactions, 'USD');
      const resultValue = assertOk(result);
      expect(resultValue.validTransactions).toHaveLength(2);
      expect(resultValue.missingPricesCount).toBe(1);
    });

    it('should return error when ALL transactions missing prices', () => {
      const transactions: UniversalTransactionData[] = [
        {
          movements: {
            inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: undefined }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          movements: {
            inflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: undefined }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const result = validateTransactionPrices(transactions, 'USD');
      const resultError = assertErr(result);
      expect(resultError.message).toContain('All transactions are missing price data');
      expect(resultError.message).toContain('USD');
    });

    it('should count fiat-only transactions as valid (no prices needed)', () => {
      const transactions: UniversalTransactionData[] = [
        {
          movements: {
            inflows: [{ assetSymbol: 'USD', amount: '1000.0', priceAtTxTime: undefined }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
        {
          movements: {
            inflows: [{ assetSymbol: 'CAD', amount: '1300.0', priceAtTxTime: undefined }],
            outflows: [],
          },
        } as unknown as UniversalTransactionData,
      ];

      const result = validateTransactionPrices(transactions, 'USD');
      const resultValue = assertOk(result);
      expect(resultValue.validTransactions).toHaveLength(2);
      expect(resultValue.missingPricesCount).toBe(0);
    });
  });

  describe('getJurisdictionRules', () => {
    it('should return CanadaRules for CA jurisdiction', () => {
      const result = getJurisdictionRules('CA');
      const resultValue = assertOk(result);
      expect(resultValue.constructor.name).toBe('CanadaRules');
    });

    it('should return USRules for US jurisdiction', () => {
      const result = getJurisdictionRules('US');
      const resultValue = assertOk(result);
      expect(resultValue.constructor.name).toBe('USRules');
    });

    it('should return error for UK jurisdiction (not implemented)', () => {
      const result = getJurisdictionRules('UK');
      const resultError = assertErr(result);
      expect(resultError.message).toContain('UK jurisdiction rules not yet implemented');
    });

    it('should return error for EU jurisdiction (not implemented)', () => {
      const result = getJurisdictionRules('EU');
      const resultError = assertErr(result);
      expect(resultError.message).toContain('EU jurisdiction rules not yet implemented');
    });
  });

  describe('validateCostBasisParams', () => {
    it('should accept valid parameters with US jurisdiction', () => {
      const result = validateCostBasisParams({
        config: {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      assertOk(result);
    });

    it('should accept average-cost for CA jurisdiction', () => {
      const result = validateCostBasisParams({
        config: {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          currency: 'CAD',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      assertOk(result);
    });

    it('should error when average-cost used with non-CA jurisdiction', () => {
      const result = validateCostBasisParams({
        config: {
          method: 'average-cost',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Average Cost (ACB) is only supported for Canada');
    });

    it('should error when specific-id method used (not implemented)', () => {
      const result = validateCostBasisParams({
        config: {
          method: 'specific-id',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      const resultError = assertErr(result);
      expect(resultError.message).toContain('not yet implemented');
    });

    it('should error for UK jurisdiction (not implemented)', () => {
      const result = validateCostBasisParams({
        config: {
          method: 'fifo',
          jurisdiction: 'UK',
          taxYear: 2024,
          currency: 'GBP',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
      });

      const resultError = assertErr(result);
      expect(resultError.message).toContain('tax rules not yet implemented');
    });
  });

  describe('formatCurrency', () => {
    it('should format positive amounts correctly', () => {
      expect(formatCurrency(new Decimal('1234.56'), 'USD')).toBe('USD 1,234.56');
    });

    it('should format negative amounts correctly', () => {
      expect(formatCurrency(new Decimal('-1234.56'), 'USD')).toBe('-USD 1,234.56');
    });

    it('should format zero correctly', () => {
      expect(formatCurrency(new Decimal('0'), 'USD')).toBe('USD 0.00');
    });

    it('should round to 2 decimal places', () => {
      expect(formatCurrency(new Decimal('10.5678'), 'USD')).toBe('USD 10.57');
    });

    it('should handle large numbers', () => {
      expect(formatCurrency(new Decimal('1000000.00'), 'USD')).toBe('USD 1,000,000.00');
    });
  });
});
