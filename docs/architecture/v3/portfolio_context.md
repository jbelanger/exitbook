## Portfolio Context - Complete Implementation

**Confidence Level: 8.5/10**

Let's build the Portfolio Context which manages positions, valuations, and portfolio analytics.

### 1. Core Domain Value Objects

```typescript
// src/contexts/portfolio/domain/value-objects/position.vo.ts
import { Data, Effect, Brand, Option, pipe } from 'effect';
import { Quantity } from '../../trading/domain/value-objects/quantity.vo';
import { Money } from '../../trading/domain/value-objects/money.vo';
import { AssetId } from '../../trading/domain/value-objects/identifiers.vo';
import BigNumber from 'bignumber.js';

// Position-specific identifiers
export type PositionId = string & Brand.Brand<'PositionId'>;
export const PositionId = {
  ...Brand.nominal<PositionId>(),
  generate: (): PositionId => Brand.nominal<PositionId>()(uuidv4()),
};

export type PortfolioId = string & Brand.Brand<'PortfolioId'>;
export const PortfolioId = {
  ...Brand.nominal<PortfolioId>(),
  generate: (): PortfolioId => Brand.nominal<PortfolioId>()(uuidv4()),
};

// Acquisition data
export class Acquisition extends Data.Class<{
  readonly quantity: Quantity;
  readonly price: Money;
  readonly date: Date;
  readonly transactionId: string;
  readonly method: AcquisitionMethod;
}> {}

export enum AcquisitionMethod {
  PURCHASE = 'PURCHASE',
  TRANSFER = 'TRANSFER',
  MINING = 'MINING',
  STAKING = 'STAKING',
  AIRDROP = 'AIRDROP',
  FORK = 'FORK',
  YIELD = 'YIELD',
}

// Cost basis tracking
export class CostBasis extends Data.Class<{
  readonly totalCost: Money;
  readonly quantity: Quantity;
  readonly method: AcquisitionMethod;
}> {
  getAverageCost(): Effect.Effect<Money, Error> {
    if (this.quantity.isZero()) {
      return Effect.succeed(Money.zero(this.totalCost.currency));
    }

    return Effect.try({
      try: () => this.totalCost.divide(this.quantity.toNumber()),
      catch: e => new Error(`Failed to calculate average cost: ${e}`),
    });
  }
}

// Holding represents a current position
export class Holding extends Data.Class<{
  readonly assetId: AssetId;
  readonly quantity: Quantity;
  readonly costBasis: CostBasis;
  readonly currentPrice: Option.Option<Money>;
  readonly lastUpdated: Date;
}> {
  getCurrentValue(): Option.Option<Money> {
    return pipe(
      this.currentPrice,
      Option.map(price => price.multiply(this.quantity.toNumber()))
    );
  }

  getUnrealizedGain(): Option.Option<Money> {
    return pipe(
      this.getCurrentValue(),
      Option.map(currentValue => currentValue.subtract(this.costBasis.totalCost)),
      Option.flatMap(Option.fromNullable)
    );
  }

  getROI(): Option.Option<number> {
    if (this.costBasis.totalCost.isZero()) {
      return Option.none();
    }

    return pipe(
      this.getUnrealizedGain(),
      Option.map(gain => (gain.toNumber() / this.costBasis.totalCost.toNumber()) * 100)
    );
  }
}

// Portfolio valuation
export class PortfolioValuation extends Data.Class<{
  readonly portfolioId: PortfolioId;
  readonly totalValue: Money;
  readonly holdings: ReadonlyArray<Holding>;
  readonly allocations: ReadonlyArray<AssetAllocation>;
  readonly timestamp: Date;
  readonly baseCurrency: string;
}> {
  getTotalCostBasis(): Money {
    return this.holdings.reduce(
      (acc, holding) => acc.add(holding.costBasis.totalCost).getOrElse(() => acc),
      Money.zero(this.totalValue.currency)
    );
  }

  getTotalUnrealizedGain(): Money {
    const costBasis = this.getTotalCostBasis();
    return this.totalValue.subtract(costBasis).getOrElse(() => Money.zero(this.totalValue.currency));
  }

  getPortfolioROI(): number {
    const costBasis = this.getTotalCostBasis();
    if (costBasis.isZero()) return 0;

    const gain = this.getTotalUnrealizedGain();
    return (gain.toNumber() / costBasis.toNumber()) * 100;
  }
}

// Asset allocation
export class AssetAllocation extends Data.Class<{
  readonly assetId: AssetId;
  readonly value: Money;
  readonly percentage: number;
  readonly targetPercentage: Option.Option<number>;
}> {
  getRebalanceAmount(totalValue: Money): Option.Option<Money> {
    return pipe(
      this.targetPercentage,
      Option.map(target => {
        const targetValue = totalValue.multiply(target / 100);
        return targetValue.subtract(this.value).getOrElse(() => Money.zero(this.value.currency));
      })
    );
  }

  isOverweight(): boolean {
    return pipe(
      this.targetPercentage,
      Option.map(target => this.percentage > target),
      Option.getOrElse(() => false)
    );
  }

  isUnderweight(): boolean {
    return pipe(
      this.targetPercentage,
      Option.map(target => this.percentage < target),
      Option.getOrElse(() => false)
    );
  }
}
```

