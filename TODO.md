# ExitBook DDD Implementation TODO

## Phase 1: Value Objects Foundation

### Value Objects (`libs/core/src/value-objects/`)

- [x] **Money Value Object** (`money/`) ✅ **COMPLETED**
  - [x] Decimal precision handling (8 decimals BTC, 18 ETH) - Uses `scale` parameter
  - [x] Currency pairing validation - Enforced in factory methods
  - [x] Arithmetic operations (add, subtract, multiply, divide) - Full implementation with currency mismatch validation
  - [x] neverthrow Result types - All operations return `Result<Money, MoneyErrorTypes>`
  - [x] Private constructor + factory methods - `fromDecimal()`, `fromBigInt()`, `zero()`
  - [x] Comprehensive error handling - 6 specific error types in `money.errors.ts`
  - [x] Complete test coverage - 58 unit tests in `__tests__/` directory
  - [x] Proper DDD structure - Domain concepts grouped in `money/` subdirectory
  - **Note**: Uses manual validation instead of Zod, follows `__tests__` folder pattern

## Phase 2: Domain Aggregates

### User Aggregate (`libs/core/src/aggregates/user/`)

- [ ] **User Aggregate Root** (`user.aggregate.ts`)
  - Private constructor pattern
  - `createAccount()` method with business rules
  - `deactivate()` method with open position checks
  - Account ownership management
  - Maximum accounts per user enforcement

- [ ] **Account Entity** (`account.entity.ts`)
  - Account type validation (ASSET_WALLET, ASSET_EXCHANGE, etc.)
  - Balance tracking with Money value object
  - Network/address validation for crypto accounts
  - Parent account relationships
  - Factory method with invariant enforcement

- [ ] **User Domain Errors** (`user.errors.ts`)
  - `InactiveUserError`
  - `MaxAccountsExceededError`
  - `InvalidAccountTypeError`
  - `HasOpenPositionsError`

### Transaction Aggregate (`libs/core/src/aggregates/transaction/`)

- [ ] **LedgerTransaction Aggregate Root** (`ledger-transaction.aggregate.ts`)
  - Double-entry invariant enforcement (entries sum = 0)
  - `addEntry()` method with validation
  - External ID uniqueness per user/source
  - Transaction balancing verification
  - Entry ownership (all entries same user)

- [ ] **Entry Entity** (`entry.entity.ts`)
  - Direction validation (CREDIT/DEBIT)
  - Entry type validation (TRADE, DEPOSIT, etc.)
  - Amount validation with Money value object
  - Account/currency relationship validation
  - Factory method with business rules

- [ ] **Transaction Domain Errors** (`transaction.errors.ts`)
  - `UnbalancedTransactionError`
  - `InvalidEntryDirectionError`
  - `DuplicateExternalIdError`
  - `CrossUserTransactionError`

### Currency Aggregate (`libs/core/src/aggregates/currency/`)

- [ ] **Currency Aggregate Root** (`currency.aggregate.ts`)
  - Currency code validation (BTC, ETH, USD)
  - Decimal precision rules
  - Display name management
  - Factory method for reference data

## Phase 3: Domain Services

### Domain Services (`libs/core/src/services/`)

- [ ] **Balance Calculator Service** (`balance-calculator.service.ts`)
  - Account balance calculation from entries
  - Multi-currency balance aggregation
  - Historical balance at specific dates

- [ ] **Transaction Validator Service** (`transaction-validator.service.ts`)
  - Cross-aggregate validation rules
  - Business rule enforcement
  - Complex validation logic

## Phase 4: Testing

### Unit Tests

- [ ] **Value Object Tests**
  - Money arithmetic operations
  - Validation edge cases
  - Error scenarios

- [ ] **Aggregate Tests**
  - Business rule enforcement
  - Invariant violations
  - Domain logic correctness

- [ ] **Domain Service Tests**
  - Balance calculations
  - Validation scenarios
  - Integration between aggregates

## Phase 5: Integration with NestJS

### Repository Interfaces (`libs/core/src/repositories/`)

