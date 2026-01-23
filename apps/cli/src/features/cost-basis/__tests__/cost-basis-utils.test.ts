import type { UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildCostBasisParamsFromFlags,
  type CostBasisCommandOptions,
  filterTransactionsByDateRange,
  formatCurrency,
  getJurisdictionRules,
  transactionHasAllPrices,
  validateCostBasisParams,
  validateTransactionPrices,
} from '../cost-basis-utils.js';

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
          expect(result.value.config.endDate.getTime()).toBeGreaterThan(result.value.config.startDate.getTime());
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

      expect(transactionHasAllPrices(tx)).toBe(true);
    });

    it('should return false when crypto inflow is missing price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [{ assetSymbol: 'BTC', amount: '1.0', priceAtTxTime: undefined }],
          outflows: [],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(tx)).toBe(false);
    });

    it('should return false when crypto outflow is missing price', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'ETH', amount: '10.0', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(tx)).toBe(false);
    });

    it('should return true when only fiat movements (no price needed)', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [{ assetSymbol: 'USD', amount: '1000.0', priceAtTxTime: undefined }],
          outflows: [{ assetSymbol: 'CAD', amount: '1300.0', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(tx)).toBe(true);
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

      expect(transactionHasAllPrices(tx)).toBe(true);
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

      expect(transactionHasAllPrices(tx)).toBe(false);
    });

    it('should handle empty inflows and outflows', () => {
      const tx: UniversalTransactionData = {
        movements: {
          inflows: [],
          outflows: [],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(tx)).toBe(true);
    });
    it('should handle invalid currency symbols by treating them as crypto (needs price)', () => {
      const tx = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'INVALID-SYM', amount: '1', priceAtTxTime: undefined }],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(tx)).toBe(false);

      const txWithPrice = {
        movements: {
          inflows: [],
          outflows: [{ assetSymbol: 'INVALID-SYM', amount: '1', priceAtTxTime: '100' }],
        },
      } as unknown as UniversalTransactionData;

      expect(transactionHasAllPrices(txWithPrice)).toBe(true);
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

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.validTransactions).toHaveLength(2);
        expect(result.value.missingPricesCount).toBe(0);
      }
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

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.validTransactions).toHaveLength(2);
        expect(result.value.missingPricesCount).toBe(1);
      }
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

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('All transactions are missing price data');
        expect(result.error.message).toContain('USD');
      }
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

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.validTransactions).toHaveLength(2);
        expect(result.value.missingPricesCount).toBe(0);
      }
    });
  });

  describe('getJurisdictionRules', () => {
    it('should return CanadaRules for CA jurisdiction', () => {
      const rules = getJurisdictionRules('CA');
      expect(rules).toBeDefined();
      expect(rules.constructor.name).toBe('CanadaRules');
    });

    it('should return USRules for US jurisdiction', () => {
      const rules = getJurisdictionRules('US');
      expect(rules).toBeDefined();
      expect(rules.constructor.name).toBe('USRules');
    });

    it('should throw error for UK jurisdiction (not implemented)', () => {
      expect(() => getJurisdictionRules('UK')).toThrow('UK jurisdiction rules not yet implemented');
    });

    it('should throw error for EU jurisdiction (not implemented)', () => {
      expect(() => getJurisdictionRules('EU')).toThrow('EU jurisdiction rules not yet implemented');
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

      expect(result.isOk()).toBe(true);
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

      expect(result.isOk()).toBe(true);
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

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Average Cost (ACB) is only supported for Canada');
      }
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

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not yet implemented');
      }
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

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('tax rules not yet implemented');
      }
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