### 2. Position Aggregate

```typescript
// src/contexts/portfolio/domain/aggregates/position.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray } from 'effect';
import { Data } from 'effect';
import { PositionId, Acquisition, CostBasis, AcquisitionMethod } from '../value-objects/position.vo';
import { UserId, AssetId, TransactionId } from '../../trading/domain/value-objects/identifiers.vo';
import { Quantity, NegativeQuantityError } from '../../trading/domain/value-objects/quantity.vo';
import { Money } from '../../trading/domain/value-objects/money.vo';
import { DomainEvent } from '../../trading/domain/events/transaction.events';

// Position errors
export class PositionError extends Data.TaggedError('PositionError')<{
  readonly message: string;
}> {}

export class PositionClosedError extends Data.TaggedError('PositionClosedError')<{
  readonly positionId: PositionId;
}> {}

export class InsufficientQuantityError extends Data.TaggedError('InsufficientQuantityError')<{
  readonly available: Quantity;
  readonly requested: Quantity;
}> {}

// Position status
export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

// Position events
export class PositionOpened extends DomainEvent {
  readonly _tag = 'PositionOpened';

  constructor(
    readonly data: {
      readonly positionId: PositionId;
      readonly userId: UserId;
      readonly asset: AssetId;
      readonly initialQuantity: Quantity;
      readonly acquisitionPrice: Money;
      readonly acquisitionMethod: AcquisitionMethod;
      readonly transactionId: TransactionId;
      readonly openedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.positionId,
      timestamp: data.openedAt,
      version: 1,
    });
  }
}

export class PositionIncreased extends DomainEvent {
  readonly _tag = 'PositionIncreased';

  constructor(
    readonly data: {
      readonly positionId: PositionId;
      readonly previousQuantity: Quantity;
      readonly addedQuantity: Quantity;
      readonly newQuantity: Quantity;
      readonly acquisitionPrice: Money;
      readonly acquisitionMethod: AcquisitionMethod;
      readonly transactionId: TransactionId;
      readonly increasedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.positionId,
      timestamp: data.increasedAt,
      version: 1,
    });
  }
}

export class PositionDecreased extends DomainEvent {
  readonly _tag = 'PositionDecreased';

  constructor(
    readonly data: {
      readonly positionId: PositionId;
      readonly previousQuantity: Quantity;
      readonly removedQuantity: Quantity;
      readonly newQuantity: Quantity;
      readonly disposalPrice: Money;
      readonly realizedGain: Money;
      readonly transactionId: TransactionId;
      readonly decreasedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.positionId,
      timestamp: data.decreasedAt,
      version: 1,
    });
  }
}

export class PositionClosed extends DomainEvent {
  readonly _tag = 'PositionClosed';

  constructor(
    readonly data: {
      readonly positionId: PositionId;
      readonly finalRealizedGain: Money;
      readonly closedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.positionId,
      timestamp: data.closedAt,
      version: 1,
    });
  }
}

// Commands
export interface OpenPositionCommand {
  readonly userId: UserId;
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly price: Money;
  readonly method: AcquisitionMethod;
  readonly transactionId: TransactionId;
}

export interface IncreasePositionCommand {
  readonly positionId: PositionId;
  readonly quantity: Quantity;
  readonly price: Money;
  readonly method: AcquisitionMethod;
  readonly transactionId: TransactionId;
}

export interface DecreasePositionCommand {
  readonly positionId: PositionId;
  readonly quantity: Quantity;
  readonly price: Money;
  readonly transactionId: TransactionId;
}

// Position Aggregate
export class Position extends Data.Class<{
  readonly positionId: Option.Option<PositionId>;
  readonly userId: Option.Option<UserId>;
  readonly asset: Option.Option<AssetId>;
  readonly quantity: Quantity;
  readonly acquisitions: ReadonlyArray<Acquisition>;
  readonly costBasis: CostBasis;
  readonly status: PositionStatus;
  readonly events: ReadonlyArray<DomainEvent>;
  readonly version: number;
}> {
  // Open new position
  static open(command: OpenPositionCommand): Effect.Effect<Position, never> {
    return Effect.sync(() => {
      const positionId = PositionId.generate();
      const totalCost = command.price.multiply(command.quantity.toNumber());

      const event = new PositionOpened({
        positionId,
        userId: command.userId,
        asset: command.asset,
        initialQuantity: command.quantity,
        acquisitionPrice: command.price,
        acquisitionMethod: command.method,
        transactionId: command.transactionId,
        openedAt: new Date(),
      });

      const acquisition = new Acquisition({
        quantity: command.quantity,
        price: command.price,
        date: new Date(),
        transactionId: command.transactionId,
        method: command.method,
      });

      const costBasis = new CostBasis({
        totalCost,
        quantity: command.quantity,
        method: command.method,
      });

      return new Position({
        positionId: Option.some(positionId),
        userId: Option.some(command.userId),
        asset: Option.some(command.asset),
        quantity: command.quantity,
        acquisitions: [acquisition],
        costBasis,
        status: PositionStatus.OPEN,
        events: [event],
        version: 0,
      });
    });
  }

  // Increase position
  increase(
    amount: Quantity,
    price: Money,
    method: AcquisitionMethod,
    transactionId: TransactionId
  ): Effect.Effect<Position, PositionClosedError> {
    if (this.status === PositionStatus.CLOSED) {
      return Effect.fail(
        new PositionClosedError({
          positionId: Option.getOrThrow(this.positionId),
        })
      );
    }

    return Effect.sync(() => {
      const newQuantity = this.quantity.add(amount);
      const additionalCost = price.multiply(amount.toNumber());
      const newTotalCost = this.costBasis.totalCost.add(additionalCost).getOrElse(() => this.costBasis.totalCost);

      const event = new PositionIncreased({
        positionId: Option.getOrThrow(this.positionId),
        previousQuantity: this.quantity,
        addedQuantity: amount,
        newQuantity,
        acquisitionPrice: price,
        acquisitionMethod: method,
        transactionId,
        increasedAt: new Date(),
      });

      const acquisition = new Acquisition({
        quantity: amount,
        price,
        date: new Date(),
        transactionId,
        method,
      });

      const costBasis = new CostBasis({
        totalCost: newTotalCost,
        quantity: newQuantity,
        method: this.costBasis.method, // Keep original method
      });

      return new Position({
        ...this,
        quantity: newQuantity,
        acquisitions: [...this.acquisitions, acquisition],
        costBasis,
        events: [...this.events, event],
      });
    });
  }

  // Decrease position
  decrease(
    amount: Quantity,
    price: Money,
    transactionId: TransactionId
  ): Effect.Effect<Position, InsufficientQuantityError | NegativeQuantityError> {
    if (this.quantity.isLessThan(amount)) {
      return Effect.fail(
        new InsufficientQuantityError({
          available: this.quantity,
          requested: amount,
        })
      );
    }

    return pipe(
      this.quantity.subtract(amount),
      Effect.flatMap(newQuantity => {
        // Calculate realized gain
        const disposalValue = price.multiply(amount.toNumber());
        const costBasisRatio = amount.toNumber() / this.quantity.toNumber();
        const disposalCostBasis = this.costBasis.totalCost.multiply(costBasisRatio);
        const realizedGain = disposalValue.subtract(disposalCostBasis).getOrElse(() => Money.zero(price.currency));

        const events: DomainEvent[] = [];

        events.push(
          new PositionDecreased({
            positionId: Option.getOrThrow(this.positionId),
            previousQuantity: this.quantity,
            removedQuantity: amount,
            newQuantity,
            disposalPrice: price,
            realizedGain,
            transactionId,
            decreasedAt: new Date(),
          })
        );

        // Close position if quantity is zero
        if (newQuantity.isZero()) {
          events.push(
            new PositionClosed({
              positionId: Option.getOrThrow(this.positionId),
              finalRealizedGain: realizedGain,
              closedAt: new Date(),
            })
          );
        }

        // Update cost basis
        const newTotalCost = this.costBasis.totalCost.multiply(1 - costBasisRatio);
        const costBasis = new CostBasis({
          totalCost: newTotalCost,
          quantity: newQuantity,
          method: this.costBasis.method,
        });

        return Effect.succeed(
          new Position({
            ...this,
            quantity: newQuantity,
            costBasis,
            status: newQuantity.isZero() ? PositionStatus.CLOSED : this.status,
            events: [...this.events, ...events],
          })
        );
      })
    );
  }

  // Calculate weighted average cost
  getWeightedAverageCost(): Effect.Effect<Money, Error> {
    if (this.quantity.isZero()) {
      return Effect.succeed(Money.zero(this.costBasis.totalCost.currency));
    }

    return Effect.try({
      try: () => this.costBasis.totalCost.divide(this.quantity.toNumber()),
      catch: e => new Error(`Failed to calculate weighted average: ${e}`),
    });
  }

  // Calculate unrealized gain
  getUnrealizedGain(currentPrice: Money): Effect.Effect<Money, Error> {
    const currentValue = currentPrice.multiply(this.quantity.toNumber());
    return Effect.succeed(
      currentValue.subtract(this.costBasis.totalCost).getOrElse(() => Money.zero(currentPrice.currency))
    );
  }

  // Get uncommitted events
  getUncommittedEvents(): ReadonlyArray<DomainEvent> {
    return this.events.slice(this.version);
  }

  // Mark events as committed
  markEventsAsCommitted(): Position {
    return new Position({
      ...this,
      version: this.events.length,
    });
  }
}
```

