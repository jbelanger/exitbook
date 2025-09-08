## Alternative Architecture Design for a Greenfield Crypto Portfolio System

Given this is a greenfield project, I'd propose a significantly different
architecture that learns from the current design's strengths while avoiding its
complexity traps.

### Core Philosophy: Event-Sourced Domain with CQRS

Instead of a hybrid state-based/event-aware system, I'd go fully event-sourced
for the financial domain. Here's why and how:

## 1. **Event-Sourced Aggregates Instead of State-Based**

### Current Design Problem:

```typescript
// Current: TaxLot aggregate maintains mutable state
class TaxLot {
  private _remainingQuantity: Money;
  consume(quantity: Money) {
    this._remainingQuantity = this._remainingQuantity.subtract(quantity);
  }
}
```

### Better Design:

```typescript
// Event-sourced approach
class TaxLotAggregate extends EventSourcedAggregate {
  // State is derived from events
  static fromEvents(events: DomainEvent[]): TaxLotAggregate {
    return events.reduce(
      (lot, event) => lot.apply(event),
      new TaxLotAggregate(),
    );
  }

  // Commands return events, not mutations
  consume(disposal: DisposalCommand): DomainEvent[] {
    const consumption = this.calculateConsumption(disposal);
    return [new TaxLotConsumed(consumption)];
  }

  // Pure calculation, no side effects
  private calculateConsumption(disposal: DisposalCommand): ConsumptionDetails {
    // Pure business logic
  }
}
```

**Benefits:**

- Complete audit trail by default
- Time-travel debugging
- Natural reversal/correction handling
- No ORM impedance mismatch

## 2. **Functional Core, Imperative Shell Pattern**

### Current Design Problem:

Services mix I/O with business logic everywhere:

```typescript
// Current: I/O and logic intertwined
class PortfolioValuationService {
  async calculatePortfolioSnapshot() {
    const balances = await this.fetchBalances(); // I/O
    const prices = await this.fetchPrices(); // I/O
    return this.calculate(balances, prices); // Logic
  }
}
```

### Better Design:

```typescript
// Pure functional core
namespace PortfolioDomain {
  // Pure functions with no I/O
  export function calculatePortfolioValue(
    holdings: Holding[],
    prices: PriceMap,
  ): PortfolioValue {
    return holdings.map((h) => ({
      ...h,
      value: h.quantity.multiply(prices.get(h.asset)),
    }));
  }

  export function identifyDiscrepancies(
    calculated: Balance[],
    external: Balance[],
  ): Discrepancy[] {
    // Pure comparison logic
  }
}

// Imperative shell handles I/O
class PortfolioQueryHandler {
  async handle(query: GetPortfolioValue): Promise<Result<PortfolioValue>> {
    // All I/O at the edges
    const holdings = await this.holdingsRepo.get(query.userId);
    const prices = await this.priceService.getBatch(holdings.assets);

    // Pure calculation
    return ok(PortfolioDomain.calculatePortfolioValue(holdings, prices));
  }
}
```

## 3. **Projection-Based Read Models**

### Current Design Problem:

Complex queries require joining across aggregates:

```typescript
// Current: Complex repository methods
class LedgerRepository {
  async getAllBalancesByCurrency(userId: string) {
    // Complex SQL with multiple joins
  }
}
```

### Better Design:

```typescript
// Event projections create optimized read models
class BalanceProjection {
  @EventHandler(TransactionRecorded)
  async handleTransaction(event: TransactionRecorded) {
    // Update denormalized balance table
    await this.updateBalance(event.userId, event.asset, event.amount);
  }

  // Simple, fast queries
  async getBalance(userId: string, asset: string): Promise<Balance> {
    return this.balanceTable.findOne({ userId, asset });
  }
}

// Multiple projections for different query needs
class PortfolioProjection {
  /* Optimized for portfolio views */
}
class TaxReportProjection {
  /* Optimized for tax calculations */
}
class ReconciliationProjection {
  /* Optimized for comparisons */
}
```

## 4. **Workflow Orchestration with Sagas**

### Current Design Problem:

Complex multi-step processes are hidden in services:

```typescript
// Current: Implicit workflow in service
class ImportService {
  async import() {
    // Step 1, 2, 3... all mixed together
  }
}
```

### Better Design:

```typescript
// Explicit workflow orchestration
class ImportWorkflow extends Saga {
  private readonly steps = [
    FetchRawDataStep,
    ValidateDataStep,
    ClassifyTransactionsStep,
    CreateTaxLotsStep,
    UpdateBalancesStep,
  ];

  async execute(context: ImportContext): Promise<Result<ImportResult>> {
    return this.pipeline(this.steps, context);
  }

  async compensate(failedStep: Step, context: ImportContext) {
    // Explicit rollback logic
  }
}

// Each step is isolated and testable
class ClassifyTransactionsStep implements WorkflowStep {
  async execute(context: ImportContext): Promise<StepResult> {
    const classified = context.transactions.map((tx) =>
      this.classifier.classify(tx),
    );
    return { ...context, classifiedTransactions: classified };
  }
}
```

## 5. **Smart Domain Events with Metadata**

### Current Design:

```typescript
// Current: Anemic events
class AssetAcquired extends DomainEvent {
  constructor(public amount: Money) {}
}
```

### Better Design:

```typescript
// Rich, self-describing events
interface TaxLotConsumed extends DomainEvent {
  // Event metadata
  readonly eventId: UUID;
  readonly aggregateId: TaxLotId;
  readonly userId: UserId;
  readonly timestamp: Timestamp;
  readonly version: number;
  readonly causationId: UUID; // Links to command that caused it
  readonly correlationId: UUID; // Links related events

  // Business data
  readonly consumption: {
    quantity: Money;
    costBasis: Money;
    disposalPrice: Money;
    realizedGain: Money;
    holdingPeriod: Days;
  };

  // Computation metadata
  readonly calculations: {
    method: AccountingMethod;
    priceSource: string;
    exchangeRate?: number;
  };
}
```

