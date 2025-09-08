## Reconciliation Context - Complete Implementation

### 1. Core Domain Value Objects

```typescript
// packages/contexts/reconciliation/src/core/value-objects/reconciliation.vo.ts
import { Data, Effect, Brand, Option, pipe } from 'effect';
import { Money } from '../../../../@core/domain/common-types/money.vo';
import { AssetId } from '../../../../@core/domain/common-types/asset-id.vo';
import { Quantity } from '../../../../@core/domain/common-types/quantity.vo';
import { v4 as uuidv4 } from 'uuid';
import BigNumber from 'bignumber.js';

// Reconciliation identifiers
export type ReconciliationId = string & Brand.Brand<'ReconciliationId'>;
export const ReconciliationId = {
  ...Brand.nominal<ReconciliationId>(),
  generate: (): ReconciliationId => Brand.nominal<ReconciliationId>()(uuidv4()),
};

export type DiscrepancyId = string & Brand.Brand<'DiscrepancyId'>;
export const DiscrepancyId = {
  ...Brand.nominal<DiscrepancyId>(),
  generate: (): DiscrepancyId => Brand.nominal<DiscrepancyId>()(uuidv4()),
};

export type CorrectionId = string & Brand.Brand<'CorrectionId'>;
export const CorrectionId = {
  ...Brand.nominal<CorrectionId>(),
  generate: (): CorrectionId => Brand.nominal<CorrectionId>()(uuidv4()),
};

// Data sources
export enum DataSource {
  BINANCE = 'BINANCE',
  COINBASE = 'COINBASE',
  KRAKEN = 'KRAKEN',
  METAMASK = 'METAMASK',
  LEDGER = 'LEDGER',
  ETHEREUM = 'ETHEREUM',
  BITCOIN = 'BITCOIN',
  BANK = 'BANK',
  MANUAL = 'MANUAL',
}

// Reconciliation status
export enum ReconciliationStatus {
  INITIATED = 'INITIATED',
  FETCHING = 'FETCHING',
  COMPARING = 'COMPARING',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_REVIEW = 'PENDING_REVIEW',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Discrepancy severity
export enum DiscrepancySeverity {
  NEGLIGIBLE = 'NEGLIGIBLE', // < 0.001%
  MINOR = 'MINOR', // < 0.1%
  WARNING = 'WARNING', // < 1%
  CRITICAL = 'CRITICAL', // >= 1%
}

// Resolution type
export enum ResolutionType {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
  ADJUST_INTERNAL = 'ADJUST_INTERNAL',
  ADJUST_EXTERNAL = 'ADJUST_EXTERNAL',
  IGNORE = 'IGNORE',
  INVESTIGATE = 'INVESTIGATE',
}

// Correction type
export enum CorrectionType {
  BALANCE_ADJUSTMENT = 'BALANCE_ADJUSTMENT',
  MISSING_TRANSACTION = 'MISSING_TRANSACTION',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  INCORRECT_CLASSIFICATION = 'INCORRECT_CLASSIFICATION',
  FEE_ADJUSTMENT = 'FEE_ADJUSTMENT',
  ROUNDING_ERROR = 'ROUNDING_ERROR',
}

// Balance snapshot
export class BalanceSnapshot extends Data.Class<{
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly value: Option.Option<Money>;
  readonly source: DataSource;
  readonly timestamp: Date;
  readonly blockHeight: Option.Option<number>;
  readonly metadata: Record<string, unknown>;
}> {
  isStale(maxAgeMinutes: number = 15): boolean {
    const ageMs = Date.now() - this.timestamp.getTime();
    return ageMs > maxAgeMinutes * 60 * 1000;
  }
}

// Discrepancy
export class Discrepancy extends Data.Class<{
  readonly id: DiscrepancyId;
  readonly asset: AssetId;
  readonly internal: BalanceSnapshot;
  readonly external: BalanceSnapshot;
  readonly difference: Quantity;
  readonly percentageDiff: number;
  readonly severity: DiscrepancySeverity;
  readonly possibleCauses: ReadonlyArray<string>;
  readonly detectedAt: Date;
  readonly isResolved: boolean;
  readonly resolution: Option.Option<Resolution>;
}> {
  static calculate(
    internal: BalanceSnapshot,
    external: BalanceSnapshot,
  ): Effect.Effect<Discrepancy, Error> {
    if (!internal.asset.equals(external.asset)) {
      return Effect.fail(new Error('Asset mismatch in balance comparison'));
    }

    return pipe(
      internal.quantity.subtract(external.quantity),
      Effect.map((diff) => {
        const average = internal.quantity
          .add(external.quantity)
          .divide(2)
          .getOrElse(() => internal.quantity);

        const percentageDiff = average.isZero()
          ? 0
          : Math.abs((diff.toNumber() / average.toNumber()) * 100);

        const severity = this.calculateSeverity(percentageDiff);
        const possibleCauses = this.identifyPossibleCauses(
          internal,
          external,
          diff,
          percentageDiff,
        );

        return new Discrepancy({
          id: DiscrepancyId.generate(),
          asset: internal.asset,
          internal,
          external,
          difference: diff,
          percentageDiff,
          severity,
          possibleCauses,
          detectedAt: new Date(),
          isResolved: false,
          resolution: Option.none(),
        });
      }),
      Effect.orElseSucceed(
        () =>
          new Discrepancy({
            id: DiscrepancyId.generate(),
            asset: internal.asset,
            internal,
            external,
            difference: Quantity.of(0, 18).getOrElse(() => internal.quantity),
            percentageDiff: 0,
            severity: DiscrepancySeverity.NEGLIGIBLE,
            possibleCauses: [],
            detectedAt: new Date(),
            isResolved: false,
            resolution: Option.none(),
          }),
      ),
    );
  }

  private static calculateSeverity(
    percentageDiff: number,
  ): DiscrepancySeverity {
    if (percentageDiff < 0.001) return DiscrepancySeverity.NEGLIGIBLE;
    if (percentageDiff < 0.1) return DiscrepancySeverity.MINOR;
    if (percentageDiff < 1) return DiscrepancySeverity.WARNING;
    return DiscrepancySeverity.CRITICAL;
  }

  private static identifyPossibleCauses(
    internal: BalanceSnapshot,
    external: BalanceSnapshot,
    difference: Quantity,
    percentageDiff: number,
  ): string[] {
    const causes: string[] = [];

    // Check for stale data
    if (internal.isStale() || external.isStale()) {
      causes.push('Stale data - balances may be outdated');
    }

    // Check for pending transactions
    const timeDiff = Math.abs(
      internal.timestamp.getTime() - external.timestamp.getTime(),
    );
    if (timeDiff > 60000) {
      // More than 1 minute
      causes.push('Timing difference - balances fetched at different times');
    }

    // Small discrepancies might be fees
    if (percentageDiff < 0.1) {
      causes.push('Possible unaccounted fees or dust');
    }

    // Large discrepancies might be missing transactions
    if (percentageDiff > 10) {
      causes.push('Possible missing or unprocessed transactions');
    }

    // Check for rounding errors
    if (percentageDiff < 0.001) {
      causes.push('Rounding error in calculations');
    }

    return causes;
  }

  requiresManualReview(): boolean {
    return (
      this.severity === DiscrepancySeverity.CRITICAL ||
      this.severity === DiscrepancySeverity.WARNING
    );
  }

  canAutoResolve(): boolean {
    return (
      this.severity === DiscrepancySeverity.NEGLIGIBLE ||
      (this.severity === DiscrepancySeverity.MINOR &&
        this.possibleCauses.includes('Rounding error in calculations'))
    );
  }
}

// Resolution
export class Resolution extends Data.Class<{
  readonly discrepancyId: DiscrepancyId;
  readonly type: ResolutionType;
  readonly adjustment: Option.Option<Adjustment>;
  readonly notes: string;
  readonly resolvedBy: string;
  readonly resolvedAt: Date;
  readonly requiresApproval: boolean;
  readonly approvedBy: Option.Option<string>;
  readonly approvedAt: Option.Option<Date>;
}> {
  isApproved(): boolean {
    return !this.requiresApproval || Option.isSome(this.approvedBy);
  }

  isPending(): boolean {
    return this.requiresApproval && Option.isNone(this.approvedBy);
  }
}

// Adjustment
export class Adjustment extends Data.Class<{
  readonly type: 'INCREASE' | 'DECREASE';
  readonly asset: AssetId;
  readonly quantity: Quantity;
  readonly value: Option.Option<Money>;
  readonly reason: string;
  readonly source: DataSource;
  readonly effectiveDate: Date;
}> {
  toJournalEntry(): {
    debit: { account: string; amount: Money };
    credit: { account: string; amount: Money };
  } | null {
    return Option.match(this.value, {
      onNone: () => null,
      onSome: (value) => {
        if (this.type === 'INCREASE') {
          return {
            debit: {
              account: `ASSET:${this.asset.toString()}`,
              amount: value,
            },
            credit: {
              account: 'RECONCILIATION:ADJUSTMENT',
              amount: value,
            },
          };
        } else {
          return {
            debit: {
              account: 'RECONCILIATION:ADJUSTMENT',
              amount: value,
            },
            credit: {
              account: `ASSET:${this.asset.toString()}`,
              amount: value,
            },
          };
        }
      },
    });
  }
}

// Reconciliation session
export class ReconciliationSession extends Data.Class<{
  readonly id: ReconciliationId;
  readonly sources: ReadonlyArray<DataSource>;
  readonly startedAt: Date;
  readonly completedAt: Option.Option<Date>;
  readonly status: ReconciliationStatus;
  readonly totalAssets: number;
  readonly totalDiscrepancies: number;
  readonly resolvedDiscrepancies: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly minorCount: number;
}> {
  getProgress(): number {
    if (this.totalDiscrepancies === 0) return 100;
    return Math.round(
      (this.resolvedDiscrepancies / this.totalDiscrepancies) * 100,
    );
  }

  isComplete(): boolean {
    return this.status === ReconciliationStatus.COMPLETED;
  }

  requiresAttention(): boolean {
    return this.criticalCount > 0 || this.warningCount > 0;
  }

  getDuration(): number {
    const end = Option.getOrElse(this.completedAt, () => new Date());
    return end.getTime() - this.startedAt.getTime();
  }
}

// Correction request
export class CorrectionRequest extends Data.Class<{
  readonly id: CorrectionId;
  readonly type: CorrectionType;
  readonly description: string;
  readonly adjustments: ReadonlyArray<Adjustment>;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  readonly reviewNotes: Option.Option<string>;
}> {
  getTotalImpact(): Record<
    string,
    { quantity: Quantity; value: Option.Option<Money> }
  > {
    const impact: Record<
      string,
      { quantity: Quantity; value: Option.Option<Money> }
    > = {};

    this.adjustments.forEach((adj) => {
      const key = adj.asset.toString();
      if (!impact[key]) {
        impact[key] = {
          quantity: Quantity.of(0, 18).getOrElse(() => adj.quantity),
          value: Option.none(),
        };
      }

      if (adj.type === 'INCREASE') {
        impact[key].quantity = impact[key].quantity.add(adj.quantity);
      } else {
        impact[key].quantity = impact[key].quantity
          .subtract(adj.quantity)
          .getOrElse(() => impact[key].quantity);
      }

      // Aggregate values if present
      if (Option.isSome(adj.value) && Option.isSome(impact[key].value)) {
        const currentValue = Option.getOrThrow(impact[key].value);
        const adjValue = Option.getOrThrow(adj.value);
        impact[key].value = Option.some(
          adj.type === 'INCREASE'
            ? currentValue.add(adjValue).getOrElse(() => currentValue)
            : currentValue.subtract(adjValue).getOrElse(() => currentValue),
        );
      } else if (Option.isSome(adj.value)) {
        impact[key].value = adj.value;
      }
    });

    return impact;
  }
}

// Evidence for corrections
export class Evidence extends Data.Class<{
  readonly type:
    | 'SCREENSHOT'
    | 'CSV'
    | 'API_RESPONSE'
    | 'BLOCKCHAIN_TX'
    | 'DOCUMENT';
  readonly description: string;
  readonly url: Option.Option<string>;
  readonly hash: Option.Option<string>;
  readonly timestamp: Date;
}> {}
```

