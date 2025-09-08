import BigNumber from 'bignumber.js';
import { Effect, Data } from 'effect';

import type { Currency } from './currency.vo.js';

export class MoneyError extends Data.TaggedError('MoneyError')<{
  readonly message: string;
}> {}

export class CurrencyMismatchError extends Data.TaggedError('CurrencyMismatchError')<{
  readonly left: Currency;
  readonly right: Currency;
}> {}

export class InvalidMoneyAmountError extends Data.TaggedError('InvalidMoneyAmountError')<{
  readonly amount: string | number;
}> {}

export class Money extends Data.Class<{
  readonly amount: BigNumber;
  readonly currency: Currency;
}> {
  static of(amount: string | number, currency: Currency): Effect.Effect<Money, InvalidMoneyAmountError> {
    return Effect.try({
      catch: () => new InvalidMoneyAmountError({ amount }),
      try: () => {
        const bigAmount = new BigNumber(amount);
        if (!bigAmount.isFinite()) {
          throw new InvalidMoneyAmountError({ amount });
        }
        return new Money({ amount: bigAmount, currency });
      },
    });
  }

  static zero(currency: Currency): Money {
    return new Money({ amount: new BigNumber(0), currency });
  }

  add(other: Money): Effect.Effect<Money, CurrencyMismatchError> {
    if (this.currency.symbol !== other.currency.symbol) {
      return Effect.fail(
        new CurrencyMismatchError({
          left: this.currency,
          right: other.currency,
        })
      );
    }
    return Effect.succeed(
      new Money({
        amount: this.amount.plus(other.amount),
        currency: this.currency,
      })
    );
  }

  subtract(other: Money): Effect.Effect<Money, CurrencyMismatchError> {
    if (this.currency.symbol !== other.currency.symbol) {
      return Effect.fail(
        new CurrencyMismatchError({
          left: this.currency,
          right: other.currency,
        })
      );
    }
    return Effect.succeed(
      new Money({
        amount: this.amount.minus(other.amount),
        currency: this.currency,
      })
    );
  }

  multiply(factor: number): Money {
    return new Money({
      amount: this.amount.multipliedBy(factor),
      currency: this.currency,
    });
  }

  negate(): Money {
    return new Money({
      amount: this.amount.negated(),
      currency: this.currency,
    });
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  toBigInt(): bigint {
    const multiplier = new BigNumber(10).pow(this.currency.decimals);
    const scaled = this.amount.multipliedBy(multiplier);
    return BigInt(scaled.toFixed(0));
  }

  toJSON() {
    return {
      amount: this.amount.toString(),
      currency: this.currency.symbol,
      decimals: this.currency.decimals,
    };
  }
}