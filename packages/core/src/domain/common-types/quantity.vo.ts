import BigNumber from 'bignumber.js';
import { Effect, Data } from 'effect';

export class QuantityError extends Data.TaggedError('QuantityError')<{
  readonly message: string;
}> {}

export class NegativeQuantityError extends Data.TaggedError('NegativeQuantityError')<{
  readonly value: string;
}> {}

export class Quantity extends Data.Class<{
  readonly precision: number;
  readonly value: BigNumber;
}> {
  static of(value: string | number, precision = 18): Effect.Effect<Quantity, QuantityError> {
    return Effect.try({
      catch: () => new QuantityError({ message: `Invalid quantity: ${value}` }),
      try: () => {
        const bigValue = new BigNumber(value);
        if (!bigValue.isFinite() || bigValue.isNegative()) {
          throw new QuantityError({ message: `Invalid quantity: ${value}` });
        }
        return new Quantity({ precision, value: bigValue });
      },
    });
  }

  static zero(precision = 18): Quantity {
    return new Quantity({ precision, value: new BigNumber(0) });
  }

  add(other: Quantity): Quantity {
    return new Quantity({
      precision: this.precision,
      value: this.value.plus(other.value),
    });
  }

  subtract(other: Quantity): Effect.Effect<Quantity, NegativeQuantityError> {
    const result = this.value.minus(other.value);
    if (result.isNegative()) {
      return Effect.fail(new NegativeQuantityError({ value: result.toString() }));
    }
    return Effect.succeed(new Quantity({ precision: this.precision, value: result }));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isGreaterThan(other: Quantity): boolean {
    return this.value.isGreaterThan(other.value);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  override toString(): string {
    return this.value.toString();
  }
}