### 2. Reconciliation Aggregate

```typescript
// packages/contexts/reconciliation/src/core/aggregates/reconciliation.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray } from 'effect';
import { Data } from 'effect';
import { EventSourcedAggregate } from '../../../../@core/domain/base/aggregate-root.base';
import { DomainEvent } from '../../../../@core/domain/base/domain-event.base';
import {
  ReconciliationId,
  ReconciliationStatus,
  ReconciliationSession,
  DataSource,
  Discrepancy,
  Resolution,
  ResolutionType,
  Adjustment,
  BalanceSnapshot,
  DiscrepancyId,
} from '../value-objects/reconciliation.vo';
import { UserId } from '../../../../@core/domain/common-types/identifiers';
import { v4 as uuidv4 } from 'uuid';

// Reconciliation errors
export class ReconciliationError extends Data.TaggedError(
  'ReconciliationError',
)<{
  readonly message: string;
}> {}

export class ReconciliationNotInProgressError extends Data.TaggedError(
  'ReconciliationNotInProgressError',
)<{
  readonly reconciliationId: ReconciliationId;
}> {}

export class DiscrepancyNotFoundError extends Data.TaggedError(
  'DiscrepancyNotFoundError',
)<{
  readonly discrepancyId: string;
}> {}

export class UnresolvedDiscrepanciesError extends Data.TaggedError(
  'UnresolvedDiscrepanciesError',
)<{
  readonly count: number;
}> {}

// Reconciliation events
export class ReconciliationInitiated extends DomainEvent {
  readonly _tag = 'ReconciliationInitiated';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly userId: UserId;
      readonly sources: ReadonlyArray<DataSource>;
      readonly initiatedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.initiatedAt,
      version: 1,
    });
  }
}

export class BalancesFetched extends DomainEvent {
  readonly _tag = 'BalancesFetched';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly source: DataSource;
      readonly balances: ReadonlyArray<BalanceSnapshot>;
      readonly fetchedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.fetchedAt,
      version: 1,
    });
  }
}

export class DiscrepancyDetected extends DomainEvent {
  readonly _tag = 'DiscrepancyDetected';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly discrepancy: Discrepancy;
      readonly detectedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.detectedAt,
      version: 1,
    });
  }
}

export class DiscrepancyResolved extends DomainEvent {
  readonly _tag = 'DiscrepancyResolved';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly discrepancyId: DiscrepancyId;
      readonly resolution: Resolution;
      readonly resolvedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.resolvedAt,
      version: 1,
    });
  }
}

export class ReconciliationCompleted extends DomainEvent {
  readonly _tag = 'ReconciliationCompleted';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly summary: ReconciliationSession;
      readonly completedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.completedAt,
      version: 1,
    });
  }
}

export class ReconciliationFailed extends DomainEvent {
  readonly _tag = 'ReconciliationFailed';

  constructor(
    readonly data: {
      readonly reconciliationId: ReconciliationId;
      readonly reason: string;
      readonly failedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.reconciliationId,
      timestamp: data.failedAt,
      version: 1,
    });
  }
}

// Commands
export interface InitiateReconciliationCommand {
  readonly userId: UserId;
  readonly sources: ReadonlyArray<DataSource>;
}

export interface RecordDiscrepancyCommand {
  readonly reconciliationId: ReconciliationId;
  readonly discrepancy: Discrepancy;
}

export interface ResolveDiscrepancyCommand {
  readonly reconciliationId: ReconciliationId;
  readonly discrepancyId: DiscrepancyId;
  readonly resolution: Resolution;
}

export interface CompleteReconciliationCommand {
  readonly reconciliationId: ReconciliationId;
}

// Reconciliation Aggregate
export class Reconciliation extends EventSourcedAggregate {
  readonly reconciliationId: Option.Option<ReconciliationId>;
  readonly userId: Option.Option<UserId>;
  readonly sources: ReadonlyArray<DataSource>;
  readonly status: ReconciliationStatus;
  readonly discrepancies: ReadonlyArray<Discrepancy>;
  readonly balances: Map<DataSource, ReadonlyArray<BalanceSnapshot>>;
  readonly startedAt: Option.Option<Date>;

  constructor(data: {
    readonly reconciliationId: Option.Option<ReconciliationId>;
    readonly userId: Option.Option<UserId>;
    readonly sources: ReadonlyArray<DataSource>;
    readonly status: ReconciliationStatus;
    readonly discrepancies: ReadonlyArray<Discrepancy>;
    readonly balances: Map<DataSource, ReadonlyArray<BalanceSnapshot>>;
    readonly startedAt: Option.Option<Date>;
    readonly version: number;
    readonly events: ReadonlyArray<DomainEvent>;
  }) {
    super({ version: data.version, events: data.events });
    this.reconciliationId = data.reconciliationId;
    this.userId = data.userId;
    this.sources = data.sources;
    this.status = data.status;
    this.discrepancies = data.discrepancies;
    this.balances = data.balances;
    this.startedAt = data.startedAt;
  }

  protected get aggregateId(): Option.Option<string> {
    return this.reconciliationId;
  }

  // Create empty reconciliation for reconstruction
  static empty(): Reconciliation {
    return new Reconciliation({
      reconciliationId: Option.none(),
      userId: Option.none(),
      sources: [],
      status: ReconciliationStatus.INITIATED,
      discrepancies: [],
      balances: new Map(),
      startedAt: Option.none(),
      events: [],
      version: 0,
    });
  }

  // The ONLY place where state transitions happen
  apply(event: DomainEvent): Reconciliation {
    switch (event._tag) {
      case 'ReconciliationInitiated':
        const initiatedData = (event as ReconciliationInitiated).data;
        return this.copy({
          reconciliationId: Option.some(initiatedData.reconciliationId),
          userId: Option.some(initiatedData.userId),
          sources: initiatedData.sources,
          status: ReconciliationStatus.INITIATED,
          discrepancies: [],
          balances: new Map(),
          startedAt: Option.some(initiatedData.initiatedAt),
          events: [...this.events, event],
        });

      case 'BalancesFetched':
        const balanceData = (event as BalancesFetched).data;
        const newBalances = new Map(this.balances);
        newBalances.set(balanceData.source, balanceData.balances);
        return this.copy({
          status: ReconciliationStatus.FETCHING,
          balances: newBalances,
          events: [...this.events, event],
        });

      case 'DiscrepancyDetected':
        const discrepancyData = (event as DiscrepancyDetected).data;
        return this.copy({
          status: ReconciliationStatus.IN_PROGRESS,
          discrepancies: [...this.discrepancies, discrepancyData.discrepancy],
          events: [...this.events, event],
        });

      case 'DiscrepancyResolved':
        const resolutionData = (event as DiscrepancyResolved).data;
        const discrepancyIndex = this.discrepancies.findIndex(
          (d) => d.id === resolutionData.discrepancyId,
        );

        if (discrepancyIndex !== -1) {
          const resolvedDiscrepancy = new Discrepancy({
            ...this.discrepancies[discrepancyIndex],
            isResolved: true,
            resolution: Option.some(resolutionData.resolution),
          });

          const updatedDiscrepancies = [
            ...this.discrepancies.slice(0, discrepancyIndex),
            resolvedDiscrepancy,
            ...this.discrepancies.slice(discrepancyIndex + 1),
          ];

          return this.copy({
            discrepancies: updatedDiscrepancies,
            events: [...this.events, event],
          });
        }
        return this;

      case 'ReconciliationCompleted':
        return this.copy({
          status: ReconciliationStatus.COMPLETED,
          events: [...this.events, event],
        });

      case 'ReconciliationFailed':
        return this.copy({
          status: ReconciliationStatus.FAILED,
          events: [...this.events, event],
        });

      default:
        return this;
    }
  }

  // Factory method for initiating - returns events, not new state
  static initiate(
    command: InitiateReconciliationCommand,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, never> {
    return Effect.succeed(() => {
      const reconciliationId = ReconciliationId.generate();
      const event = new ReconciliationInitiated({
        reconciliationId,
        userId: command.userId,
        sources: command.sources,
        initiatedAt: new Date(),
      });
      return [event];
    })();
  }

  // Record fetched balances - returns events only
  recordBalances(
    source: DataSource,
    balances: ReadonlyArray<BalanceSnapshot>,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, never> {
    return Effect.succeed(() => {
      const reconciliationId = Option.getOrThrow(this.reconciliationId);
      const event = new BalancesFetched({
        reconciliationId,
        source,
        balances,
        fetchedAt: new Date(),
      });
      return [event];
    })();
  }

  // Record discrepancy - returns events only
  recordDiscrepancy(
    discrepancy: Discrepancy,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, ReconciliationError> {
    if (
      this.status !== ReconciliationStatus.COMPARING &&
      this.status !== ReconciliationStatus.IN_PROGRESS
    ) {
      return Effect.fail(
        new ReconciliationError({
          message: 'Cannot record discrepancies in current status',
        }),
      );
    }

    return Effect.succeed(() => {
      const reconciliationId = Option.getOrThrow(this.reconciliationId);
      const event = new DiscrepancyDetected({
        reconciliationId,
        discrepancy,
        detectedAt: new Date(),
      });
      return [event];
    })();
  }

  // Resolve discrepancy - returns events only
  resolveDiscrepancy(
    discrepancyId: DiscrepancyId,
    resolution: Resolution,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, DiscrepancyNotFoundError> {
    const discrepancyIndex = this.discrepancies.findIndex(
      (d) => d.id === discrepancyId,
    );

    if (discrepancyIndex === -1) {
      return Effect.fail(
        new DiscrepancyNotFoundError({
          discrepancyId,
        }),
      );
    }

    return Effect.succeed(() => {
      const reconciliationId = Option.getOrThrow(this.reconciliationId);
      const event = new DiscrepancyResolved({
        reconciliationId,
        discrepancyId,
        resolution,
        resolvedAt: new Date(),
      });
      return [event];
    })();
  }

  // Auto-resolve minor discrepancies - returns events only
  autoResolveMinorDiscrepancies(): Effect.Effect<
    ReadonlyArray<DomainEvent>,
    never
  > {
    return Effect.sync(() => {
      const events: DomainEvent[] = [];
      const reconciliationId = Option.getOrThrow(this.reconciliationId);

      this.discrepancies
        .filter((d) => !d.isResolved && d.canAutoResolve())
        .forEach((discrepancy) => {
          const resolution = new Resolution({
            discrepancyId: discrepancy.id,
            type: ResolutionType.AUTO,
            adjustment: Option.none(),
            notes: `Auto-resolved: ${discrepancy.possibleCauses.join(', ')}`,
            resolvedBy: 'system',
            resolvedAt: new Date(),
            requiresApproval: false,
            approvedBy: Option.some('system'),
            approvedAt: Option.some(new Date()),
          });

          const event = new DiscrepancyResolved({
            reconciliationId,
            discrepancyId: discrepancy.id,
            resolution,
            resolvedAt: new Date(),
          });

          events.push(event);
        });

      return events;
    });
  }

  // Complete reconciliation - returns events only
  complete(): Effect.Effect<
    ReadonlyArray<DomainEvent>,
    UnresolvedDiscrepanciesError
  > {
    const unresolvedCount = this.discrepancies.filter(
      (d) => !d.isResolved,
    ).length;

    if (unresolvedCount > 0) {
      return Effect.fail(
        new UnresolvedDiscrepanciesError({
          count: unresolvedCount,
        }),
      );
    }

    return Effect.succeed(() => {
      const reconciliationId = Option.getOrThrow(this.reconciliationId);
      const summary = new ReconciliationSession({
        id: reconciliationId,
        sources: this.sources,
        startedAt: Option.getOrThrow(this.startedAt),
        completedAt: Option.some(new Date()),
        status: ReconciliationStatus.COMPLETED,
        totalAssets: this.getUniqueAssetCount(),
        totalDiscrepancies: this.discrepancies.length,
        resolvedDiscrepancies: this.discrepancies.filter((d) => d.isResolved)
          .length,
        criticalCount: this.discrepancies.filter(
          (d) => d.severity === 'CRITICAL',
        ).length,
        warningCount: this.discrepancies.filter((d) => d.severity === 'WARNING')
          .length,
        minorCount: this.discrepancies.filter((d) => d.severity === 'MINOR')
          .length,
      });

      const event = new ReconciliationCompleted({
        reconciliationId,
        summary,
        completedAt: new Date(),
      });

      return [event];
    })();
  }

  // Mark as failed - returns events only
  fail(reason: string): Effect.Effect<ReadonlyArray<DomainEvent>, never> {
    return Effect.succeed(() => {
      const reconciliationId = Option.getOrThrow(this.reconciliationId);
      const event = new ReconciliationFailed({
        reconciliationId,
        reason,
        failedAt: new Date(),
      });
      return [event];
    })();
  }

  // Helper methods
  private getUniqueAssetCount(): number {
    const assets = new Set<string>();

    this.balances.forEach((snapshots) => {
      snapshots.forEach((snapshot) => {
        assets.add(snapshot.asset.toString());
      });
    });

    return assets.size;
  }

  getProgress(): number {
    if (this.discrepancies.length === 0) return 100;
    const resolved = this.discrepancies.filter((d) => d.isResolved).length;
    return Math.round((resolved / this.discrepancies.length) * 100);
  }

  requiresManualReview(): boolean {
    return this.discrepancies.some(
      (d) => !d.isResolved && d.requiresManualReview(),
    );
  }
}
```