### 3. Portfolio Aggregate

```typescript
// src/contexts/portfolio/domain/aggregates/portfolio.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray, ReadonlyRecord } from 'effect';
import { Data } from 'effect';
import { PortfolioId, PortfolioValuation, AssetAllocation, Holding } from '../value-objects/position.vo';
import { UserId, AssetId } from '../../trading/domain/value-objects/identifiers.vo';
import { Money, Currency } from '../../trading/domain/value-objects/money.vo';
import { DomainEvent } from '../../trading/domain/events/transaction.events';

// Portfolio errors
export class PortfolioError extends Data.TaggedError('PortfolioError')<{
  readonly message: string;
}> {}

export class MissingPriceError extends Data.TaggedError('MissingPriceError')<{
  readonly asset: AssetId;
}> {}

// Portfolio events
export class PortfolioInitialized extends DomainEvent {
  readonly _tag = 'PortfolioInitialized';

  constructor(
    readonly data: {
      readonly portfolioId: PortfolioId;
      readonly userId: UserId;
      readonly baseCurrency: Currency;
      readonly initializedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.portfolioId,
      timestamp: data.initializedAt,
      version: 1,
    });
  }
}

export class PortfolioValuated extends DomainEvent {
  readonly _tag = 'PortfolioValuated';

  constructor(
    readonly data: {
      readonly portfolioId: PortfolioId;
      readonly valuation: PortfolioValuation;
      readonly valuatedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.portfolioId,
      timestamp: data.valuatedAt,
      version: 1,
    });
  }
}

export class PortfolioRebalanced extends DomainEvent {
  readonly _tag = 'PortfolioRebalanced';

  constructor(
    readonly data: {
      readonly portfolioId: PortfolioId;
      readonly rebalanceOrders: ReadonlyArray<RebalanceOrder>;
      readonly rebalancedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.portfolioId,
      timestamp: data.rebalancedAt,
      version: 1,
    });
  }
}

// Rebalance order
export class RebalanceOrder extends Data.Class<{
  readonly asset: AssetId;
  readonly action: 'BUY' | 'SELL';
  readonly quantity: Quantity;
  readonly estimatedPrice: Money;
  readonly reason: string;
}> {}

// Position summary for portfolio
export class PositionSummary extends Data.Class<{
  readonly positionId: PositionId;
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly costBasis: Money;
  readonly lastUpdated: Date;
}> {}

// Price map type
export type PriceMap = ReadonlyRecord.ReadonlyRecord<string, Money>;

// Portfolio aggregate
export class Portfolio extends Data.Class<{
  readonly portfolioId: Option.Option<PortfolioId>;
  readonly userId: Option.Option<UserId>;
  readonly baseCurrency: Option.Option<Currency>;
  readonly positions: ReadonlyRecord.ReadonlyRecord<string, PositionSummary>;
  readonly lastValuation: Option.Option<PortfolioValuation>;
  readonly targetAllocations: ReadonlyRecord.ReadonlyRecord<string, number>;
  readonly events: ReadonlyArray<DomainEvent>;
  readonly version: number;
}> {
  // Initialize portfolio
  static initialize(userId: UserId, baseCurrency: Currency): Effect.Effect<Portfolio, never> {
    return Effect.sync(() => {
      const portfolioId = PortfolioId.generate();

      const event = new PortfolioInitialized({
        portfolioId,
        userId,
        baseCurrency,
        initializedAt: new Date(),
      });

      return new Portfolio({
        portfolioId: Option.some(portfolioId),
        userId: Option.some(userId),
        baseCurrency: Option.some(baseCurrency),
        positions: {},
        lastValuation: Option.none(),
        targetAllocations: {},
        events: [event],
        version: 0,
      });
    });
  }

  // Update position in portfolio
  updatePosition(position: PositionSummary): Portfolio {
    return new Portfolio({
      ...this,
      positions: {
        ...this.positions,
        [position.asset.toString()]: position,
      },
    });
  }

  // Calculate portfolio valuation
  calculateValuation(prices: PriceMap): Effect.Effect<Portfolio, MissingPriceError> {
    return pipe(
      Effect.forEach(
        Object.entries(this.positions),
        ([assetKey, position]) => {
          const price = prices[assetKey];
          if (!price) {
            return Effect.fail(
              new MissingPriceError({
                asset: position.asset,
              })
            );
          }

          const value = price.multiply(position.quantity.toNumber());
          const holding = new Holding({
            assetId: position.asset,
            quantity: position.quantity,
            costBasis: new CostBasis({
              totalCost: position.costBasis,
              quantity: position.quantity,
              method: AcquisitionMethod.PURCHASE,
            }),
            currentPrice: Option.some(price),
            lastUpdated: new Date(),
          });

          return Effect.succeed({ holding, value });
        },
        { concurrency: 'unbounded' }
      ),
      Effect.map(holdingsData => {
        const holdings = holdingsData.map(d => d.holding);
        const totalValue = holdingsData.reduce(
          (acc, d) => acc.add(d.value).getOrElse(() => acc),
          Money.zero(Option.getOrThrow(this.baseCurrency))
        );

        // Calculate allocations
        const allocations = holdingsData.map(({ holding, value }) => {
          const percentage = totalValue.isZero() ? 0 : (value.toNumber() / totalValue.toNumber()) * 100;

          const targetPercentage = Option.fromNullable(this.targetAllocations[holding.assetId.toString()]);

          return new AssetAllocation({
            assetId: holding.assetId,
            value,
            percentage,
            targetPercentage,
          });
        });

        const valuation = new PortfolioValuation({
          portfolioId: Option.getOrThrow(this.portfolioId),
          totalValue,
          holdings,
          allocations,
          timestamp: new Date(),
          baseCurrency: Option.getOrThrow(this.baseCurrency).symbol,
        });

        const event = new PortfolioValuated({
          portfolioId: Option.getOrThrow(this.portfolioId),
          valuation,
          valuatedAt: new Date(),
        });

        return new Portfolio({
          ...this,
          lastValuation: Option.some(valuation),
          events: [...this.events, event],
        });
      })
    );
  }

  // Set target allocations
  setTargetAllocations(
    allocations: ReadonlyRecord.ReadonlyRecord<string, number>
  ): Effect.Effect<Portfolio, PortfolioError> {
    // Validate allocations sum to 100
    const total = Object.values(allocations).reduce((sum, pct) => sum + pct, 0);

    if (Math.abs(total - 100) > 0.01) {
      return Effect.fail(
        new PortfolioError({
          message: `Allocations must sum to 100%, got ${total}%`,
        })
      );
    }

    return Effect.succeed(
      new Portfolio({
        ...this,
        targetAllocations: allocations,
      })
    );
  }

  // Calculate rebalance orders
  calculateRebalance(): Effect.Effect<ReadonlyArray<RebalanceOrder>, PortfolioError> {
    return pipe(
      this.lastValuation,
      Option.match({
        onNone: () =>
          Effect.fail(
            new PortfolioError({
              message: 'Portfolio must be valuated before rebalancing',
            })
          ),
        onSome: valuation => {
          const orders: RebalanceOrder[] = [];

          valuation.allocations.forEach(allocation => {
            const rebalanceAmount = allocation.getRebalanceAmount(valuation.totalValue);

            Option.match(rebalanceAmount, {
              onNone: () => {},
              onSome: amount => {
                if (!amount.isZero()) {
                  // Find current price for the asset
                  const holding = valuation.holdings.find(h => h.assetId.toString() === allocation.assetId.toString());

                  Option.match(holding?.currentPrice, {
                    onNone: () => {},
                    onSome: price => {
                      const quantity = Quantity.of(Math.abs(amount.toNumber() / price.toNumber()), 18);

                      Effect.match(quantity, {
                        onFailure: () => {},
                        onSuccess: qty => {
                          orders.push(
                            new RebalanceOrder({
                              asset: allocation.assetId,
                              action: amount.isNegative() ? 'SELL' : 'BUY',
                              quantity: qty,
                              estimatedPrice: price,
                              reason: allocation.isOverweight() ? 'Overweight position' : 'Underweight position',
                            })
                          );
                        },
                      });
                    },
                  });
                }
              },
            });
          });

          const event = new PortfolioRebalanced({
            portfolioId: Option.getOrThrow(this.portfolioId),
            rebalanceOrders: orders,
            rebalancedAt: new Date(),
          });

          // Note: In practice, we'd update the aggregate with the event
          // But since we're returning orders, we'll handle that in the command handler

          return Effect.succeed(orders);
        },
      })
    );
  }

  // Get uncommitted events
  getUncommittedEvents(): ReadonlyArray<DomainEvent> {
    return this.events.slice(this.version);
  }

  // Mark events as committed
  markEventsAsCommitted(): Portfolio {
    return new Portfolio({
      ...this,
      version: this.events.length,
    });
  }
}
```

