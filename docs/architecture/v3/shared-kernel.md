## Shared Kernel Implementation

### 1. Base Classes

```typescript
// packages/core/domain/base/aggregate-root.base.ts
import { Data, Option, ReadonlyArray } from 'effect';
import { DomainEvent } from './domain-event.base';

export abstract class EventSourcedAggregate extends Data.Class<{
  readonly version: number;
  readonly events: ReadonlyArray<DomainEvent>;
}> {
  protected abstract get aggregateId(): Option.Option<string>;

  getUncommittedEvents(): ReadonlyArray<DomainEvent> {
    return this.events.slice(this.version);
  }

  markEventsAsCommitted(): this {
    return this.copy({ version: this.events.length });
  }

  protected copy(updates: Partial<any>): this {
    const Constructor = this.constructor as any;
    return new Constructor({ ...this, ...updates });
  }
}
```

```typescript
// packages/core/domain/base/domain-event.base.ts
import { Data } from 'effect';
import { v4 as uuidv4 } from 'uuid';

export abstract class DomainEvent extends Data.Class<{
  readonly eventId: string;
  readonly aggregateId: string;
  readonly timestamp: Date;
  readonly version: number;
}> {
  abstract readonly _tag: string;

  protected constructor(data: Omit<DomainEvent, '_tag'>) {
    super({
      eventId: data.eventId || uuidv4(),
      aggregateId: data.aggregateId,
      timestamp: data.timestamp || new Date(),
      version: data.version || 1,
    });
  }
}
```

### 2. Common Value Objects

```typescript
// packages/core/domain/common-types/identifiers.ts
import { Brand } from 'effect';
import { v4 as uuidv4 } from 'uuid';

// Shared across all contexts
export type UserId = string & Brand.Brand<'UserId'>;
export const UserId = Brand.nominal<UserId>();

export type TransactionId = string & Brand.Brand<'TransactionId'>;
export const TransactionId = {
  ...Brand.nominal<TransactionId>(),
  generate: (): TransactionId => Brand.nominal<TransactionId>()(uuidv4()),
};

// Base ID generator
export const createIdType = <T extends string>(tag: T) => {
  type Id = string & Brand.Brand<T>;
  return {
    ...Brand.nominal<Id>(),
    generate: (): Id => Brand.nominal<Id>()(uuidv4()),
  };
};
```

```typescript
// packages/core/domain/common-types/currency.vo.ts
import { Data, Brand } from 'effect';

export type CurrencySymbol = string & Brand.Brand<'CurrencySymbol'>;
export const CurrencySymbol = Brand.nominal<CurrencySymbol>();

export interface Currency extends Data.Case {
  readonly _tag: 'Currency';
  readonly symbol: CurrencySymbol;
  readonly decimals: number;
  readonly name: string;
}

export const Currency = Data.tagged<Currency>('Currency');
```

```typescript
// packages/core/domain/common-types/money.vo.ts
import { Effect, Data, Brand, pipe } from 'effect';
import BigNumber from 'bignumber.js';
import { Currency } from './currency.vo';

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
      try: () => {
        const bigAmount = new BigNumber(amount);
        if (!bigAmount.isFinite()) {
          throw new InvalidMoneyAmountError({ amount });
        }
        return new Money({ amount: bigAmount, currency });
      },
      catch: () => new InvalidMoneyAmountError({ amount }),
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
```

```typescript
// packages/core/domain/common-types/quantity.vo.ts
import { Effect, Data } from 'effect';
import BigNumber from 'bignumber.js';

export class QuantityError extends Data.TaggedError('QuantityError')<{
  readonly message: string;
}> {}

export class NegativeQuantityError extends Data.TaggedError('NegativeQuantityError')<{
  readonly value: string;
}> {}

export class Quantity extends Data.Class<{
  readonly value: BigNumber;
  readonly precision: number;
}> {
  static of(value: string | number, precision: number = 18): Effect.Effect<Quantity, QuantityError> {
    return Effect.try({
      try: () => {
        const bigValue = new BigNumber(value);
        if (!bigValue.isFinite() || bigValue.isNegative()) {
          throw new QuantityError({ message: `Invalid quantity: ${value}` });
        }
        return new Quantity({ value: bigValue, precision });
      },
      catch: () => new QuantityError({ message: `Invalid quantity: ${value}` }),
    });
  }

  static zero(precision: number = 18): Quantity {
    return new Quantity({ value: new BigNumber(0), precision });
  }

  add(other: Quantity): Quantity {
    return new Quantity({
      value: this.value.plus(other.value),
      precision: this.precision,
    });
  }

  subtract(other: Quantity): Effect.Effect<Quantity, NegativeQuantityError> {
    const result = this.value.minus(other.value);
    if (result.isNegative()) {
      return Effect.fail(new NegativeQuantityError({ value: result.toString() }));
    }
    return Effect.succeed(new Quantity({ value: result, precision: this.precision }));
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
}
```

