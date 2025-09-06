## Taxation Context

### 1. Core Domain Value Objects

```typescript
// src/contexts/taxation/domain/value-objects/tax-lot.vo.ts
import { Data, Effect, Brand, Option, pipe } from 'effect';
import { Quantity } from '../../trading/domain/value-objects/quantity.vo';
import { Money, CurrencyMismatchError } from '../../trading/domain/value-objects/money.vo';
import { AssetId, TransactionId } from '../../trading/domain/value-objects/identifiers.vo';

// Tax lot identifiers
export type TaxLotId = string & Brand.Brand<'TaxLotId'>;
export const TaxLotId = {
  ...Brand.nominal<TaxLotId>(),
  generate: (): TaxLotId => Brand.nominal<TaxLotId>()(uuidv4()),
};

export type TaxReportId = string & Brand.Brand<'TaxReportId'>;
export const TaxReportId = {
  ...Brand.nominal<TaxReportId>(),
  generate: (): TaxReportId => Brand.nominal<TaxReportId>()(uuidv4()),
};

// Tax year
export class TaxYear extends Data.Class<{
  readonly year: number;
  readonly startDate: Date;
  readonly endDate: Date;
}> {
  static of(year: number): TaxYear {
    return new TaxYear({
      year,
      startDate: new Date(`${year}-01-01`),
      endDate: new Date(`${year}-12-31T23:59:59.999Z`),
    });
  }

  contains(date: Date): boolean {
    return date >= this.startDate && date <= this.endDate;
  }

  isValid(): boolean {
    const currentYear = new Date().getFullYear();
    return this.year > 2008 && this.year <= currentYear; // Bitcoin started in 2009
  }
}

// Accounting methods
export enum AccountingMethod {
  FIFO = 'FIFO', // First In First Out
  LIFO = 'LIFO', // Last In First Out
  HIFO = 'HIFO', // Highest In First Out
  SPECIFIC = 'SPECIFIC', // Specific Identification
}

// Tax lot status
export enum TaxLotStatus {
  OPEN = 'OPEN',
  PARTIAL = 'PARTIAL',
  CLOSED = 'CLOSED',
  ADJUSTED = 'ADJUSTED', // For wash sales
}

// Holding period
export class HoldingPeriod extends Data.Class<{
  readonly days: number;
  readonly startDate: Date;
  readonly endDate: Date;
}> {
  static between(start: Date, end: Date): HoldingPeriod {
    const diffMs = end.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return new HoldingPeriod({
      days: Math.max(0, days),
      startDate: start,
      endDate: end,
    });
  }

  getMonths(): number {
    return Math.floor(this.days / 30);
  }

  getYears(): number {
    return Math.floor(this.days / 365);
  }
}

// Cost basis with adjustments
export class CostBasis extends Data.Class<{
  readonly originalAmount: Money;
  readonly adjustedAmount: Money;
  readonly adjustments: ReadonlyArray<CostBasisAdjustment>;
}> {
  static initial(amount: Money): CostBasis {
    return new CostBasis({
      originalAmount: amount,
      adjustedAmount: amount,
      adjustments: [],
    });
  }

  addAdjustment(adjustment: CostBasisAdjustment): Effect.Effect<CostBasis, CurrencyMismatchError> {
    const effect =
      adjustment.type === 'INCREASE'
        ? this.adjustedAmount.add(adjustment.amount)
        : this.adjustedAmount.subtract(adjustment.amount);

    return Effect.map(
      effect,
      newAdjustedAmount =>
        new CostBasis({
          originalAmount: this.originalAmount,
          adjustedAmount: newAdjustedAmount,
          adjustments: [...this.adjustments, adjustment],
        })
    );
  }

  perUnit(quantity: Quantity): Effect.Effect<Money, Error> {
    if (quantity.isZero()) {
      return Effect.fail(new Error('Cannot calculate per-unit cost for zero quantity'));
    }

    return Effect.try({
      try: () => this.adjustedAmount.divide(quantity.toNumber()),
      catch: e => new Error(`Failed to calculate per-unit cost: ${e}`),
    });
  }
}

// Cost basis adjustment (for wash sales, etc.)
export class CostBasisAdjustment extends Data.Class<{
  readonly type: 'INCREASE' | 'DECREASE';
  readonly amount: Money;
  readonly reason: string;
  readonly date: Date;
  readonly relatedTransactionId: Option.Option<TransactionId>;
}> {}

// Tax lot quantity tracking
export class TaxLotQuantity extends Data.Class<{
  readonly original: Quantity;
  readonly remaining: Quantity;
  readonly consumed: Quantity;
}> {
  static initial(quantity: Quantity): TaxLotQuantity {
    return new TaxLotQuantity({
      original: quantity,
      remaining: quantity,
      consumed: Quantity.of(0, quantity.precision).getOrElse(() => quantity),
    });
  }

  consume(amount: Quantity): Effect.Effect<TaxLotQuantity, Error> {
    if (amount.isGreaterThan(this.remaining)) {
      return Effect.fail(new Error('Cannot consume more than remaining quantity'));
    }

    return pipe(
      this.remaining.subtract(amount),
      Effect.map(
        newRemaining =>
          new TaxLotQuantity({
            original: this.original,
            remaining: newRemaining,
            consumed: this.consumed.add(amount),
          })
      )
    );
  }

  isFullyConsumed(): boolean {
    return this.remaining.isZero();
  }

  getConsumptionPercentage(): number {
    if (this.original.isZero()) return 100;
    return (this.consumed.toNumber() / this.original.toNumber()) * 100;
  }
}

// Realized gain/loss
export class RealizedGain extends Data.Class<{
  readonly proceeds: Money;
  readonly costBasis: Money;
  readonly gain: Money;
  readonly holdingPeriod: HoldingPeriod;
  readonly washSaleAdjustment: Option.Option<Money>;
}> {
  static calculate(
    proceeds: Money,
    costBasis: Money,
    holdingPeriod: HoldingPeriod,
    washSaleAdjustment?: Money
  ): RealizedGain {
    const gain = proceeds.subtract(costBasis).getOrElse(() => Money.zero(proceeds.currency));

    return new RealizedGain({
      proceeds,
      costBasis,
      gain: washSaleAdjustment ? gain.subtract(washSaleAdjustment).getOrElse(() => gain) : gain,
      holdingPeriod,
      washSaleAdjustment: Option.fromNullable(washSaleAdjustment),
    });
  }

  isGain(): boolean {
    return !this.gain.isNegative();
  }

  isLoss(): boolean {
    return this.gain.isNegative();
  }

  getTaxableAmount(): Money {
    // Apply wash sale rules if applicable
    return Option.match(this.washSaleAdjustment, {
      onNone: () => this.gain,
      onSome: adjustment => {
        // If it's a loss and wash sale applies, disallow the loss
        if (this.isLoss()) {
          return Money.zero(this.gain.currency);
        }
        return this.gain;
      },
    });
  }
}

// Tax summary
export class TaxSummary extends Data.Class<{
  readonly taxYear: TaxYear;
  readonly jurisdiction: string;
  readonly totalProceeds: Money;
  readonly totalCostBasis: Money;
  readonly netGain: Money;
  readonly details: Record<string, unknown>; // Jurisdiction-specific details
}> {}

// Taxable transaction
export class TaxableTransaction extends Data.Class<{
  readonly transactionId: TransactionId;
  readonly type: 'ACQUISITION' | 'DISPOSAL' | 'INCOME' | 'MINING' | 'STAKING';
  readonly asset: AssetId;
  readonly taxCategory: TaxCategory; // Added for richer asset classification
  readonly quantity: Quantity;
  readonly price: Money;
  readonly date: Date;
  readonly taxLotId: Option.Option<TaxLotId>;
  readonly realizedGain: Option.Option<RealizedGain>;
}> {
  isTaxableEvent(): boolean {
    return this.type === 'DISPOSAL' || this.type === 'INCOME' || this.type === 'MINING' || this.type === 'STAKING';
  }
}
```

### 2. Tax Lot Aggregate

