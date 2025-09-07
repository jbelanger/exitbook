# Domain Services & Business Logic Engines - Design Analysis

**Date**: 2025-09-04  
**Status**: Design Review Complete  
**Phase**: Pre-Implementation Analysis

## Executive Summary

This document provides a comprehensive analysis of the proposed Domain Services & Business Logic Engines outlined in the project strategy. While the business requirements are sound, the proposed implementation has significant architectural flaws that must be addressed before proceeding.

**Key Finding**: The current proposal violates several DDD principles and introduces performance/security risks that would be problematic in a production financial application.

## Current Codebase Foundation Assessment

### ✅ Strengths

- **Solid Money Value Object**: Proper BigInt precision handling, comprehensive test coverage
- **Well-Designed Aggregates**: User and Account aggregates follow DDD patterns correctly
- **Proper Error Handling**: neverthrow Result types throughout domain layer
- **Factory Method Pattern**: Private constructors with static factory methods
- **Double-Entry Ledger**: Correct implementation with proper validation

### ⚠️ Areas for Enhancement

- **Limited Account Types**: Current enum needs expansion for DeFi/NFT support
- **Missing Domain Events**: No event-driven architecture for cross-aggregate communication
- **Service Layer Gaps**: Limited domain services for complex business logic

## Detailed Analysis of Proposed Features

### Priority #1: TaxLot Entity

#### ❌ Critical Design Flaws

**1. Aggregate Boundary Violation**

```typescript
// INCORRECT: TaxLot as child entity of User
export class TaxLot {
  private constructor(
    private readonly _userId: string,  // ⚠️ Violates aggregate boundaries
    private readonly _entryToAcquireId: number, // ⚠️ Cross-aggregate reference
```

**Problems:**

- TaxLot has complex lifecycle (FIFO/HIFO consumption, partial depletion) → needs own aggregate
- User aggregate already at capacity managing account references
- Direct foreign key references violate DDD principles

**2. Database Schema Issues**

```typescript
// PROBLEMATIC: Tight coupling to ledger entries
entryToAcquireId: integer('entry_to_acquire_id').references(() => entries.id).notNull(),
```

**Performance & Design Issues:**

- Creates expensive joins for tax calculations
- Violates event sourcing principles (relies on mutable references)
- Cross-aggregate dependencies in database layer

#### ✅ Recommended TaxLot Design

**Proper Aggregate Structure:**

```typescript
// libs/core/src/aggregates/tax-lot/tax-lot.aggregate.ts
export class TaxLot extends AggregateRoot {
  private constructor(
    private readonly _id: TaxLotId,
    private readonly _userId: UserId,
    private readonly _asset: AssetId,
    private readonly _acquisitionTransactionId: TransactionId, // Domain ID, not FK
    private readonly _acquisitionDate: Date,
    private readonly _originalQuantity: Money,
    private _remainingQuantity: Money,
    private readonly _costBasisSnapshot: CostBasisSnapshot, // Immutable at creation
    private _status: LotStatus
  ) {
    super();
  }

  static create(data: CreateTaxLotData): Result<TaxLot, TaxLotError> {
    // Validation logic
    const lot = new TaxLot(/* ... */);

    // Emit domain event
    lot.addDomainEvent(new TaxLotCreated(lot.id, data));

    return ok(lot);
  }

  consume(quantity: Money): Result<ConsumptionResult, TaxLotError> {
    // FIFO/HIFO consumption logic
    // Emit TaxLotConsumed event
    // Return realized gain/loss calculation
  }
}
```

**Improved Database Schema:**

```typescript
export const taxLots = pgTable(
  'tax_lots',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Immutable acquisition data (no cross-aggregate FKs)
    acquisitionTransactionId: varchar('acquisition_transaction_id', { length: 255 }).notNull(),
    acquisitionDate: timestamp('acquisition_date', { withTimezone: true }).notNull(),

    assetSymbol: varchar('asset_symbol', { length: 20 }).notNull(),
    originalQuantity: bigint('original_quantity', { mode: 'bigint' }).notNull(),
    remainingQuantity: bigint('remaining_quantity', { mode: 'bigint' }).notNull(),

    // Immutable cost basis snapshot
    costBasisAmount: bigint('cost_basis_amount', { mode: 'bigint' }).notNull(),
    costBasisCurrency: varchar('cost_basis_currency', { length: 10 }).notNull(),
    costBasisExchangeRate: bigint('cost_basis_exchange_rate', { mode: 'bigint' }),

    status: lotStatusEnum('status').default('OPEN').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    userAssetDateIdx: index('idx_tax_lots_user_asset_date').on(table.userId, table.assetSymbol, table.acquisitionDate),
    userStatusIdx: index('idx_tax_lots_user_status').on(table.userId, table.status),
  })
);
```