### 3. Correction Aggregate

```typescript
// packages/contexts/reconciliation/src/core/aggregates/correction.aggregate.ts
import { Effect, pipe, Option, ReadonlyArray } from 'effect';
import { Data } from 'effect';
import { EventSourcedAggregate } from '../../../../@core/domain/base/aggregate-root.base';
import { DomainEvent } from '../../../../@core/domain/base/domain-event.base';
import {
  CorrectionId,
  CorrectionType,
  CorrectionRequest,
  Adjustment,
  Evidence,
} from '../value-objects/reconciliation.vo';
import { UserId } from '../../../../@core/domain/common-types/identifiers';
import { v4 as uuidv4 } from 'uuid';

// Correction status
export enum CorrectionStatus {
  PROPOSED = 'PROPOSED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  APPLIED = 'APPLIED',
}

// Correction errors
export class CorrectionError extends Data.TaggedError('CorrectionError')<{
  readonly message: string;
}> {}

export class InvalidCorrectionStatusError extends Data.TaggedError(
  'InvalidCorrectionStatusError',
)<{
  readonly currentStatus: CorrectionStatus;
  readonly attemptedAction: string;
}> {}

export class CorrectionNotApprovedError extends Data.TaggedError(
  'CorrectionNotApprovedError',
)<{
  readonly correctionId: CorrectionId;
}> {}

// Correction events
export class CorrectionProposed extends DomainEvent {
  readonly _tag = 'CorrectionProposed';

  constructor(
    readonly data: {
      readonly correctionId: CorrectionId;
      readonly userId: UserId;
      readonly correctionType: CorrectionType;
      readonly adjustments: ReadonlyArray<Adjustment>;
      readonly reason: string;
      readonly proposedBy: UserId;
      readonly proposedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.correctionId,
      timestamp: data.proposedAt,
      version: 1,
    });
  }
}

export class CorrectionReviewed extends DomainEvent {
  readonly _tag = 'CorrectionReviewed';

  constructor(
    readonly data: {
      readonly correctionId: CorrectionId;
      readonly reviewedBy: UserId;
      readonly reviewNotes: string;
      readonly reviewedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.correctionId,
      timestamp: data.reviewedAt,
      version: 1,
    });
  }
}

export class CorrectionApproved extends DomainEvent {
  readonly _tag = 'CorrectionApproved';

  constructor(
    readonly data: {
      readonly correctionId: CorrectionId;
      readonly approvedBy: UserId;
      readonly approvalNotes: Option.Option<string>;
      readonly approvedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.correctionId,
      timestamp: data.approvedAt,
      version: 1,
    });
  }
}

export class CorrectionRejected extends DomainEvent {
  readonly _tag = 'CorrectionRejected';

  constructor(
    readonly data: {
      readonly correctionId: CorrectionId;
      readonly rejectedBy: UserId;
      readonly rejectionReason: string;
      readonly rejectedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.correctionId,
      timestamp: data.rejectedAt,
      version: 1,
    });
  }
}

export class CorrectionApplied extends DomainEvent {
  readonly _tag = 'CorrectionApplied';

  constructor(
    readonly data: {
      readonly correctionId: CorrectionId;
      readonly adjustments: ReadonlyArray<Adjustment>;
      readonly appliedAt: Date;
    },
  ) {
    super({
      eventId: uuidv4(),
      aggregateId: data.correctionId,
      timestamp: data.appliedAt,
      version: 1,
    });
  }
}

// Commands
export interface ProposeCorrectionCommand {
  readonly userId: UserId;
  readonly type: CorrectionType;
  readonly adjustments: ReadonlyArray<Adjustment>;
  readonly reason: string;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly proposedBy: UserId;
}

export interface ReviewCorrectionCommand {
  readonly correctionId: CorrectionId;
  readonly reviewedBy: UserId;
  readonly reviewNotes: string;
}

export interface ApproveCorrectionCommand {
  readonly correctionId: CorrectionId;
  readonly approvedBy: UserId;
  readonly approvalNotes?: string;
}

export interface RejectCorrectionCommand {
  readonly correctionId: CorrectionId;
  readonly rejectedBy: UserId;
  readonly rejectionReason: string;
}

export interface ApplyCorrectionCommand {
  readonly correctionId: CorrectionId;
}

// Correction Aggregate
export class Correction extends EventSourcedAggregate {
  readonly correctionId: Option.Option<CorrectionId>;
  readonly userId: Option.Option<UserId>;
  readonly correctionType: CorrectionType;
  readonly adjustments: ReadonlyArray<Adjustment>;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly status: CorrectionStatus;
  readonly reason: string;
  readonly reviewNotes: Option.Option<string>;

  constructor(data: {
    readonly correctionId: Option.Option<CorrectionId>;
    readonly userId: Option.Option<UserId>;
    readonly correctionType: CorrectionType;
    readonly adjustments: ReadonlyArray<Adjustment>;
    readonly evidence: ReadonlyArray<Evidence>;
    readonly status: CorrectionStatus;
    readonly reason: string;
    readonly reviewNotes: Option.Option<string>;
    readonly version: number;
    readonly events: ReadonlyArray<DomainEvent>;
  }) {
    super({ version: data.version, events: data.events });
    this.correctionId = data.correctionId;
    this.userId = data.userId;
    this.correctionType = data.correctionType;
    this.adjustments = data.adjustments;
    this.evidence = data.evidence;
    this.status = data.status;
    this.reason = data.reason;
    this.reviewNotes = data.reviewNotes;
  }

  protected get aggregateId(): Option.Option<string> {
    return this.correctionId;
  }

  // Create empty correction for reconstruction
  static empty(): Correction {
    return new Correction({
      correctionId: Option.none(),
      userId: Option.none(),
      correctionType: CorrectionType.BALANCE_ADJUSTMENT,
      adjustments: [],
      evidence: [],
      status: CorrectionStatus.PROPOSED,
      reason: '',
      reviewNotes: Option.none(),
      events: [],
      version: 0,
    });
  }

  // The ONLY place where state transitions happen
  apply(event: DomainEvent): Correction {
    switch (event._tag) {
      case 'CorrectionProposed':
        const proposedData = (event as CorrectionProposed).data;
        return this.copy({
          correctionId: Option.some(proposedData.correctionId),
          userId: Option.some(proposedData.userId),
          correctionType: proposedData.correctionType,
          adjustments: proposedData.adjustments,
          evidence: [], // Evidence set separately in the command
          status: CorrectionStatus.PROPOSED,
          reason: proposedData.reason,
          reviewNotes: Option.none(),
          events: [...this.events, event],
        });

      case 'CorrectionReviewed':
        const reviewData = (event as CorrectionReviewed).data;
        return this.copy({
          status: CorrectionStatus.PENDING_REVIEW,
          reviewNotes: Option.some(reviewData.reviewNotes),
          events: [...this.events, event],
        });

      case 'CorrectionApproved':
        return this.copy({
          status: CorrectionStatus.APPROVED,
          events: [...this.events, event],
        });

      case 'CorrectionRejected':
        return this.copy({
          status: CorrectionStatus.REJECTED,
          events: [...this.events, event],
        });

      case 'CorrectionApplied':
        return this.copy({
          status: CorrectionStatus.APPLIED,
          events: [...this.events, event],
        });

      default:
        return this;
    }
  }

  // Propose correction - returns events only
  static propose(
    command: ProposeCorrectionCommand,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, CorrectionError> {
    // Validate adjustments balance (if applicable)
    if (command.type === CorrectionType.BALANCE_ADJUSTMENT) {
      const validation = this.validateBalanceAdjustments(command.adjustments);
      if (Effect.isFailure(validation)) {
        return validation;
      }
    }

    return Effect.succeed(() => {
      const correctionId = CorrectionId.generate();
      const event = new CorrectionProposed({
        correctionId,
        userId: command.userId,
        correctionType: command.type,
        adjustments: command.adjustments,
        reason: command.reason,
        proposedBy: command.proposedBy,
        proposedAt: new Date(),
      });
      return [event];
    })();
  }

  // Review correction - returns events only
  review(
    reviewedBy: UserId,
    reviewNotes: string,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, InvalidCorrectionStatusError> {
    if (this.status !== CorrectionStatus.PROPOSED) {
      return Effect.fail(
        new InvalidCorrectionStatusError({
          currentStatus: this.status,
          attemptedAction: 'review',
        }),
      );
    }

    return Effect.succeed(() => {
      const correctionId = Option.getOrThrow(this.correctionId);
      const event = new CorrectionReviewed({
        correctionId,
        reviewedBy,
        reviewNotes,
        reviewedAt: new Date(),
      });
      return [event];
    })();
  }

  // Approve correction - returns events only
  approve(
    approvedBy: UserId,
    approvalNotes?: string,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, InvalidCorrectionStatusError> {
    if (
      this.status !== CorrectionStatus.PENDING_REVIEW &&
      this.status !== CorrectionStatus.PROPOSED
    ) {
      return Effect.fail(
        new InvalidCorrectionStatusError({
          currentStatus: this.status,
          attemptedAction: 'approve',
        }),
      );
    }

    return Effect.succeed(() => {
      const correctionId = Option.getOrThrow(this.correctionId);
      const event = new CorrectionApproved({
        correctionId,
        approvedBy,
        approvalNotes: Option.fromNullable(approvalNotes),
        approvedAt: new Date(),
      });
      return [event];
    })();
  }

  // Reject correction - returns events only
  reject(
    rejectedBy: UserId,
    rejectionReason: string,
  ): Effect.Effect<ReadonlyArray<DomainEvent>, InvalidCorrectionStatusError> {
    if (
      this.status !== CorrectionStatus.PENDING_REVIEW &&
      this.status !== CorrectionStatus.PROPOSED
    ) {
      return Effect.fail(
        new InvalidCorrectionStatusError({
          currentStatus: this.status,
          attemptedAction: 'reject',
        }),
      );
    }

    return Effect.succeed(() => {
      const correctionId = Option.getOrThrow(this.correctionId);
      const event = new CorrectionRejected({
        correctionId,
        rejectedBy,
        rejectionReason,
        rejectedAt: new Date(),
      });
      return [event];
    })();
  }

  // Apply correction - returns events only
  applyCorrection(): Effect.Effect<
    ReadonlyArray<DomainEvent>,
    CorrectionNotApprovedError
  > {
    if (this.status !== CorrectionStatus.APPROVED) {
      return Effect.fail(
        new CorrectionNotApprovedError({
          correctionId: Option.getOrThrow(this.correctionId),
        }),
      );
    }

    return Effect.succeed(() => {
      const correctionId = Option.getOrThrow(this.correctionId);
      const event = new CorrectionApplied({
        correctionId,
        adjustments: this.adjustments,
        appliedAt: new Date(),
      });
      return [event];
    })();
  }

  // Validation helpers
  private static validateBalanceAdjustments(
    adjustments: ReadonlyArray<Adjustment>,
  ): Effect.Effect<void, CorrectionError> {
    // For balance adjustments, ensure they make sense
    // This is simplified - in production, you'd have more complex validation

    if (adjustments.length === 0) {
      return Effect.fail(
        new CorrectionError({
          message: 'At least one adjustment is required',
        }),
      );
    }

    // Check for duplicate assets
    const assets = new Set<string>();
    for (const adj of adjustments) {
      const assetKey = adj.asset.toString();
      if (assets.has(assetKey)) {
        return Effect.fail(
          new CorrectionError({
            message: `Duplicate adjustment for asset: ${assetKey}`,
          }),
        );
      }
      assets.add(assetKey);
    }

    return Effect.void;
  }
}
```