### 4. Domain Services

```typescript
// src/contexts/portfolio/domain/services/valuation.service.ts
import { Effect, Context, Layer, pipe } from 'effect';
import { Money, Currency } from '../../trading/domain/value-objects/money.vo';
import { AssetId } from '../../trading/domain/value-objects/identifiers.vo';
import { Data } from 'effect';

// Price provider errors
export class PriceFetchError extends Data.TaggedError('PriceFetchError')<{
  readonly asset: AssetId;
  readonly reason: string;
}> {}

export class PriceNotAvailableError extends Data.TaggedError('PriceNotAvailableError')<{
  readonly asset: AssetId;
  readonly timestamp: Date;
}> {}

// Price data
export class Price extends Data.Class<{
  readonly asset: AssetId;
  readonly price: Money;
  readonly timestamp: Date;
  readonly source: string;
}> {}

// Price provider service
export interface PriceProvider {
  getPrice(
    asset: AssetId,
    currency: Currency,
    timestamp?: Date
  ): Effect.Effect<Price, PriceFetchError | PriceNotAvailableError>;

  getPrices(
    assets: ReadonlyArray<AssetId>,
    currency: Currency,
    timestamp?: Date
  ): Effect.Effect<ReadonlyArray<Price>, PriceFetchError>;
}

export const PriceProvider = Context.GenericTag<PriceProvider>('PriceProvider');

// Valuation calculator
export class ValuationCalculator {
  static calculate(
    holdings: ReadonlyArray<Holding>,
    prices: ReadonlyArray<Price>,
    baseCurrency: Currency
  ): Effect.Effect<PortfolioValuation, never> {
    return Effect.sync(() => {
      const priceMap = new Map(prices.map(p => [p.asset.toString(), p.price]));

      let totalValue = Money.zero(baseCurrency);
      const valuedHoldings = holdings.map(holding => {
        const price = priceMap.get(holding.assetId.toString());
        if (price) {
          const value = price.multiply(holding.quantity.toNumber());
          totalValue = totalValue.add(value).getOrElse(() => totalValue);
        }
        return holding;
      });

      // Calculate allocations
      const allocations = valuedHoldings.map(holding => {
        const price = priceMap.get(holding.assetId.toString());
        const value = price ? price.multiply(holding.quantity.toNumber()) : Money.zero(baseCurrency);

        const percentage = totalValue.isZero() ? 0 : (value.toNumber() / totalValue.toNumber()) * 100;

        return new AssetAllocation({
          assetId: holding.assetId,
          value,
          percentage,
          targetPercentage: Option.none(),
        });
      });

      return new PortfolioValuation({
        portfolioId: PortfolioId.generate(),
        totalValue,
        holdings: valuedHoldings,
        allocations,
        timestamp: new Date(),
        baseCurrency: baseCurrency.symbol,
      });
    });
  }
}

// Performance metrics calculator
export class PerformanceCalculator {
  static calculateReturns(
    currentValue: Money,
    previousValue: Money,
    period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  ): Effect.Effect<number, never> {
    if (previousValue.isZero()) {
      return Effect.succeed(0);
    }

    return pipe(
      currentValue.subtract(previousValue),
      Effect.map(difference => (difference.toNumber() / previousValue.toNumber()) * 100),
      Effect.orElseSucceed(() => 0)
    );
  }

  static calculateSharpeRatio(returns: ReadonlyArray<number>, riskFreeRate: number = 0.02): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const excessReturn = avgReturn - riskFreeRate;

    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;

    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : excessReturn / stdDev;
  }

  static calculateMaxDrawdown(values: ReadonlyArray<Money>): number {
    if (values.length < 2) return 0;

    let peak = values[0];
    let maxDrawdown = 0;

    for (const value of values) {
      if (value.isGreaterThan(peak)) {
        peak = value;
      }

      const drawdown = peak
        .subtract(value)
        .map(diff => (diff.toNumber() / peak.toNumber()) * 100)
        .getOrElse(() => 0);

      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }
}
```

