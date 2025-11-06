import { describe, expect, it } from 'vitest';

import { calculateFee, convertAmount, convertAmountFromArray } from './calculation-utils.js';
import type { InjectiveGasFee, InjectiveAmount } from './providers/injective-explorer/injective-explorer.schemas.js';

describe('calculation-utils', () => {
  describe('calculateFee', () => {
    it('should calculate fee with default decimals (18)', () => {
      const gasFee: InjectiveGasFee = {
        amount: [{ amount: '1000000000000000000', denom: 'inj' }],
        gas_limit: 100000,
      };

      const result = calculateFee(gasFee);

      expect(result).toEqual({
        feeAmount: '1',
        feeCurrency: 'inj',
      });
    });

    it('should calculate fee with custom decimals', () => {
      const gasFee: InjectiveGasFee = {
        amount: [{ amount: '1000000', denom: 'usdc' }],
        gas_limit: 100000,
      };

      const result = calculateFee(gasFee, 6);

      expect(result).toEqual({
        feeAmount: '1',
        feeCurrency: 'usdc',
      });
    });

    it('should return undefined for empty gas fee', () => {
      const result = calculateFee();
      expect(result).toBeUndefined();
    });

    it('should return undefined for gas fee with empty amount array', () => {
      const gasFee: InjectiveGasFee = {
        amount: [],
        gas_limit: 100000,
      };

      const result = calculateFee(gasFee);
      expect(result).toBeUndefined();
    });

    it('should handle very small fees', () => {
      const gasFee: InjectiveGasFee = {
        amount: [{ amount: '1', denom: 'inj' }],
        gas_limit: 100000,
      };

      const result = calculateFee(gasFee);

      expect(result).toEqual({
        feeAmount: '0.000000000000000001',
        feeCurrency: 'inj',
      });
    });

    it('should handle very large fees', () => {
      const gasFee: InjectiveGasFee = {
        amount: [{ amount: '1000000000000000000000', denom: 'inj' }],
        gas_limit: 100000,
      };

      const result = calculateFee(gasFee);

      expect(result).toEqual({
        feeAmount: '1000',
        feeCurrency: 'inj',
      });
    });
  });

  describe('convertAmount', () => {
    it('should convert amount with default decimals (18)', () => {
      const amount: InjectiveAmount = {
        amount: '1000000000000000000',
        denom: 'inj',
      };

      const result = convertAmount(amount);

      expect(result).toEqual({
        amount: '1',
        currency: 'inj',
      });
    });

    it('should convert amount with custom decimals', () => {
      const amount: InjectiveAmount = {
        amount: '1000000',
        denom: 'usdc',
      };

      const result = convertAmount(amount, 6);

      expect(result).toEqual({
        amount: '1',
        currency: 'usdc',
      });
    });

    it('should handle fractional amounts', () => {
      const amount: InjectiveAmount = {
        amount: '1500000000000000000',
        denom: 'inj',
      };

      const result = convertAmount(amount);

      expect(result).toEqual({
        amount: '1.5',
        currency: 'inj',
      });
    });

    it('should handle zero amount', () => {
      const amount: InjectiveAmount = {
        amount: '0',
        denom: 'inj',
      };

      const result = convertAmount(amount);

      expect(result).toEqual({
        amount: '0',
        currency: 'inj',
      });
    });
  });

  describe('convertAmountFromArray', () => {
    it('should convert first amount from array', () => {
      const amounts: InjectiveAmount[] = [
        { amount: '1000000000000000000', denom: 'inj' },
        { amount: '2000000000000000000', denom: 'usdc' },
      ];

      const result = convertAmountFromArray(amounts);

      expect(result).toEqual({
        amount: '1',
        currency: 'inj',
      });
    });

    it('should return undefined for empty array', () => {
      const result = convertAmountFromArray([]);
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined array', () => {
      const result = convertAmountFromArray();
      expect(result).toBeUndefined();
    });

    it('should handle single-element array', () => {
      const amounts: InjectiveAmount[] = [{ amount: '500000000000000000', denom: 'inj' }];

      const result = convertAmountFromArray(amounts);

      expect(result).toEqual({
        amount: '0.5',
        currency: 'inj',
      });
    });
  });
});