### 4. Domain Services

```typescript
// packages/contexts/reconciliation/src/core/services/discrepancy-analyzer.service.ts
import { Effect, pipe, ReadonlyArray } from 'effect';
import { Context, Layer } from 'effect';
import {
  BalanceSnapshot,
  Discrepancy,
  DataSource,
} from '../value-objects/reconciliation.vo';
import { AssetId } from '../../trading/domain/value-objects/identifiers.vo';

// Discrepancy analyzer interface
export interface DiscrepancyAnalyzer {
  analyze(
    internalBalances: ReadonlyArray<BalanceSnapshot>,
    externalBalances: ReadonlyArray<BalanceSnapshot>,
  ): Effect.Effect<ReadonlyArray<Discrepancy>, Error>;

  compareSnapshots(
    internal: BalanceSnapshot,
    external: BalanceSnapshot,
  ): Effect.Effect<Option.Option<Discrepancy>, Error>;
}

export const DiscrepancyAnalyzer = Context.GenericTag<DiscrepancyAnalyzer>(
  'DiscrepancyAnalyzer',
);

// Implementation
export class StandardDiscrepancyAnalyzer implements DiscrepancyAnalyzer {
  analyze(
    internalBalances: ReadonlyArray<BalanceSnapshot>,
    externalBalances: ReadonlyArray<BalanceSnapshot>,
  ): Effect.Effect<ReadonlyArray<Discrepancy>, Error> {
    return Effect.sync(() => {
      const discrepancies: Discrepancy[] = [];

      // Create maps for efficient lookup
      const internalMap = new Map(
        internalBalances.map((b) => [b.asset.toString(), b]),
      );
      const externalMap = new Map(
        externalBalances.map((b) => [b.asset.toString(), b]),
      );

      // Check all internal balances against external
      for (const [assetKey, internalBalance] of internalMap) {
        const externalBalance = externalMap.get(assetKey);

        if (!externalBalance) {
          // Asset exists internally but not externally
          const discrepancy = Discrepancy.calculate(
            internalBalance,
            new BalanceSnapshot({
              asset: internalBalance.asset,
              quantity: Quantity.zero(),
              value: Option.none(),
              source: DataSource.MANUAL,
              timestamp: new Date(),
              blockHeight: Option.none(),
              metadata: {},
            }),
          );

          Effect.match(discrepancy, {
            onFailure: () => {},
            onSuccess: (d) => discrepancies.push(d),
          });
        } else {
          // Both exist, compare them
          const discrepancy = Discrepancy.calculate(
            internalBalance,
            externalBalance,
          );

          Effect.match(discrepancy, {
            onFailure: () => {},
            onSuccess: (d) => {
              if (d.severity !== 'NEGLIGIBLE') {
                discrepancies.push(d);
              }
            },
          });
        }
      }

      // Check for assets that exist externally but not internally
      for (const [assetKey, externalBalance] of externalMap) {
        if (!internalMap.has(assetKey)) {
          const discrepancy = Discrepancy.calculate(
            new BalanceSnapshot({
              asset: externalBalance.asset,
              quantity: Quantity.zero(),
              value: Option.none(),
              source: DataSource.MANUAL,
              timestamp: new Date(),
              blockHeight: Option.none(),
              metadata: {},
            }),
            externalBalance,
          );

          Effect.match(discrepancy, {
            onFailure: () => {},
            onSuccess: (d) => discrepancies.push(d),
          });
        }
      }

      return discrepancies;
    });
  }

  compareSnapshots(
    internal: BalanceSnapshot,
    external: BalanceSnapshot,
  ): Effect.Effect<Option.Option<Discrepancy>, Error> {
    if (!internal.asset.equals(external.asset)) {
      return Effect.succeed(Option.none());
    }

    return pipe(
      Discrepancy.calculate(internal, external),
      Effect.map((d) =>
        d.severity === 'NEGLIGIBLE' ? Option.none() : Option.some(d),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );
  }
}

// Layer
export const StandardDiscrepancyAnalyzerLayer = Layer.succeed(
  DiscrepancyAnalyzer,
  new StandardDiscrepancyAnalyzer(),
);
```