```typescript
// src/contexts/taxation/domain/aggregates/tax-lot.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray } from 'effect';
import { Data } from 'effect';
import {
  TaxLotId,
  TaxLotQuantity,
  CostBasis,
  CostBasisAdjustment,
  HoldingPeriod,
  RealizedGain,
  TaxLotStatus,
} from '../value-objects/tax-lot.vo';
import { UserId, AssetId, TransactionId } from '../../trading/domain/value-objects/identifiers.vo';
import { Quantity } from '../../trading/domain/value-objects/quantity.vo';
import { Money } from '../../trading/domain/value-objects/money.vo';
import { DomainEvent } from '../../trading/domain/events/transaction.events';
import { AcquisitionMethod } from '../../portfolio/domain/value-objects/position.vo';

// Tax lot errors
export class TaxLotError extends Data.TaggedError('TaxLotError')<{
  readonly message: string;
}> {}

export class InvalidCostBasisError extends Data.TaggedError('InvalidCostBasisError')<{
  readonly costBasis: Money;
}> {}

export class TaxLotNotAvailableError extends Data.TaggedError('TaxLotNotAvailableError')<{
  readonly lotId: TaxLotId;
}> {}

export class InsufficientLotQuantityError extends Data.TaggedError('InsufficientLotQuantityError')<{
  readonly lotId: TaxLotId;
  readonly available: Quantity;
  readonly requested: Quantity;
}> {}

// Tax lot events
export class TaxLotCreated extends DomainEvent {
  readonly _tag = 'TaxLotCreated';

  constructor(
    readonly data: {
      readonly lotId: TaxLotId;
      readonly userId: UserId;
      readonly asset: AssetId;
      readonly quantity: Quantity;
      readonly costBasis: Money;
      readonly acquisitionDate: Date;
      readonly acquisitionMethod: AcquisitionMethod;
      readonly transactionId: TransactionId;
      readonly createdAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.lotId,
      timestamp: data.createdAt,
      version: 1,
    });
  }
}

export class TaxLotPartiallyConsumed extends DomainEvent {
  readonly _tag = 'TaxLotPartiallyConsumed';

  constructor(
    readonly data: {
      readonly lotId: TaxLotId;
      readonly consumed: Quantity;
      readonly remaining: Quantity;
      readonly consumedCostBasis: Money;
      readonly proceeds: Money;
      readonly realizedGain: RealizedGain;
      readonly disposalTransactionId: TransactionId;
      readonly consumedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.lotId,
      timestamp: data.consumedAt,
      version: 1,
    });
  }
}

export class TaxLotFullyConsumed extends DomainEvent {
  readonly _tag = 'TaxLotFullyConsumed';

  constructor(
    readonly data: {
      readonly lotId: TaxLotId;
      readonly consumedQuantity: Quantity;
      readonly consumedCostBasis: Money;
      readonly proceeds: Money;
      readonly realizedGain: RealizedGain;
      readonly disposalTransactionId: TransactionId;
      readonly consumedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.lotId,
      timestamp: data.consumedAt,
      version: 1,
    });
  }
}

export class TaxLotAdjusted extends DomainEvent {
  readonly _tag = 'TaxLotAdjusted';

  constructor(
    readonly data: {
      readonly lotId: TaxLotId;
      readonly adjustment: CostBasisAdjustment;
      readonly newCostBasis: CostBasis;
      readonly reason: string;
      readonly adjustedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.lotId,
      timestamp: data.adjustedAt,
      version: 1,
    });
  }
}

// Commands
export interface CreateTaxLotCommand {
  readonly userId: UserId;
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly costBasis: Money;
  readonly acquisitionDate: Date;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly transactionId: TransactionId;
}

export interface ConsumeTaxLotCommand {
  readonly lotId: TaxLotId;
  readonly quantity: Quantity;
  readonly disposalPrice: Money;
  readonly disposalDate: Date;
  readonly disposalTransactionId: TransactionId;
}

export interface AdjustCostBasisCommand {
  readonly _tag: 'AdjustCostBasisCommand';
  readonly lotId: string;
  readonly type: 'INCREASE' | 'DECREASE';
  readonly amount: number;
  readonly currency: string;
  readonly reason: string;
  readonly relatedTransactionId?: string;
}

// Tax Lot Aggregate
export class TaxLot extends Data.Class<{
  readonly lotId: Option.Option<TaxLotId>;
  readonly userId: Option.Option<UserId>;
  readonly asset: Option.Option<AssetId>;
  readonly quantity: TaxLotQuantity;
  readonly costBasis: CostBasis;
  readonly acquisitionDate: Date;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly status: TaxLotStatus;
  readonly version: number;
}> {
  // Command methods now ONLY return events
  static create(command: CreateTaxLotCommand): Effect.Effect<DomainEvent[], InvalidCostBasisError> {
    if (command.costBasis.isNegative()) {
      return Effect.fail(
        new InvalidCostBasisError({
          costBasis: command.costBasis,
        })
      );
    }

    const lotId = TaxLotId.generate();
    const event = new TaxLotCreated({
      lotId,
      userId: command.userId,
      asset: command.asset,
      quantity: command.quantity,
      costBasis: command.costBasis,
      acquisitionDate: command.acquisitionDate,
      acquisitionMethod: command.acquisitionMethod,
      transactionId: command.transactionId,
      createdAt: new Date(),
    });

    return Effect.succeed([event]);
  }

  consume(
    disposalQuantity: Quantity,
    disposalPrice: Money,
    disposalDate: Date,
    disposalTransactionId: TransactionId
  ): Effect.Effect<DomainEvent[], TaxLotNotAvailableError | InsufficientLotQuantityError> {
    return pipe(
      Effect.fromOption(this.lotId),
      Effect.mapError(() => new TaxLotNotAvailableError({ lotId: TaxLotId.generate() })),
      Effect.flatMap(lotId => {
        if (this.status === TaxLotStatus.CLOSED) {
          return Effect.fail(new TaxLotNotAvailableError({ lotId }));
        }

        if (disposalQuantity.isGreaterThan(this.quantity.remaining)) {
          return Effect.fail(
            new InsufficientLotQuantityError({
              lotId,
              available: this.quantity.remaining,
              requested: disposalQuantity,
            })
          );
        }

        return this.calculateConsumptionEvent(
          lotId,
          disposalQuantity,
          disposalPrice,
          disposalDate,
          disposalTransactionId
        );
      })
    );
  }

  private calculateConsumptionEvent(
    lotId: TaxLotId,
    disposalQuantity: Quantity,
    disposalPrice: Money,
    disposalDate: Date,
    disposalTransactionId: TransactionId
  ): Effect.Effect<DomainEvent[], InsufficientLotQuantityError> {
    return pipe(
      // This subtract operation can fail - let it propagate properly
      this.quantity.remaining.subtract(disposalQuantity),
      Effect.mapError(
        () =>
          new InsufficientLotQuantityError({
            lotId,
            available: this.quantity.remaining,
            requested: disposalQuantity,
          })
      ),
      Effect.map(newRemaining => {
        // Calculate values for the event
        const consumptionRatio = disposalQuantity.toNumber() / this.quantity.original.toNumber();
        const consumedCostBasis = this.costBasis.adjustedAmount.multiply(consumptionRatio);
        const proceeds = disposalPrice.multiply(disposalQuantity.toNumber());
        const holdingPeriod = HoldingPeriod.between(this.acquisitionDate, disposalDate);
        const realizedGain = RealizedGain.calculate(proceeds, consumedCostBasis, holdingPeriod);

        const isFullyConsumed = newRemaining.isZero();

        const event: DomainEvent = isFullyConsumed
          ? new TaxLotFullyConsumed({
              lotId,
              consumedQuantity: disposalQuantity,
              consumedCostBasis,
              proceeds,
              realizedGain,
              disposalTransactionId,
              consumedAt: new Date(),
            })
          : new TaxLotPartiallyConsumed({
              lotId,
              consumed: disposalQuantity,
              remaining: newRemaining,
              consumedCostBasis,
              proceeds,
              realizedGain,
              disposalTransactionId,
              consumedAt: new Date(),
            });

        return [event];
      })
    );
  }

  // THE SINGLE SOURCE OF TRUTH for state transitions
  static apply(state: TaxLot, event: DomainEvent): TaxLot {
    switch (event._tag) {
      case 'TaxLotCreated':
        return new TaxLot({
          lotId: Option.some(event.data.lotId),
          userId: Option.some(event.data.userId),
          asset: Option.some(event.data.asset),
          quantity: TaxLotQuantity.initial(event.data.quantity),
          costBasis: CostBasis.initial(event.data.costBasis),
          acquisitionDate: event.data.acquisitionDate,
          acquisitionMethod: event.data.acquisitionMethod,
          status: TaxLotStatus.OPEN,
          version: state.version + 1,
        });

      case 'TaxLotPartiallyConsumed':
        return new TaxLot({
          ...state,
          quantity: new TaxLotQuantity({
            original: state.quantity.original,
            remaining: event.data.remaining,
            consumed: state.quantity.consumed.add(event.data.consumed),
          }),
          status: TaxLotStatus.PARTIAL,
          version: state.version + 1,
        });

      case 'TaxLotFullyConsumed':
        return new TaxLot({
          ...state,
          quantity: new TaxLotQuantity({
            original: state.quantity.original,
            remaining: Quantity.zero(),
            consumed: state.quantity.original,
          }),
          status: TaxLotStatus.CLOSED,
          version: state.version + 1,
        });

      case 'TaxLotAdjusted':
        return new TaxLot({
          ...state,
          costBasis: event.data.newCostBasis,
          status: TaxLotStatus.ADJUSTED,
          version: state.version + 1,
        });

      default:
        return state;
    }
  }

  getPerUnitCost(): Effect.Effect<Money, Error> {
    return this.costBasis.perUnit(this.quantity.original);
  }

  adjustCostBasis(adjustment: CostBasisAdjustment): Effect.Effect<DomainEvent[], TaxLotNotAvailableError> {
    return pipe(
      Effect.fromOption(this.lotId),
      Effect.mapError(() => new TaxLotNotAvailableError({ lotId: TaxLotId.generate() })),
      Effect.flatMap(lotId => {
        // Cannot adjust a closed lot
        if (this.status === TaxLotStatus.CLOSED) {
          return Effect.fail(new TaxLotNotAvailableError({ lotId }));
        }

        return pipe(
          this.costBasis.addAdjustment(adjustment),
          Effect.map(newCostBasis => [
            new TaxLotAdjusted({
              lotId,
              adjustment,
              newCostBasis,
              reason: adjustment.reason,
              adjustedAt: new Date(),
            }),
          ])
        );
      })
    );
  }

  // Factory for empty state
  static empty(): TaxLot {
    return new TaxLot({
      lotId: Option.none(),
      userId: Option.none(),
      asset: Option.none(),
      quantity: TaxLotQuantity.initial(Quantity.zero()),
      costBasis: CostBasis.initial(
        Money.zero(
          Currency({
            symbol: 'USD',
            decimals: 2,
            name: 'US Dollar',
          })
        )
      ),
      acquisitionDate: new Date(),
      acquisitionMethod: AcquisitionMethod.PURCHASE,
      status: TaxLotStatus.OPEN,
      version: 0,
    });
  }
}
```

### 3. Tax Report Aggregate

