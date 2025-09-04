import { describe, expect, it } from 'vitest';

import { CurrencyMismatchError, DivisionByZeroError, InvalidCurrencyError, InvalidScaleError } from '../money.errors';
import { Money } from '../money.vo';

describe('Money Value Object', () => {
  describe('Factory Methods', () => {
    describe('fromDecimal', () => {
      it('should create Money from decimal number', () => {
        const result = Money.fromDecimal(1.23456789, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.value).toBe(123456789n);
          expect(money.currency).toBe('BTC');
          expect(money.scale).toBe(8);
        }
      });

      it('should create Money from decimal string', () => {
        const result = Money.fromDecimal('1.23456789', 'ETH', 18);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.value).toBe(1234567890000000000n);
          expect(money.currency).toBe('ETH');
          expect(money.scale).toBe(18);
        }
      });

      it('should handle whole numbers', () => {
        const result = Money.fromDecimal(5, 'USD', 2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.value).toBe(500n);
          expect(money.currency).toBe('USD');
          expect(money.scale).toBe(2);
        }
      });

      it('should pad decimal places when needed', () => {
        const result = Money.fromDecimal(1.5, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.value).toBe(150000000n);
        }
      });

      it('should truncate excess decimal places', () => {
        const result = Money.fromDecimal(1.123456789999, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.value).toBe(112345678n);
        }
      });

      it('should normalize currency to uppercase', () => {
        const result = Money.fromDecimal(1, 'btc', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.currency).toBe('BTC');
        }
      });
    });

    describe('fromBigInt', () => {
      it('should create Money from BigInt value', () => {
        const result = Money.fromBigInt(123456789n, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.value).toBe(123456789n);
          expect(money.currency).toBe('BTC');
          expect(money.scale).toBe(8);
        }
      });

      it('should normalize currency to uppercase', () => {
        const result = Money.fromBigInt(100n, 'eth', 18);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.currency).toBe('ETH');
        }
      });
    });

    describe('zero', () => {
      it('should create zero Money amount', () => {
        const result = Money.zero('USD', 2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.value).toBe(0n);
          expect(money.currency).toBe('USD');
          expect(money.scale).toBe(2);
          expect(money.isZero()).toBe(true);
        }
      });
    });

    describe('validation', () => {
      it('should return error for negative scale', () => {
        const result = Money.fromDecimal(1, 'BTC', -1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(InvalidScaleError);
        }
      });

      it('should return error for empty currency', () => {
        const result1 = Money.fromDecimal(1, '', 8);
        const result2 = Money.fromDecimal(1, '   ', 8);

        expect(result1.isErr()).toBe(true);
        expect(result2.isErr()).toBe(true);

        if (result1.isErr()) {
          expect(result1.error).toBeInstanceOf(InvalidCurrencyError);
        }
        if (result2.isErr()) {
          expect(result2.error).toBeInstanceOf(InvalidCurrencyError);
        }
      });
    });
  });

  describe('Conversion Methods', () => {
    describe('toDecimal', () => {
      it('should convert BigInt back to decimal', () => {
        const result = Money.fromBigInt(123456789n, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toDecimal()).toBe(1.23456789);
        }
      });

      it('should handle values smaller than scale', () => {
        const result = Money.fromBigInt(123n, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toDecimal()).toBe(0.00000123);
        }
      });

      it('should handle zero values', () => {
        const result = Money.zero('USD', 2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toDecimal()).toBe(0);
        }
      });
    });

    describe('toString', () => {
      it('should format Money with currency', () => {
        const result = Money.fromDecimal(1.23456789, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toString()).toBe('1.23456789 BTC');
        }
      });

      it('should handle zero amounts', () => {
        const result = Money.zero('USD', 2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toString()).toBe('0.00 USD');
        }
      });
    });

    describe('toFixedString', () => {
      it('should format Money without currency', () => {
        const result = Money.fromDecimal(1.23456789, 'BTC', 8);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toFixedString()).toBe('1.23456789');
        }
      });
    });
  });

  describe('Comparison Methods', () => {
    const btc1 = Money.fromDecimal(1, 'BTC', 8)._unsafeUnwrap();
    const btc2 = Money.fromDecimal(2, 'BTC', 8)._unsafeUnwrap();
    const btc1Copy = Money.fromDecimal(1, 'BTC', 8)._unsafeUnwrap();
    const eth1 = Money.fromDecimal(1, 'ETH', 18)._unsafeUnwrap();

    describe('equals', () => {
      it('should return true for equal amounts', () => {
        expect(btc1.equals(btc1Copy)).toBe(true);
      });

      it('should return false for different amounts', () => {
        expect(btc1.equals(btc2)).toBe(false);
      });

      it('should return false for different currencies', () => {
        expect(btc1.equals(eth1)).toBe(false);
      });
    });

    describe('compare', () => {
      it('should return -1 when first amount is smaller', () => {
        const result = btc1.compare(btc2);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBe(-1);
        }
      });

      it('should return 1 when first amount is larger', () => {
        const result = btc2.compare(btc1);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBe(1);
        }
      });

      it('should return 0 when amounts are equal', () => {
        const result = btc1.compare(btc1Copy);
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBe(0);
        }
      });

      it('should return error for different currencies', () => {
        const result = btc1.compare(eth1);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(CurrencyMismatchError);
        }
      });
    });

    describe('boolean comparisons', () => {
      it('should check if greater than', () => {
        const result1 = btc2.isGreaterThan(btc1);
        const result2 = btc1.isGreaterThan(btc2);

        expect(result1.isOk()).toBe(true);
        expect(result2.isOk()).toBe(true);

        if (result1.isOk()) expect(result1.value).toBe(true);
        if (result2.isOk()) expect(result2.value).toBe(false);
      });

      it('should check if less than', () => {
        const result1 = btc1.isLessThan(btc2);
        const result2 = btc2.isLessThan(btc1);

        expect(result1.isOk()).toBe(true);
        expect(result2.isOk()).toBe(true);

        if (result1.isOk()) expect(result1.value).toBe(true);
        if (result2.isOk()) expect(result2.value).toBe(false);
      });

      it('should check if greater than or equal', () => {
        const result1 = btc2.isGreaterThanOrEqual(btc1);
        const result2 = btc1.isGreaterThanOrEqual(btc1Copy);
        const result3 = btc1.isGreaterThanOrEqual(btc2);

        expect(result1.isOk()).toBe(true);
        expect(result2.isOk()).toBe(true);
        expect(result3.isOk()).toBe(true);

        if (result1.isOk()) expect(result1.value).toBe(true);
        if (result2.isOk()) expect(result2.value).toBe(true);
        if (result3.isOk()) expect(result3.value).toBe(false);
      });

      it('should check if less than or equal', () => {
        const result1 = btc1.isLessThanOrEqual(btc2);
        const result2 = btc1.isLessThanOrEqual(btc1Copy);
        const result3 = btc2.isLessThanOrEqual(btc1);

        expect(result1.isOk()).toBe(true);
        expect(result2.isOk()).toBe(true);
        expect(result3.isOk()).toBe(true);

        if (result1.isOk()) expect(result1.value).toBe(true);
        if (result2.isOk()) expect(result2.value).toBe(true);
        if (result3.isOk()) expect(result3.value).toBe(false);
      });
    });

    describe('sign checks', () => {
      const positive = Money.fromDecimal(1, 'BTC', 8)._unsafeUnwrap();
      const negative = Money.fromDecimal(-1, 'BTC', 8)._unsafeUnwrap();
      const zero = Money.zero('BTC', 8)._unsafeUnwrap();

      it('should check if zero', () => {
        expect(zero.isZero()).toBe(true);
        expect(positive.isZero()).toBe(false);
        expect(negative.isZero()).toBe(false);
      });

      it('should check if positive', () => {
        expect(positive.isPositive()).toBe(true);
        expect(zero.isPositive()).toBe(false);
        expect(negative.isPositive()).toBe(false);
      });

      it('should check if negative', () => {
        expect(negative.isNegative()).toBe(true);
        expect(zero.isNegative()).toBe(false);
        expect(positive.isNegative()).toBe(false);
      });
    });
  });

  describe('Arithmetic Operations', () => {
    const btc1 = Money.fromDecimal(1, 'BTC', 8)._unsafeUnwrap();
    const btc2 = Money.fromDecimal(2, 'BTC', 8)._unsafeUnwrap();
    const eth1 = Money.fromDecimal(1, 'ETH', 18)._unsafeUnwrap();

    describe('add', () => {
      it('should add two Money amounts', () => {
        const result = btc1.add(btc2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.toDecimal()).toBe(3);
          expect(money.currency).toBe('BTC');
          expect(money.scale).toBe(8);
        }
      });

      it('should not mutate original amounts', () => {
        const originalValue = btc1.value;
        btc1.add(btc2);

        expect(btc1.value).toBe(originalValue);
      });

      it('should return error for different currencies', () => {
        const result = btc1.add(eth1);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(CurrencyMismatchError);
        }
      });
    });

    describe('subtract', () => {
      it('should subtract two Money amounts', () => {
        const result = btc2.subtract(btc1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.toDecimal()).toBe(1);
          expect(money.currency).toBe('BTC');
        }
      });

      it('should handle negative results', () => {
        const result = btc1.subtract(btc2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.toDecimal()).toBe(-1);
          expect(money.isNegative()).toBe(true);
        }
      });

      it('should return error for different currencies', () => {
        const result = btc1.subtract(eth1);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(CurrencyMismatchError);
        }
      });
    });

    describe('multiply', () => {
      it('should multiply by number', () => {
        const result = btc1.multiply(2.5);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.toDecimal()).toBe(2.5);
          expect(money.currency).toBe('BTC');
        }
      });

      it('should multiply by string', () => {
        const result = btc1.multiply('1.5');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toDecimal()).toBe(1.5);
        }
      });

      it('should handle different result scale', () => {
        const result = btc1.multiply(2, 4);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.scale).toBe(4);
          expect(money.toDecimal()).toBe(2);
        }
      });
    });

    describe('divide', () => {
      it('should divide by number', () => {
        const result = btc2.divide(2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.toDecimal()).toBe(1);
          expect(money.currency).toBe('BTC');
        }
      });

      it('should divide by string', () => {
        const result = btc2.divide('4');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.toDecimal()).toBe(0.5);
        }
      });

      it('should handle different result scale', () => {
        const result = btc2.divide(2, 4);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const money = result.value;
          expect(money.scale).toBe(4);
          expect(money.toDecimal()).toBe(1);
        }
      });

      it('should return error for division by zero', () => {
        const result1 = btc1.divide(0);
        const result2 = btc1.divide('0');

        expect(result1.isErr()).toBe(true);
        expect(result2.isErr()).toBe(true);

        if (result1.isErr()) {
          expect(result1.error).toBeInstanceOf(DivisionByZeroError);
        }
        if (result2.isErr()) {
          expect(result2.error).toBeInstanceOf(DivisionByZeroError);
        }
      });
    });

    describe('abs', () => {
      it('should return absolute value of positive amount', () => {
        const positiveResult = Money.fromDecimal(5, 'BTC', 8);

        expect(positiveResult.isOk()).toBe(true);

        if (positiveResult.isOk()) {
          const result = positiveResult.value.abs();
          expect(result.toDecimal()).toBe(5);
        }
      });

      it('should return absolute value of negative amount', () => {
        const negativeResult = Money.fromDecimal(-5, 'BTC', 8);

        expect(negativeResult.isOk()).toBe(true);

        if (negativeResult.isOk()) {
          const result = negativeResult.value.abs();
          expect(result.toDecimal()).toBe(5);
          expect(result.isPositive()).toBe(true);
        }
      });

      it('should handle zero', () => {
        const zeroResult = Money.zero('BTC', 8);

        expect(zeroResult.isOk()).toBe(true);

        if (zeroResult.isOk()) {
          const result = zeroResult.value.abs();
          expect(result.isZero()).toBe(true);
        }
      });
    });

    describe('negate', () => {
      it('should negate positive amount', () => {
        const positiveResult = Money.fromDecimal(5, 'BTC', 8);

        expect(positiveResult.isOk()).toBe(true);

        if (positiveResult.isOk()) {
          const result = positiveResult.value.negate();
          expect(result.toDecimal()).toBe(-5);
          expect(result.isNegative()).toBe(true);
        }
      });

      it('should negate negative amount', () => {
        const negativeResult = Money.fromDecimal(-5, 'BTC', 8);

        expect(negativeResult.isOk()).toBe(true);

        if (negativeResult.isOk()) {
          const result = negativeResult.value.negate();
          expect(result.toDecimal()).toBe(5);
          expect(result.isPositive()).toBe(true);
        }
      });

      it('should handle zero', () => {
        const zeroResult = Money.zero('BTC', 8);

        expect(zeroResult.isOk()).toBe(true);

        if (zeroResult.isOk()) {
          const result = zeroResult.value.negate();
          expect(result.isZero()).toBe(true);
        }
      });
    });
  });

  describe('Precision Edge Cases', () => {
    it('should handle very small amounts', () => {
      const tinyResult = Money.fromDecimal('0.00000001', 'BTC', 8); // Use string to avoid scientific notation

      expect(tinyResult.isOk()).toBe(true);

      if (tinyResult.isOk()) {
        const tiny = tinyResult.value;
        expect(tiny.value).toBe(1n);
        expect(tiny.toDecimal()).toBe(0.00000001);
      }
    });

    it('should handle very large amounts', () => {
      const largeResult = Money.fromDecimal(21000000, 'BTC', 8);

      expect(largeResult.isOk()).toBe(true);

      if (largeResult.isOk()) {
        const large = largeResult.value;
        expect(large.value).toBe(2100000000000000n);
        expect(large.toDecimal()).toBe(21000000);
      }
    });

    it('should maintain precision in arithmetic', () => {
      const aResult = Money.fromDecimal(0.1, 'USD', 2);
      const bResult = Money.fromDecimal(0.2, 'USD', 2);

      expect(aResult.isOk()).toBe(true);
      expect(bResult.isOk()).toBe(true);

      if (aResult.isOk() && bResult.isOk()) {
        const resultResult = aResult.value.add(bResult.value);

        expect(resultResult.isOk()).toBe(true);

        if (resultResult.isOk()) {
          expect(resultResult.value.toDecimal()).toBe(0.3); // No floating point precision issues
        }
      }
    });

    it('should handle different scales in multiplication', () => {
      const btcResult = Money.fromDecimal(1, 'BTC', 8);

      expect(btcResult.isOk()).toBe(true);

      if (btcResult.isOk()) {
        const resultResult = btcResult.value.multiply(0.5, 18); // Result with 18 decimals

        expect(resultResult.isOk()).toBe(true);

        if (resultResult.isOk()) {
          const result = resultResult.value;
          expect(result.scale).toBe(18);
          expect(result.toDecimal()).toBe(0.5);
        }
      }
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle Bitcoin transaction', () => {
      const amountResult = Money.fromDecimal(0.00123456, 'BTC', 8);
      const feeResult = Money.fromDecimal(0.000005, 'BTC', 8);

      expect(amountResult.isOk()).toBe(true);
      expect(feeResult.isOk()).toBe(true);

      if (amountResult.isOk() && feeResult.isOk()) {
        const totalResult = amountResult.value.add(feeResult.value);
        expect(totalResult.isOk()).toBe(true);

        if (totalResult.isOk()) {
          const total = totalResult.value;
          expect(total.toDecimal()).toBe(0.00123956);
          expect(total.toString()).toBe('0.00123956 BTC');
        }
      }
    });

    it('should handle USD calculations', () => {
      const priceResult = Money.fromDecimal(1234.56, 'USD', 2);
      const quantity = 0.75;

      expect(priceResult.isOk()).toBe(true);

      if (priceResult.isOk()) {
        const totalResult = priceResult.value.multiply(quantity);
        expect(totalResult.isOk()).toBe(true);

        if (totalResult.isOk()) {
          const total = totalResult.value;
          expect(total.toDecimal()).toBe(925.92);
          expect(total.toString()).toBe('925.92 USD');
        }
      }
    });

    it('should handle percentage calculations', () => {
      const principalResult = Money.fromDecimal(1000, 'USD', 2);

      expect(principalResult.isOk()).toBe(true);

      if (principalResult.isOk()) {
        const principal = principalResult.value;
        const interestResult = principal.multiply(0.05); // 5% interest

        expect(interestResult.isOk()).toBe(true);

        if (interestResult.isOk()) {
          const interest = interestResult.value;
          const totalResult = principal.add(interest);

          expect(totalResult.isOk()).toBe(true);

          if (totalResult.isOk()) {
            expect(interest.toDecimal()).toBe(50);
            expect(totalResult.value.toDecimal()).toBe(1050);
          }
        }
      }
    });

    it('should handle exchange rate conversion', () => {
      const btcResult = Money.fromDecimal(1, 'BTC', 8);
      const btcPrice = 50000; // $50,000 per BTC

      expect(btcResult.isOk()).toBe(true);

      if (btcResult.isOk()) {
        // Convert to USD equivalent (but keep BTC currency for this example)
        const usdValueResult = btcResult.value.multiply(btcPrice);

        expect(usdValueResult.isOk()).toBe(true);

        if (usdValueResult.isOk()) {
          expect(usdValueResult.value.toDecimal()).toBe(50000);
        }
      }
    });
  });
});