```typescript
// packages/contexts/reconciliation/src/core/services/balance-fetcher.service.ts
import { Effect, pipe, ReadonlyArray } from 'effect';
import { Context, Layer } from 'effect';
import {
  BalanceSnapshot,
  DataSource,
} from '../value-objects/reconciliation.vo';
import { UserId } from '../../trading/domain/value-objects/identifiers.vo';
import { Data } from 'effect';

// Balance fetcher errors
export class ExternalFetchError extends Data.TaggedError('ExternalFetchError')<{
  readonly source: DataSource;
  readonly reason: string;
}> {}

export class ConnectionError extends Data.TaggedError('ConnectionError')<{
  readonly source: DataSource;
  readonly details: string;
}> {}

// External balance fetcher interface
export interface ExternalBalanceFetcher {
  fetchBalances(
    userId: UserId,
    source: DataSource,
  ): Effect.Effect<
    ReadonlyArray<BalanceSnapshot>,
    ExternalFetchError | ConnectionError
  >;

  fetchAllSources(
    userId: UserId,
    sources: ReadonlyArray<DataSource>,
  ): Effect.Effect<
    Map<DataSource, ReadonlyArray<BalanceSnapshot>>,
    ExternalFetchError
  >;
}

export const ExternalBalanceFetcher =
  Context.GenericTag<ExternalBalanceFetcher>('ExternalBalanceFetcher');

// Composite fetcher implementation
export class CompositeBalanceFetcher implements ExternalBalanceFetcher {
  constructor(private fetchers: Map<DataSource, SourceSpecificFetcher>) {}

  fetchBalances(
    userId: UserId,
    source: DataSource,
  ): Effect.Effect<
    ReadonlyArray<BalanceSnapshot>,
    ExternalFetchError | ConnectionError
  > {
    const fetcher = this.fetchers.get(source);

    if (!fetcher) {
      return Effect.fail(
        new ExternalFetchError({
          source,
          reason: `No fetcher configured for source: ${source}`,
        }),
      );
    }

    return fetcher.fetch(userId);
  }

  fetchAllSources(
    userId: UserId,
    sources: ReadonlyArray<DataSource>,
  ): Effect.Effect<
    Map<DataSource, ReadonlyArray<BalanceSnapshot>>,
    ExternalFetchError
  > {
    return Effect.forEach(
      sources,
      (source) =>
        pipe(
          this.fetchBalances(userId, source),
          Effect.map((balances) => ({ source, balances })),
          Effect.orElseSucceed(() => ({ source, balances: [] })),
        ),
      { concurrency: 3 }, // Parallel fetching with limit
    ).pipe(
      Effect.map(
        (results) => new Map(results.map((r) => [r.source, r.balances])),
      ),
    );
  }
}

// Source-specific fetcher interface
interface SourceSpecificFetcher {
  fetch(
    userId: UserId,
  ): Effect.Effect<
    ReadonlyArray<BalanceSnapshot>,
    ExternalFetchError | ConnectionError
  >;
}
```

### 5. Application Layer

```typescript
// packages/contexts/reconciliation/src/application/commands/initiate-reconciliation.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Data } from 'effect';
import {
  Reconciliation,
  InitiateReconciliationCommand,
} from '../../domain/aggregates/reconciliation.aggregate';
import { ReconciliationRepository } from '../../infrastructure/repositories/reconciliation.repository';
import { ReconciliationSaga } from '../sagas/reconciliation.saga';

// Event publishing error
export class PublishEventError extends Data.TaggedError('PublishEventError')<{
  readonly eventType: string;
  readonly message: string;
}> {}

// Saga error
export class SagaError extends Data.TaggedError('SagaError')<{
  readonly message: string;
}> {}

@Injectable()
@CommandHandler(InitiateReconciliationCommand)
export class InitiateReconciliationHandler
  implements ICommandHandler<InitiateReconciliationCommand>
{
  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly eventBus: EventBus,
    private readonly saga: ReconciliationSaga,
  ) {}

  async execute(command: InitiateReconciliationCommand): Promise<void> {
    // Single, unbroken pipeline from start to finish
    const program = pipe(
      // 1. Create the event(s) using pure domain logic
      Reconciliation.initiate(command),

      // 2. Build the initial state from the event(s)
      Effect.map((events) => {
        const reconciliation = events.reduce(
          (acc, event) => acc.apply(event),
          Reconciliation.empty(),
        );
        return { reconciliation, events };
      }),

      // 3. Save the new aggregate (which saves the events)
      Effect.flatMap(({ reconciliation, events }) =>
        pipe(
          this.repository.save(reconciliation),
          Effect.map(() => ({ reconciliation, events })),
        ),
      ),

      // 4. Publish events after successful save
      Effect.tap(({ events }) =>
        Effect.forEach(
          events,
          (event) =>
            Effect.tryPromise({
              try: () => this.eventBus.publish(event),
              catch: (e) =>
                new PublishEventError({
                  eventType: event._tag,
                  message: `Failed to publish event: ${e}`,
                }),
            }),
          { concurrency: 'unbounded' },
        ),
      ),

      // 5. Start saga after successful save and event publishing
      Effect.tap(({ reconciliation }) => {
        const reconciliationId = reconciliation.reconciliationId;
        if (reconciliationId._tag === 'Some') {
          return Effect.tryPromise({
            try: () =>
              this.saga.execute({
                reconciliationId: reconciliationId.value,
                userId: command.userId,
                sources: command.sources,
              }),
            catch: (e) => new SagaError({ message: `${e}` }),
          });
        }
        return Effect.void;
      }),
    );

    // Run the entire program and handle the final exit state
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // The cause contains the specific, typed error from anywhere in the pipeline
      const error =
        exit.cause._tag === 'Fail'
          ? exit.cause.error
          : new Error('Unknown error');
      // Re-throw the original typed error - it will be caught by the Exception Filter
      throw error;
    }
  }
}
```

```typescript
// packages/contexts/reconciliation/src/application/sagas/reconciliation.saga.ts
import { Injectable } from '@nestjs/common';
import { Effect, pipe, ReadonlyArray } from 'effect';
import { ReconciliationRepository } from '../../infrastructure/repositories/reconciliation.repository';
import { ExternalBalanceFetcher } from '../../domain/services/balance-fetcher.service';
import { DiscrepancyAnalyzer } from '../../domain/services/discrepancy-analyzer.service';
import { InternalBalanceService } from '../services/internal-balance.service';
import { DataSource } from '../../domain/value-objects/reconciliation.vo';

export interface ReconciliationContext {
  reconciliationId: string;
  userId: string;
  sources: ReadonlyArray<DataSource>;
}

@Injectable()
export class ReconciliationSaga {
  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly externalFetcher: ExternalBalanceFetcher,
    private readonly internalBalanceService: InternalBalanceService,
    private readonly discrepancyAnalyzer: DiscrepancyAnalyzer,
  ) {}

  async execute(context: ReconciliationContext): Promise<void> {
    const program = pipe(
      // Step 1: Fetch internal balances
      Effect.tryPromise({
        try: () =>
          this.internalBalanceService.getCurrentBalances(context.userId),
        catch: (error) =>
          new Error(`Failed to fetch internal balances: ${error}`),
      }),
      Effect.flatMap((internalBalances) => {
        // Step 2: Fetch external balances from all sources
        return pipe(
          this.externalFetcher.fetchAllSources(context.userId, context.sources),
          Effect.map((externalBalances) => ({
            internalBalances,
            externalBalances,
          })),
        );
      }),
      Effect.flatMap(({ internalBalances, externalBalances }) => {
        // Step 3: Analyze discrepancies for each source
        const allDiscrepancies: Discrepancy[] = [];

        return Effect.forEach(
          context.sources,
          (source) => {
            const sourceBalances = externalBalances.get(source) || [];
            return pipe(
              this.discrepancyAnalyzer.analyze(
                internalBalances,
                sourceBalances,
              ),
              Effect.tap((discrepancies) => {
                allDiscrepancies.push(...discrepancies);
              }),
            );
          },
          { concurrency: 1 },
        ).pipe(Effect.map(() => allDiscrepancies));
      }),
      Effect.flatMap((discrepancies) => {
        // Step 4: Record discrepancies in reconciliation
        return this.recordDiscrepancies(
          context.reconciliationId,
          discrepancies,
        );
      }),
      Effect.flatMap(() => {
        // Step 5: Auto-resolve minor discrepancies
        return this.autoResolveMinor(context.reconciliationId);
      }),
      Effect.flatMap(() => {
        // Step 6: Check if manual review is needed
        return this.checkManualReviewRequired(context.reconciliationId);
      }),
    );

    await Effect.runPromise(program);
  }

  private recordDiscrepancies(
    reconciliationId: string,
    discrepancies: ReadonlyArray<Discrepancy>,
  ): Effect.Effect<void, any> {
    return pipe(
      this.repository.load(reconciliationId),
      Effect.flatMap((reconciliation) =>
        Effect.forEach(
          discrepancies,
          (discrepancy) =>
            pipe(
              reconciliation.recordDiscrepancy(discrepancy),
              Effect.map((events) =>
                events.reduce((acc, event) => acc.apply(event), reconciliation),
              ),
              Effect.flatMap((updatedReconciliation) =>
                this.repository.save(updatedReconciliation),
              ),
            ),
          { concurrency: 1 },
        ),
      ),
      Effect.asVoid,
    );
  }

  private autoResolveMinor(reconciliationId: string): Effect.Effect<void, any> {
    return pipe(
      this.repository.load(reconciliationId),
      Effect.flatMap((reconciliation) =>
        pipe(
          reconciliation.autoResolveMinorDiscrepancies(),
          Effect.map((events) =>
            events.reduce((acc, event) => acc.apply(event), reconciliation),
          ),
          Effect.flatMap((updatedReconciliation) =>
            this.repository.save(updatedReconciliation),
          ),
        ),
      ),
    );
  }

  private checkManualReviewRequired(
    reconciliationId: string,
  ): Effect.Effect<void, any> {
    return pipe(
      this.repository.load(reconciliationId),
      Effect.flatMap((reconciliation) =>
        reconciliation.requiresManualReview()
          ? Effect.sync(() => {
              // Send notification for manual review
              console.log(
                `Reconciliation ${reconciliationId} requires manual review`,
              );
            })
          : pipe(
              reconciliation.complete(),
              Effect.map((events) =>
                events.reduce((acc, event) => acc.apply(event), reconciliation),
              ),
              Effect.flatMap((completedReconciliation) =>
                this.repository.save(completedReconciliation),
              ),
              Effect.orElse(() => Effect.void), // Ignore completion errors
            ),
      ),
    );
  }
}
```