## 6. **Separation of Concerns via Bounded Contexts**

### Better Architecture:

```
contexts/
├── trading/                 # Transaction recording
│   ├── domain/
│   │   ├── aggregates/      # Transaction, Entry
│   │   └── events/          # TransactionRecorded
│   └── infrastructure/
│
├── portfolio/               # Portfolio management
│   ├── domain/
│   │   ├── calculations/    # Pure functions
│   │   └── projections/     # BalanceProjection, HoldingsProjection
│   └── api/
│
├── taxation/                # Tax calculations
│   ├── domain/
│   │   ├── aggregates/      # TaxLot, TaxReport
│   │   ├── policies/        # FIFOPolicy, LIFOPolicy
│   │   └── events/
│   └── infrastructure/
│
├── reconciliation/          # External reconciliation
│   ├── domain/
│   │   ├── specifications/  # DiscrepancySpec, ToleranceSpec
│   │   └── services/        # Pure reconciliation logic
│   └── adapters/            # Exchange-specific adapters
│
└── shared-kernel/           # Shared concepts
    ├── money/               # Money value object
    ├── time/                # Time handling
    └── results/             # Result types
```

## 7. **Policy-Based Business Rules**

### Current Design Problem:

Business rules are scattered and implicit:

```typescript
// Current: Rules hidden in methods
if (discrepancyPercentage > 10) return 'CRITICAL';
```

### Better Design:

```typescript
// Explicit, configurable policies
interface DiscrepancySeverityPolicy {
  evaluate(discrepancy: Discrepancy): Severity;
}

class PercentageBasedSeverityPolicy implements DiscrepancySeverityPolicy {
  constructor(
    private thresholds: { critical: number; warning: number; minor: number },
  ) {}

  evaluate(discrepancy: Discrepancy): Severity {
    const percentage = discrepancy.getPercentage();
    if (percentage > this.thresholds.critical) return Severity.Critical;
    if (percentage > this.thresholds.warning) return Severity.Warning;
    return Severity.Minor;
  }
}

// Policies are injected and configurable
class ReconciliationService {
  constructor(
    private severityPolicy: DiscrepancySeverityPolicy,
    private tolerancePolicy: TolerancePolicy,
  ) {}
}
```

## 8. **Type-Safe Transaction Classification**

### Better Design using Discriminated Unions:

```typescript
// Type-safe classification results
type ClassifiedTransaction =
  | { type: 'swap'; data: SwapTransaction }
  | { type: 'liquidity'; data: LiquidityTransaction }
  | { type: 'nft'; data: NFTTransaction }
  | { type: 'transfer'; data: TransferTransaction };

// Pattern matching for handling
function processClassified(tx: ClassifiedTransaction) {
  switch (tx.type) {
    case 'swap':
      return handleSwap(tx.data);
    case 'liquidity':
      return handleLiquidity(tx.data);
    // Compiler ensures exhaustiveness
  }
}
```

## 9. **Streaming and Reactive Patterns**

### For Large Data Sets:

```typescript
// Instead of loading everything into memory
class DataExportService {
  async *exportTransactions(userId: string): AsyncGenerator<Transaction> {
    let offset = 0;
    const batchSize = 1000;

    while (true) {
      const batch = await this.repo.getTransactions(userId, offset, batchSize);
      if (batch.length === 0) break;

      for (const transaction of batch) {
        yield transaction;
      }
      offset += batchSize;
    }
  }

  // Stream to file
  async exportToFile(userId: string, writer: Writable) {
    for await (const transaction of this.exportTransactions(userId)) {
      writer.write(this.formatTransaction(transaction));
    }
  }
}
```

## 10. **Testing Strategy Built-In**

### Property-Based Testing for Financial Invariants:

```typescript
// Test invariants, not just examples
describe('TaxLot consumption', () => {
  it('should maintain conservation of value', () => {
    fc.assert(
      fc.property(arbTaxLot(), arbDisposalQuantity(), (lot, quantity) => {
        const result = lot.consume(quantity);
        const totalValue = result.consumedBasis.add(result.remainingBasis);
        return totalValue.equals(lot.originalBasis);
      }),
    );
  });
});
```

## Key Architectural Decisions Summary

1. **Event Sourcing** for financial aggregates - natural audit trail
2. **Functional Core** - pure business logic, easy to test
3. **Projections** for queries - optimized read models
4. **Explicit Workflows** - visible, testable business processes
5. **Bounded Contexts** - clear module boundaries
6. **Policy Objects** - configurable business rules
7. **Type Safety** - discriminated unions over stringly-typed
8. **Streaming** - handle large datasets efficiently
9. **Property Testing** - verify invariants, not just cases

## Migration Path

If you want to evolve the current design:

1. **Start with Event Sourcing** for new aggregates (don't retrofit existing)
2. **Extract pure functions** from existing services
3. **Build projections** alongside existing repositories
4. **Gradually move** to workflow orchestration
5. **Keep the CQRS** structure but make it more explicit

This architecture provides:

- **Better testability** (pure functions, explicit workflows)
- **Natural audit trail** (event sourcing)
- **Performance at scale** (projections, streaming)
- **Maintainability** (bounded contexts, policies)
- **Flexibility** (event-driven, loosely coupled)

The main trade-off is initial complexity - event sourcing has a learning curve.
But for a financial system where audit, corrections, and temporal queries are
critical, it's worth the investment.