```typescript
// src/contexts/taxation/domain/aggregates/tax-report.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray } from 'effect';
import { Data } from 'effect';
import { TaxReportId, TaxYear, TaxSummary, TaxableTransaction, AccountingMethod } from '../value-objects/tax-lot.vo';
import { UserId } from '../../trading/domain/value-objects/identifiers.vo';
import { Money, Currency } from '../../trading/domain/value-objects/money.vo';
import { DomainEvent } from '../../trading/domain/events/transaction.events';

// Asset tax classification for different crypto asset types
export enum TaxCategory {
  PROPERTY = 'PROPERTY', // Standard crypto assets (BTC, ETH)
  SECURITY = 'SECURITY', // Securities tokens
  COLLECTIBLE = 'COLLECTIBLE', // NFTs
  DEFI_LP = 'DEFI_LP', // DeFi liquidity pool tokens
  WRAPPED = 'WRAPPED', // Wrapped assets (wBTC, wETH)
  STAKING_DERIVATIVE = 'STAKING_DERIVATIVE', // Staking derivatives
}

// Report status
export enum ReportStatus {
  DRAFT = 'DRAFT',
  CALCULATING = 'CALCULATING',
  READY = 'READY',
  FINALIZED = 'FINALIZED',
  FILED = 'FILED',
  AMENDED = 'AMENDED', // Added for amendment support
}

// Tax report errors
export class TaxReportError extends Data.TaggedError('TaxReportError')<{
  readonly message: string;
}> {}

export class InvalidTaxYearError extends Data.TaggedError('InvalidTaxYearError')<{
  readonly year: number;
}> {}

export class ReportFinalizedError extends Data.TaggedError('ReportFinalizedError')<{
  readonly reportId: TaxReportId;
}> {}

export class AlreadyFiledError extends Data.TaggedError('AlreadyFiledError')<{
  readonly reportId: TaxReportId;
}> {}

// Tax report events
export class TaxReportGenerated extends DomainEvent {
  readonly _tag = 'TaxReportGenerated';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly userId: UserId;
      readonly taxYear: TaxYear;
      readonly accountingMethod: AccountingMethod;
      readonly generatedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.generatedAt,
      version: 1,
    });
  }
}

export class TaxableTransactionAdded extends DomainEvent {
  readonly _tag = 'TaxableTransactionAdded';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly transaction: TaxableTransaction;
      readonly addedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.addedAt,
      version: 1,
    });
  }
}

export class TaxReportCalculated extends DomainEvent {
  readonly _tag = 'TaxReportCalculated';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly summary: TaxSummary;
      readonly calculatedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.calculatedAt,
      version: 1,
    });
  }
}

export class TaxReportFinalized extends DomainEvent {
  readonly _tag = 'TaxReportFinalized';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly finalSummary: TaxSummary;
      readonly finalizedAt: Date;
      readonly finalizedBy: UserId;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.finalizedAt,
      version: 1,
    });
  }
}

export class TaxReportFiled extends DomainEvent {
  readonly _tag = 'TaxReportFiled';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly filingReference: string;
      readonly filedAt: Date;
      readonly filedBy: UserId;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.filedAt,
      version: 1,
    });
  }
}

export class TaxReportAmended extends DomainEvent {
  readonly _tag = 'TaxReportAmended';

  constructor(
    readonly data: {
      readonly reportId: TaxReportId;
      readonly originalReportId: TaxReportId;
      readonly amendmentReason: string;
      readonly amendedBy: UserId;
      readonly amendedAt: Date;
    }
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reportId,
      timestamp: data.amendedAt,
      version: 1,
    });
  }
}

// Commands
export interface GenerateTaxReportCommand {
  readonly userId: UserId;
  readonly taxYear: number;
  readonly accountingMethod: AccountingMethod;
}

export interface AddTaxableTransactionCommand {
  readonly reportId: TaxReportId;
  readonly transaction: TaxableTransaction;
}

export interface FinalizeTaxReportCommand {
  readonly reportId: TaxReportId;
  readonly finalizedBy: UserId;
}

export interface AmendTaxReportCommand {
  readonly originalReportId: TaxReportId;
  readonly amendmentReason: string;
  readonly amendedBy: UserId;
}

// Tax Report Aggregate
export class TaxReport extends Data.Class<{
  readonly reportId: Option.Option<TaxReportId>;
  readonly userId: Option.Option<UserId>;
  readonly taxYear: Option.Option<TaxYear>;
  readonly accountingMethod: AccountingMethod;
  readonly transactions: ReadonlyArray<TaxableTransaction>;
  readonly summary: Option.Option<TaxSummary>;
  readonly status: ReportStatus;
  readonly events: ReadonlyArray<DomainEvent>;
  readonly version: number;
}> {
  // Generate new tax report
  static generate(command: GenerateTaxReportCommand): Effect.Effect<TaxReport, InvalidTaxYearError> {
    const taxYear = TaxYear.of(command.taxYear);

    if (!taxYear.isValid()) {
      return Effect.fail(
        new InvalidTaxYearError({
          year: command.taxYear,
        })
      );
    }

    return Effect.succeed(() => {
      const reportId = TaxReportId.generate();

      const event = new TaxReportGenerated({
        reportId,
        userId: command.userId,
        taxYear,
        accountingMethod: command.accountingMethod,
        generatedAt: new Date(),
      });

      return new TaxReport({
        reportId: Option.some(reportId),
        userId: Option.some(command.userId),
        taxYear: Option.some(taxYear),
        accountingMethod: command.accountingMethod,
        transactions: [],
        summary: Option.none(),
        status: ReportStatus.DRAFT,
        events: [event],
        version: 0,
      });
    })();
  }

  // Add taxable transaction
  addTransaction(transaction: TaxableTransaction): Effect.Effect<TaxReport, ReportFinalizedError> {
    return pipe(
      Effect.all([Effect.fromOption(this.reportId), Effect.fromOption(this.taxYear)]),
      Effect.mapError(() => new ReportFinalizedError({ reportId: TaxReportId.generate() })),
      Effect.flatMap(([reportId, taxYear]) => {
        if (this.status === ReportStatus.FINALIZED || this.status === ReportStatus.FILED) {
          return Effect.fail(new ReportFinalizedError({ reportId }));
        }

        // Check if transaction is within tax year
        if (!taxYear.contains(transaction.date)) {
          return Effect.succeed(this); // Skip transactions outside tax year
        }

        const event = new TaxableTransactionAdded({
          reportId,
          transaction,
          addedAt: new Date(),
        });

        return Effect.succeed(
          new TaxReport({
            ...this,
            transactions: [...this.transactions, transaction],
            status: ReportStatus.CALCULATING,
            events: [...this.events, event],
          })
        );
      })
    );
  }

  // Finalize report
  finalize(finalizedBy: UserId): Effect.Effect<TaxReport, ReportFinalizedError> {
    return pipe(
      Effect.all([Effect.fromOption(this.reportId), Effect.fromOption(this.summary)]),
      Effect.mapError(() => new ReportFinalizedError({ reportId: TaxReportId.generate() })),
      Effect.flatMap(([reportId, summary]) => {
        if (this.status === ReportStatus.FINALIZED || this.status === ReportStatus.FILED) {
          return Effect.fail(new ReportFinalizedError({ reportId }));
        }

        const event = new TaxReportFinalized({
          reportId,
          finalSummary: summary,
          finalizedAt: new Date(),
          finalizedBy,
        });

        return Effect.succeed(
          new TaxReport({
            ...this,
            status: ReportStatus.FINALIZED,
            events: [...this.events, event],
          })
        );
      })
    );
  }

  // Mark as filed
  markAsFiled(filingReference: string, filedBy: UserId): Effect.Effect<TaxReport, AlreadyFiledError> {
    return pipe(
      Effect.fromOption(this.reportId),
      Effect.mapError(() => new AlreadyFiledError({ reportId: TaxReportId.generate() })),
      Effect.flatMap(reportId => {
        if (this.status === ReportStatus.FILED) {
          return Effect.fail(new AlreadyFiledError({ reportId }));
        }

        const event = new TaxReportFiled({
          reportId,
          filingReference,
          filedAt: new Date(),
          filedBy,
        });

        return Effect.succeed(
          new TaxReport({
            ...this,
            status: ReportStatus.FILED,
            events: [...this.events, event],
          })
        );
      })
    );
  }

  // Create amendment (new report based on existing one)
  static amend(command: AmendTaxReportCommand): Effect.Effect<TaxReport, TaxReportError> {
    return Effect.succeed(() => {
      const amendmentReportId = TaxReportId.generate();

      const event = new TaxReportAmended({
        reportId: amendmentReportId,
        originalReportId: command.originalReportId,
        amendmentReason: command.amendmentReason,
        amendedBy: command.amendedBy,
        amendedAt: new Date(),
      });

      return new TaxReport({
        reportId: Option.some(amendmentReportId),
        userId: Option.some(command.amendedBy),
        taxYear: Option.none(), // To be set from original report
        accountingMethod: AccountingMethod.FIFO, // To be set from original report
        transactions: [],
        summary: Option.none(),
        status: ReportStatus.DRAFT,
        events: [event],
        version: 0,
      });
    })();
  }

  // Get uncommitted events
  getUncommittedEvents(): ReadonlyArray<DomainEvent> {
    return this.events.slice(this.version);
  }

  // Mark events as committed
  markEventsAsCommitted(): TaxReport {
    return new TaxReport({
      ...this,
      version: this.events.length,
    });
  }
}

// Form 8949 data structures
interface Form8949Entry {
  description: string;
  dateAcquired: Date;
  dateSold: Date;
  proceeds: number;
  costBasis: number;
  gainOrLoss: number;
  adjustmentCode: string;
  adjustmentAmount: number;
}

class Form8949Data extends Data.Class<{
  readonly taxYear: number;
  readonly shortTermSales: ReadonlyArray<Form8949Entry>;
  readonly longTermSales: ReadonlyArray<Form8949Entry>;
  readonly totals: TaxSummary;
}> {}
```

### 4. Domain Services