### 6. Infrastructure Layer

```typescript
// packages/contexts/reconciliation/src/infrastructure/repositories/reconciliation.repository.ts
import { Injectable } from '@nestjs/common';
import { EventStore } from '../../../../infrastructure/event-store/event-store.service';
import {
  Reconciliation,
  ReconciliationStatus,
} from '../../domain/aggregates/reconciliation.aggregate';
import { ReconciliationId } from '../../domain/value-objects/reconciliation.vo';
import { Option, Effect, pipe, Data } from 'effect';
import { Knex } from 'knex';
import { InjectConnection } from 'nest-knexjs';

// Repository-specific errors
export class LoadReconciliationError extends Data.TaggedError(
  'LoadReconciliationError',
)<{
  readonly reconciliationId: ReconciliationId;
  readonly message: string;
}> {}

export class SaveReconciliationError extends Data.TaggedError(
  'SaveReconciliationError',
)<{
  readonly reconciliationId?: ReconciliationId;
  readonly message: string;
}> {}

@Injectable()
export class ReconciliationRepository {
  constructor(
    private readonly eventStore: EventStore,
    @InjectConnection() private readonly knex: Knex,
  ) {}

  load(
    reconciliationId: ReconciliationId,
  ): Effect.Effect<Reconciliation, LoadReconciliationError> {
    return pipe(
      Effect.tryPromise({
        try: () => this.eventStore.readStream(reconciliationId),
        catch: (error) =>
          new LoadReconciliationError({
            reconciliationId,
            message: `Failed to read event stream: ${error}`,
          }),
      }),
      Effect.map((events) =>
        events.reduce(
          (aggregate, event) => aggregate.apply(event),
          Reconciliation.empty(),
        ),
      ),
    );
  }

  save(
    reconciliation: Reconciliation,
  ): Effect.Effect<void, SaveReconciliationError> {
    const uncommittedEvents = reconciliation.getUncommittedEvents();

    if (uncommittedEvents.length === 0) {
      return Effect.void;
    }

    return pipe(
      reconciliation.reconciliationId,
      Effect.fromOption(
        () =>
          new SaveReconciliationError({
            message: 'Reconciliation ID is missing for save operation',
          }),
      ),
      Effect.flatMap((reconciliationId) =>
        Effect.tryPromise({
          try: () =>
            this.eventStore.append(
              reconciliationId,
              uncommittedEvents,
              reconciliation.version,
            ),
          catch: (error) =>
            new SaveReconciliationError({
              reconciliationId,
              message: `Failed to save events: ${error}`,
            }),
        }),
      ),
    );
  }

  findActiveByUser(
    userId: string,
  ): Effect.Effect<ReadonlyArray<Reconciliation>, LoadReconciliationError> {
    return pipe(
      Effect.tryPromise({
        try: () =>
          this.knex('reconciliation_projections')
            .where('user_id', userId)
            .whereIn('status', ['INITIATED', 'IN_PROGRESS', 'PENDING_REVIEW'])
            .orderBy('started_at', 'desc'),
        catch: (error) =>
          new LoadReconciliationError({
            reconciliationId: '' as ReconciliationId,
            message: `Failed to query active reconciliations: ${error}`,
          }),
      }),
      Effect.flatMap((results) =>
        Effect.forEach(
          results,
          (result) => this.load(result.reconciliation_id),
          { concurrency: 'unbounded' },
        ),
      ),
    );
  }
}
```

### 7. Module Configuration

```typescript
// packages/contexts/reconciliation/src/reconciliation.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { InitiateReconciliationHandler } from './application/commands/initiate-reconciliation.handler';
import { ProposeCorrectionHandler } from './application/commands/propose-correction.handler';
import { ReconciliationRepository } from './infrastructure/repositories/reconciliation.repository';
import { CorrectionRepository } from './infrastructure/repositories/correction.repository';
import { ReconciliationSaga } from './application/sagas/reconciliation.saga';
import { StandardDiscrepancyAnalyzer } from './domain/services/discrepancy-analyzer.service';
import { CompositeBalanceFetcher } from './domain/services/balance-fetcher.service';
import { InternalBalanceService } from './application/services/internal-balance.service';
import { ReconciliationController } from './api/reconciliation.controller';
import { EventStoreModule } from '../../infrastructure/event-store/event-store.module';
import { BinanceFetcher } from './infrastructure/fetchers/binance.fetcher';
import { CoinbaseFetcher } from './infrastructure/fetchers/coinbase.fetcher';
import { EthereumFetcher } from './infrastructure/fetchers/ethereum.fetcher';

// Command handlers
const CommandHandlers = [
  InitiateReconciliationHandler,
  ProposeCorrectionHandler,
];

// Sagas
const Sagas = [ReconciliationSaga];

// Domain services
const DomainServices = [
  {
    provide: 'DiscrepancyAnalyzer',
    useClass: StandardDiscrepancyAnalyzer,
  },
  {
    provide: 'ExternalBalanceFetcher',
    useFactory: (
      binance: BinanceFetcher,
      coinbase: CoinbaseFetcher,
      ethereum: EthereumFetcher,
    ) => {
      const fetchers = new Map();
      fetchers.set('BINANCE', binance);
      fetchers.set('COINBASE', coinbase);
      fetchers.set('ETHEREUM', ethereum);
      return new CompositeBalanceFetcher(fetchers);
    },
    inject: [BinanceFetcher, CoinbaseFetcher, EthereumFetcher],
  },
];

// Infrastructure services
const InfrastructureServices = [
  BinanceFetcher,
  CoinbaseFetcher,
  EthereumFetcher,
  InternalBalanceService,
];

@Module({
  imports: [CqrsModule, EventStoreModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationRepository,
    CorrectionRepository,
    ...CommandHandlers,
    ...Sagas,
    ...DomainServices,
    ...InfrastructureServices,
  ],
  exports: [ReconciliationRepository, CorrectionRepository],
})
export class ReconciliationModule {}
```

### 8. API Controller

