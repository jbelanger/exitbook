import { Result, err, ok } from 'neverthrow';

import {
  CurrencyMismatchError,
  DivisionByZeroError,
  InvalidCurrencyError,
  InvalidDecimalError,
  InvalidScaleError,
  MoneyErrorTypes,
  ScaleMismatchError,
} from './money.errors';

// Money value object with precision-safe operations
export class Money {
  /**
   * Create Money from decimal value
   * @param value - Decimal value (e.g., 1.23456789)
   * @param currency - Currency code (e.g., 'BTC', 'USD')
   * @param scale - Number of decimal places (e.g., 8 for BTC)
   */
  static fromDecimal(value: number | string, currency: string, scale: number): Result<Money, MoneyErrorTypes> {
    // Validate inputs
    if (scale < 0) {
      return err(new InvalidScaleError(scale));
    }

    if (!currency || currency.trim() === '') {
      return err(new InvalidCurrencyError(currency));
    }

    try {
      const stringValue = typeof value === 'number' ? value.toString() : value;

      // Basic decimal validation
      if (!/^-?\d*\.?\d*$/.test(stringValue)) {
        return err(new InvalidDecimalError(stringValue, 'Invalid decimal format'));
      }

      const [whole = '0', decimal = ''] = stringValue.split('.');

      // Pad or truncate decimal part to match scale
      const paddedDecimal = decimal.padEnd(scale, '0').slice(0, scale);
      const bigIntValue = BigInt(whole + paddedDecimal);

      return ok(new Money(bigIntValue, currency.toUpperCase(), scale));
    } catch (error) {
      return err(new InvalidDecimalError(value.toString(), error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  /**
   * Create Money from BigInt value
   * @param value - BigInt value in smallest units
   * @param currency - Currency code
   * @param scale - Number of decimal places
   */
  static fromBigInt(value: bigint, currency: string, scale: number): Result<Money, MoneyErrorTypes> {
    // Validate inputs
    if (scale < 0) {
      return err(new InvalidScaleError(scale));
    }

    if (!currency || currency.trim() === '') {
      return err(new InvalidCurrencyError(currency));
    }

    return ok(new Money(value, currency.toUpperCase(), scale));
  }

  /**
   * Create zero amount for currency
   */
  static zero(currency: string, scale: number): Result<Money, MoneyErrorTypes> {
    return Money.fromBigInt(0n, currency, scale);
  }

  private constructor(
    private readonly _value: bigint,
    private readonly _currency: string,
    private readonly _scale: number
  ) {
    // Constructor is private - validation happens in factory methods
  }

  // Getters for readonly access
  get value(): bigint {
    return this._value;
  }

  get currency(): string {
    return this._currency;
  }

  get scale(): number {
    return this._scale;
  }

  // Conversion methods
  /**
   * Convert to decimal number (use with caution - may lose precision)
   */
  toDecimal(): number {
    const stringValue = this._value.toString();

    if (stringValue.length <= this._scale) {
      const paddedValue = stringValue.padStart(this._scale, '0');
      return Number('0.' + paddedValue);
    }

    const whole = stringValue.slice(0, -this._scale);
    const decimal = stringValue.slice(-this._scale);
    return Number(whole + '.' + decimal);
  }

  /**
   * Format for display
   */
  toString(): string {
    const decimal = this.toDecimal();
    return `${decimal.toFixed(this._scale)} ${this._currency}`;
  }

  /**
   * Get formatted string without currency
   */
  toFixedString(): string {
    const decimal = this.toDecimal();
    return decimal.toFixed(this._scale);
  }

  // Comparison methods
  /**
   * Check equality with another Money
   */
  equals(other: Money): boolean {
    return this._currency === other._currency && this._scale === other._scale && this._value === other._value;
  }

  /**
   * Compare with another Money
   * @returns Result with -1 if this < other, 0 if equal, 1 if this > other
   */
  compare(other: Money): Result<number, MoneyErrorTypes> {
    const validation = this.assertSameCurrencyAndScale(other);
    if (validation.isErr()) {
      return err(validation.error);
    }

    if (this._value < other._value) return ok(-1);
    if (this._value > other._value) return ok(1);
    return ok(0);
  }

  isZero(): boolean {
    return this._value === 0n;
  }

  isPositive(): boolean {
    return this._value > 0n;
  }

  isNegative(): boolean {
    return this._value < 0n;
  }

  isGreaterThan(other: Money): Result<boolean, MoneyErrorTypes> {
    return this.compare(other).map(result => result > 0);
  }

  isLessThan(other: Money): Result<boolean, MoneyErrorTypes> {
    return this.compare(other).map(result => result < 0);
  }

  isGreaterThanOrEqual(other: Money): Result<boolean, MoneyErrorTypes> {
    return this.compare(other).map(result => result >= 0);
  }

  isLessThanOrEqual(other: Money): Result<boolean, MoneyErrorTypes> {
    return this.compare(other).map(result => result <= 0);
  }

  // Arithmetic operations (return new instances)
  /**
   * Add another Money amount
   */
  add(other: Money): Result<Money, MoneyErrorTypes> {
    const validation = this.assertSameCurrencyAndScale(other);
    if (validation.isErr()) {
      return err(validation.error);
    }

    return ok(new Money(this._value + other._value, this._currency, this._scale));
  }

  /**
   * Subtract another Money amount
   */
  subtract(other: Money): Result<Money, MoneyErrorTypes> {
    const validation = this.assertSameCurrencyAndScale(other);
    if (validation.isErr()) {
      return err(validation.error);
    }

    return ok(new Money(this._value - other._value, this._currency, this._scale));
  }

  /**
   * Multiply by a scalar
   * @param multiplier - Scalar value
   * @param resultScale - Optional scale for result (defaults to current scale)
   */
  multiply(multiplier: number | string, resultScale?: number): Result<Money, MoneyErrorTypes> {
    const scale = resultScale ?? this._scale;

    return this.toBigInt(multiplier, scale).map(multiplierBigInt => {
      // Multiply and adjust for double scaling
      const result = (this._value * multiplierBigInt) / BigInt(10 ** this._scale);
      return new Money(result, this._currency, scale);
    });
  }

  /**
   * Divide by a scalar
   * @param divisor - Scalar value
   * @param resultScale - Optional scale for result (defaults to current scale)
   */
  divide(divisor: number | string, resultScale?: number): Result<Money, MoneyErrorTypes> {
    const scale = resultScale ?? this._scale;

    return this.toBigInt(divisor, this._scale).andThen(divisorBigInt => {
      if (divisorBigInt === 0n) {
        return err(new DivisionByZeroError());
      }

      // Simple division: this._value / divisorBigInt, then adjust scale
      const result = this._value / (divisorBigInt / BigInt(10 ** this._scale));

      // Adjust for target scale
      const scaleDiff = scale - this._scale;
      const finalResult =
        scaleDiff >= 0 ? result * BigInt(10 ** scaleDiff) : result / BigInt(10 ** Math.abs(scaleDiff));

      return ok(new Money(finalResult, this._currency, scale));
    });
  }

  /**
   * Get absolute value
   */
  abs(): Money {
    const absValue = this._value < 0n ? -this._value : this._value;
    return new Money(absValue, this._currency, this._scale);
  }

  /**
   * Negate the amount
   */
  negate(): Money {
    return new Money(-this._value, this._currency, this._scale);
  }

  // Private helper methods
  private assertSameCurrencyAndScale(other: Money): Result<void, MoneyErrorTypes> {
    if (this._currency !== other._currency) {
      return err(new CurrencyMismatchError(this._currency, other._currency));
    }
    if (this._scale !== other._scale) {
      return err(new ScaleMismatchError(this._scale, other._scale));
    }
    return ok();
  }

  private toBigInt(value: number | string, scale: number): Result<bigint, MoneyErrorTypes> {
    try {
      const stringValue = typeof value === 'number' ? value.toString() : value;

      // Basic decimal validation
      if (!/^-?\d*\.?\d*$/.test(stringValue)) {
        return err(new InvalidDecimalError(stringValue, 'Invalid decimal format'));
      }

      const [whole = '0', decimal = ''] = stringValue.split('.');

      // Pad or truncate decimal part to match scale
      const paddedDecimal = decimal.padEnd(scale, '0').slice(0, scale);

      return ok(BigInt(whole + paddedDecimal));
    } catch (error) {
      return err(new InvalidDecimalError(value.toString(), error instanceof Error ? error.message : 'Unknown error'));
    }
  }
}