```typescript
// src/contexts/taxation/domain/services/tax-lot-selector.service.ts
import { Effect, pipe, ReadonlyArray, Option } from 'effect';
import { Context, Layer } from 'effect';
import { TaxLot } from '../aggregates/tax-lot.aggregate';
import { Quantity } from '../../trading/domain/value-objects/quantity.vo';
import { AccountingMethod } from '../value-objects/tax-lot.vo';
import { Data } from 'effect';

// Errors
export class InsufficientLotsError extends Data.TaggedError('InsufficientLotsError')<{
  readonly needed: Quantity;
  readonly available: Quantity;
}> {}

// Tax lot selector interface
export interface TaxLotSelector {
  selectLots(
    availableLots: ReadonlyArray<TaxLot>,
    quantityNeeded: Quantity,
    method: AccountingMethod
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError>;
}

export const TaxLotSelector = Context.GenericTag<TaxLotSelector>('TaxLotSelector');

// FIFO Implementation
export class FIFOSelector implements TaxLotSelector {
  selectLots(
    availableLots: ReadonlyArray<TaxLot>,
    quantityNeeded: Quantity,
    method: AccountingMethod
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError> {
    return Effect.sync(() => {
      // Sort by acquisition date (oldest first)
      const sorted = [...availableLots].sort((a, b) => a.acquisitionDate.getTime() - b.acquisitionDate.getTime());

      return this.selectUntilQuantityMet(sorted, quantityNeeded);
    }).pipe(Effect.flatten);
  }

  private selectUntilQuantityMet(
    lots: ReadonlyArray<TaxLot>,
    needed: Quantity
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError> {
    const selected: TaxLot[] = [];
    let accumulated = Quantity.of(0, needed.precision).getOrElse(() => needed);

    for (const lot of lots) {
      if (lot.status === 'CLOSED') continue;

      if (accumulated.isGreaterThanOrEqual(needed)) break;

      selected.push(lot);
      accumulated = accumulated.add(lot.quantity.remaining);
    }

    if (accumulated.isLessThan(needed)) {
      return Effect.fail(
        new InsufficientLotsError({
          needed,
          available: accumulated,
        })
      );
    }

    return Effect.succeed(selected);
  }
}

// LIFO Implementation
export class LIFOSelector implements TaxLotSelector {
  selectLots(
    availableLots: ReadonlyArray<TaxLot>,
    quantityNeeded: Quantity,
    method: AccountingMethod
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError> {
    return Effect.sync(() => {
      // Sort by acquisition date (newest first)
      const sorted = [...availableLots].sort((a, b) => b.acquisitionDate.getTime() - a.acquisitionDate.getTime());

      return new FIFOSelector().selectUntilQuantityMet(sorted, quantityNeeded);
    }).pipe(Effect.flatten);
  }
}

// HIFO Implementation
export class HIFOSelector implements TaxLotSelector {
  selectLots(
    availableLots: ReadonlyArray<TaxLot>,
    quantityNeeded: Quantity,
    method: AccountingMethod
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError> {
    return pipe(
      Effect.forEach(
        availableLots,
        lot =>
          pipe(
            lot.getPerUnitCost(),
            Effect.map(perUnit => ({ lot, perUnit })),
            Effect.orElseSucceed(() => ({ lot, perUnit: null }))
          ),
        { concurrency: 'unbounded' }
      ),
      Effect.map(lotsWithCost => {
        // Sort by cost per unit (highest first)
        const sorted = lotsWithCost
          .filter(item => item.perUnit !== null)
          .sort((a, b) => b.perUnit!.toNumber() - a.perUnit!.toNumber())
          .map(item => item.lot);

        return new FIFOSelector().selectUntilQuantityMet(sorted, quantityNeeded);
      }),
      Effect.flatten
    );
  }
}

// Specific ID Implementation
export class SpecificIDSelector implements TaxLotSelector {
  constructor(private specificLotIds: ReadonlyArray<string>) {}

  selectLots(
    availableLots: ReadonlyArray<TaxLot>,
    quantityNeeded: Quantity,
    method: AccountingMethod
  ): Effect.Effect<ReadonlyArray<TaxLot>, InsufficientLotsError> {
    return Effect.sync(() => {
      const selected = availableLots.filter(lot =>
        Option.match(lot.lotId, {
          onNone: () => false,
          onSome: id => this.specificLotIds.includes(id),
        })
      );

      return new FIFOSelector().selectUntilQuantityMet(selected, quantityNeeded);
    }).pipe(Effect.flatten);
  }
}

// Factory for creating selectors
export const createTaxLotSelector = (
  method: AccountingMethod,
  specificLotIds?: ReadonlyArray<string>
): TaxLotSelector => {
  switch (method) {
    case AccountingMethod.FIFO:
      return new FIFOSelector();
    case AccountingMethod.LIFO:
      return new LIFOSelector();
    case AccountingMethod.HIFO:
      return new HIFOSelector();
    case AccountingMethod.SPECIFIC:
      return new SpecificIDSelector(specificLotIds || []);
    default:
      return new FIFOSelector();
  }
};
```

```typescript
// src/contexts/taxation/domain/services/wash-sale-detector.service.ts
import { Effect, pipe, ReadonlyArray, Option } from 'effect';
import { Data } from 'effect';
import { AssetId, TransactionId } from '../../trading/domain/value-objects/identifiers.vo';
import { Money } from '../../trading/domain/value-objects/money.vo';

// Wash sale window (30 days before and after)
const WASH_SALE_WINDOW_DAYS = 30;

// Wash sale violation
export class WashSaleViolation extends Data.Class<{
  readonly disposalTransactionId: TransactionId;
  readonly acquisitionTransactionId: TransactionId;
  readonly asset: AssetId;
  readonly lossAmount: Money;
  readonly disallowedAmount: Money;
  readonly disposalDate: Date;
  readonly acquisitionDate: Date;
  readonly daysApart: number;
}> {
  isWithinWindow(): boolean {
    return Math.abs(this.daysApart) <= WASH_SALE_WINDOW_DAYS;
  }
}

// Disposal event
export interface DisposalEvent {
  readonly transactionId: TransactionId;
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly proceeds: Money;
  readonly costBasis: Money;
  readonly date: Date;
  readonly realizedGain: Money;
}

// Acquisition event
export interface AcquisitionEvent {
  readonly transactionId: TransactionId;
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly cost: Money;
  readonly date: Date;
}

// Substantially similar asset detector interface
export interface SubstantiallySimilarAssetDetector {
  areSubstantiallySimilar(asset1: AssetId, asset2: AssetId): Effect.Effect<boolean, never>;
}

// Simple implementation - only identical assets
export class IdenticalAssetDetector implements SubstantiallySimilarAssetDetector {
  areSubstantiallySimilar(asset1: AssetId, asset2: AssetId): Effect.Effect<boolean, never> {
    return Effect.succeed(asset1.equals(asset2));
  }
}

// Wash sale detector service
export class WashSaleDetector {
  constructor(
    private readonly similarAssetDetector: SubstantiallySimilarAssetDetector = new IdenticalAssetDetector()
  ) {}

  detectWashSales(
    disposals: ReadonlyArray<DisposalEvent>,
    acquisitions: ReadonlyArray<AcquisitionEvent>
  ): Effect.Effect<ReadonlyArray<WashSaleViolation>, never> {
    return Effect.sync(() => {
      const violations: WashSaleViolation[] = [];

      for (const disposal of disposals) {
        // Only check if it's a loss
        if (!disposal.realizedGain.isNegative()) continue;

        // Find acquisitions of substantially similar assets within wash sale window
        const relevantAcquisitionsEffect = Effect.forEach(acquisitions, acq =>
          pipe(
            this.similarAssetDetector.areSubstantiallySimilar(disposal.asset, acq.asset),
            Effect.map(isSimilar => ({ acquisition: acq, isSimilar }))
          )
        ).pipe(
          Effect.map(results => results.filter(r => r.isSimilar).map(r => r.acquisition)),
          Effect.map(similarAcquisitions =>
            similarAcquisitions.filter(acq => {
              const daysDiff = this.daysBetween(disposal.date, acq.date);
              return Math.abs(daysDiff) <= WASH_SALE_WINDOW_DAYS;
            })
          )
        );

        // For now, use synchronous approach for compatibility
        const relevantAcquisitions = acquisitions.filter(acq => {
          if (!acq.asset.equals(disposal.asset)) return false;

          const daysDiff = this.daysBetween(disposal.date, acq.date);
          return Math.abs(daysDiff) <= WASH_SALE_WINDOW_DAYS;
        });

        for (const acquisition of relevantAcquisitions) {
          const daysApart = this.daysBetween(disposal.date, acquisition.date);

          // Create wash sale violation
          const violation = new WashSaleViolation({
            disposalTransactionId: disposal.transactionId,
            acquisitionTransactionId: acquisition.transactionId,
            asset: disposal.asset,
            lossAmount: disposal.realizedGain.abs(),
            disallowedAmount: disposal.realizedGain.abs(), // Full loss is disallowed
            disposalDate: disposal.date,
            acquisitionDate: acquisition.date,
            daysApart,
          });

          violations.push(violation);
        }
      }

      return violations;
    });
  }

  adjustForWashSales(
    transactions: ReadonlyArray<TaxableTransaction>,
    violations: ReadonlyArray<WashSaleViolation>
  ): Effect.Effect<ReadonlyArray<TaxableTransaction>, never> {
    return Effect.sync(() => {
      const violationMap = new Map(violations.map(v => [v.disposalTransactionId, v]));

      return transactions.map(tx => {
        const violation = violationMap.get(tx.transactionId);

        if (!violation || !Option.isSome(tx.realizedGain)) {
          return tx;
        }

        const gain = Option.getOrThrow(tx.realizedGain);

        // Adjust the realized gain for wash sale
        const adjustedGain = new RealizedGain({
          ...gain,
          washSaleAdjustment: Option.some(violation.disallowedAmount),
        });

        return new TaxableTransaction({
          ...tx,
          realizedGain: Option.some(adjustedGain),
        });
      });
    });
  }

  private daysBetween(date1: Date, date2: Date): number {
    const diffMs = date2.getTime() - date1.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
```

### 5. Application Layer

```typescript
// src/contexts/taxation/application/commands/create-tax-lot.handler.ts
import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { Effect, pipe, Exit } from 'effect';
import { TaxLot, CreateTaxLotCommand, InvalidCostBasisError } from '../../domain/aggregates/tax-lot.aggregate';
import { TaxLotRepository } from '../../infrastructure/repositories/tax-lot.repository';

@Injectable()
@CommandHandler(CreateTaxLotCommand)
export class CreateTaxLotHandler implements ICommandHandler<CreateTaxLotCommand> {
  constructor(
    private readonly repository: TaxLotRepository,
    private readonly eventBus: EventBus
  ) {}

  async execute(command: CreateTaxLotCommand): Promise<void> {
    const program = pipe(
      TaxLot.create(command),
      Effect.flatMap(events => this.repository.saveEventsEffect(events)),
      Effect.tap(events => this.eventBus.publishAllEffect(events))
    );

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      const error = exit.cause.failure;

      if (error instanceof InvalidCostBasisError) {
        throw new BadRequestException(`Invalid cost basis: ${error.costBasis.toString()}`);
      }

      throw new InternalServerErrorException('Failed to create tax lot');
    }
  }
}
```