`````typescript
// packages/contexts/reconciliation/src/api/reconciliation.controller.ts
import { Controller, Post, Get, Put, Body, Param, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  InitiateReconciliationCommand,
  ResolveDiscrepancyCommand
} from '../domain/aggregates/reconciliation.aggregate';
import {
  ProposeCorrectionCommand,
  ApproveCorrectionCommand,
  RejectCorrectionCommand
} from '../domain/aggregates/correction.aggregate';
import { UserId } from '../../trading/domain/value-objects/identifiers.vo';
import { DataSource } from '../domain/value-objects/reconciliation.vo';

@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  ### 8. API Controller (continued)

````typescript
// packages/contexts/reconciliation/src/api/reconciliation.controller.ts (continued)
  @Post('initiate')
  @ApiOperation({ summary: 'Initiate a new reconciliation session' })
  async initiateReconciliation(@Body() dto: InitiateReconciliationDto) {
    const command: InitiateReconciliationCommand = {
      userId: UserId(dto.userId),
      sources: dto.sources as DataSource[]
    };

    await this.commandBus.execute(command);

    return {
      success: true,
      message: 'Reconciliation initiated successfully'
    };
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active reconciliation sessions' })
  async getActiveReconciliations() {
    const query = new GetActiveReconciliationsQuery(
      UserId('current-user') // From auth context
    );

    return this.queryBus.execute(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reconciliation details' })
  async getReconciliation(@Param('id') reconciliationId: string) {
    const query = new GetReconciliationDetailsQuery(
      ReconciliationId(reconciliationId)
    );

    return this.queryBus.execute(query);
  }

  @Put(':id/discrepancies/:discrepancyId/resolve')
  @ApiOperation({ summary: 'Resolve a discrepancy' })
  async resolveDiscrepancy(
    @Param('id') reconciliationId: string,
    @Param('discrepancyId') discrepancyId: string,
    @Body() dto: ResolveDiscrepancyDto
  ) {
    const resolution = new Resolution({
      discrepancyId: DiscrepancyId(discrepancyId),
      type: dto.type as ResolutionType,
      adjustment: dto.adjustment
        ? Option.some(new Adjustment({
            type: dto.adjustment.type as 'INCREASE' | 'DECREASE',
            asset: AssetId.crypto(dto.adjustment.asset, dto.adjustment.blockchain || 'ethereum'),
            quantity: await Effect.runPromise(Quantity.of(dto.adjustment.quantity)),
            value: Option.none(),
            reason: dto.adjustment.reason,
            source: dto.adjustment.source as DataSource,
            effectiveDate: new Date(dto.adjustment.effectiveDate)
          }))
        : Option.none(),
      notes: dto.notes,
      resolvedBy: 'current-user',
      resolvedAt: new Date(),
      requiresApproval: dto.requiresApproval || false,
      approvedBy: Option.none(),
      approvedAt: Option.none()
    });

    const command: ResolveDiscrepancyCommand = {
      reconciliationId: ReconciliationId(reconciliationId),
      discrepancyId: DiscrepancyId(discrepancyId),
      resolution
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete reconciliation session' })
  async completeReconciliation(@Param('id') reconciliationId: string) {
    const command: CompleteReconciliationCommand = {
      reconciliationId: ReconciliationId(reconciliationId)
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Post('corrections')
  @ApiOperation({ summary: 'Propose a correction' })
  async proposeCorrection(@Body() dto: ProposeCorrectionDto) {
    const adjustments = dto.adjustments.map(adj =>
      new Adjustment({
        type: adj.type as 'INCREASE' | 'DECREASE',
        asset: AssetId.crypto(adj.asset, adj.blockchain || 'ethereum'),
        quantity: Effect.runSync(Quantity.of(adj.quantity)),
        value: adj.value
          ? Option.some(Effect.runSync(Money.of(adj.value.amount, Currency({
              symbol: adj.value.currency,
              decimals: adj.value.decimals || 2,
              name: adj.value.currencyName || 'USD'
            }))))
          : Option.none(),
        reason: adj.reason,
        source: adj.source as DataSource,
        effectiveDate: new Date(adj.effectiveDate)
      })
    );

    const evidence = dto.evidence?.map(e =>
      new Evidence({
        type: e.type as any,
        description: e.description,
        url: Option.fromNullable(e.url),
        hash: Option.fromNullable(e.hash),
        timestamp: new Date(e.timestamp || Date.now())
      })
    ) || [];

    const command: ProposeCorrectionCommand = {
      userId: UserId(dto.userId),
      type: dto.type as CorrectionType,
      adjustments,
      reason: dto.reason,
      evidence,
      proposedBy: UserId('current-user')
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Put('corrections/:id/approve')
  @ApiOperation({ summary: 'Approve a correction' })
  async approveCorrection(
    @Param('id') correctionId: string,
    @Body() dto: ApproveCorrectionDto
  ) {
    const command: ApproveCorrectionCommand = {
      correctionId: CorrectionId(correctionId),
      approvedBy: UserId('current-user'),
      approvalNotes: dto.notes
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Put('corrections/:id/reject')
  @ApiOperation({ summary: 'Reject a correction' })
  async rejectCorrection(
    @Param('id') correctionId: string,
    @Body() dto: RejectCorrectionDto
  ) {
    const command: RejectCorrectionCommand = {
      correctionId: CorrectionId(correctionId),
      rejectedBy: UserId('current-user'),
      rejectionReason: dto.reason
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Post('corrections/:id/apply')
  @ApiOperation({ summary: 'Apply an approved correction' })
  async applyCorrection(@Param('id') correctionId: string) {
    const command: ApplyCorrectionCommand = {
      correctionId: CorrectionId(correctionId)
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Get('discrepancies')
  @ApiOperation({ summary: 'Get all discrepancies' })
  @ApiQuery({ name: 'severity', enum: ['NEGLIGIBLE', 'MINOR', 'WARNING', 'CRITICAL'], required: false })
  @ApiQuery({ name: 'resolved', type: Boolean, required: false })
  @ApiQuery({ name: 'asset', required: false })
  async getDiscrepancies(
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: boolean,
    @Query('asset') asset?: string
  ) {
    const query = new GetDiscrepanciesQuery({
      userId: UserId('current-user'),
      severity: severity as DiscrepancySeverity,
      resolved,
      asset
    });

    return this.queryBus.execute(query);
  }

  @Get('summary/dashboard')
  @ApiOperation({ summary: 'Get reconciliation dashboard summary' })
  async getDashboardSummary() {
    const query = new GetReconciliationDashboardQuery(
      UserId('current-user')
    );

    return this.queryBus.execute(query);
  }
}
`````

### 9. Query Handlers

```typescript
// packages/contexts/reconciliation/src/application/queries/get-reconciliation-details.query.ts
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { ReconciliationId } from '../../domain/value-objects/reconciliation.vo';

export class GetReconciliationDetailsQuery {
  constructor(readonly reconciliationId: ReconciliationId) {}
}

@QueryHandler(GetReconciliationDetailsQuery)
export class GetReconciliationDetailsHandler
  implements IQueryHandler<GetReconciliationDetailsQuery>
{
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async execute(query: GetReconciliationDetailsQuery): Promise<any> {
    const reconciliation = await this.knex('reconciliation_projections')
      .where('reconciliation_id', query.reconciliationId)
      .first();

    if (!reconciliation) {
      return null;
    }

    // Get discrepancies
    const discrepancies = await this.knex('discrepancy_projections')
      .where('reconciliation_id', query.reconciliationId)
      .orderBy('severity_order', 'asc')
      .orderBy('detected_at', 'desc');

    // Get resolutions
    const resolutions = await this.knex('resolution_projections').whereIn(
      'discrepancy_id',
      discrepancies.map((d) => d.discrepancy_id),
    );

    // Map resolutions to discrepancies
    const resolutionMap = new Map(
      resolutions.map((r) => [r.discrepancy_id, r]),
    );

    const enrichedDiscrepancies = discrepancies.map((d) => ({
      ...d,
      resolution: resolutionMap.get(d.discrepancy_id) || null,
    }));

    return {
      ...reconciliation,
      discrepancies: enrichedDiscrepancies,
      progress: this.calculateProgress(enrichedDiscrepancies),
      summary: {
        totalDiscrepancies: discrepancies.length,
        resolved: discrepancies.filter((d) => d.is_resolved).length,
        pending: discrepancies.filter((d) => !d.is_resolved).length,
        bySeverity: {
          critical: discrepancies.filter((d) => d.severity === 'CRITICAL')
            .length,
          warning: discrepancies.filter((d) => d.severity === 'WARNING').length,
          minor: discrepancies.filter((d) => d.severity === 'MINOR').length,
          negligible: discrepancies.filter((d) => d.severity === 'NEGLIGIBLE')
            .length,
        },
      },
    };
  }

  private calculateProgress(discrepancies: any[]): number {
    if (discrepancies.length === 0) return 100;
    const resolved = discrepancies.filter((d) => d.is_resolved).length;
    return Math.round((resolved / discrepancies.length) * 100);
  }
}
```

```typescript
// packages/contexts/reconciliation/src/application/queries/get-reconciliation-dashboard.query.ts
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { UserId } from '../../../trading/domain/value-objects/identifiers.vo';

export class GetReconciliationDashboardQuery {
  constructor(readonly userId: UserId) {}
}

@QueryHandler(GetReconciliationDashboardQuery)
export class GetReconciliationDashboardHandler
  implements IQueryHandler<GetReconciliationDashboardQuery>
{
  constructor(@InjectConnection() private readonly knex: Knex) {}

  async execute(query: GetReconciliationDashboardQuery): Promise<any> {
    // Get recent reconciliations
    const recentReconciliations = await this.knex('reconciliation_projections')
      .where('user_id', query.userId)
      .orderBy('started_at', 'desc')
      .limit(10);

    // Get unresolved discrepancies
    const unresolvedDiscrepancies = await this.knex(
      'discrepancy_projections as d',
    )
      .join(
        'reconciliation_projections as r',
        'd.reconciliation_id',
        'r.reconciliation_id',
      )
      .where('r.user_id', query.userId)
      .where('d.is_resolved', false)
      .select('d.*', 'r.started_at as reconciliation_date')
      .orderBy('d.severity_order', 'asc')
      .limit(20);

    // Get pending corrections
    const pendingCorrections = await this.knex('correction_projections')
      .where('user_id', query.userId)
      .whereIn('status', ['PROPOSED', 'PENDING_REVIEW', 'APPROVED'])
      .orderBy('proposed_at', 'desc');

    // Calculate statistics
    const stats = await this.knex('discrepancy_projections as d')
      .join(
        'reconciliation_projections as r',
        'd.reconciliation_id',
        'r.reconciliation_id',
      )
      .where('r.user_id', query.userId)
      .where('r.started_at', '>=', this.knex.raw("NOW() - INTERVAL '30 days'"))
      .select(
        this.knex.raw('COUNT(*) as total_discrepancies'),
        this.knex.raw(
          'COUNT(CASE WHEN d.is_resolved THEN 1 END) as resolved_count',
        ),
        this.knex.raw(
          'COUNT(CASE WHEN d.severity = ? THEN 1 END) as critical_count',
          ['CRITICAL'],
        ),
        this.knex.raw(
          'AVG(CASE WHEN d.is_resolved THEN d.resolution_time_hours END) as avg_resolution_time',
        ),
      )
      .first();

    // Get reconciliation trends (last 30 days)
    const trends = await this.knex('reconciliation_projections')
      .where('user_id', query.userId)
      .where('started_at', '>=', this.knex.raw("NOW() - INTERVAL '30 days'"))
      .select(
        this.knex.raw('DATE(started_at) as date'),
        this.knex.raw('COUNT(*) as reconciliation_count'),
        this.knex.raw('AVG(total_discrepancies) as avg_discrepancies'),
      )
      .groupBy(this.knex.raw('DATE(started_at)'))
      .orderBy('date', 'asc');

    // Get asset health scores
    const assetHealth = await this.knex('discrepancy_projections as d')
      .join(
        'reconciliation_projections as r',
        'd.reconciliation_id',
        'r.reconciliation_id',
      )
      .where('r.user_id', query.userId)
      .where('r.started_at', '>=', this.knex.raw("NOW() - INTERVAL '7 days'"))
      .select(
        'd.asset_id',
        this.knex.raw('COUNT(*) as discrepancy_count'),
        this.knex.raw('AVG(d.percentage_diff) as avg_discrepancy_percentage'),
        this.knex.raw('MAX(d.severity_order) as max_severity'),
      )
      .groupBy('d.asset_id')
      .orderBy('discrepancy_count', 'desc')
      .limit(10);

    return {
      recentReconciliations,
      unresolvedDiscrepancies,
      pendingCorrections,
      statistics: {
        ...stats,
        resolutionRate:
          stats.total_discrepancies > 0
            ? (stats.resolved_count / stats.total_discrepancies) * 100
            : 100,
        healthScore: this.calculateHealthScore(stats),
      },
      trends,
      assetHealth: assetHealth.map((a) => ({
        ...a,
        healthScore: this.calculateAssetHealthScore(a),
      })),
    };
  }

  private calculateHealthScore(stats: any): number {
    // Simple health score calculation
    let score = 100;

    // Deduct for unresolved discrepancies
    const unresolvedRate =
      (stats.total_discrepancies - stats.resolved_count) /
      Math.max(stats.total_discrepancies, 1);
    score -= unresolvedRate * 30;

    // Deduct for critical issues
    score -= stats.critical_count * 10;

    // Bonus for quick resolution time (under 2 hours)
    if (stats.avg_resolution_time && stats.avg_resolution_time < 2) {
      score += 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateAssetHealthScore(assetData: any): number {
    let score = 100;

    // Deduct based on discrepancy count
    score -= Math.min(30, assetData.discrepancy_count * 5);

    // Deduct based on average discrepancy percentage
    score -= Math.min(40, assetData.avg_discrepancy_percentage * 10);

    // Deduct based on max severity
    const severityPenalty = {
      1: 30, // CRITICAL
      2: 20, // WARNING
      3: 10, // MINOR
      4: 0, // NEGLIGIBLE
    };
    score -= severityPenalty[assetData.max_severity] || 0;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
```