### 5. Application Layer

```typescript
// src/contexts/portfolio/application/commands/open-position.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { Effect, pipe } from 'effect';
import { Position, OpenPositionCommand } from '../../domain/aggregates/position.aggregate';
import { PositionRepository } from '../../infrastructure/repositories/position.repository';

@Injectable()
@CommandHandler(OpenPositionCommand)
export class OpenPositionHandler implements ICommandHandler<OpenPositionCommand> {
  constructor(
    private readonly repository: PositionRepository,
    private readonly eventBus: EventBus
  ) {}

  async execute(command: OpenPositionCommand): Promise<void> {
    const program = pipe(
      Position.open(command),
      Effect.flatMap(position =>
        Effect.tryPromise({
          try: async () => {
            // Save position
            await this.repository.save(position);

            // Publish events
            for (const event of position.getUncommittedEvents()) {
              await this.eventBus.publish(event);
            }

            return position;
          },
          catch: error => new Error(`Failed to save position: ${error}`),
        })
      )
    );

    await Effect.runPromise(program);
  }
}
```

```typescript
// src/contexts/portfolio/application/commands/calculate-valuation.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { Effect, pipe, Layer } from 'effect';
import { Portfolio } from '../../domain/aggregates/portfolio.aggregate';
import { PortfolioRepository } from '../../infrastructure/repositories/portfolio.repository';
import { PriceProvider } from '../../domain/services/valuation.service';
import { UserId, PortfolioId } from '../../trading/domain/value-objects/identifiers.vo';

export class CalculateValuationCommand {
  constructor(
    readonly portfolioId: PortfolioId,
    readonly userId: UserId
  ) {}
}

@Injectable()
@CommandHandler(CalculateValuationCommand)
export class CalculateValuationHandler implements ICommandHandler<CalculateValuationCommand> {
  constructor(
    private readonly repository: PortfolioRepository,
    private readonly eventBus: EventBus,
    private readonly priceProvider: PriceProvider
  ) {}

  async execute(command: CalculateValuationCommand): Promise<void> {
    const program = pipe(
      // Load portfolio
      Effect.tryPromise({
        try: () => this.repository.load(command.portfolioId),
        catch: error => new Error(`Failed to load portfolio: ${error}`),
      }),
      Effect.flatMap(portfolio => {
        // Get all asset IDs
        const assetIds = Object.values(portfolio.positions).map(p => p.asset);

        // Fetch prices
        return pipe(
          this.priceProvider.getPrices(assetIds, portfolio.baseCurrency.getOrThrow(), new Date()),
          Effect.map(prices => {
            // Convert to price map
            const priceMap = prices.reduce(
              (acc, p) => ({
                ...acc,
                [p.asset.toString()]: p.price,
              }),
              {}
            );

            return { portfolio, priceMap };
          })
        );
      }),
      Effect.flatMap(({ portfolio, priceMap }) => portfolio.calculateValuation(priceMap)),
      Effect.flatMap(updatedPortfolio =>
        Effect.tryPromise({
          try: async () => {
            // Save portfolio
            await this.repository.save(updatedPortfolio);

            // Publish events
            for (const event of updatedPortfolio.getUncommittedEvents()) {
              await this.eventBus.publish(event);
            }
          },
          catch: error => new Error(`Failed to save valuation: ${error}`),
        })
      )
    );

    await Effect.runPromise(program.pipe(Effect.provideService(PriceProvider, this.priceProvider)));
  }
}
```