```typescript
// src/contexts/taxation/application/commands/generate-tax-report.handler.ts
import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Layer } from 'effect';
import { TaxReport, GenerateTaxReportCommand, InvalidTaxYearError } from '../../domain/aggregates/tax-report.aggregate';
import { TaxReportRepository } from '../../infrastructure/repositories/tax-report.repository';
import { TaxCalculationSaga } from '../sagas/tax-calculation.saga';
import {
  JurisdictionTaxPolicy,
  USTaxPolicy,
  CanadianTaxPolicy,
} from '../../domain/services/jurisdiction-tax-policy.service';
import { TaxLotSelector, createTaxLotSelector } from '../../domain/services/tax-lot-selector.service';

@Injectable()
@CommandHandler(GenerateTaxReportCommand)
export class GenerateTaxReportHandler implements ICommandHandler<GenerateTaxReportCommand> {
  constructor(
    private readonly reportRepository: TaxReportRepository,
    private readonly saga: TaxCalculationSaga
  ) {}

  async execute(command: GenerateTaxReportCommand): Promise<void> {
    // Determine jurisdiction policy (could come from user profile in real system)
    const userJurisdiction = 'US'; // Hardcoded for example

    // Create the service layers the saga needs
    const taxPolicyLayer = Layer.succeed(
      JurisdictionTaxPolicy,
      userJurisdiction === 'US' ? new USTaxPolicy() : new CanadianTaxPolicy()
    );
    const lotSelectorLayer = Layer.succeed(TaxLotSelector, createTaxLotSelector(command.accountingMethod));

    const program = pipe(
      // 1. Create the initial report aggregate
      TaxReport.generate(command),
      Effect.flatMap(report => this.reportRepository.saveEffect(report)),

      // 2. Execute the entire saga as a single Effect
      Effect.flatMap(report =>
        pipe(
          Effect.fromOption(report.reportId),
          Effect.mapError(() => new InvalidTaxYearError({ year: command.taxYear })),
          Effect.flatMap(reportId =>
            this.saga.execute({
              reportId: reportId,
              userId: command.userId,
              taxYear: command.taxYear,
              accountingMethod: command.accountingMethod,
            })
          )
        )
      ),

      // 3. Provide the required services to the program
      Effect.provide(taxPolicyLayer),
      Effect.provide(lotSelectorLayer)
    );

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      const error = exit.cause.failure;

      if (error instanceof InvalidTaxYearError) {
        throw new BadRequestException(`Invalid tax year: ${error.year}`);
      }

      throw new InternalServerErrorException('Failed to generate tax report');
    }
  }
}
```

```typescript
// src/contexts/taxation/application/commands/adjust-cost-basis.handler.ts
import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Option } from 'effect';
import { TaxLot, TaxLotNotAvailableError } from '../../domain/aggregates/tax-lot.aggregate';
import { TaxLotRepository } from '../../infrastructure/repositories/tax-lot.repository';
import { TaxLotId, CostBasisAdjustment } from '../../domain/value-objects/tax-lot.vo';
import { Money, Currency, CurrencyMismatchError } from '../../trading/domain/value-objects/money.vo';
import { TransactionId } from '../../trading/domain/value-objects/identifiers.vo';

@Injectable()
@CommandHandler(AdjustCostBasisCommand)
export class AdjustCostBasisHandler implements ICommandHandler<AdjustCostBasisCommand> {
  constructor(private readonly repository: TaxLotRepository) {}

  async execute(command: AdjustCostBasisCommand): Promise<void> {
    // Handler is now responsible for ALL parsing and domain object creation
    const program = pipe(
      // 1. Safely create the Money value object
      Money.of(
        command.amount,
        Currency({
          symbol: command.currency,
          decimals: 2,
          name: command.currency,
        })
      ),

      // 2. Create the CostBasisAdjustment object
      Effect.map(
        moneyAmount =>
          new CostBasisAdjustment({
            type: command.type,
            amount: moneyAmount,
            reason: command.reason,
            date: new Date(),
            relatedTransactionId: Option.fromNullable(command.relatedTransactionId).pipe(
              Option.map(id => TransactionId(id))
            ),
          })
      ),

      // 3. Load the aggregate and run the domain logic
      Effect.flatMap(adjustment =>
        pipe(
          this.repository.loadForCommand(TaxLotId(command.lotId)),
          Effect.flatMap(lot => lot.adjustCostBasis(adjustment)),
          Effect.flatMap(events => this.repository.saveEventsEffect(events))
        )
      )
    );

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      const error = exit.cause.failure;

      if (error instanceof TaxLotNotAvailableError) {
        throw new NotFoundException(`Tax lot not found: ${error.lotId}`);
      }

      if (error instanceof CurrencyMismatchError) {
        throw new BadRequestException(`Currency mismatch: ${error.message}`);
      }

      throw new InternalServerErrorException('Failed to adjust cost basis');
    }
  }
}
```

### 6. Tax Calculation Saga

```typescript
// src/contexts/taxation/application/sagas/tax-calculation.saga.ts
import { Injectable } from '@nestjs/common';
import { Effect, pipe, ReadonlyArray } from 'effect';
import { TaxReportRepository } from '../../infrastructure/repositories/tax-report.repository';
import { TaxLotRepository } from '../../infrastructure/repositories/tax-lot.repository';
import { TransactionRepository } from '../../../trading/infrastructure/repositories/transaction.repository';
import { createTaxLotSelector } from '../../domain/services/tax-lot-selector.service';
import { WashSaleDetector } from '../../domain/services/wash-sale-detector.service';
import { Currency } from '../../../trading/domain/value-objects/money.vo';

export interface TaxCalculationContext {
  reportId: string;
  userId: string;
  taxYear: number;
  accountingMethod: AccountingMethod;
}

@Injectable()
export class TaxCalculationSaga {
  constructor(
    private readonly reportRepository: TaxReportRepository,
    private readonly lotRepository: TaxLotRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly washSaleDetector: WashSaleDetector
  ) {}

  // Complete saga implementation as a single Effect pipeline
  execute(
    context: TaxCalculationContext
  ): Effect.Effect<void, TaxCalculationError, TaxLotSelector | JurisdictionTaxPolicy> {
    return pipe(
      // Step 1: Load transactions
      this.loadTransactionsForYear(context.userId, context.taxYear),

      // Step 2: Process all disposals
      Effect.flatMap(transactions =>
        this.processAllDisposals(
          transactions.filter(tx => tx.type === 'DISPOSAL'),
          context
        )
      ),

      // Step 3: Apply jurisdiction-specific loss rules
      Effect.flatMap(processedTxs =>
        pipe(
          Effect.serviceWithEffect(JurisdictionTaxPolicy, policy => policy.applyLossRules(processedTxs)),
          Effect.map(adjusted => ({ processedTxs, adjusted }))
        )
      ),

      // Step 4: Update report with transactions
      Effect.flatMap(({ adjusted }) => this.updateReportWithTransactions(context.reportId, adjusted)),

      // Step 5: Calculate final summary using jurisdiction policy
      Effect.flatMap(() =>
        pipe(
          this.reportRepository.loadEffect(context.reportId),
          Effect.flatMap(report =>
            pipe(
              Effect.serviceWithEffect(JurisdictionTaxPolicy, policy =>
                policy.calculateTaxSummary(report.transactions)
              ),
              Effect.flatMap(summary => this.reportRepository.updateSummaryEffect(context.reportId, summary))
            )
          )
        )
      ),

      Effect.asVoid
    );
  }

  private loadTransactionsForYear(userId: string, year: number): Effect.Effect<Transaction[], TransactionLoadError> {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

    return this.transactionRepository.findByUserAndDateRangeEffect(userId, startDate, endDate);
  }

  private processAllDisposals(
    disposals: Transaction[],
    context: TaxCalculationContext
  ): Effect.Effect<ProcessedDisposal[], DisposalProcessingError, TaxLotSelector> {
    return Effect.forEach(
      disposals,
      disposal => this.processSingleDisposal(disposal, context),
      { concurrency: 1 } // Sequential for correct lot consumption
    );
  }

  private processSingleDisposal(
    disposal: Transaction,
    context: TaxCalculationContext
  ): Effect.Effect<ProcessedDisposal, DisposalProcessingError, TaxLotSelector> {
    return pipe(
      // Get selector from context
      Effect.service(TaxLotSelector),

      // Load lot IDs from projection, then rehydrate selected lots
      Effect.flatMap(selector =>
        pipe(
          this.lotRepository.findAvailableLotIdsFromProjection(context.userId, disposal.asset),
          Effect.flatMap(lotIds => Effect.forEach(lotIds, lotId => this.lotRepository.loadForCommand(lotId))),
          Effect.flatMap(fullLots => selector.selectLots(fullLots, disposal.quantity, context.accountingMethod)),

          Effect.map(selectedLots => ({ selector, selectedLots }))
        )
      ),

      // Consume lots and collect events
      Effect.flatMap(({ selectedLots }) => this.consumeLotsForDisposal(selectedLots, disposal)),

      // Save events and return processed disposal
      Effect.flatMap(consumptionResults =>
        pipe(
          // Save all events atomically
          this.lotRepository.saveEventsEffect(consumptionResults.flatMap(r => r.events)),
          Effect.map(() => ({
            disposal,
            consumptions: consumptionResults,
            totalGain: this.aggregateGains(consumptionResults),
          }))
        )
      )
    );
  }

  private consumeLotsForDisposal(
    lots: TaxLot[],
    disposal: Transaction
  ): Effect.Effect<ConsumptionResult[], ConsumptionError> {
    let remainingQuantity = disposal.quantity;
    const results: Effect.Effect<ConsumptionResult, ConsumptionError>[] = [];

    for (const lot of lots) {
      if (remainingQuantity.isZero()) break;

      const consumeQuantity = Quantity.min(remainingQuantity, lot.quantity.remaining);

      const consumptionEffect = pipe(
        lot.consume(consumeQuantity, disposal.price, disposal.date, disposal.transactionId),
        Effect.map(events => ({
          lotId: lot.lotId,
          events,
          consumedQuantity: consumeQuantity,
          realizedGain: this.extractRealizedGain(events),
        }))
      );

      results.push(consumptionEffect);
      remainingQuantity = remainingQuantity.subtract(consumeQuantity).getOrElse(() => Quantity.zero());
    }

    return Effect.all(results);
  }
}
```

## Jurisdiction-Specific Tax Policies