### Priority #1: Account Type Expansion

#### ✅ Good Additions

```typescript
ASSET_NFT_WALLET = 'ASSET_NFT_WALLET',
INCOME_LP_FEES = 'INCOME_LP_FEES',
EXPENSE_FEES_NETWORK = 'EXPENSE_FEES_NETWORK',
```

#### ❌ Missing Critical Types

```typescript
// Additional types needed for comprehensive DeFi support:
export enum AccountType {
  // ... existing types

  // DeFi Asset Types
  ASSET_LP_TOKEN = 'ASSET_LP_TOKEN',
  ASSET_NFT_COLLECTION = 'ASSET_NFT_COLLECTION',
  ASSET_YIELD_BEARING = 'ASSET_YIELD_BEARING',

  // DeFi Income Types
  INCOME_YIELD_FARMING = 'INCOME_YIELD_FARMING',
  INCOME_LIQUIDITY_REWARDS = 'INCOME_LIQUIDITY_REWARDS',

  // DeFi Expense Types
  EXPENSE_SLIPPAGE = 'EXPENSE_SLIPPAGE',
  EXPENSE_MEV = 'EXPENSE_MEV',

  // DeFi Liability Types
  LIABILITY_FLASH_LOAN = 'LIABILITY_FLASH_LOAN',
  LIABILITY_BORROWING = 'LIABILITY_BORROWING',
}
```

### Priority #2: Service Interface Contracts

#### ✅ Good Separation of Concerns

```typescript
export const IHistoricalPriceProvider = Symbol('IHistoricalPriceProvider');
export const IRealTimePriceProvider = Symbol('IRealTimePriceProvider');
```

#### ❌ Missing Critical Features

**1. Insufficient Error Handling & Options:**

```typescript
// CURRENT: Too simplistic
export interface IHistoricalPriceProvider {
  fetchPrice(baseAsset: string, quoteAsset: string, timestamp: Date): Promise<Result<Money, PriceProviderError>>;
}

// RECOMMENDED: Production-ready interface
export interface IHistoricalPriceProvider {
  fetchPrice(
    baseAsset: string,
    quoteAsset: string,
    timestamp: Date,
    options?: PriceProviderOptions
  ): Promise<Result<PriceResponse, PriceProviderError>>;

  // Essential for financial applications
  isAvailable(baseAsset: string, quoteAsset: string): Promise<boolean>;
  getSupportedPairs(): Promise<string[]>;
  getProviderStatus(): Promise<ProviderHealthStatus>;
}

interface PriceProviderOptions {
  allowApproximateTimestamp?: boolean;
  maxAgeMinutes?: number;
  fallbackToNearest?: boolean;
  requiredConfidence?: number; // 0-1 scale
}

interface PriceResponse {
  price: Money;
  timestamp: Date;
  confidence: number;
  source: string;
  approximated: boolean;
}
```

**2. Security Issues in Credentials Service:**

```typescript
// DANGEROUS: Returns plaintext credentials
getApiKey(userId: string, source: string): Promise<Result<{ apiKey: string; apiSecret: string }, DomainError>>;

// SECURE: Return handles/tokens only
export interface ICredentialsService {
  storeCredentials(userId: string, source: string, credentials: EncryptedCredentials): Promise<Result<CredentialHandle, DomainError>>;
  getCredentialHandle(userId: string, source: string): Promise<Result<CredentialHandle, DomainError>>;
  executeWithCredentials<T>(
    handle: CredentialHandle,
    operation: (credentials: DecryptedCredentials) => Promise<T>
  ): Promise<Result<T, DomainError>>;
  revokeCredentials(userId: string, source: string): Promise<Result<void, DomainError>>;
}
```

### Priority #3: DTO Structure

#### ❌ Fundamental Type Safety Issues

**Current Proposal:**

```typescript
export interface HoldingDto {
  quantity: string; // ⚠️ Loses type safety
  currentPrice: string;
  currentValue: string;
  // ... all strings
}
```

**Problems:**

1. **Type safety lost too early** - should preserve Money objects until API boundary
2. **Precision handling unclear** - which string format? How many decimals?
3. **Calculation errors undetectable** at compile time

#### ✅ Recommended DTO Design

**Domain DTOs (Internal):**