### 6. Infrastructure Layer

```typescript
// src/contexts/portfolio/infrastructure/repositories/position.repository.ts
import { Injectable } from '@nestjs/common';
import { EventStore } from '../../../../infrastructure/event-store/event-store.service';
import { Position, PositionStatus } from '../../domain/aggregates/position.aggregate';
import { PositionId } from '../../domain/value-objects/position.vo';
import { Option } from 'effect';

@Injectable()
export class PositionRepository {
  constructor(private readonly eventStore: EventStore) {}

  async load(positionId: PositionId): Promise<Position> {
    const events = await this.eventStore.readStream(positionId);

    // Reconstruct from events
    let position = new Position({
      positionId: Option.none(),
      userId: Option.none(),
      asset: Option.none(),
      quantity: Quantity.zero(),
      acquisitions: [],
      costBasis: new CostBasis({
        totalCost: Money.zero(Currency({ symbol: 'USD', decimals: 2, name: 'US Dollar' })),
        quantity: Quantity.zero(),
        method: AcquisitionMethod.PURCHASE,
      }),
      status: PositionStatus.OPEN,
      events: [],
      version: 0,
    });

    // Apply events
    for (const event of events) {
      position = this.applyEvent(position, event);
    }

    return position;
  }

  async save(position: Position): Promise<void> {
    const uncommittedEvents = position.getUncommittedEvents();

    if (uncommittedEvents.length === 0) {
      return;
    }

    await this.eventStore.append(Option.getOrThrow(position.positionId), uncommittedEvents, position.version);
  }

  async findByUserAndAsset(userId: string, assetId: string): Promise<Position | null> {
    // Query projection for active positions
    // This would typically query a read model/projection
    const result = await this.queryProjection(
      'SELECT position_id FROM position_projections WHERE user_id = $1 AND asset_id = $2 AND status = $3',
      [userId, assetId, 'OPEN']
    );

    if (!result) return null;

    return this.load(result.position_id);
  }

  private applyEvent(position: Position, event: any): Position {
    // Event reconstruction logic
    switch (event._tag) {
      case 'PositionOpened':
        return new Position({
          ...position,
          positionId: Option.some(event.data.positionId),
          userId: Option.some(event.data.userId),
          asset: Option.some(event.data.asset),
          quantity: event.data.initialQuantity,
          status: PositionStatus.OPEN,
          version: position.version + 1,
        });

      case 'PositionIncreased':
        return new Position({
          ...position,
          quantity: event.data.newQuantity,
          version: position.version + 1,
        });

      case 'PositionDecreased':
        return new Position({
          ...position,
          quantity: event.data.newQuantity,
          version: position.version + 1,
        });

      case 'PositionClosed':
        return new Position({
          ...position,
          status: PositionStatus.CLOSED,
          version: position.version + 1,
        });

      default:
        return position;
    }
  }
}
```