- [ ] **User Repository Interface** (`user.repository.ts`)
- [ ] **Transaction Repository Interface** (`transaction.repository.ts`)
- [ ] **Currency Repository Interface** (`currency.repository.ts`)

### Application Services Bridge

- [ ] **Convert domain Results to NestJS Promises**
- [ ] **Error mapping to HTTP exceptions**
- [ ] **DTO to domain object transformation**

## Implementation Guidelines

### Factory Method Pattern & Invariant Protection

**Private Constructor + Static Factory Methods:**

- **Why**: Ensures objects can never exist in invalid states
- **Pattern**: `private constructor()` + `static create()` returning `Result<T, Error>`
- **Invariant Protection**: All validation happens at object creation time
- **Immutability**: Objects cannot be mutated after creation (financial safety)

**Example (from Money implementation):**

```typescript
export class Money {
  private constructor(
    private readonly _amount: Decimal,
    private readonly _currency: Currency
  ) {}

  static fromDecimal(amount: Decimal, currency: Currency): Result<Money, MoneyErrorTypes> {
    // Validation + invariant enforcement
    return ok(new Money(amount, currency));
  }
}
```

**Benefits:**

- **Compile-time safety**: TypeScript prevents direct instantiation
- **Runtime safety**: All instances guaranteed valid by factory validation
- **Domain integrity**: Business rules enforced at creation boundary
- **Refactoring safety**: Changes to validation centralized in factory methods

### Patterns to Follow

- ✅ Private constructors + static factory methods (validated objects only)
- ✅ Manual validation (performance + control over Zod for critical paths)
- ✅ neverthrow Result types (no throwing exceptions, explicit error handling)
- ✅ Immutable entities (return new instances, financial data protection)
- ✅ Branded types for ID safety (prevent ID mixing between entities)
- ✅ Business logic in domain entities (rich domain model vs anemic)
- ✅ Aggregate boundary enforcement (consistency boundaries)

### Key Invariants to Enforce

**Financial Domain Invariants:**

- **Double-entry ledger**: All transactions must balance (sum of all entries = 0)
  - Enforced in `LedgerTransaction.addEntry()` and `LedgerTransaction.finalize()`
  - Cannot save transaction until balanced
- **Currency consistency**: Money amounts must match their account's currency
  - Enforced in `Account.recordEntry()` and `Entry.create()`
- **Balance integrity**: No negative balances without explicit liability account types
  - Asset accounts (ASSET\_\*) cannot go negative
  - Liability accounts (LIABILITY\_\*) can have negative balances
- **User ownership**: Users can only access their own financial data
  - All aggregates enforce user ID consistency
  - Cross-user transactions explicitly forbidden

**Business Rule Invariants:**

- **Account limits**: Maximum accounts per user (business configurable)
- **Account hierarchy**: Parent accounts must exist and belong to same user
- **Transaction immutability**: Once finalized, transactions cannot be modified
- **External ID uniqueness**: Per user+source combination (idempotency)

### Error Handling Strategy

**Domain Layer (Core Business Logic):**

- **neverthrow Result types**: All operations return `Result<T, Error>`
- **No throwing exceptions**: Domain logic never throws, always returns Results
- **Explicit error types**: Each business rule has specific error class
- **Composable error handling**: Use `pipe()` and `Result.flatMap()` for chaining

**Example Pattern:**

```typescript
// Domain layer - explicit error handling
static create(params: CreateMoneyParams): Result<Money, MoneyErrorTypes> {
  return pipe(
    validateAmount(params.amount),
    Result.flatMap(validateCurrency(params.currency)),
    Result.map(([amount, currency]) => new Money(amount, currency))
  );
}

// Application layer - convert to NestJS exceptions
async createAccount(dto: CreateAccountDto): Promise<Account> {
  const result = Account.create(dto);
  if (result.isErr()) {
    throw new BadRequestException(result.error.message);
  }
  return result.value;
}
```

**Error Conversion Strategy:**

- Domain `Result<T, Error>` → Application layer converts to HTTP exceptions
- Preserve error context and business meaning
- Map domain errors to appropriate HTTP status codes
- Log domain errors for debugging, expose user-friendly messages

---

**Start with Phase 1 value objects - they're the foundation for everything else!**