```typescript
// src/contexts/taxation/domain/services/jurisdiction-tax-policy.service.ts
import { Effect, Context, Layer } from 'effect';

// Generic tax policy interface
export interface JurisdictionTaxPolicy {
  readonly jurisdiction: string;

  calculateTaxSummary(transactions: TaxableTransaction[]): Effect.Effect<TaxSummary, TaxCalculationError>;

  getHoldingPeriodClassification(holdingPeriod: HoldingPeriod): TaxTreatmentType;

  applyLossRules(transactions: ProcessedDisposal[]): Effect.Effect<AdjustedTransaction[], LossRuleError>;

  getRequiredForms(): TaxForm[];
}

export const JurisdictionTaxPolicy = Context.GenericTag<JurisdictionTaxPolicy>('JurisdictionTaxPolicy');

export class FormGenerationError extends Data.TaggedError('FormGenerationError')<{
  readonly message: string;
}> {}

// US Implementation
export class USTaxPolicy implements JurisdictionTaxPolicy {
  readonly jurisdiction = 'US';

  getHoldingPeriodClassification(holdingPeriod: HoldingPeriod): TaxTreatmentType {
    return holdingPeriod.days > 365 ? 'LONG_TERM' : 'SHORT_TERM';
  }

  calculateTaxSummary(transactions: TaxableTransaction[]): Effect.Effect<TaxSummary, CurrencyMismatchError> {
    // Initialize totals inside an Effect to be safe and architecturally pure
    const initialTotals = Effect.succeed({
      shortTermGains: Money.zero(Currency.USD),
      shortTermLosses: Money.zero(Currency.USD),
      longTermGains: Money.zero(Currency.USD),
      longTermLosses: Money.zero(Currency.USD),
      washSaleDisallowed: Money.zero(Currency.USD),
      totalProceeds: Money.zero(Currency.USD),
      totalCostBasis: Money.zero(Currency.USD),
    });

    // Process each transaction with US-specific logic - now fully Effect-based
    const totalsEffect = pipe(
      initialTotals,
      Effect.flatMap(totals =>
        Effect.reduce(transactions, totals, (acc, tx) => {
          if (tx.type === 'DISPOSAL' && Option.isSome(tx.realizedGain)) {
            return pipe(
              Effect.fromOption(tx.realizedGain),
              Effect.mapError(() => new CurrencyMismatchError({ message: 'Missing realized gain' })),
              Effect.flatMap(gain => {
                // Classify holding period according to US rules
                const treatment = this.getHoldingPeriodClassification(gain.holdingPeriod);

                // Now all add operations are properly handled - if any fail, the whole Effect fails
                return pipe(
                  Effect.all({
                    newTotalProceeds: acc.totalProceeds.add(gain.proceeds),
                    newTotalCostBasis: acc.totalCostBasis.add(gain.costBasis),
                  }),
                  Effect.flatMap(({ newTotalProceeds, newTotalCostBasis }) => {
                    if (treatment === 'SHORT_TERM') {
                      if (gain.isGain()) {
                        return pipe(
                          acc.shortTermGains.add(gain.gain),
                          Effect.map(newShortTermGains => ({
                            ...acc,
                            totalProceeds: newTotalProceeds,
                            totalCostBasis: newTotalCostBasis,
                            shortTermGains: newShortTermGains,
                          }))
                        );
                      } else {
                        return pipe(
                          acc.shortTermLosses.add(gain.gain.abs()),
                          Effect.map(newShortTermLosses => ({
                            ...acc,
                            totalProceeds: newTotalProceeds,
                            totalCostBasis: newTotalCostBasis,
                            shortTermLosses: newShortTermLosses,
                          }))
                        );
                      }
                    } else {
                      if (gain.isGain()) {
                        return pipe(
                          acc.longTermGains.add(gain.gain),
                          Effect.map(newLongTermGains => ({
                            ...acc,
                            totalProceeds: newTotalProceeds,
                            totalCostBasis: newTotalCostBasis,
                            longTermGains: newLongTermGains,
                          }))
                        );
                      } else {
                        return pipe(
                          acc.longTermLosses.add(gain.gain.abs()),
                          Effect.map(newLongTermLosses => ({
                            ...acc,
                            totalProceeds: newTotalProceeds,
                            totalCostBasis: newTotalCostBasis,
                            longTermLosses: newLongTermLosses,
                          }))
                        );
                      }
                    }
                  }),
                  Effect.flatMap(updatedAcc =>
                    // Handle wash sale adjustments
                    Option.match(gain.washSaleAdjustment, {
                      onNone: () => Effect.succeed(updatedAcc),
                      onSome: adjustment =>
                        pipe(
                          updatedAcc.washSaleDisallowed.add(adjustment),
                          Effect.map(newWashSaleDisallowed => ({
                            ...updatedAcc,
                            washSaleDisallowed: newWashSaleDisallowed,
                          }))
                        ),
                    })
                  )
                );
              })
            );
          }
          return Effect.succeed(acc);
        })
      )
    );

    // Calculate final summary with proper error handling
    return pipe(
      totalsEffect,
      Effect.flatMap(totals =>
        pipe(
          Effect.all({
            netGain: totals.totalProceeds.subtract(totals.totalCostBasis),
            netShortTerm: totals.shortTermGains.subtract(totals.shortTermLosses),
            netLongTerm: totals.longTermGains.subtract(totals.longTermLosses),
          }),
          Effect.map(
            ({ netGain, netShortTerm, netLongTerm }) =>
              new TaxSummary({
                taxYear: transactions[0]?.taxYear || TaxYear.of(new Date().getFullYear()),
                jurisdiction: 'US',
                totalProceeds: totals.totalProceeds,
                totalCostBasis: totals.totalCostBasis,
                netGain,
                details: {
                  shortTermGains: totals.shortTermGains.toNumber(),
                  shortTermLosses: totals.shortTermLosses.toNumber(),
                  longTermGains: totals.longTermGains.toNumber(),
                  longTermLosses: totals.longTermLosses.toNumber(),
                  washSaleDisallowed: totals.washSaleDisallowed.toNumber(),
                  netShortTerm: netShortTerm.toNumber(),
                  netLongTerm: netLongTerm.toNumber(),
                },
              })
          )
        )
      )
    );
  }

  applyLossRules(transactions: ProcessedDisposal[]): Effect.Effect<AdjustedTransaction[], never> {
    // US wash sale rules
    return pipe(
      this.detectWashSales(transactions),
      Effect.map(violations => this.applyWashSaleAdjustments(transactions, violations))
    );
  }

  getRequiredForms(): TaxForm[] {
    return [
      { code: '8949', name: 'Sales and Other Dispositions of Capital Assets' },
      { code: 'Schedule D', name: 'Capital Gains and Losses' },
    ];
  }

  generateRequiredForms(report: TaxReport): Effect.Effect<Form8949Data, FormGenerationError> {
    return pipe(
      Effect.all([Effect.fromOption(report.taxYear), Effect.fromOption(report.summary)]),
      Effect.mapError(
        () =>
          new FormGenerationError({
            message: 'Cannot generate forms for incomplete report',
          })
      ),
      Effect.map(([taxYear, summary]) => {
        const shortTermSales: Form8949Entry[] = [];
        const longTermSales: Form8949Entry[] = [];

        report.transactions
          .filter(tx => tx.type === 'DISPOSAL' && Option.isSome(tx.realizedGain))
          .forEach(tx => {
            Option.match(tx.realizedGain, {
              onNone: () => {},
              onSome: gain => {
                const entry: Form8949Entry = {
                  description: tx.asset.toString(),
                  dateAcquired: gain.holdingPeriod.startDate,
                  dateSold: gain.holdingPeriod.endDate,
                  proceeds: gain.proceeds.toNumber(),
                  costBasis: gain.costBasis.toNumber(),
                  gainOrLoss: gain.gain.toNumber(),
                  adjustmentCode: Option.isSome(gain.washSaleAdjustment) ? 'W' : '',
                  adjustmentAmount: Option.match(gain.washSaleAdjustment, {
                    onNone: () => 0,
                    onSome: adj => adj.toNumber(),
                  }),
                };

                // Classify holding period according to US rules
                const treatment = this.getHoldingPeriodClassification(gain.holdingPeriod);

                if (treatment === 'SHORT_TERM') {
                  shortTermSales.push(entry);
                } else {
                  longTermSales.push(entry);
                }
              },
            });
          });

        return new Form8949Data({
          taxYear: taxYear.year,
          shortTermSales,
          longTermSales,
          totals: summary,
        });
      })
    );
  }

  private detectWashSales(transactions: ProcessedDisposal[]): Effect.Effect<WashSaleViolation[], never> {
    // US-specific 30-day wash sale window logic
    // ... implementation
    return Effect.succeed([]);
  }

  private applyWashSaleAdjustments(
    transactions: ProcessedDisposal[],
    violations: WashSaleViolation[]
  ): AdjustedTransaction[] {
    // ... implementation
    return transactions;
  }
}

// Canadian Implementation
export class CanadaTaxPolicy implements JurisdictionTaxPolicy {
  readonly jurisdiction = 'CA';

  getHoldingPeriodClassification(holdingPeriod: HoldingPeriod): TaxTreatmentType {
    // Canada doesn't distinguish by holding period
    return 'CAPITAL_GAIN';
  }

  calculateTaxSummary(transactions: TaxableTransaction[]): Effect.Effect<TaxSummary, never> {
    return Effect.sync(() => {
      // Canadian 50% inclusion rate
      const totalGains = transactions
        .filter(tx => tx.gain.isPositive())
        .reduce((sum, tx) => sum.add(tx.gain).getOrThrow(), Money.zero(Currency.CAD));

      const totalLosses = transactions
        .filter(tx => tx.gain.isNegative())
        .reduce((sum, tx) => sum.add(tx.gain.abs()).getOrThrow(), Money.zero(Currency.CAD));

      const netCapitalGain = totalGains.subtract(totalLosses).getOrThrow();
      const taxableCapitalGain = netCapitalGain.multiply(0.5); // 50% inclusion rate

      return new CanadianTaxSummary({
        totalCapitalGains: totalGains,
        totalCapitalLosses: totalLosses,
        netCapitalGain,
        taxableCapitalGain,
        inclusionRate: 0.5,
      });
    });
  }

  applyLossRules(transactions: ProcessedDisposal[]): Effect.Effect<AdjustedTransaction[], never> {
    // Canadian superficial loss rules (similar to wash sale but different window)
    return this.detectSuperficialLosses(transactions);
  }

  getRequiredForms(): TaxForm[] {
    return [
      { code: 'Schedule 3', name: 'Capital Gains (or Losses)' },
      { code: 'T5008', name: 'Statement of Securities Transactions' },
    ];
  }

  private detectSuperficialLosses(transactions: ProcessedDisposal[]): Effect.Effect<AdjustedTransaction[], never> {
    // Canadian 30-day before/after rule but with different criteria
    // ... implementation
  }
}

// Layer configuration
export const USTaxPolicyLayer = Layer.succeed(JurisdictionTaxPolicy, new USTaxPolicy());
export const CanadianTaxPolicyLayer = Layer.succeed(JurisdictionTaxPolicy, new CanadaTaxPolicy());
```