```typescript
// src/contexts/portfolio/infrastructure/integrations/price-provider.implementation.ts
import { Injectable } from '@nestjs/common';
import { Effect, pipe } from 'effect';
import { PriceProvider, Price, PriceFetchError } from '../../domain/services/valuation.service';
import { AssetId } from '../../../trading/domain/value-objects/identifiers.vo';
import { Money, Currency } from '../../../trading/domain/value-objects/money.vo';
import axios from 'axios';

@Injectable()
export class CoinGeckoPriceProvider implements PriceProvider {
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';

  getPrice(asset: AssetId, currency: Currency, timestamp?: Date): Effect.Effect<Price, PriceFetchError> {
    return Effect.tryPromise({
      try: async () => {
        const response = await axios.get(`${this.baseUrl}/simple/price`, {
          params: {
            ids: this.mapAssetToCoingeckoId(asset),
            vs_currencies: currency.symbol.toLowerCase(),
            include_24hr_change: true,
          },
        });

        const data = response.data[this.mapAssetToCoingeckoId(asset)];
        if (!data) {
          throw new Error('Price not found');
        }

        const price = Money.of(data[currency.symbol.toLowerCase()], currency);

        return Effect.map(
          price,
          p =>
            new Price({
              asset,
              price: p,
              timestamp: timestamp || new Date(),
              source: 'coingecko',
            })
        );
      },
      catch: error =>
        new PriceFetchError({
          asset,
          reason: error.message,
        }),
    }).pipe(Effect.flatten);
  }

  getPrices(
    assets: ReadonlyArray<AssetId>,
    currency: Currency,
    timestamp?: Date
  ): Effect.Effect<ReadonlyArray<Price>, PriceFetchError> {
    return Effect.forEach(
      assets,
      asset => this.getPrice(asset, currency, timestamp),
      { concurrency: 5 } // Rate limiting
    );
  }

  private mapAssetToCoingeckoId(asset: AssetId): string {
    // Map internal asset IDs to CoinGecko IDs
    const mapping: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      USDT: 'tether',
      // ... more mappings
    };

    return mapping[asset.symbol] || asset.symbol.toLowerCase();
  }
}
```