```typescript
// packages/core/domain/common-types/asset-id.vo.ts
import { Data } from 'effect';

export enum AssetType {
  CRYPTO = 'CRYPTO',
  FIAT = 'FIAT',
  NFT = 'NFT',
  LP_TOKEN = 'LP_TOKEN',
}

export class AssetId extends Data.Class<{
  readonly symbol: string;
  readonly type: AssetType;
  readonly blockchain?: string;
  readonly contractAddress?: string;
}> {
  static crypto(symbol: string, blockchain: string, contractAddress?: string): AssetId {
    return new AssetId({
      symbol: symbol.toUpperCase(),
      type: AssetType.CRYPTO,
      blockchain,
      contractAddress,
    });
  }

  static fiat(symbol: string): AssetId {
    return new AssetId({
      symbol: symbol.toUpperCase(),
      type: AssetType.FIAT,
    });
  }

  toString(): string {
    return this.blockchain ? `${this.symbol}@${this.blockchain}` : this.symbol;
  }
}
```

### 3. Effect Runtime Configuration

```typescript
// packages/core/effect/runtime.ts
import { Layer, Runtime, Effect, Context } from 'effect';
import { Clock } from '../clock/clock.service';

// Common services that all contexts need
export interface CoreServices {
  readonly clock: Clock;
}

export const CoreServices = Context.GenericTag<CoreServices>('CoreServices');

// Base runtime layer
export const CoreLayer = Layer.mergeAll(Clock.layer);

// Create runtime with core services
export const createRuntime = <R, E, A>(
  program: Effect.Effect<A, E, R>,
  contextLayer?: Layer.Layer<R, never, never>
) => {
  const fullLayer = contextLayer ? Layer.merge(CoreLayer, contextLayer) : CoreLayer;

  return Runtime.runPromise(Runtime.defaultRuntime.pipe(Runtime.provideLayer(fullLayer)), program);
};
```

### 4. Infrastructure Services

```typescript
// packages/core/effect/clock.ts
import { Effect, Context, Layer } from 'effect';

export interface Clock {
  now(): Date;
  setTestTime(date: Date): void;
  clearTestTime(): void;
}

export const Clock = Context.GenericTag<Clock>('Clock');

export class SystemClock implements Clock {
  private testTime?: Date;

  now(): Date {
    return this.testTime || new Date();
  }

  setTestTime(date: Date): void {
    this.testTime = date;
  }

  clearTestTime(): void {
    this.testTime = undefined;
  }
}

export const SystemClockLayer = Layer.succeed(Clock, new SystemClock());
```

### 5. Root Module Configuration

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CoreModule } from './@core/core.module';
import { TradingModule } from './contexts/trading/trading.module';
import { PortfolioModule } from './contexts/portfolio/portfolio.module';
import { TaxationModule } from './contexts/taxation/taxation.module';
import { ReconciliationModule } from './contexts/reconciliation/reconciliation.module';
import { EventStoreModule } from './infrastructure/event-store/event-store.module';
import { DatabaseModule } from './infrastructure/database/postgres/postgres.module';

@Module({
  imports: [
    // Core modules
    CoreModule,
    CqrsModule.forRoot(),
    DatabaseModule,
    EventStoreModule,

    // Bounded contexts
    TradingModule,
    PortfolioModule,
    TaxationModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
```

```typescript
// src/@core/core.module.ts
import { Global, Module } from '@nestjs/common';
import { SystemClock } from './infrastructure/clock/clock.service';

@Global()
@Module({
  providers: [
    {
      provide: 'Clock',
      useClass: SystemClock,
    },
    // Other core services
  ],
  exports: [
    'Clock',
    // Export other core services
  ],
})
export class CoreModule {}
```