### 7. Module Configuration

```typescript
// src/contexts/taxation/taxation.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CreateTaxLotHandler } from './application/commands/create-tax-lot.handler';
import { GenerateTaxReportHandler } from './application/commands/generate-tax-report.handler';
import { TaxLotRepository } from './infrastructure/repositories/tax-lot.repository';
import { TaxReportRepository } from './infrastructure/repositories/tax-report.repository';
import { TaxCalculationSaga } from './application/sagas/tax-calculation.saga';
import { WashSaleDetector } from './domain/services/wash-sale-detector.service';
import { TaxController } from './api/tax.controller';
import { EventStoreModule } from '../../infrastructure/event-store/event-store.module';

// Command handlers
const CommandHandlers = [CreateTaxLotHandler, GenerateTaxReportHandler];

// Sagas
const Sagas = [TaxCalculationSaga];

// Domain services
const DomainServices = [WashSaleDetector];

@Module({
  imports: [CqrsModule, EventStoreModule],
  controllers: [TaxController],
  providers: [TaxLotRepository, TaxReportRepository, ...CommandHandlers, ...Sagas, ...DomainServices],
  exports: [TaxLotRepository, TaxReportRepository],
})
export class TaxationModule {}
```

### 8. API Controller

`````typescript
// src/contexts/taxation/api/tax.controller.ts
import { Controller, Post, Get, Body, Param, Query, Res } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { GenerateTaxReportCommand } from '../domain/aggregates/tax-report.aggregate';
import { GetTaxReportQuery } from '../application/queries/get-tax-report.query';
import { AccountingMethod } from '../domain/value-objects/tax-lot.vo';
import { UserId } from '../../trading/domain/value-objects/identifiers.vo';

@ApiTags('taxation')
@Controller('tax')
export class TaxController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('reports/generate')
  @ApiOperation({ summary: 'Generate tax report for a specific year' })
  async generateReport(@Body() dto: GenerateTaxReportDto) {
    const command = new GenerateTaxReportCommand(
      UserId(dto.userId),
      dto.taxYear,
      dto.accountingMethod as AccountingMethod
    );

    await this.commandBus.execute(command);

    return {
      success: true,
      message: `Tax report generation started for ${dto.taxYear}`
    };
  }

  @Get('reports/:year')
  @ApiOperation({ summary: 'Get tax report for a specific year' })
  @ApiQuery({ name: 'format', enum: ['json', 'pdf', 'csv'], required: false })
  ### 8. API Controller (continued)

````typescript
// src/contexts/taxation/api/tax.controller.ts (continued)
  async getTaxReport(
    @Param('year') year: string,
    @Query('format') format: string = 'json',
    @Res() res: Response
  ) {
    const query = new GetTaxReportQuery(
      UserId('current-user'), // From auth context
      parseInt(year)
    );

    const report = await this.queryBus.execute(query);

    switch (format) {
      case 'pdf':
        const pdfBuffer = await this.generatePDF(report);
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="tax-report-${year}.pdf"`
        });
        res.send(pdfBuffer);
        break;

      case 'csv':
        const csv = await this.generateCSV(report);
        res.set({
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="tax-report-${year}.csv"`
        });
        res.send(csv);
        break;

      default:
        res.json(report);
    }
  }

  @Get('reports/:year/form8949')
  @ApiOperation({ summary: 'Export Form 8949 data' })
  async exportForm8949(@Param('year') year: string) {
    const query = new GetForm8949Query(UserId('current-user'), parseInt(year));
    return this.queryBus.execute(query);
  }

  @Get('lots')
  @ApiOperation({ summary: 'Get all tax lots for current user' })
  @ApiQuery({ name: 'status', enum: ['OPEN', 'PARTIAL', 'CLOSED'], required: false })
  @ApiQuery({ name: 'asset', required: false })
  async getTaxLots(
    @Query('status') status?: string,
    @Query('asset') asset?: string
  ) {
    const query = new GetTaxLotsQuery(
      UserId('current-user'),
      { status, asset }
    );

    return this.queryBus.execute(query);
  }

  @Post('lots/:id/adjust')
  @ApiOperation({ summary: 'Adjust cost basis for wash sale or other reasons' })
  async adjustCostBasis(
    @Param('id') lotId: string,
    @Body() dto: AdjustCostBasisDto
  ) {
    // Controller now only creates plain data command - no domain logic
    await this.commandBus.execute({
      _tag: 'AdjustCostBasisCommand',
      lotId,
      ...dto,
    });

    return { success: true };
  }

  @Get('wash-sales/:year')
  @ApiOperation({ summary: 'Get wash sale violations for a tax year' })
  async getWashSales(@Param('year') year: string) {
    const query = new GetWashSalesQuery(
      UserId('current-user'),
      parseInt(year)
    );

    return this.queryBus.execute(query);
  }

  private async generatePDF(report: any): Promise<Buffer> {
    // PDF generation logic using a library like pdfkit or puppeteer
    // This is a placeholder
    return Buffer.from('PDF content');
  }

  private async generateCSV(report: any): Promise<string> {
    // CSV generation logic
    const headers = [
      'Date Acquired',
      'Date Sold',
      'Asset',
      'Quantity',
      'Proceeds',
      'Cost Basis',
      'Gain/Loss',
      'Type'
    ];

    const rows = report.transactions.map(tx => [
      tx.acquisitionDate,
      tx.disposalDate,
      tx.asset,
      tx.quantity,
      tx.proceeds,
      tx.costBasis,
      tx.realizedGain,
      tx.taxTreatment
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}
`````

### 9. Infrastructure Repositories

```typescript
// src/contexts/taxation/infrastructure/repositories/tax-lot.repository.ts
import { Injectable } from '@nestjs/common';
import { EventStore } from '../../../../infrastructure/event-store/event-store.service';
import { TaxLot, TaxLotStatus } from '../../domain/aggregates/tax-lot.aggregate';
import { TaxLotId } from '../../domain/value-objects/tax-lot.vo';
import { Option } from 'effect';
import { Knex } from 'knex';
import { InjectConnection } from 'nest-knexjs';

// Projection DTO for read queries
export class TaxLotProjection extends Data.Class<{
  readonly lotId: TaxLotId;
  readonly userId: UserId;
  readonly asset: AssetId;
  readonly remainingQuantity: Quantity;
  readonly costBasis: Money;
  readonly acquisitionDate: Date;
  readonly status: TaxLotStatus;
}> {
  static fromRow(row: any): TaxLotProjection {
    return new TaxLotProjection({
      lotId: TaxLotId(row.lot_id),
      userId: UserId(row.user_id),
      asset: AssetId.fromString(row.asset_id),
      remainingQuantity: Quantity.of(row.remaining_quantity, 18).getOrThrow(),
      costBasis: Money.of(row.adjusted_cost_basis, Currency.USD).getOrThrow(),
      acquisitionDate: new Date(row.acquisition_date),
      status: row.status as TaxLotStatus,
    });
  }
}

@Injectable()
export class TaxLotRepository {
  constructor(
    private readonly eventStore: EventStore,
    @InjectConnection() private readonly knex: Knex
  ) {}

  // Only load from event store when we need to execute commands
  loadForCommand(lotId: TaxLotId): Effect.Effect<TaxLot, LoadError> {
    return pipe(
      this.eventStore.readStreamEffect(lotId),
      Effect.map(events => events.reduce(TaxLot.apply, TaxLot.empty()))
    );
  }

  // For selector logic, return only lot IDs from projection for efficient loading
  findAvailableLotIdsFromProjection(userId: string, assetId: string): Effect.Effect<TaxLotId[], QueryError> {
    return Effect.tryPromise({
      try: () =>
        this.knex('tax_lot_projections')
          .where('user_id', userId)
          .where('asset_id', assetId)
          .whereIn('status', ['OPEN', 'PARTIAL'])
          .orderBy('acquisition_date', 'asc')
          .pluck('lot_id'),
      catch: error => new QueryError({ message: String(error) }),
    }).pipe(Effect.map(ids => ids.map(id => TaxLotId(id))));
  }

  // For read-only queries, use the projection directly
  findAvailableLotsFromProjection(userId: string, assetId: string): Effect.Effect<TaxLotProjection[], QueryError> {
    return Effect.tryPromise({
      try: () =>
        this.knex('tax_lot_projections')
          .where('user_id', userId)
          .where('asset_id', assetId)
          .whereIn('status', ['OPEN', 'PARTIAL'])
          .orderBy('acquisition_date', 'asc'),
      catch: error => new QueryError({ message: String(error) }),
    }).pipe(Effect.map(rows => rows.map(row => TaxLotProjection.fromRow(row))));
  }

  // Save events atomically
  saveEventsEffect(events: DomainEvent[]): Effect.Effect<void, SaveError> {
    return Effect.tryPromise({
      try: () => this.eventStore.appendBatch(events),
      catch: error => new SaveError({ message: String(error) }),
    });
  }
}
```

### 10. Projection Handlers

```typescript
// src/contexts/taxation/infrastructure/projections/tax-lot.projection.ts
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import {
  TaxLotCreated,
  TaxLotPartiallyConsumed,
  TaxLotFullyConsumed,
  TaxLotAdjusted,
} from '../../domain/aggregates/tax-lot.aggregate';

@EventsHandler(TaxLotCreated)
export class TaxLotCreatedHandler implements IEventHandler<TaxLotCreated> {
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async handle(event: TaxLotCreated): Promise<void> {
    await this.knex('tax_lot_projections').insert({
      lot_id: event.data.lotId,
      user_id: event.data.userId,
      asset_id: event.data.asset.toString(),
      acquisition_date: event.data.acquisitionDate,
      acquisition_method: event.data.acquisitionMethod,
      original_quantity: event.data.quantity.toNumber(),
      remaining_quantity: event.data.quantity.toNumber(),
      consumed_quantity: 0,
      original_cost_basis: event.data.costBasis.toNumber(),
      adjusted_cost_basis: event.data.costBasis.toNumber(),
      cost_basis_currency: event.data.costBasis.currency.symbol,
      status: 'OPEN',
      created_at: event.data.createdAt,
    });
  }
}

@EventsHandler(TaxLotPartiallyConsumed)
export class TaxLotPartiallyConsumedHandler implements IEventHandler<TaxLotPartiallyConsumed> {
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async handle(event: TaxLotPartiallyConsumed): Promise<void> {
    await this.knex('tax_lot_projections').where('lot_id', event.data.lotId).update({
      remaining_quantity: event.data.remaining.toNumber(),
      consumed_quantity: event.data.consumed.toNumber(),
      status: 'PARTIAL',
      updated_at: event.data.consumedAt,
    });

    // Record the realized gain
    await this.knex('realized_gains').insert({
      lot_id: event.data.lotId,
      disposal_transaction_id: event.data.disposalTransactionId,
      quantity_disposed: event.data.consumed.toNumber(),
      proceeds: event.data.proceeds.toNumber(),
      cost_basis: event.data.consumedCostBasis.toNumber(),
      realized_gain: event.data.realizedGain.gain.toNumber(),
      holding_period_days: event.data.realizedGain.holdingPeriod.days,
      tax_treatment: event.data.realizedGain.taxTreatment,
      wash_sale_adjustment: event.data.realizedGain.washSaleAdjustment.map(adj => adj.toNumber()).getOrElse(() => null),
      created_at: event.data.consumedAt,
    });
  }
}

@EventsHandler(TaxLotFullyConsumed)
export class TaxLotFullyConsumedHandler implements IEventHandler<TaxLotFullyConsumed> {
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async handle(event: TaxLotFullyConsumed): Promise<void> {
    await this.knex('tax_lot_projections').where('lot_id', event.data.lotId).update({
      remaining_quantity: 0,
      consumed_quantity: event.data.consumedQuantity.toNumber(),
      status: 'CLOSED',
      closed_at: event.data.consumedAt,
      updated_at: event.data.consumedAt,
    });

    // Record the realized gain
    await this.knex('realized_gains').insert({
      lot_id: event.data.lotId,
      disposal_transaction_id: event.data.disposalTransactionId,
      quantity_disposed: event.data.consumedQuantity.toNumber(),
      proceeds: event.data.proceeds.toNumber(),
      cost_basis: event.data.consumedCostBasis.toNumber(),
      realized_gain: event.data.realizedGain.gain.toNumber(),
      holding_period_days: event.data.realizedGain.holdingPeriod.days,
      tax_treatment: event.data.realizedGain.taxTreatment,
      wash_sale_adjustment: event.data.realizedGain.washSaleAdjustment.map(adj => adj.toNumber()).getOrElse(() => null),
      created_at: event.data.consumedAt,
    });
  }
}

@EventsHandler(TaxLotAdjusted)
export class TaxLotAdjustedHandler implements IEventHandler<TaxLotAdjusted> {
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async handle(event: TaxLotAdjusted): Promise<void> {
    await this.knex('tax_lot_projections').where('lot_id', event.data.lotId).update({
      adjusted_cost_basis: event.data.newCostBasis.adjustedAmount.toNumber(),
      status: 'ADJUSTED',
      updated_at: event.data.adjustedAt,
    });

    // Record the adjustment
    await this.knex('cost_basis_adjustments').insert({
      lot_id: event.data.lotId,
      adjustment_type: event.data.adjustment.type,
      adjustment_amount: event.data.adjustment.amount.toNumber(),
      reason: event.data.reason,
      related_transaction_id: event.data.adjustment.relatedTransactionId.getOrElse(() => null),
      created_at: event.data.adjustedAt,
    });
  }
}
```

### 11. Database Migrations

```typescript
// src/contexts/taxation/infrastructure/migrations/001_create_tax_tables.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Tax lot projections table
  await knex.schema.createTable('tax_lot_projections', table => {
    table.uuid('lot_id').primary();
    table.uuid('user_id').notNullable();
    table.string('asset_id').notNullable();
    table.timestamp('acquisition_date').notNullable();
    table.string('acquisition_method').notNullable();
    table.decimal('original_quantity', 30, 18).notNullable();
    table.decimal('remaining_quantity', 30, 18).notNullable();
    table.decimal('consumed_quantity', 30, 18).defaultTo(0);
    table.decimal('original_cost_basis', 20, 2).notNullable();
    table.decimal('adjusted_cost_basis', 20, 2).notNullable();
    table.string('cost_basis_currency', 10).notNullable();
    table.enum('status', ['OPEN', 'PARTIAL', 'CLOSED', 'ADJUSTED']).notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at');
    table.timestamp('closed_at');

    table.index(['user_id', 'asset_id', 'status']);
    table.index(['user_id', 'acquisition_date']);
    table.index(['status']);
  });

  // Realized gains table
  await knex.schema.createTable('realized_gains', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('lot_id').notNullable();
    table.uuid('disposal_transaction_id').notNullable();
    table.decimal('quantity_disposed', 30, 18).notNullable();
    table.decimal('proceeds', 20, 2).notNullable();
    table.decimal('cost_basis', 20, 2).notNullable();
    table.decimal('realized_gain', 20, 2).notNullable();
    table.integer('holding_period_days').notNullable();
    table.enum('tax_treatment', ['SHORT_TERM', 'LONG_TERM']).notNullable();
    table.decimal('wash_sale_adjustment', 20, 2);
    table.timestamp('created_at').notNullable();

    table.index(['lot_id']);
    table.index(['disposal_transaction_id']);
    table.index(['tax_treatment']);
  });

  // Cost basis adjustments table
  await knex.schema.createTable('cost_basis_adjustments', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('lot_id').notNullable();
    table.enum('adjustment_type', ['INCREASE', 'DECREASE']).notNullable();
    table.decimal('adjustment_amount', 20, 2).notNullable();
    table.string('reason').notNullable();
    table.uuid('related_transaction_id');
    table.timestamp('created_at').notNullable();

    table.index(['lot_id']);
  });

  // Tax report projections table
  await knex.schema.createTable('tax_report_projections', table => {
    table.uuid('report_id').primary();
    table.uuid('user_id').notNullable();
    table.integer('tax_year').notNullable();
    table.string('accounting_method').notNullable();
    table.enum('status', ['DRAFT', 'CALCULATING', 'READY', 'FINALIZED', 'FILED']).notNullable();
    table.decimal('short_term_gains', 20, 2);
    table.decimal('short_term_losses', 20, 2);
    table.decimal('long_term_gains', 20, 2);
    table.decimal('long_term_losses', 20, 2);
    table.decimal('wash_sale_disallowed', 20, 2);
    table.decimal('total_proceeds', 20, 2);
    table.decimal('total_cost_basis', 20, 2);
    table.decimal('net_gain', 20, 2);
    table.string('filing_reference');
    table.timestamp('created_at').notNullable();
    table.timestamp('calculated_at');
    table.timestamp('finalized_at');
    table.timestamp('filed_at');

    table.index(['user_id', 'tax_year']);
    table.index(['status']);
  });

  // Wash sale violations table
  await knex.schema.createTable('wash_sale_violations', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('disposal_transaction_id').notNullable();
    table.uuid('acquisition_transaction_id').notNullable();
    table.string('asset_id').notNullable();
    table.decimal('loss_amount', 20, 2).notNullable();
    table.decimal('disallowed_amount', 20, 2).notNullable();
    table.timestamp('disposal_date').notNullable();
    table.timestamp('acquisition_date').notNullable();
    table.integer('days_apart').notNullable();
    table.timestamp('detected_at').notNullable();

    table.index(['disposal_transaction_id']);
    table.index(['acquisition_transaction_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wash_sale_violations');
  await knex.schema.dropTableIfExists('tax_report_projections');
  await knex.schema.dropTableIfExists('cost_basis_adjustments');
  await knex.schema.dropTableIfExists('realized_gains');
  await knex.schema.dropTableIfExists('tax_lot_projections');
}
```

### 12. Query Handlers

```typescript
// src/contexts/taxation/application/queries/get-tax-report.query.ts
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { UserId } from '../../../trading/domain/value-objects/identifiers.vo';

export class GetTaxReportQuery {
  constructor(
    readonly userId: UserId,
    readonly taxYear: number
  ) {}
}

@QueryHandler(GetTaxReportQuery)
export class GetTaxReportHandler implements IQueryHandler<GetTaxReportQuery> {
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async execute(query: GetTaxReportQuery): Promise<any> {
    const report = await this.knex('tax_report_projections')
      .where('user_id', query.userId)
      .where('tax_year', query.taxYear)
      .first();

    if (!report) {
      return null;
    }

    // Get all transactions for the report
    const transactions = await this.knex('realized_gains as rg')
      .join('tax_lot_projections as tlp', 'rg.lot_id', 'tlp.lot_id')
      .where('tlp.user_id', query.userId)
      .whereRaw('EXTRACT(YEAR FROM rg.created_at) = ?', [query.taxYear])
      .select('rg.*', 'tlp.asset_id', 'tlp.acquisition_date', 'tlp.acquisition_method')
      .orderBy('rg.created_at');

    // Get wash sale violations
    const washSales = await this.knex('wash_sale_violations')
      .whereIn(
        'disposal_transaction_id',
        transactions.map(t => t.disposal_transaction_id)
      )
      .orWhereIn(
        'acquisition_transaction_id',
        transactions.map(t => t.disposal_transaction_id)
      );

    return {
      ...report,
      transactions,
      washSales,
      summary: {
        shortTermGains: report.short_term_gains,
        shortTermLosses: report.short_term_losses,
        longTermGains: report.long_term_gains,
        longTermLosses: report.long_term_losses,
        washSaleDisallowed: report.wash_sale_disallowed,
        totalProceeds: report.total_proceeds,
        totalCostBasis: report.total_cost_basis,
        netGain: report.net_gain,
        netShortTerm: report.short_term_gains - report.short_term_losses,
        netLongTerm: report.long_term_gains - report.long_term_losses,
        totalTaxableGain: report.net_gain - report.wash_sale_disallowed,
      },
    };
  }
}
```