### 7. Module Configuration

```typescript
// src/contexts/portfolio/portfolio.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { OpenPositionHandler } from './application/commands/open-position.handler';
import { CalculateValuationHandler } from './application/commands/calculate-valuation.handler';
import { PositionRepository } from './infrastructure/repositories/position.repository';
import { PortfolioRepository } from './infrastructure/repositories/portfolio.repository';
import { CoinGeckoPriceProvider } from './infrastructure/integrations/price-provider.implementation';
import { PortfolioController } from './api/portfolio.controller';
import { EventStoreModule } from '../../infrastructure/event-store/event-store.module';
import { PriceProvider } from './domain/services/valuation.service';

// Command handlers
const CommandHandlers = [OpenPositionHandler, CalculateValuationHandler];

// Event handlers (projections)
const EventHandlers = [];

// Query handlers
const QueryHandlers = [];

@Module({
  imports: [CqrsModule, EventStoreModule],
  controllers: [PortfolioController],
  providers: [
    PositionRepository,
    PortfolioRepository,
    {
      provide: PriceProvider,
      useClass: CoinGeckoPriceProvider,
    },
    ...CommandHandlers,
    ...EventHandlers,
    ...QueryHandlers,
  ],
  exports: [PositionRepository, PortfolioRepository],
})
export class PortfolioModule {}
```

### 8. API Controller

```typescript
// src/contexts/portfolio/api/portfolio.controller.ts
import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OpenPositionCommand, CalculateValuationCommand } from '../application/commands';
import { GetPortfolioValuationQuery } from '../application/queries';

@ApiTags('portfolio')
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('positions')
  @ApiOperation({ summary: 'Open a new position' })
  async openPosition(@Body() dto: OpenPositionDto) {
    const command = new OpenPositionCommand(
      UserId(dto.userId),
      AssetId.crypto(dto.asset.symbol, dto.asset.blockchain),
      await Effect.runPromise(Quantity.of(dto.quantity)),
      await Effect.runPromise(
        Money.of(
          dto.price.amount,
          Currency({
            symbol: dto.price.currency,
            decimals: dto.price.decimals,
            name: dto.price.currencyName,
          })
        )
      ),
      dto.method as AcquisitionMethod,
      TransactionId(dto.transactionId)
    );

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Post(':id/valuate')
  @ApiOperation({ summary: 'Calculate portfolio valuation' })
  async calculateValuation(@Param('id') portfolioId: string) {
    const command = new CalculateValuationCommand(
      PortfolioId(portfolioId),
      UserId('current-user') // From auth context
    );

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Get(':id/valuation')
  @ApiOperation({ summary: 'Get current portfolio valuation' })
  async getValuation(@Param('id') portfolioId: string) {
    const query = new GetPortfolioValuationQuery(PortfolioId(portfolioId));

    return this.queryBus.execute(query);
  }
}
```

This completes the **Portfolio Context** with:

1. ✅ Position tracking with cost basis
2. ✅ Portfolio valuation and allocations
3. ✅ Rebalancing calculations
4. ✅ Performance metrics
5. ✅ Price provider integration
6. ✅ Event sourcing for positions
7. ✅ Effect-TS for domain logic
8. ✅ NestJS for infrastructure

Key features implemented:

- Weighted average cost calculation
- Unrealized/realized gain tracking
- Multi-currency support
- Target allocation and rebalancing
- Performance metrics (Sharpe ratio, max drawdown)
- External price integration

Would you like me to continue with the **Taxation Context** next, or would you like to review/adjust anything in the Portfolio Context?