```typescript
// libs/core/src/dto/portfolio.dto.ts
export interface PortfolioSnapshot {
  readonly totalValue: Money;
  readonly totalCostBasis: Money;
  readonly totalUnrealizedGain: Money;
  readonly holdings: readonly Holding[];
  readonly asOfTimestamp: Date;
  readonly baseCurrency: string;
}

export interface Holding {
  readonly asset: AssetInfo;
  readonly quantity: Money;
  readonly currentPrice: Money;
  readonly currentValue: Money;
  readonly costBasis: Money;
  readonly unrealizedGain: Money;
  readonly gainLossPercentage: number;
}
```

**API DTOs (External):**

```typescript
// apps/api/src/dto/portfolio-api.dto.ts
export interface PortfolioSnapshotApiDto {
  totalValue: {
    formatted: string; // "1,234.56 USD"
    raw: string; // "123456" (for programmatic use)
    currency: string; // "USD"
    decimals: number; // 2
  };
  totalCostBasis: MoneyApiDto;
  totalUnrealizedGain: MoneyApiDto;
  holdings: HoldingApiDto[];
  asOfTimestamp: string; // ISO 8601
  baseCurrency: string;
}
```

## Missing Critical Components

### 1. Domain Events Architecture

```typescript
// Tax lot creation should emit events for audit and cross-aggregate coordination
export class TaxLotCreated extends DomainEvent {
  constructor(
    public readonly lotId: TaxLotId,
    public readonly userId: UserId,
    public readonly asset: AssetId,
    public readonly acquisitionData: AcquisitionData
  ) {
    super();
  }
}

// Event handlers for cross-aggregate coordination
@EventHandler(TaxLotCreated)
export class TaxLotCreatedHandler implements IEventHandler<TaxLotCreated> {
  async handle(event: TaxLotCreated): Promise<void> {
    // Update portfolio valuation cache
    // Send audit log entry
    // Trigger tax calculation refresh
  }
}
```

### 2. Error Recovery Strategies

**Missing Scenarios:**

- Price provider down during tax calculation
- User has transactions but no price data for timestamp
- TaxLot consumption fails mid-transaction
- Currency conversion rates unavailable

**Recommended Patterns:**

```typescript
export class TaxCalculationService {
  async calculateGains(
    disposalEvent: DisposalEvent,
    fallbackOptions: FallbackOptions
  ): Promise<Result<TaxCalculationResult, TaxCalculationError>> {
    return this.priceProvider
      .fetchPrice(/* ... */)
      .orElse(error => this.handlePriceProviderFailure(error, fallbackOptions))
      .andThen(price => this.performCalculation(disposalEvent, price))
      .orElse(error => this.handleCalculationFailure(error, fallbackOptions));
  }
}
```

### 3. Performance Considerations

**Scalability Issues Not Addressed:**

- Tax calculations for active traders (thousands of lots)
- Real-time portfolio updates
- Concurrent user calculations

**Required Patterns:**

- Pagination for large result sets
- Background processing for expensive calculations
- Caching strategies with invalidation
- Database query optimization

## Implementation Recommendations

### Phase 1: Foundation (Do First)

1. **Expand AccountType enum** with DeFi/NFT types
2. **Implement proper Price Provider interfaces** with fallback strategies
3. **Add Domain Events infrastructure** to existing aggregates
4. **Create secure CredentialsService interface** (implementation can be mocked initially)

### Phase 2: TaxLot Aggregate (Do Second)

1. **Design TaxLot as separate aggregate** with proper boundaries
2. **Implement domain events** for lot creation/consumption
3. **Create TaxLotRepository interface** with efficient queries
4. **Build simple FIFO consumption logic** before advanced accounting methods

### Phase 3: Portfolio Services (Do Third)

1. **Simple portfolio valuation** without complex tax calculations
2. **Basic holdings display** with current prices
3. **Performance monitoring** and optimization

### Phase 4: Advanced Tax Features (Do Last)

1. **HIFO/LIFO accounting methods**
2. **Capital gains reporting**
3. **Tax form generation**

## Security & Compliance Notes

### Data Protection Requirements

- **API keys must never be logged** or appear in error messages
- **Tax calculations are financial advice** - audit trail requirements
- **User data isolation** must be maintained at all service levels

### Performance Requirements

- **Sub-second portfolio updates** for reasonable portfolio sizes
- **Concurrent user support** without resource contention
- **Graceful degradation** when external services fail

## Conclusion

The proposed Domain Services address legitimate business needs, but the current implementation approach has significant architectural flaws. The recommendations above provide a path to production-ready financial software that maintains data integrity, security, and performance at scale.

**Next Steps:**

1. Implement Phase 1 foundation improvements
2. Prototype TaxLot aggregate design with domain events
3. Build simple portfolio valuation before complex tax features
4. Establish comprehensive error handling and testing strategies

---

**Review Required**: This analysis should be reviewed by the technical lead before proceeding with implementation.