### 10. Database Migrations

```typescript
// packages/contexts/reconciliation/src/infrastructure/migrations/001_create_reconciliation_tables.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Reconciliation projections table
  await knex.schema.createTable('reconciliation_projections', (table) => {
    table.uuid('reconciliation_id').primary();
    table.uuid('user_id').notNullable();
    table.specificType('sources', 'text[]').notNullable();
    table
      .enum('status', [
        'INITIATED',
        'FETCHING',
        'COMPARING',
        'IN_PROGRESS',
        'PENDING_REVIEW',
        'COMPLETED',
        'FAILED',
      ])
      .notNullable();
    table.integer('total_assets').defaultTo(0);
    table.integer('total_discrepancies').defaultTo(0);
    table.integer('resolved_discrepancies').defaultTo(0);
    table.integer('critical_count').defaultTo(0);
    table.integer('warning_count').defaultTo(0);
    table.integer('minor_count').defaultTo(0);
    table.timestamp('started_at').notNullable();
    table.timestamp('completed_at');
    table.integer('duration_ms');

    table.index(['user_id', 'status']);
    table.index(['started_at']);
  });

  // Discrepancy projections table
  await knex.schema.createTable('discrepancy_projections', (table) => {
    table.uuid('discrepancy_id').primary();
    table.uuid('reconciliation_id').notNullable();
    table.string('asset_id').notNullable();
    table.decimal('internal_quantity', 30, 18).notNullable();
    table.decimal('external_quantity', 30, 18).notNullable();
    table.decimal('difference_quantity', 30, 18).notNullable();
    table.decimal('percentage_diff', 10, 6).notNullable();
    table
      .enum('severity', ['NEGLIGIBLE', 'MINOR', 'WARNING', 'CRITICAL'])
      .notNullable();
    table.integer('severity_order').notNullable(); // For sorting
    table.specificType('possible_causes', 'text[]');
    table.boolean('is_resolved').defaultTo(false);
    table.timestamp('detected_at').notNullable();
    table.timestamp('resolved_at');
    table.decimal('resolution_time_hours', 10, 2);

    table.index(['reconciliation_id']);
    table.index(['asset_id']);
    table.index(['severity']);
    table.index(['is_resolved']);
  });

  // Resolution projections table
  await knex.schema.createTable('resolution_projections', (table) => {
    table
      .uuid('resolution_id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('discrepancy_id').notNullable();
    table
      .enum('type', [
        'AUTO',
        'MANUAL',
        'ADJUST_INTERNAL',
        'ADJUST_EXTERNAL',
        'IGNORE',
        'INVESTIGATE',
      ])
      .notNullable();
    table.text('notes').notNullable();
    table.string('resolved_by').notNullable();
    table.timestamp('resolved_at').notNullable();
    table.boolean('requires_approval').defaultTo(false);
    table.string('approved_by');
    table.timestamp('approved_at');

    table.index(['discrepancy_id']);
    table.index(['type']);
  });

  // Adjustment projections table
  await knex.schema.createTable('adjustment_projections', (table) => {
    table
      .uuid('adjustment_id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('resolution_id');
    table.uuid('correction_id');
    table.enum('type', ['INCREASE', 'DECREASE']).notNullable();
    table.string('asset_id').notNullable();
    table.decimal('quantity', 30, 18).notNullable();
    table.decimal('value', 20, 2);
    table.string('value_currency', 10);
    table.text('reason').notNullable();
    table.string('source').notNullable();
    table.timestamp('effective_date').notNullable();
    table.timestamp('created_at').notNullable();

    table.index(['resolution_id']);
    table.index(['correction_id']);
    table.index(['asset_id']);
  });

  // Correction projections table
  await knex.schema.createTable('correction_projections', (table) => {
    table.uuid('correction_id').primary();
    table.uuid('user_id').notNullable();
    table
      .enum('correction_type', [
        'BALANCE_ADJUSTMENT',
        'MISSING_TRANSACTION',
        'DUPLICATE_TRANSACTION',
        'INCORRECT_CLASSIFICATION',
        'FEE_ADJUSTMENT',
        'ROUNDING_ERROR',
      ])
      .notNullable();
    table.text('description').notNullable();
    table
      .enum('status', [
        'PROPOSED',
        'PENDING_REVIEW',
        'APPROVED',
        'REJECTED',
        'APPLIED',
      ])
      .notNullable();
    table.string('proposed_by').notNullable();
    table.timestamp('proposed_at').notNullable();
    table.string('reviewed_by');
    table.text('review_notes');
    table.timestamp('reviewed_at');
    table.string('approved_by');
    table.timestamp('approved_at');
    table.string('rejected_by');
    table.text('rejection_reason');
    table.timestamp('rejected_at');
    table.timestamp('applied_at');

    table.index(['user_id', 'status']);
    table.index(['proposed_at']);
  });

  // Evidence table
  await knex.schema.createTable('evidence', (table) => {
    table
      .uuid('evidence_id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('correction_id').notNullable();
    table
      .enum('type', [
        'SCREENSHOT',
        'CSV',
        'API_RESPONSE',
        'BLOCKCHAIN_TX',
        'DOCUMENT',
      ])
      .notNullable();
    table.text('description').notNullable();
    table.text('url');
    table.string('hash', 64);
    table.timestamp('timestamp').notNullable();

    table.index(['correction_id']);
  });

  // Balance snapshot table (for historical tracking)
  await knex.schema.createTable('balance_snapshots', (table) => {
    table
      .uuid('snapshot_id')
      .primary()
      .defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('reconciliation_id').notNullable();
    table.string('asset_id').notNullable();
    table.decimal('quantity', 30, 18).notNullable();
    table.decimal('value_usd', 20, 2);
    table.string('source').notNullable();
    table.timestamp('snapshot_time').notNullable();
    table.integer('block_height');
    table.jsonb('metadata');

    table.index(['reconciliation_id']);
    table.index(['asset_id', 'source']);
    table.index(['snapshot_time']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('balance_snapshots');
  await knex.schema.dropTableIfExists('evidence');
  await knex.schema.dropTableIfExists('correction_projections');
  await knex.schema.dropTableIfExists('adjustment_projections');
  await knex.schema.dropTableIfExists('resolution_projections');
  await knex.schema.dropTableIfExists('discrepancy_projections');
  await knex.schema.dropTableIfExists('reconciliation_projections');
}
```

### 11. External Balance Fetchers

```typescript
// packages/contexts/reconciliation/src/infrastructure/fetchers/binance.fetcher.ts
import { Injectable } from '@nestjs/common';
import { Effect, pipe, Option } from 'effect';
import {
  BalanceSnapshot,
  DataSource,
} from '../../domain/value-objects/reconciliation.vo';
import { UserId } from '../../../trading/domain/value-objects/identifiers.vo';
import { AssetId } from '../../../trading/domain/value-objects/identifiers.vo';
import { Quantity } from '../../../trading/domain/value-objects/quantity.vo';
import {
  ExternalFetchError,
  ConnectionError,
} from '../../domain/services/balance-fetcher.service';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class BinanceFetcher {
  private readonly baseUrl = 'https://api.binance.com';

  fetch(
    userId: UserId,
  ): Effect.Effect<
    ReadonlyArray<BalanceSnapshot>,
    ExternalFetchError | ConnectionError
  > {
    return pipe(
      this.getApiCredentials(userId),
      Effect.flatMap((credentials) => this.fetchAccountBalances(credentials)),
      Effect.map((balances) => this.transformToSnapshots(balances)),
      Effect.catchAll((error) =>
        Effect.fail(
          new ExternalFetchError({
            source: DataSource.BINANCE,
            reason: error.message,
          }),
        ),
      ),
    );
  }

  private getApiCredentials(
    userId: UserId,
  ): Effect.Effect<{ apiKey: string; apiSecret: string }, Error> {
    // In production, fetch encrypted credentials from secure storage
    return Effect.sync(() => ({
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
    }));
  }

  private fetchAccountBalances(credentials: {
    apiKey: string;
    apiSecret: string;
  }): Effect.Effect<any, Error> {
    return Effect.tryPromise({
      try: async () => {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = this.generateSignature(
          queryString,
          credentials.apiSecret,
        );

        const response = await axios.get(
          `${this.baseUrl}/api/v3/account?${queryString}&signature=${signature}`,
          {
            headers: {
              'X-MBX-APIKEY': credentials.apiKey,
            },
          },
        );

        return response.data.balances.filter(
          (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0,
        );
      },
      catch: (error) =>
        new ConnectionError({
          source: DataSource.BINANCE,
          details: error.message,
        }),
    });
  }

  private transformToSnapshots(balances: any[]): BalanceSnapshot[] {
    return balances.map((balance) => {
      const totalQuantity =
        parseFloat(balance.free) + parseFloat(balance.locked);

      return new BalanceSnapshot({
        asset: AssetId.crypto(balance.asset, 'binance'),
        quantity: Quantity.of(totalQuantity, 18).getOrElse(() =>
          Quantity.zero(),
        ),
        value: Option.none(), // Price fetched separately if needed
        source: DataSource.BINANCE,
        timestamp: new Date(),
        blockHeight: Option.none(),
        metadata: {
          free: balance.free,
          locked: balance.locked,
        },
      });
    });
  }

  private generateSignature(queryString: string, apiSecret: string): string {
    return crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');
  }
}
```
