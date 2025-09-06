# NestJS Double-Entry Ledger Architecture

## Overview

A NestJS-based cryptocurrency transaction import system implementing a complete double-entry ledger architecture with Drizzle ORM. The system uses CQRS pattern with small, focused command/query handlers for maintainability and scalability. Error handling is implemented using `neverthrow` for explicit, type-safe error handling that eliminates hidden exceptions and provides structured error data.

### Core Philosophy: Domain-Driven Design (DDD)

While the system uses CQRS for orchestration, the core business logic, rules, and invariants are encapsulated within a rich **Domain Model** as defined in `libs/core`. This approach avoids an anemic domain model where logic is scattered in services, and instead creates a robust, testable, and maintainable core.

**Key Principles Adopted:**

- **Aggregates & Entities:** Business concepts like `LedgerTransaction` and `User` are modeled as classes (`Aggregates`) that protect their own internal consistency (`invariants`).
- **Value Objects:** Concepts without identity, like `Money`, are modeled as immutable value objects to ensure correctness (e.g., preventing operations between different currencies).
- **Factory Pattern:** Aggregates cannot be instantiated directly. They are created via static `create()` factory methods that contain all validation logic, ensuring no invalid object can ever exist in the system.
- **Rich Domain Model:** Business logic lives within the domain objects themselves (e.g., `LedgerTransaction.addEntry()`), not in application services or repositories.

## Multi-Tenant Architecture & User Context Management

**Critical:** This system is designed as a multi-tenant architecture where all data is scoped by `userId`. Every command, query, and repository operation must include user context to ensure data isolation and security.

### User Context Requirements

1. **All Commands and Queries must include userId**
2. **All Repository methods must be user-scoped**
3. **CLI operations must specify user context**
4. **API operations must extract user from authentication**

## System Architecture

The system implements a clean ETL pipeline using NestJS patterns:

1. **Importers**: Fetch raw data from sources via Command Handlers
2. **Processors**: Transform raw data via Command/Query Handlers
3. **Orchestration**: ETL pipeline management via CQRS
4. **Provider Registry**: Multi-provider failover via NestJS Provider Modules

**Core Components**:

- Import logic via NestJS Command Handlers (Import\* commands)
- Complex processor logic via NestJS Command/Query Handlers (Process*, Transform* commands)
- Provider registry via NestJS dynamic modules
- Session management via NestJS Query Handlers (Get*, Find* queries)

## Error Handling Strategy with `neverthrow`

The system adopts `neverthrow` for explicit, type-safe error handling throughout all domain operations. This eliminates hidden exceptions and provides structured error data perfect for financial systems where errors are expected outcomes rather than exceptional cases.

### Why `neverthrow` for Financial Systems

For financial operations, errors are not "exceptions" but common, expected outcomes:

- **Validation failures**: Unbalanced ledger entries, invalid amounts
- **Business rule violations**: Insufficient funds, account not found
- **External service failures**: Provider timeouts, API rate limits
- **Data integrity issues**: Duplicate transactions, currency mismatches

The `Result<T, E>` type explicitly represents success (`Ok<T>`) or failure (`Err<E>`), forcing developers to handle both paths and eliminating entire classes of runtime errors.

A key principle is that these domain errors are generated **from within the domain aggregates themselves**. When a factory method or a business method on an aggregate encounters a violation of a rule (an invariant), it returns an `Err` result containing a specific, typed domain error.

**Example:**

```typescript
// libs/core/src/aggregates/transaction/ledger-transaction.aggregate.ts

export class LedgerTransaction extends AggregateRoot {
  // ...

  public addEntry(entry: Entry): Result<void, UnbalancedTransactionError> {
    // ... logic to check if adding this entry would unbalance the transaction
    if (isUnbalanced) {
      return err(new UnbalancedTransactionError('Adding this entry would unbalance the transaction'));
    }
    this._entries.push(entry);
    return ok(undefined);
  }
}
```

### Domain Error Classes

All domain-specific errors are structured classes providing machine-readable data:

```typescript
// libs/shared/src/errors/domain-errors.ts
export abstract class DomainError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class LedgerValidationError extends DomainError {
  constructor(details: { unbalancedCurrencies: Array<{ currencyId: number; ticker: string; delta: string }> }) {
    super('Ledger validation failed: entries are unbalanced', 'LEDGER_UNBALANCED', details);
  }
}

export class TransformationError extends DomainError {
  constructor(details: { universalTxId: string; reason: string }) {
    super(`Failed to transform transaction: ${details.universalTxId}`, 'TRANSFORMATION_FAILED', details);
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(accountId: number) {
    super(`Account with ID ${accountId} not found`, 'ACCOUNT_NOT_FOUND', { accountId });
  }
}

export class BatchProcessingError extends DomainError {
  constructor(details: { total: number; successful: number; failed: number }) {
    super('Batch processing completed with partial failures', 'BATCH_PARTIAL_FAILURE', details);
  }
}
```

### Result Type Integration

All command handlers, repositories, and services return `Result<T, E>` or `ResultAsync<T, E>` instead of throwing exceptions:

- **Repositories**: `ResultAsync<Entity, DomainError>`
- **Command Handlers**: `ResultAsync<DTO, DomainError>`
- **Services**: `Result<T, E>` for synchronous operations
- **Batch Operations**: Structured results with success/failure collections

## Project Structure

```
crypto-tx-import/
├── apps/
│   ├── api/                          # NestJS REST API application
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   └── controllers/          # REST endpoints
│   │   └── test/
│   └── cli/                          # NestJS CLI application
│       ├── src/
│       │   ├── main.ts
│       │   ├── cli.module.ts
│       │   └── commands/             # CLI commands as services
│       └── test/
├── libs/                             # NestJS shared libraries
│   ├── core/                         # Pure Domain Model (DDD)
│   │   ├── src/
│   │   │   ├── aggregates/           # Aggregate Roots and child Entities (e.g., LedgerTransaction, Entry)
│   │   │   ├── value-objects/        # Immutable value objects (e.g., Money)
│   │   │   ├── services/             # Stateless Domain Services (e.g., BalanceCalculator)
│   │   │   ├── repositories/         # Repository INTERFACES (the contract for persistence)
│   │   │   └── errors/               # Custom, typed Domain Errors
│   │   └── test/
│   ├── database/                     # Drizzle ORM integration
│   │   ├── src/
│   │   │   ├── schema/               # Database schema
│   │   │   ├── migrations/           # Migration files
│   │   │   ├── repositories/         # Repository services
│   │   │   └── database.module.ts
│   │   └── test/
│   ├── ledger/                       # Ledger CQRS domain
│   │   ├── src/
│   │   │   ├── commands/             # Command handlers (write operations)
│   │   │   │   ├── handlers/         # RecordTransaction, CreateAccount, etc.
│   │   │   │   └── impl/             # Command DTOs
│   │   │   ├── queries/              # Query handlers (read operations)
│   │   │   │   ├── handlers/         # GetBalance, FindTransaction, etc.
│   │   │   │   └── impl/             # Query DTOs
│   │   │   ├── dto/                  # API DTOs
│   │   │   ├── transformers/         # Universal → Ledger transformation
│   │   │   └── ledger.module.ts
│   │   └── test/
│   ├── import/                       # Import CQRS domain
│   │   ├── src/
│   │   │   ├── commands/             # Import command handlers
│   │   │   │   ├── handlers/         # ImportFromExchange, ProcessTransactions, etc.
│   │   │   │   └── impl/             # Command DTOs
│   │   │   ├── queries/              # Import query handlers
│   │   │   │   ├── handlers/         # GetImportStatus, FindRawData, etc.
│   │   │   │   └── impl/             # Query DTOs
│   │   │   ├── importers/            # Importer implementations
│   │   │   ├── processors/           # Processor implementations
│   │   │   └── import.module.ts
│   │   └── test/
│   ├── providers/                    # External data provider integration
│   │   ├── src/
│   │   │   ├── registry/             # Provider registry for exchanges/blockchains
│   │   │   ├── pricing/              # Historical price provider infrastructure
│   │   │   ├── blockchain/           # Blockchain provider managers
│   │   │   └── providers.module.ts
│   │   └── test/
│   └── shared/                       # Cross-cutting concerns (implemented as scoped packages)
│       ├── config/                   # @exitbook/shared-config
│       ├── logger/                   # @exitbook/shared-logger
│       └── ... other shared packages
```

## CQRS Architecture Design

### Overview

The system uses **Command Query Responsibility Segregation (CQRS)** via `@nestjs/cqrs` with small, focused handlers providing:

- **Single Responsibility**: Each handler has exactly one reason to change
- **Testability**: Unit testing individual handlers is straightforward
- **Clear Intent**: Commands/Queries make business operations explicit
- **Scalability**: Natural separation of read/write concerns

### Command vs Query Separation

**Commands** (Write Operations):

- `RecordTransactionCommand` → `RecordTransactionHandler`
- `ImportFromExchangeCommand` → `ImportFromExchangeHandler`
- `ProcessUniversalTransactionsCommand` → `ProcessUniversalTransactionsHandler`
- `CreateAccountCommand` → `CreateAccountHandler`

**Queries** (Read Operations):

- `GetAccountBalanceQuery` → `GetAccountBalanceHandler`
- `FindTransactionByIdQuery` → `FindTransactionByIdHandler`
- `GetImportSessionStatusQuery` → `GetImportSessionStatusHandler`
- `GetAllBalancesQuery` → `GetAllBalancesHandler`

### Handler Organization

```typescript
import { ResultAsync } from 'neverthrow';

// Example Command Handler Structure with neverthrow
@CommandHandler(RecordTransactionCommand)
export class RecordTransactionHandler implements ICommandHandler<RecordTransactionCommand> {
  constructor(
    private readonly ledgerRepository: LedgerRepository,
    private readonly accountService: AccountService,
    private readonly logger: LoggerService
  ) {}

  async execute(command: RecordTransactionCommand): ResultAsync<LedgerTransactionDto, DomainError> {
    const { userId, transactionData } = command;

    // Chain operations using neverthrow's railway-oriented programming
    return this.ledgerRepository.createTransaction(userId, transactionData).andThen(ledgerTransaction => {
      this.logger.log(`Transaction recorded: ${ledgerTransaction.id}`);
      return ResultAsync.fromPromise(
        this.mapToDto(ledgerTransaction),
        (error: Error) =>
          new TransformationError({
            universalTxId: ledgerTransaction.id.toString(),
            reason: error.message,
          })
      );
    });
  }
}

// Example Query Handler Structure with neverthrow
@QueryHandler(GetAccountBalanceQuery)
export class GetAccountBalanceHandler implements IQueryHandler<GetAccountBalanceQuery> {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  async execute(query: GetAccountBalanceQuery): ResultAsync<BalanceDto, DomainError> {
    const { userId, accountId } = query;

    return this.ledgerRepository.findAccountBalance(userId, accountId).map(balance => this.mapToBalanceDto(balance));
  }
}
```

### Controllers as Command/Query Dispatchers

Controllers are kept lean and are only responsible for dispatching commands and queries. They contain no business logic. Error handling for `Result` types is managed globally by a NestJS Exception Filter, which unwraps the result and maps domain errors to appropriate HTTP responses.

```typescript
import { Result } from 'neverthrow';

@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('transactions')
  async createTransaction(@Body() request: CreateLedgerTransactionDto) {
    const result: Result<LedgerTransactionDto, DomainError> = await this.commandBus.execute(
      new RecordTransactionCommand(request)
    );

    // The controller simply returns the result.
    // If it's an Err, unwrapOrThrow will throw the DomainError,
    // which is then caught by our GlobalExceptionFilter.
    return result.unwrapOrThrow();
  }

  @Get('accounts/:id/balance')
  async getBalance(@Param('id') accountId: number) {
    const result: Result<BalanceDto, DomainError> = await this.queryBus.execute(new GetAccountBalanceQuery(accountId));

    return result.unwrapOrThrow();
  }
}
```

### Handler Responsibilities vs. Worker Services

CQRS handlers are **orchestrators** of the domain model, not containers for complex business logic. Their role is to fetch domain aggregates from repositories, call their methods, and save the results.

```typescript
// ✅ CORRECT: Handler orchestrates the domain model
@CommandHandler(RecordTransactionCommand)
export class RecordTransactionHandler implements ICommandHandler<RecordTransactionCommand> {
  constructor(
    private readonly transactionRepository: ITransactionRepository, // Using interface from libs/core
    private readonly logger: LoggerService
  ) {}

  async execute(command: RecordTransactionCommand): ResultAsync<LedgerTransactionDto, DomainError> {
    const { userId, transactionData } = command;

    // 1. Use the domain aggregate's factory to create a valid transaction object.
    //    All validation and business rules are contained within the aggregate itself.
    const transactionResult = LedgerTransaction.create({
      userId,
      externalId: transactionData.externalId,
      // ... other data
    });

    if (transactionResult.isErr()) {
      // If the domain rules are violated, return the specific domain error.
      return errAsync(transactionResult.error);
    }

    const transaction = transactionResult.value;

    // 2. Add entries using the aggregate's methods, which enforce invariants.
    for (const entryData of transactionData.entries) {
      const entryResult = Entry.create(entryData);
      if (entryResult.isErr()) return errAsync(entryResult.error);

      const addEntryResult = transaction.addEntry(entryResult.value);
      if (addEntryResult.isErr()) return errAsync(addEntryResult.error);
    }

    // 3. Persist the valid aggregate state using the repository.
    //    The repository's job is persistence, not business logic.
    return this.transactionRepository.save(transaction).andThen(() => {
      this.logger.log(`Transaction recorded: ${transaction.id}`);
      return okAsync(this.mapToDto(transaction)); // Map aggregate state to DTO
    });
  }
}

// Structured batch result type
export interface BatchProcessingResult {
  successful: UniversalTransaction[];
  failed: Array<{
    rawDataId: string;
    error: DomainError;
  }>;
  summary: {
    total: number;
    successCount: number;
    failureCount: number;
  };
}

// ❌ INCORRECT: Handler tries to contain all business logic
@CommandHandler(ProcessUniversalTransactionsCommand)
export class ProcessUniversalTransactionsHandler {
  async execute(command: ProcessUniversalTransactionsCommand): Promise<UniversalTransaction[]> {
    // DON'T put complex trade pairing logic, dustsweeping, etc. directly in handler
    // This defeats the purpose of CQRS and makes testing difficult
  }
}
```

### Architecture Benefits

The CQRS pattern provides:

- Focused handlers with single responsibility
- Complex domain logic in specialized worker services
- Clear command/query separation
- Easy unit testing (mock handler dependencies, not entire services)
- Explicit business operations via command/query names

## Database Schema & Foundation

### Database Schema

The system implements a complete database schema with all tables, indexes, and constraints.

#### Project Setup:

```bash
# Install CQRS package for command/query pattern
pnpm add @nestjs/cqrs

# Applications
# - api: NestJS REST API application
# - cli: NestJS CLI application

# Libraries
# - core: Domain entities & types
# - database: Drizzle ORM integration
# - ledger: Ledger CQRS domain
# - import: Import CQRS domain
# - providers: Provider registry & circuit breakers
# - shared: Cross-cutting concerns
```

#### Typed Configuration Setup

The system uses a standalone, type-safe configuration package: `@exitbook/shared-config`. This module provides a robust and validated configuration object to the entire application.

**Key Features:**

- **Zod Schema:** Configuration is defined and validated using a Zod schema, making it the single source of truth.
- **Fail-Fast Validation:** The application will not start if the configuration is invalid, preventing runtime errors.
- **Cascading Load Strategy:** It intelligently loads configuration from `.env` files and environment-specific `.json` files (e.g., `providers.development.json`), allowing for flexible overrides.
- **Type-Safe Injection:** The final, validated `Configuration` object is available globally via the `'TYPED_CONFIG'` injection token.

#### Database Module with Drizzle Schema & Migrations:

```typescript
// libs/database/src/schema/users.ts
import { pgTable, serial, varchar, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// libs/database/src/schema/currencies.ts
import { pgTable, serial, varchar, integer, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const assetClassEnum = pgEnum('asset_class', ['CRYPTO', 'FIAT', 'NFT', 'STOCK']);

export const currencies = pgTable('currencies', {
  id: serial('id').primaryKey(),
  ticker: varchar('ticker', { length: 20 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  decimals: integer('decimals').notNull(),
  assetClass: assetClassEnum('asset_class').notNull(),
  network: varchar('network', { length: 50 }),
  contractAddress: varchar('contract_address', { length: 100 }),
  isNative: boolean('is_native').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// libs/database/src/schema/accounts.ts
import { pgTable, serial, varchar, timestamp, text, pgEnum, integer, uuid, index } from 'drizzle-orm/pg-core';
import { currencies } from './currencies';
import { users } from './users';

export const accountTypeEnum = pgEnum('account_type', [
  'ASSET_WALLET',
  'ASSET_EXCHANGE',
  'ASSET_DEFI_LP',
  'LIABILITY_LOAN',
  'EQUITY_OPENING_BALANCE',
  'EQUITY_MANUAL_ADJUSTMENT',
  'INCOME_STAKING',
  'INCOME_TRADING',
  'INCOME_AIRDROP',
  'INCOME_MINING',
  'EXPENSE_FEES_GAS',
  'EXPENSE_FEES_TRADE',
]);

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    currencyId: integer('currency_id')
      .references(() => currencies.id, { onDelete: 'restrict' })
      .notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    network: varchar('network', { length: 50 }),
    externalAddress: varchar('external_address', { length: 255 }),
    source: varchar('source', { length: 50 }),
    parentAccountId: integer('parent_account_id').references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index('accounts_user_id_idx').on(table.userId),
    userCurrencyIdx: index('accounts_user_currency_idx').on(table.userId, table.currencyId),
  })
);

// libs/database/src/schema/ledger.ts
import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
  bigint,
  pgEnum,
  uniqueIndex,
  integer,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { currencies } from './currencies';
import { users } from './users';

export const directionEnum = pgEnum('direction', ['CREDIT', 'DEBIT']);
export const entryTypeEnum = pgEnum('entry_type', [
  'TRADE',
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'REWARD',
  'STAKING',
  'AIRDROP',
  'MINING',
  'LOAN',
  'REPAYMENT',
  'TRANSFER',
  'GAS',
]);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    source: varchar('source', { length: 50 }).notNull(),
    description: text('description').notNull(),
    transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    externalIdSourceUserIdx: uniqueIndex('external_id_source_user_idx').on(
      table.userId,
      table.externalId,
      table.source
    ),
    userIdIdx: index('ledger_transactions_user_id_idx').on(table.userId),
    userDateIdx: index('ledger_transactions_user_date_idx').on(table.userId, table.transactionDate),
    userSourceIdx: index('ledger_transactions_user_source_idx').on(table.userId, table.source),
  })
);

export const entries = pgTable(
  'entries',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    transactionId: integer('transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'restrict' })
      .notNull(),
    currencyId: integer('currency_id')
      .references(() => currencies.id, { onDelete: 'restrict' })
      .notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    direction: directionEnum('direction').notNull(),
    entryType: entryTypeEnum('entry_type').notNull(),

    // ADDED: First-class storage for historical price
    // These columns are nullable as not all entries require pricing (e.g., a USD entry).
    priceAmount: bigint('price_amount', { mode: 'bigint' }),
    priceCurrencyId: integer('price_currency_id').references(() => currencies.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index('entries_user_id_idx').on(table.userId),
    userAccountCurrencyIdx: index('entries_user_account_currency_idx').on(
      table.userId,
      table.accountId,
      table.currencyId
    ),
    transactionIdx: index('entries_transaction_idx').on(table.transactionId),
    currencyIdx: index('entries_currency_idx').on(table.currencyId),
  })
);

// libs/database/src/database.module.ts
@Module({
  imports: [TypedConfigModule],
  providers: [
    {
      provide: 'DATABASE_CONNECTION',
      inject: ['TYPED_CONFIG'],
      useFactory: async (config: Configuration) => {
        const client = postgres(config.DATABASE_URL, {
          max: config.DATABASE_POOL_SIZE,
          ssl: config.DATABASE_SSL_MODE !== 'disable' ? { rejectUnauthorized: false } : false,
        });
        return drizzle(client, {
          schema: {
            currencies,
            accounts,
            ledgerTransactions,
            entries,
            blockchainTransactionDetails,
            exchangeTransactionDetails,
            transactionMetadata,
          },
        });
      },
    },
    DatabaseHealthService,
    CurrencySeederService,
  ],
  exports: ['DATABASE_CONNECTION', DatabaseHealthService],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    private currencySeeder: CurrencySeederService,
    private healthService: DatabaseHealthService,
    private logger: LoggerService
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing database module...');

    // Ensure global currencies are seeded on every application startup
    await this.currencySeeder.seedDefaultCurrencies();

    // Validate database health
    const isHealthy = await this.healthService.isHealthy();
    if (!isHealthy) {
      throw new Error('Database health check failed during startup');
    }

    this.logger.log('Database module initialized successfully');
  }
}

// libs/database/src/services/currency-seeder.service.ts
import { currencies } from '../schema';
@Injectable()
export class CurrencySeederService {
  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private logger: LoggerService
  ) {}

  /**
   * GLOBAL CURRENCY APPROACH:
   * Currencies are global and shared across all users.
   * Eliminates massive data duplication (10K currencies vs 100M+ user-scoped records).
   * Provides 10,000x reduction in currency records, faster queries, and simpler architecture.
   * No per-user provisioning needed - all users access the same currency table.
   */
  async seedDefaultCurrencies(): Promise<void> {
    this.logger.log('Starting global currency seeding process...');

    const globalCurrencies = [
      { ticker: 'BTC', name: 'Bitcoin', decimals: 8, assetClass: 'CRYPTO', isNative: true, network: 'bitcoin' },
      { ticker: 'ETH', name: 'Ethereum', decimals: 18, assetClass: 'CRYPTO', network: 'ethereum', isNative: true },
      {
        ticker: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        assetClass: 'CRYPTO',
        network: 'ethereum',
        contractAddress: '0xA0b86a33E6441e0fD4f5f6aF08e6E56fF29b4c3D',
      },
      { ticker: 'SOL', name: 'Solana', decimals: 9, assetClass: 'CRYPTO', network: 'solana', isNative: true },
      { ticker: 'USD', name: 'US Dollar', decimals: 2, assetClass: 'FIAT', isNative: true },
    ];

    let seededCount = 0;
    for (const currency of globalCurrencies) {
      try {
        const result = await this.db
          .insert(currencies)
          .values(currency)
          .onConflictDoNothing({ target: currencies.ticker })
          .returning({ ticker: currencies.ticker });

        if (result.length > 0) {
          seededCount++;
          this.logger.debug(`Seeded global currency: ${currency.ticker}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to seed global currency ${currency.ticker}: ${error.message}`);
      }
    }

    this.logger.log(
      `Global currency seeding completed. New currencies added: ${seededCount}, Total currencies: ${globalCurrencies.length}`
    );
  }

  async validateCurrencySeeding(): Promise<boolean> {
    const expectedCurrencies = ['BTC', 'ETH', 'USDC', 'SOL', 'USD'];

    try {
      const existingCurrencies = await this.db
        .select({ ticker: currencies.ticker })
        .from(currencies)
        .where(sql`${currencies.ticker} = ANY(${expectedCurrencies})`);

      const existingTickers = existingCurrencies.map(c => c.ticker);
      const missingCurrencies = expectedCurrencies.filter(ticker => !existingTickers.includes(ticker));

      if (missingCurrencies.length > 0) {
        this.logger.error(`Missing required currencies: ${missingCurrencies.join(', ')}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Currency validation failed: ${error.message}`);
      return false;
    }
  }
}

// libs/database/src/schema/blockchain-transaction-details.ts
import { pgTable, integer, varchar, timestamp, bigint, pgEnum, index } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const blockchainStatusEnum = pgEnum('blockchain_status', ['pending', 'confirmed', 'failed']);

export const blockchainTransactionDetails = pgTable(
  'blockchain_transaction_details',
  {
    transactionId: integer('transaction_id')
      .primaryKey()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    txHash: varchar('tx_hash', { length: 100 }).unique().notNull(),
    blockHeight: integer('block_height'),
    status: blockchainStatusEnum('status').notNull(),
    gasUsed: integer('gas_used'),
    gasPrice: bigint('gas_price', { mode: 'bigint' }), // Use bigint to prevent overflow with high gas prices
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    txHashIdx: index('idx_blockchain_tx_hash').on(table.txHash),
    statusIdx: index('idx_blockchain_status').on(table.status),
    blockHeightIdx: index('idx_blockchain_block_height').on(table.blockHeight),
  })
);

// libs/database/src/schema/exchange-transaction-details.ts
import { pgTable, integer, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const exchangeTransactionDetails = pgTable('exchange_transaction_details', {
  transactionId: integer('transaction_id')
    .primaryKey()
    .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
  orderId: varchar('order_id', { length: 100 }),
  tradeId: varchar('trade_id', { length: 100 }),
  symbol: varchar('symbol', { length: 20 }),
  side: tradeSideEnum('side'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// libs/database/src/schema/transaction-metadata.ts
import { pgTable, serial, integer, varchar, text, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const metadataTypeEnum = pgEnum('metadata_type', ['string', 'number', 'json', 'boolean']);

export const transactionMetadata = pgTable(
  'transaction_metadata',
  {
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' })
      .notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    value: text('value').notNull(),
    dataType: metadataTypeEnum('data_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    uniqueKeyPerTransaction: uniqueIndex('unique_transaction_metadata_key').on(table.transactionId, table.key),
  })
);

// libs/database/src/schema/index.ts
export * from './currencies';
export * from './accounts';
export * from './ledger';
export * from './blockchain-transaction-details';
export * from './exchange-transaction-details';
export * from './transaction-metadata';

// Generate initial migration
// pnpm drizzle-kit generate:pg --schema=libs/database/src/schema/index.ts --out=libs/database/src/migrations
// After generation, run CurrencySeederService.seedSystemDefaultCurrencies() in bootstrap

// libs/database/src/repositories/base.repository.ts
@Injectable()
export abstract class BaseRepository<T> {
  constructor(
    @Inject('DATABASE_CONNECTION') protected db: DrizzleDB,
    protected logger: Logger
  ) {}
}

// libs/database/src/repositories/ledger.repository.ts
@Injectable()
export class LedgerRepository extends BaseRepository<LedgerTransaction> {
  async createTransaction(transaction: CreateLedgerTransaction): Promise<LedgerTransaction> {
    return this.db.transaction(async trx => {
      // Validate entries balance per currency before inserting
      // Transaction balance validation at application level
      // within a database transaction, not via database triggers
      const entriesByCurrency = new Map<number, bigint>();

      for (const entry of transaction.entries) {
        const currentSum = entriesByCurrency.get(entry.currencyId) || 0n;
        entriesByCurrency.set(entry.currencyId, currentSum + entry.amount);
      }

      for (const [currencyId, sum] of entriesByCurrency) {
        if (sum !== 0n) {
          // Structured error with machine-readable data for API responses
          throw new LedgerValidationException({
            message: `Entries for currency ${currencyId} must balance to zero, got ${sum}`,
            code: 'ENTRIES_UNBALANCED',
            unbalancedCurrencies: [
              {
                currencyId,
                delta: sum.toString(),
                // Include currency ticker if available
                ticker: await this.getCurrencyTicker(currencyId),
              },
            ],
            transactionId: transaction.externalId,
            source: transaction.source,
          });
        }
      }

      // Insert transaction
      const [dbTransaction] = await trx
        .insert(ledgerTransactions)
        .values({
          externalId: transaction.externalId,
          source: transaction.source,
          description: transaction.description,
          transactionDate: transaction.transactionDate,
        })
        .returning();

      // Insert entries
      const dbEntries = await trx
        .insert(entries)
        .values(
          transaction.entries.map(entry => ({
            transactionId: dbTransaction.id,
            accountId: entry.accountId,
            currencyId: entry.currencyId,
            amount: entry.amount,
            direction: entry.direction,
            entryType: entry.entryType,
          }))
        )
        .returning();

      // Create blockchain or exchange details if provided
      if (transaction.blockchainDetails) {
        await trx.insert(blockchainTransactionDetails).values({
          transactionId: dbTransaction.id,
          ...transaction.blockchainDetails,
        });
      }

      if (transaction.exchangeDetails) {
        await trx.insert(exchangeTransactionDetails).values({
          transactionId: dbTransaction.id,
          ...transaction.exchangeDetails,
        });
      }

      // Create metadata entries if provided
      if (transaction.metadata) {
        const metadataEntries = Object.entries(transaction.metadata).map(([key, value]) => ({
          transactionId: dbTransaction.id,
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          dataType: typeof value,
        }));

        if (metadataEntries.length > 0) {
          await trx.insert(transactionMetadata).values(metadataEntries);
        }
      }

      return this.mapToLedgerTransaction(dbTransaction, dbEntries);
    });
  }

  async findTransactionByHash(txHash: string): Promise<LedgerTransaction | null> {
    const result = await this.db
      .select()
      .from(ledgerTransactions)
      .innerJoin(blockchainTransactionDetails, eq(ledgerTransactions.id, blockchainTransactionDetails.transactionId))
      .where(eq(blockchainTransactionDetails.txHash, txHash))
      .limit(1);

    return result.length > 0 ? this.mapToLedgerTransaction(result[0].ledger_transactions, []) : null;
  }

  async handleIdempotentTransaction(transaction: CreateLedgerTransaction): Promise<LedgerTransaction> {
    try {
      return await this.createTransaction(transaction);
    } catch (error) {
      // Check if it's a unique constraint violation on (external_id, source)
      if (error.constraint === 'external_id_source_idx') {
        // Find and return existing transaction
        const existing = await this.db
          .select()
          .from(ledgerTransactions)
          .where(
            and(
              eq(ledgerTransactions.externalId, transaction.externalId),
              eq(ledgerTransactions.source, transaction.source)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          return this.mapToLedgerTransaction(existing[0], []);
        }
      }
      throw error;
    }
  }

  async getAccountBalance(accountId: number): Promise<Balance> {
    const result = await this.db
      .select({
        balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
        currencyTicker: currencies.ticker,
        currencyDecimals: currencies.decimals,
      })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
      .where(eq(entries.accountId, accountId))
      .groupBy(currencies.ticker, currencies.decimals);

    if (result.length === 0) {
      throw new AccountNotFoundException(`Account ${accountId} not found`);
    }

    return {
      amount: BigInt(result[0].balance),
      currency: result[0].currencyTicker,
      decimals: result[0].currencyDecimals,
    };
  }

  async getAllBalancesByCurrency(): Promise<Record<string, Balance[]>> {
    const result = await this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
        currencyTicker: currencies.ticker,
        currencyDecimals: currencies.decimals,
      })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
      .groupBy(accounts.id, accounts.name, currencies.ticker, currencies.decimals)
      .having(sql`sum(${entries.amount}) != 0`);

    const balancesByCurrency: Record<string, Balance[]> = {};

    for (const row of result) {
      const currency = row.currencyTicker;
      if (!balancesByCurrency[currency]) {
        balancesByCurrency[currency] = [];
      }

      balancesByCurrency[currency].push({
        accountId: row.accountId,
        accountName: row.accountName,
        amount: BigInt(row.balance),
        currency: row.currencyTicker,
        decimals: row.currencyDecimals,
      });
    }

    return balancesByCurrency;
  }
}
```

#### Database Triggers for Data Integrity:

Transaction balance validation is handled at the application level (see LedgerRepository.createTransaction), not via database triggers, due to the logical impossibility of validating multi-entry balance during individual row insertion.

```sql
-- Apply these triggers after initial schema creation
-- libs/database/src/migrations/add-triggers.sql

-- NOTE: Transaction balance validation is handled in APPLICATION LAYER
-- Database triggers for balance validation would fail because they fire after
-- each individual entry insert, not after all entries for a transaction.
-- See LedgerRepository.createTransaction() for correct implementation.

-- Ensure currency_id in entries matches account's currency
CREATE OR REPLACE FUNCTION validate_entry_currency_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = NEW.account_id
    AND a.currency_id = NEW.currency_id
  ) THEN
    RAISE EXCEPTION 'Entry currency_id must match account currency_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_validate_entry_currency
  BEFORE INSERT ON entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_entry_currency_consistency();

-- Ensure direction matches amount sign
CREATE OR REPLACE FUNCTION validate_entry_direction()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.direction = 'CREDIT' AND NEW.amount < 0) OR
     (NEW.direction = 'DEBIT' AND NEW.amount > 0) THEN
    RAISE EXCEPTION 'Entry direction must match amount sign';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_validate_entry_direction
  BEFORE INSERT ON entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_entry_direction();
```

#### Deployment Pipeline Requirements:

```yaml
# docker-compose.yml - Production deployment
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: crypto_tx_import
      POSTGRES_USER: crypto_user
      POSTGRES_PASSWORD: crypto_pass
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # Run migrations on startup
    command: >
      bash -c "postgres &
      sleep 10 &&
      cd /app &&
      pnpm drizzle-kit migrate &&
      wait"

  api:
    build:
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://crypto_user:crypto_pass@postgres:5432/crypto_tx_import
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
    # Explicit migration step before app starts
    command: >
      bash -c "pnpm drizzle-kit migrate &&
      node main.js"

# CI/CD Pipeline Step
- name: Database Migration
  run: |
    echo "Running database migrations..."
    pnpm drizzle-kit migrate
    echo "Migrations completed successfully"

- name: Start Application
  run: |
    echo "Starting application server..."
    pnpm start
```

#### Database Health Service:

```typescript
// libs/database/src/services/database-health.service.ts
@Injectable()
export class DatabaseHealthService {
  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private currencySeeder: CurrencySeederService,
    private logger: LoggerService
  ) {}

  async isHealthy(): Promise<boolean> {
    try {
      // Test database connectivity
      await this.db
        .select({ count: sql<number>`count(*)` })
        .from(currencies)
        .limit(1);

      // Validate currency seeding completed
      const seedingValid = await this.currencySeeder.validateCurrencySeeding();
      if (!seedingValid) {
        this.logger.error('Currency seeding validation failed');
        return false;
      }

      // Test account/currency relationship integrity
      const relationshipTest = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(accounts)
        .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
        .limit(1);

      this.logger.log('Database health check passed');
      return true;
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return false;
    }
  }

  async getHealthMetrics(): Promise<{
    databaseConnected: boolean;
    currenciesSeeded: boolean;
    totalCurrencies: number;
    totalAccounts: number;
    totalTransactions: number;
  }> {
    try {
      const [currencyCount] = await this.db.select({ count: sql<number>`count(*)` }).from(currencies);

      const [accountCount] = await this.db.select({ count: sql<number>`count(*)` }).from(accounts);

      const [transactionCount] = await this.db.select({ count: sql<number>`count(*)` }).from(ledgerTransactions);

      return {
        databaseConnected: true,
        currenciesSeeded: currencyCount.count >= 5, // BTC, ETH, USDC, SOL, USD
        totalCurrencies: currencyCount.count,
        totalAccounts: accountCount.count,
        totalTransactions: transactionCount.count,
      };
    } catch (error) {
      return {
        databaseConnected: false,
        currenciesSeeded: false,
        totalCurrencies: 0,
        totalAccounts: 0,
        totalTransactions: 0,
      };
    }
  }
}
```

#### Production Monitoring Integration:

```typescript
// libs/shared/src/metrics/prometheus-metrics.service.ts
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class PrometheusMetricsService {
  private readonly registry = new Registry();

  private readonly transactionProcessingDuration = new Histogram({
    name: 'ledger_transaction_processing_duration_seconds',
    help: 'Time spent processing transactions',
    labelNames: ['source', 'type', 'status'],
  });

  private readonly balanceCalculationDuration = new Histogram({
    name: 'ledger_balance_calculation_duration_seconds',
    help: 'Time spent calculating balances',
    labelNames: ['currency', 'account_type'],
  });

  private readonly validationFailures = new Counter({
    name: 'ledger_validation_failures_total',
    help: 'Number of validation failures',
    labelNames: ['type', 'currency'],
  });

  private readonly importSuccessRate = new Counter({
    name: 'import_operations_total',
    help: 'Total import operations',
    labelNames: ['source', 'status'],
  });

  private readonly activeConnections = new Gauge({
    name: 'database_active_connections',
    help: 'Number of active database connections',
  });

  constructor() {
    this.registry.registerMetric(this.transactionProcessingDuration);
    this.registry.registerMetric(this.balanceCalculationDuration);
    this.registry.registerMetric(this.validationFailures);
    this.registry.registerMetric(this.importSuccessRate);
    this.registry.registerMetric(this.activeConnections);
  }

  recordTransactionProcessing(source: string, type: string, status: 'success' | 'error', duration: number) {
    this.transactionProcessingDuration.labels(source, type, status).observe(duration);
  }

  recordValidationFailure(type: string, currency: string) {
    this.validationFailures.labels(type, currency).inc();
  }

  recordImportOperation(source: string, status: 'success' | 'error') {
    this.importSuccessRate.labels(source, status).inc();
  }

  updateActiveConnections(count: number) {
    this.activeConnections.set(count);
  }

  getMetrics(): string {
    return this.registry.metrics();
  }
}

// Add to apps/api/src/controllers/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private healthService: DatabaseHealthService,
    private metricsService: PrometheusMetricsService
  ) {}

  @Get()
  async healthCheck() {
    const isHealthy = await this.healthService.isHealthy();
    const metrics = await this.healthService.getHealthMetrics();

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      ...metrics,
    };
  }

  @Get('metrics')
  getMetrics() {
    return this.metricsService.getMetrics();
  }
}
```

The system includes complete database schema with all tables, indexes, constraints, triggers, automated seeding, health checks, and production monitoring.

### Repository Pattern: Interfaces vs. Implementations

The architecture strictly separates the domain model from the persistence mechanism.

1.  **Repository Interfaces (in `libs/core`):** The `core` library defines the _contracts_ for persistence (e.g., `ITransactionRepository`). These interfaces are pure and have no knowledge of databases or Drizzle. The domain model depends only on these interfaces.

2.  **Repository Implementations (in `libs/database`):** The `database` library provides the concrete Drizzle ORM implementations of those interfaces. These classes are responsible for mapping the domain aggregates to the database schema and performing the actual database operations.

**This shifts business logic out of the repository and into the domain model.**

- **Before (Logic in Repository):** The repository was responsible for validating business rules, like ensuring a transaction was balanced.

- **After (Logic in Aggregate):** The repository's _only_ job is persistence. It receives a `LedgerTransaction` aggregate that is already guaranteed to be valid by its own internal logic.

  ```typescript
  // New Responsibility of the Repository Implementation in libs/database

  @Injectable()
  export class DrizzleTransactionRepository implements ITransactionRepository {
    constructor(@Inject('DATABASE_CONNECTION') private db: DrizzleDB) {}

    async save(transaction: LedgerTransaction): ResultAsync<void, DomainError> {
      // The 'transaction' object is already validated by the domain.
      // The repository's only job is to map and save.
      const state = transaction.getState(); // Get raw data from the aggregate

      return ResultAsync.fromPromise(
        this.db.transaction(async trx => {
          // Map aggregate state to Drizzle schema and insert/update.
          // Contains NO business logic.
        }),
        (error: Error) => new DomainError(error.message, 'DATABASE_ERROR')
      );
    }
  }
  ```

### First-Class Historical Price Handling

For accurate cost-basis tracking and tax reporting, historical price is a first-class citizen of every financial event. The system is designed to handle this from day one, ensuring financial integrity and preventing future technical debt.

#### Core Principle: Price Belongs to the `Entry`

The most critical design decision is that **price information is attached to the `Entry` entity, not the `LedgerTransaction` aggregate.** This provides the necessary granularity for complex financial scenarios:

- **Trades**: In a BTC/USD trade, the BTC `Entry` is priced in USD. Attaching a single price to the parent `LedgerTransaction` would be ambiguous.
- **Fees**: A transaction fee can be paid in a third currency (e.g., BNB for an ETH swap) and requires its own distinct price.
- **Clarity**: Each movement of value (an `Entry`) has a Fair Market Value at that moment. The model must capture this one-to-one relationship.

#### Domain Model Changes (`libs/core`)

The `Entry` entity is enhanced to optionally include a `price` as a `Money` value object.

```typescript
// libs/core/src/aggregates/transaction/entry.entity.ts
export interface CreateEntryData {
  accountId: number;
  amount: Money;
  price?: Money; // The price of ONE unit of the amount's currency
  description?: string;
  metadata?: Record<string, any>;
}
```

#### Price Provider Infrastructure (`libs/providers`)

To decouple price fetching from business logic, the system uses a dedicated provider interface. This allows for interchangeable sources (e.g., CoinGecko, Kaiko, internal systems) and robust testing.

- **`IPriceProvider` Interface**: Defines the contract for fetching historical prices.
- **Caching Layer**: A `HistoricalPriceService` acts as a caching layer on top of the provider to minimize redundant and costly API calls.

```typescript
// libs/providers/src/pricing/price-provider.interface.ts
export interface IPriceProvider {
  fetchPrice(baseAsset: string, quoteAsset: string, timestamp: Date): Promise<Result<Money, PriceProviderError>>;
}
```

#### Integration into CQRS Flow

The price enrichment happens during the import pipeline, before domain objects are created. The `ProcessUniversalTransactionsHandler` will be responsible for:

1.  Calling the `HistoricalPriceService` with the transaction's asset and timestamp.
2.  Passing the resulting `Money` object (the price) into the `Entry.create()` factory method.
3.  The `LedgerRepository` then persists this price data into the dedicated columns on the `entries` table.

## CQRS Command & Query Handlers

### Production-Grade Logging

The system uses a standalone logging package: `@exitbook/shared-logger`. This module provides high-performance, structured (JSON) logging suitable for production environments.

**Key Features:**

- **Pino-Powered:** Leverages the Pino logger for speed and low overhead.
- **Correlation Tracking:** A `CorrelationService` establishes a unique ID for each request (API) or execution (CLI), which is automatically included in all log entries for easy tracing.
- **Structured Logging:** All logs are emitted as JSON, making them easily parsable by log management systems.
- **Centralized Integration:** A `LoggingInterceptor` (for API) and a `GlobalExceptionFilter` provide zero-configuration observability for HTTP requests and unhandled errors.

### Ledger Command Handlers:

```typescript
// libs/ledger/src/commands/handlers/record-transaction.handler.ts
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

// libs/ledger/src/commands/impl/record-transaction.command.ts
export class RecordTransactionCommand {
  constructor(
    public readonly userId: string,
    public readonly transactionRequest: CreateLedgerTransactionDto
  ) {}
}

@CommandHandler(RecordTransactionCommand)
export class RecordTransactionHandler implements ICommandHandler<RecordTransactionCommand> {
  constructor(
    private readonly ledgerRepository: LedgerRepository,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(command: RecordTransactionCommand): Promise<LedgerTransactionDto> {
    const { userId, transactionRequest } = command;

    this.logger.log(`Recording transaction from ${transactionRequest.source}`);

    try {
      // Handler delegates to repository for database transaction management
      // The repository performs balance validation within a database transaction
      const ledgerTransaction = await this.ledgerRepository.createTransaction(userId, {
        externalId: transactionRequest.externalId,
        source: transactionRequest.source,
        description: transactionRequest.description,
        transactionDate: new Date(transactionRequest.transactionDate),
        entries: transactionRequest.entries.map(entry => ({
          accountId: entry.accountId,
          currencyId: entry.currencyId,
          amount: BigInt(entry.amount),
          direction: entry.direction,
          entryType: entry.entryType,
        })),
      });

      return this.mapToDto(ledgerTransaction);
    } catch (error) {
      this.logger.error(`Failed to record transaction: ${error.message}`);
      throw new LedgerServiceException(`Failed to record transaction: ${error.message}`);
    }
  }

  private mapToDto(ledgerTransaction: any): LedgerTransactionDto {
    return {
      id: ledgerTransaction.id,
      externalId: ledgerTransaction.externalId,
      source: ledgerTransaction.source,
      description: ledgerTransaction.description,
      transactionDate: ledgerTransaction.transactionDate.toISOString(),
      entries: ledgerTransaction.entries.map(entry => ({
        id: entry.id,
        accountId: entry.accountId,
        currencyId: entry.currencyId,
        amount: entry.amount.toString(),
        direction: entry.direction,
        entryType: entry.entryType,
      })),
    };
  }
}

// libs/ledger/src/commands/impl/create-account.command.ts
export class CreateAccountCommand {
  constructor(
    public readonly userId: string,
    public readonly accountRequest: FindOrCreateAccountDto
  ) {}
}

// libs/ledger/src/commands/handlers/create-account.handler.ts
@CommandHandler(CreateAccountCommand)
export class CreateAccountHandler implements ICommandHandler<CreateAccountCommand> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly currencyService: CurrencyService,
    private readonly logger: LoggerService
  ) {}

  async execute(command: CreateAccountCommand): Promise<AccountDto> {
    const { userId, accountRequest } = command;

    // Single-purpose account creation logic
    const existing = await this.accountRepository.findByIdentifier(
      userId,
      accountRequest.currencyTicker,
      accountRequest.source,
      accountRequest.network
    );

    if (existing) {
      return this.mapToDto(existing);
    }

    const account = await this.accountRepository.create(userId, {
      name: this.generateAccountName(accountRequest),
      currencyTicker: accountRequest.currencyTicker,
      accountType: accountRequest.accountType,
      network: accountRequest.network,
      externalAddress: accountRequest.externalAddress,
    });

    this.logger.log(`Created new account: ${account.name}`);
    return this.mapToDto(account);
  }

  private generateAccountName(request: FindOrCreateAccountDto): string {
    const parts = [request.accountType, request.currencyTicker];
    if (request.network) parts.push(request.network);
    if (request.source) parts.push(`(${request.source})`);
    return parts.join(' ');
  }

  private mapToDto(account: any): AccountDto {
    // Mapping logic
  }
}
```

#### CQRS Ledger Query Handlers:

```typescript
// libs/ledger/src/queries/handlers/get-account-balance.handler.ts
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

// libs/ledger/src/queries/impl/get-account-balance.query.ts
export class GetAccountBalanceQuery {
  constructor(
    public readonly userId: string,
    public readonly accountId: number
  ) {}
}

@QueryHandler(GetAccountBalanceQuery)
export class GetAccountBalanceHandler implements IQueryHandler<GetAccountBalanceQuery> {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  async execute(query: GetAccountBalanceQuery): Promise<BalanceDto> {
    const { userId, accountId } = query;
    const balance = await this.ledgerRepository.getAccountBalance(userId, accountId);

    return {
      accountId,
      amount: balance.amount.toString(),
      currency: balance.currency,
      decimals: balance.decimals,
    };
  }
}

// libs/ledger/src/queries/impl/get-all-balances.query.ts
export class GetAllBalancesQuery {
  constructor(public readonly userId: string) {}
}

// libs/ledger/src/queries/handlers/get-all-balances.handler.ts
@QueryHandler(GetAllBalancesQuery)
export class GetAllBalancesHandler implements IQueryHandler<GetAllBalancesQuery> {
  constructor(
    private readonly ledgerRepository: LedgerRepository,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(query: GetAllBalancesQuery): Promise<BalanceDto[]> {
    const { userId } = query;
    const startTime = Date.now();

    try {
      // Direct repository call instead of going through AccountService
      const balancesByCurrency = await this.ledgerRepository.getAllBalancesByCurrency(userId);

      const allBalances: BalanceDto[] = [];
      for (const [currency, balances] of Object.entries(balancesByCurrency)) {
        allBalances.push(
          ...balances.map(balance => ({
            accountId: balance.accountId,
            accountName: balance.accountName,
            amount: balance.amount.toString(),
            currency: balance.currency,
            decimals: balance.decimals,
          }))
        );
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Balance calculation completed in ${duration}s for ${allBalances.length} accounts`);

      return allBalances.filter(balance => BigInt(balance.amount) !== 0n);
    } catch (error) {
      this.logger.error(`Balance calculation failed: ${error.message}`);
      throw new LedgerServiceException(`Failed to calculate balances: ${error.message}`);
    }
  }
}

// libs/ledger/src/queries/impl/find-transaction-by-id.query.ts
export class FindTransactionByIdQuery {
  constructor(
    public readonly userId: string,
    public readonly transactionId: number
  ) {}
}

// libs/ledger/src/queries/handlers/find-transaction-by-id.handler.ts
@QueryHandler(FindTransactionByIdQuery)
export class FindTransactionByIdHandler implements IQueryHandler<FindTransactionByIdQuery> {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  async execute(query: FindTransactionByIdQuery): Promise<LedgerTransactionDto | null> {
    const { userId, transactionId } = query;
    const transaction = await this.ledgerRepository.findById(userId, transactionId);

    return transaction ? this.mapToDto(transaction) : null;
  }

  private mapToDto(transaction: any): LedgerTransactionDto {
    // Mapping logic
  }
}
```

#### CQRS Module Setup:

```typescript
// libs/ledger/src/ledger.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DatabaseModule } from '../database/database.module';
import { CreateAccountHandler } from './commands/handlers/create-account.handler';
// Command Handlers
import { RecordTransactionHandler } from './commands/handlers/record-transaction.handler';
import { FindTransactionByIdHandler } from './queries/handlers/find-transaction-by-id.handler';
// Query Handlers
import { GetAccountBalanceHandler } from './queries/handlers/get-account-balance.handler';
import { GetAllBalancesHandler } from './queries/handlers/get-all-balances.handler';

export const CommandHandlers = [RecordTransactionHandler, CreateAccountHandler];

export const QueryHandlers = [GetAccountBalanceHandler, GetAllBalancesHandler, FindTransactionByIdHandler];

@Module({
  imports: [CqrsModule, DatabaseModule],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    // Keep essential services that handlers depend on
    CurrencyService, // Still needed for currency lookups
    UniversalToLedgerTransformerService,
  ],
  exports: [...CommandHandlers, ...QueryHandlers, CurrencyService, UniversalToLedgerTransformerService],
})
export class LedgerModule {}
```

#### Critical Repository Implementation with Balance Validation:

```typescript
// libs/database/src/repositories/ledger.repository.ts
import { ResultAsync, errAsync } from 'neverthrow';

@Injectable()
export class LedgerRepository extends BaseRepository<LedgerTransaction> {
  constructor(
    @Inject('DATABASE_CONNECTION') protected db: DrizzleDB,
    protected logger: Logger
  ) {
    super(db, logger);
  }

  async createTransaction(
    userId: string,
    transaction: CreateLedgerTransaction
  ): ResultAsync<LedgerTransaction, LedgerValidationError> {
    return ResultAsync.fromPromise(
      this.db.transaction(async trx => {
        const entriesByCurrency = new Map<number, bigint>();

        for (const entry of transaction.entries) {
          const currentSum = entriesByCurrency.get(entry.currencyId) || 0n;
          entriesByCurrency.set(entry.currencyId, currentSum + entry.amount);
        }

        // Validate balance before proceeding
        const unbalancedCurrencies = [];
        for (const [currencyId, sum] of entriesByCurrency) {
          if (sum !== 0n) {
            const currency = await this.getCurrencyTicker(currencyId);
            unbalancedCurrencies.push({
              currencyId,
              delta: sum.toString(),
              ticker: currency,
            });
          }
        }

        if (unbalancedCurrencies.length > 0) {
          throw new LedgerValidationError({ unbalancedCurrencies });
        }

        const [dbTransaction] = await trx
          .insert(ledgerTransactions)
          .values({
            userId,
            externalId: transaction.externalId,
            source: transaction.source,
            description: transaction.description,
            transactionDate: transaction.transactionDate,
          })
          .returning();

        // Insert entries, now including price data
        const dbEntries = await trx
          .insert(entries)
          .values(
            transaction.entries.map(entry => {
              const entryState = entry.getState(); // Get state from domain entity
              return {
                userId,
                transactionId: dbTransaction.id,
                accountId: entryState.accountId,
                currencyId: entryState.currencyId,
                amount: entryState.amount.value,
                direction: entryState.direction,
                entryType: entryState.entryType,
                // Map price from Money VO to database columns
                priceAmount: entryState.price ? entryState.price.value : null,
                priceCurrencyId: entryState.price ? entryState.priceCurrencyId : null, // Assumes priceCurrencyId is attached
              };
            })
          )
          .returning();

        // Handle blockchain/exchange details if provided
        if (transaction.blockchainDetails) {
          await trx.insert(blockchainTransactionDetails).values({
            transactionId: dbTransaction.id,
            ...transaction.blockchainDetails,
          });
        }

        if (transaction.exchangeDetails) {
          await trx.insert(exchangeTransactionDetails).values({
            transactionId: dbTransaction.id,
            ...transaction.exchangeDetails,
          });
        }

        // Create metadata entries if provided
        if (transaction.metadata) {
          const metadataEntries = Object.entries(transaction.metadata).map(([key, value]) => ({
            transactionId: dbTransaction.id,
            key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
            dataType: typeof value as 'string' | 'number' | 'json' | 'boolean',
          }));

          if (metadataEntries.length > 0) {
            await trx.insert(transactionMetadata).values(metadataEntries);
          }
        }

        return this.mapToLedgerTransaction(dbTransaction, dbEntries);
      }),
      (error: Error) => {
        // Map database errors to domain errors
        if (error instanceof LedgerValidationError) {
          return error;
        }
        return new DomainError(error.message, 'DATABASE_ERROR', { originalError: error });
      }
    );
  }

  /**
   * Handle idempotent transactions with unique constraint recovery
   * Critical for preventing duplicate imports during retried operations
   */
  async handleIdempotentTransaction(
    userId: string,
    transaction: CreateLedgerTransaction
  ): ResultAsync<LedgerTransaction, DomainError> {
    return this.createTransaction(userId, transaction).orElse(error => {
      // Handle unique constraint violations for idempotency
      if (error.details?.originalError?.constraint === 'external_id_source_user_idx') {
        return ResultAsync.fromPromise(
          this.db
            .select()
            .from(ledgerTransactions)
            .where(
              and(
                eq(ledgerTransactions.userId, userId),
                eq(ledgerTransactions.externalId, transaction.externalId),
                eq(ledgerTransactions.source, transaction.source)
              )
            )
            .limit(1)
            .then(async existing => {
              if (existing.length > 0) {
                const entriesResult = await this.db
                  .select()
                  .from(entries)
                  .where(and(eq(entries.userId, userId), eq(entries.transactionId, existing[0].id)));

                return this.mapToLedgerTransaction(existing[0], entriesResult);
              }
              throw new DomainError('Transaction not found after constraint violation', 'TRANSACTION_NOT_FOUND');
            }),
          (dbError: Error) => new DomainError(dbError.message, 'DATABASE_ERROR', { originalError: dbError })
        );
      }

      // Re-throw other errors
      return errAsync(error);
    });
  }

  async getAccountBalance(userId: string, accountId: number): ResultAsync<Balance, AccountNotFoundError> {
    return ResultAsync.fromPromise(
      this.db
        .select({
          balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
          currencyTicker: currencies.ticker,
          currencyDecimals: currencies.decimals,
        })
        .from(entries)
        .innerJoin(accounts, eq(entries.accountId, accounts.id))
        .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
        .where(and(eq(entries.userId, userId), eq(entries.accountId, accountId)))
        .groupBy(currencies.ticker, currencies.decimals),
      (error: Error) => new DomainError(error.message, 'DATABASE_ERROR', { originalError: error })
    ).andThen(result => {
      if (result.length === 0) {
        return errAsync(new AccountNotFoundError(accountId));
      }

      return okAsync({
        amount: BigInt(result[0].balance),
        currency: result[0].currencyTicker,
        decimals: result[0].currencyDecimals,
      });
    });
  }

  async getAllBalancesByCurrency(userId: string): Promise<Record<string, Balance[]>> {
    const result = await this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
        currencyTicker: currencies.ticker,
        currencyDecimals: currencies.decimals,
      })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .innerJoin(currencies, eq(accounts.currencyId, currencies.id))
      .where(eq(entries.userId, userId))
      .groupBy(accounts.id, accounts.name, currencies.ticker, currencies.decimals)
      .having(sql`sum(${entries.amount}) != 0`);

    const balancesByCurrency: Record<string, Balance[]> = {};

    for (const row of result) {
      const currency = row.currencyTicker;
      if (!balancesByCurrency[currency]) {
        balancesByCurrency[currency] = [];
      }

      balancesByCurrency[currency].push({
        accountId: row.accountId,
        accountName: row.accountName,
        amount: BigInt(row.balance),
        currency: row.currencyTicker,
        decimals: row.currencyDecimals,
      });
    }

    return balancesByCurrency;
  }

  private async getCurrencyTicker(currencyId: number): Promise<string> {
    const result = await this.db
      .select({ ticker: currencies.ticker })
      .from(currencies)
      .where(eq(currencies.id, currencyId))
      .limit(1);

    return result[0]?.ticker || `Currency#${currencyId}`;
  }

  private mapToLedgerTransaction(dbTransaction: any, dbEntries: any[]): LedgerTransaction {
    return {
      id: dbTransaction.id,
      externalId: dbTransaction.externalId,
      source: dbTransaction.source,
      description: dbTransaction.description,
      transactionDate: dbTransaction.transactionDate,
      entries: dbEntries.map(entry => ({
        id: entry.id,
        accountId: entry.accountId,
        currencyId: entry.currencyId,
        amount: entry.amount,
        direction: entry.direction,
        entryType: entry.entryType,
      })),
    };
  }
}
```

#### High-Performance Currency Service with Caching:

```typescript
// libs/ledger/src/services/currency.service.ts
@Injectable()
export class CurrencyService implements OnModuleInit {
  /**
   * GLOBAL CURRENCY APPROACH:
   * Currencies are global and shared across all users.
   * Uses Redis-based caching with global keys (no user scoping needed).
   * Cache keys: currency:${ticker} and currency:id:${id}
   *
   * Benefits:
   * - 10,000x reduction in currency records (10K vs 100M+ user-scoped)
   * - Faster queries - no user joins needed
   * - Simpler architecture - currency metadata is truly global
   * - Better cache utilization - shared across all users
   */
  private redisClient: Redis;

  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    @Inject('REDIS_CLIENT') private redis: Redis,
    private logger: LoggerService
  ) {
    this.redisClient = redis;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('CurrencyService initialized with global currency caching');
  }

  /**
   * High-performance global currency lookup by ticker (Redis cached)
   * Critical for import processing where currency lookups happen in tight loops
   */
  async findByTicker(ticker: string): Promise<CurrencyDto | null> {
    const cacheKey = `currency:${ticker.toUpperCase()}`;

    try {
      // Try Redis cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Cache miss - fetch from global currency table
      const result = await this.db
        .select()
        .from(currencies)
        .where(eq(currencies.ticker, ticker.toUpperCase()))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const currencyDto = this.mapToDto(result[0]);

      // Cache for 1 hour (currencies rarely change)
      await this.redisClient.setex(cacheKey, 3600, JSON.stringify(currencyDto));

      return currencyDto;
    } catch (error) {
      this.logger.error(`Failed to lookup currency ${ticker}: ${error.message}`);
      // Fallback to database on Redis failure
      const result = await this.db
        .select()
        .from(currencies)
        .where(eq(currencies.ticker, ticker.toUpperCase()))
        .limit(1);

      return result.length > 0 ? this.mapToDto(result[0]) : null;
    }
  }

  /**
   * High-performance global currency lookup by ID (Redis cached)
   */
  async findById(id: number): Promise<CurrencyDto | null> {
    const cacheKey = `currency:id:${id}`;

    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await this.db.select().from(currencies).where(eq(currencies.id, id)).limit(1);

      if (result.length === 0) {
        return null;
      }

      const currencyDto = this.mapToDto(result[0]);
      await this.redisClient.setex(cacheKey, 3600, JSON.stringify(currencyDto));

      return currencyDto;
    } catch (error) {
      this.logger.error(`Failed to lookup currency ID ${id}: ${error.message}`);
      const result = await this.db.select().from(currencies).where(eq(currencies.id, id)).limit(1);

      return result.length > 0 ? this.mapToDto(result[0]) : null;
    }
  }

  /**
   * Create new global currency and update cache
   * Used for dynamic currency addition during imports
   * Note: Only admin/system operations should create currencies
   */
  async create(request: CreateCurrencyDto): Promise<CurrencyDto> {
    // Check if currency already exists globally
    const existing = await this.findByTicker(request.ticker);
    if (existing) {
      this.logger.warn(`Currency ${request.ticker} already exists globally`);
      return existing;
    }

    const newCurrency = await this.db
      .insert(currencies)
      .values({
        ticker: request.ticker.toUpperCase(),
        name: request.name,
        decimals: request.decimals,
        assetClass: request.assetClass,
        network: request.network,
        contractAddress: request.contractAddress,
        isNative: request.isNative || false,
      })
      .returning();

    const currencyDto = this.mapToDto(newCurrency[0]);

    // Update Redis cache immediately with global keys
    const tickerCacheKey = `currency:${currencyDto.ticker}`;
    const idCacheKey = `currency:id:${currencyDto.id}`;

    try {
      await Promise.all([
        this.redisClient.setex(tickerCacheKey, 3600, JSON.stringify(currencyDto)),
        this.redisClient.setex(idCacheKey, 3600, JSON.stringify(currencyDto)),
      ]);
    } catch (error) {
      this.logger.warn(`Failed to update Redis cache for new currency ${currencyDto.ticker}: ${error.message}`);
    }

    this.logger.log(`Created global currency: ${currencyDto.ticker}`);
    return currencyDto;
  }

  /**
   * Invalidate global currency cache (useful for admin operations)
   */
  async invalidateGlobalCache(): Promise<void> {
    try {
      const pattern = `currency:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
        this.logger.log(`Invalidated ${keys.length} global currency cache entries`);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate global currency cache: ${error.message}`);
    }
  }

  /**
   * Get cache statistics for monitoring (global)
   */
  async getCacheStats(): Promise<{ cachedCount: number; pattern: string }> {
    try {
      const pattern = `currency:*`;
      const keys = await this.redisClient.keys(pattern);
      return {
        cachedCount: keys.length,
        pattern,
      };
    } catch (error) {
      this.logger.error(`Failed to get global cache stats: ${error.message}`);
      return { cachedCount: 0, pattern: 'currency:*' };
    }
  }

  private mapToDto(currency: any): CurrencyDto {
    return {
      id: currency.id,
      ticker: currency.ticker,
      name: currency.name,
      decimals: currency.decimals,
      assetClass: currency.assetClass,
      network: currency.network,
      contractAddress: currency.contractAddress,
      isNative: currency.isNative,
    };
  }
}
```

CQRS handlers eliminate large services, providing focused single-purpose classes and clear separation of concerns while preserving domain logic in specialized worker services.

## Domain Services & Business Logic Engines

While CQRS handlers orchestrate data flow, the complex, multi-aggregate business logic resides in dedicated domain services. These services represent the core value proposition of the portfolio application, providing users with critical financial insights. They are called by CQRS handlers and operate on the domain aggregates.

### Pillar 1: Reporting & Analytics

#### Portfolio Valuation Service

- **Business Need**: Provides a real-time snapshot of the user's entire portfolio, valued in their preferred fiat currency.
- **Dependencies**:
  - `GetAllBalancesQuery`: To fetch the quantity of all held assets.
  - `RealTimePriceProvider`: A new, dedicated price provider for fetching current market prices with a short cache duration (1-5 minutes).
- **Output**: A `PortfolioSnapshotDto` detailing the value of each asset and the total portfolio value.

#### Cost Basis & Capital Gains Engine

- **Business Need**: The core tax-reporting engine, responsible for calculating profit and loss for every disposal event (sell, trade, spend).
- **Architectural Consideration**: This requires a **`tax_lots` table** to track individual parcels of assets acquired at a specific time and price. The double-entry ledger confirms accounting correctness, while the `tax_lots` table provides the necessary detail for tax-lot accounting. This table will be populated by a domain event listener that triggers on asset acquisition entries.
- **Implementation**: A `CostBasisEngine` domain service that implements user-configurable accounting methods (e.g., FIFO, HIFO).
- **Dependencies**:
  - `ITransactionRepository`: To fetch the user's entire transaction history.
  - `TaxLotRepository`: A new repository for managing the `tax_lots` table.
  - `UserSettingsService`: To retrieve the user's chosen accounting method.

#### Tax & Income Reporting Services

- **Business Need**: Generates user-facing reports for tax filing and income analysis.
- **Implementation**:
  - `TaxReportGenerator`: Consumes data from the `CostBasisEngine` to produce downloadable reports in formats like IRS Form 8949 CSV.
  - `IncomeReportQueryHandler`: A specialized query that aggregates all entries in `INCOME_*` accounts, prices them using the historical price, and provides a yearly income summary.

### Pillar 2: Advanced Transaction Handling

#### Transaction Classifier Service

- **Business Need**: Translates ambiguous on-chain interactions into clear, human-readable financial events (e.g., "Uniswap Swap," "Aave Deposit").
- **Implementation**: A rule-based service that analyzes raw transaction data against known contract signatures and patterns.
- **Domain Impact**: This service will necessitate expanding the `AccountType` and `EntryType` enums to include more granular DeFi and NFT-related concepts (`DEFI_SWAP`, `ADD_LIQUIDITY`, `NFT_MINT`, etc.).

#### NFT & DeFi Modeling Strategy

- **NFTs**: Modeled as unique currencies in the `currencies` table with a `decimals` of 0 and an `asset_class` of 'NFT'. This allows them to be tracked with full double-entry integrity.
- **LP Tokens**: Modeled as distinct assets. An "add liquidity" event is a disposal of two underlying assets in exchange for a new LP token asset.

### Pillar 3: Data Integrity & User Control

#### Reconciliation Service

- **Business Need**: Allows users to verify that the balances calculated by the ledger match the actual balances on their exchanges or wallets.
- **Implementation**: A service that uses read-only API keys to fetch live balances from external sources and compares them against the output of `GetAllBalancesQuery`, flagging discrepancies.

#### Manual Transaction & Correction Logic

- **Business Need**: Enable users to fix missing data or re-classify transactions without compromising ledger integrity.
- **Implementation**:
  - **`CreateManualTransactionCommand`**: A dedicated CQRS command for user-initiated entries.
  - **`ReverseTransactionCommand`**: Implements the principle of immutable corrections. It creates a new, perfectly opposing transaction to nullify an incorrect one, preserving a complete and accurate audit trail.

### Pillar 4: System & Security

#### Secure Credential Management Service

- **Business Need**: Securely store user-provided, read-only API keys for automated data synchronization.
- **Architectural Requirement**: API keys **must not** be stored in the primary application database, even if encrypted. A dedicated secret management solution (e.g., HashiCorp Vault, AWS/GCP Secret Manager) must be used to ensure security.
- **Implementation**: A `CredentialsService` that acts as a secure facade to the chosen secret management system.

## Import CQRS Handlers

The system transforms importers/processors into focused CQRS command and query handlers while preserving all domain logic.

### Import Command Handlers:

```typescript
// libs/import/src/commands/handlers/transform-to-ledger.handler.ts
import { ResultAsync, okAsync } from 'neverthrow';

// libs/import/src/commands/impl/import-from-exchange.command.ts
export class ImportFromExchangeCommand {
  constructor(
    public readonly userId: string,
    public readonly sourceId: string,
    public readonly providerId: string,
    public readonly params: ImportParamsDto
  ) {}
}

// libs/import/src/commands/handlers/import-from-exchange.handler.ts
@CommandHandler(ImportFromExchangeCommand)
export class ImportFromExchangeHandler implements ICommandHandler<ImportFromExchangeCommand> {
  constructor(
    private readonly importerFactory: ImporterFactoryService,
    private readonly rawDataRepository: RawDataRepository,
    private readonly sessionRepository: ImportSessionRepository,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(command: ImportFromExchangeCommand): Promise<ImportResultDto> {
    const { userId, sourceId, providerId, params } = command;

    this.logger.log(`Starting import from exchange ${sourceId} via ${providerId} for user ${userId}`);

    try {
      const session = await this.sessionRepository.create(userId, sourceId, 'exchange', providerId);

      const importer = await this.importerFactory.create(sourceId, 'exchange', providerId);
      const importResult = await importer.import(params);

      await this.rawDataRepository.save(userId, sourceId, 'exchange', importResult.rawData, {
        importSessionId: session.id,
        metadata: importResult.metadata,
      });

      await this.sessionRepository.finalize(userId, session.id, 'completed');

      return {
        sessionId: session.id,
        importedCount: importResult.rawData.length,
        metadata: importResult.metadata,
      };
    } catch (error) {
      this.logger.error(`Import from ${sourceId} failed for user ${userId}: ${error.message}`);
      throw new ImportServiceException(`Import failed: ${error.message}`);
    }
  }
}

// libs/import/src/commands/impl/process-universal-transactions.command.ts
export class ProcessUniversalTransactionsCommand {
  constructor(
    public readonly userId: string,
    public readonly sourceId: string,
    public readonly sessionId: string
  ) {}
}

// libs/import/src/commands/handlers/process-universal-transactions.handler.ts
@CommandHandler(ProcessUniversalTransactionsCommand)
export class ProcessUniversalTransactionsHandler implements ICommandHandler<ProcessUniversalTransactionsCommand> {
  constructor(
    private readonly processorFactory: ProcessorFactoryService,
    private readonly rawDataRepository: RawDataRepository,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(command: ProcessUniversalTransactionsCommand): Promise<UniversalTransaction[]> {
    const { userId, sourceId, sessionId } = command;

    this.logger.log(`Processing transactions for session ${sessionId} for user ${userId}`);

    try {
      const rawDataItems = await this.rawDataRepository.findBySession(userId, sessionId);

      const processor = await this.processorFactory.create(sourceId, 'exchange');
      const universalTransactions = await processor.process({
        id: sessionId,
        sourceId,
        sourceType: 'exchange',
        rawDataItems,
        sessionMetadata: {},
      });

      return universalTransactions;
    } catch (error) {
      this.logger.error(`Processing failed for session ${sessionId} for user ${userId}: ${error.message}`);
      throw new ProcessingServiceException(`Processing failed: ${error.message}`);
    }
  }
}

// libs/import/src/commands/impl/transform-to-ledger.command.ts
export class TransformToLedgerCommand {
  constructor(
    public readonly userId: string,
    public readonly universalTransactions: UniversalTransaction[]
  ) {}
}

@CommandHandler(TransformToLedgerCommand)
export class TransformToLedgerHandler implements ICommandHandler<TransformToLedgerCommand> {
  constructor(
    private readonly transformerService: UniversalToLedgerTransformerService,
    private readonly commandBus: CommandBus,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(command: TransformToLedgerCommand): ResultAsync<BatchTransformResult, DomainError> {
    const { userId, universalTransactions } = command;

    this.logger.log(`Transforming ${universalTransactions.length} transactions to ledger entries for user ${userId}`);

    // Process all transactions concurrently and collect results
    const processingResults = await Promise.all(
      universalTransactions.map(tx => this.processSingleTransaction(userId, tx))
    );

    // Partition results into successes and failures
    const result: BatchTransformResult = {
      successfulTransactions: [],
      failedTransactions: [],
      summary: {
        total: universalTransactions.length,
        successCount: 0,
        failureCount: 0,
      },
    };

    processingResults.forEach((res, index) => {
      if (res.isOk()) {
        result.successfulTransactions.push(res.value);
        result.summary.successCount++;
      } else {
        result.failedTransactions.push({
          universalTxId: universalTransactions[index].id,
          error: res.error,
        });
        result.summary.failureCount++;
      }
    });

    this.logger.log(
      `Transformation complete. Success: ${result.summary.successCount}, Failed: ${result.summary.failureCount}`
    );

    return okAsync(result);
  }

  /**
   * Process a single transaction using neverthrow's railway-oriented programming
   */
  private async processSingleTransaction(
    userId: string,
    tx: UniversalTransaction
  ): ResultAsync<LedgerTransactionDto, DomainError> {
    return this.transformerService
      .transformUniversalTransaction(userId, tx)
      .andThen(ledgerDto => {
        // Chain the command execution
        return this.commandBus.execute(new RecordTransactionCommand(userId, ledgerDto));
      })
      .mapErr(error => {
        this.logger.error(`Failed to process transaction ${tx.id}: ${error.message}`);
        return error;
      });
  }
}

// Batch transformation result type
export interface BatchTransformResult {
  successfulTransactions: LedgerTransactionDto[];
  failedTransactions: Array<{
    universalTxId: string;
    error: DomainError;
  }>;
  summary: {
    total: number;
    successCount: number;
    failureCount: number;
  };
}
```

#### Import Query Handlers:

```typescript
// libs/import/src/queries/impl/get-import-session-status.query.ts
export class GetImportSessionStatusQuery {
  constructor(
    public readonly userId: string,
    public readonly sessionId: string
  ) {}
}

// libs/import/src/queries/handlers/get-import-session-status.handler.ts
@QueryHandler(GetImportSessionStatusQuery)
export class GetImportSessionStatusHandler implements IQueryHandler<GetImportSessionStatusQuery> {
  constructor(private readonly sessionRepository: ImportSessionRepository) {}

  async execute(query: GetImportSessionStatusQuery): Promise<ImportSessionStatusDto> {
    const { userId, sessionId } = query;
    const session = await this.sessionRepository.findById(userId, sessionId);

    if (!session) {
      throw new SessionNotFoundException(`Session ${sessionId} not found for user ${userId}`);
    }

    return {
      id: session.id,
      sourceId: session.sourceId,
      status: session.status,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      errorMessage: session.errorMessage,
    };
  }
}

// libs/import/src/queries/impl/find-raw-data.query.ts
export class FindRawDataQuery {
  constructor(
    public readonly sessionId: string,
    public readonly limit?: number,
    public readonly offset?: number
  ) {}
}

// libs/import/src/queries/handlers/find-raw-data.handler.ts
@QueryHandler(FindRawDataQuery)
export class FindRawDataHandler implements IQueryHandler<FindRawDataQuery> {
  constructor(private readonly rawDataRepository: RawDataRepository) {}

  async execute(query: FindRawDataQuery): Promise<RawDataItemDto[]> {
    const { sessionId, limit, offset } = query;

    const rawDataItems = await this.rawDataRepository.findBySession(sessionId, {
      limit: limit || 100,
      offset: offset || 0,
    });

    return rawDataItems.map(item => ({
      id: item.id,
      providerId: item.providerId,
      rawData: item.rawData,
      createdAt: item.createdAt,
    }));
  }
}
```

#### CQRS Import Orchestration:

```typescript
// libs/import/src/commands/impl/complete-import-pipeline.command.ts
export class CompleteImportPipelineCommand {
  constructor(
    public readonly sourceId: string,
    public readonly sourceType: 'exchange' | 'blockchain',
    public readonly params: ImportParamsDto
  ) {}
}

// libs/import/src/commands/handlers/complete-import-pipeline.handler.ts
@CommandHandler(CompleteImportPipelineCommand)
export class CompleteImportPipelineHandler implements ICommandHandler<CompleteImportPipelineCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  async execute(command: CompleteImportPipelineCommand): Promise<CompleteImportResultDto> {
    const { sourceId, sourceType, params } = command;

    this.logger.log(`Starting complete import pipeline for ${sourceId}`);

    try {
      // Phase 1: Import raw data
      // → Invokes KrakenImporterService (or appropriate importer) via ImporterFactory
      // → Preserves ALL existing CSV parsing, validation, file processing logic
      const importResult = await this.commandBus.execute(
        new ImportFromExchangeCommand(sourceId, params.providerId, params)
      );

      // Phase 2: Process to UniversalTransactions
      // → Invokes KrakenProcessorService (or appropriate processor) via ProcessorFactory
      // → Preserves ALL existing business logic: trade pairing, failed transaction detection,
      //   token migration handling, dustsweeping logic
      const universalTransactions = await this.commandBus.execute(
        new ProcessUniversalTransactionsCommand(sourceId, importResult.sessionId)
      );

      // Phase 3: Transform and record in ledger
      // → Invokes UniversalToLedgerTransformerService for domain transformation
      // → Uses RecordTransactionCommand → LedgerRepository for balance validation
      const ledgerTransactions = await this.commandBus.execute(new TransformToLedgerCommand(universalTransactions));

      // Phase 4: Get final balances
      // → Uses cached CurrencyService for high-performance lookups
      const balances = await this.queryBus.execute(new GetAllBalancesQuery());

      return {
        sessionId: importResult.sessionId,
        imported: importResult.importedCount,
        processed: universalTransactions.length,
        ledgerTransactions: ledgerTransactions.length,
        balanceSnapshot: balances,
      };
    } catch (error) {
      this.logger.error(`Complete import pipeline failed: ${error.message}`);
      throw new ImportOrchestrationException(`Import pipeline failed: ${error.message}`);
    }
  }
}
```

#### CQRS Import Module:

```typescript
// libs/import/src/import.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CompleteImportPipelineHandler } from './commands/handlers/complete-import-pipeline.handler';
// Command Handlers
import { ImportFromExchangeHandler } from './commands/handlers/import-from-exchange.handler';
import { ProcessUniversalTransactionsHandler } from './commands/handlers/process-universal-transactions.handler';
import { TransformToLedgerHandler } from './commands/handlers/transform-to-ledger.handler';
// Existing Services (preserved)
import { ImporterFactoryService } from './importers/factory.service';
import { ProcessorFactoryService } from './processors/factory.service';
import { FindRawDataHandler } from './queries/handlers/find-raw-data.handler';
// Query Handlers
import { GetImportSessionStatusHandler } from './queries/handlers/get-import-session-status.handler';

export const CommandHandlers = [
  ImportFromExchangeHandler,
  ProcessUniversalTransactionsHandler,
  TransformToLedgerHandler,
  CompleteImportPipelineHandler,
];

export const QueryHandlers = [GetImportSessionStatusHandler, FindRawDataHandler];

@Module({
  imports: [
    CqrsModule,
    DatabaseModule,
    LedgerModule, // For transformer service and command bus
  ],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    // Preserve existing factories and implementations
    ImporterFactoryService,
    ProcessorFactoryService,
    // Keep all existing importers and processors as injectable services
    KrakenImporterService,
    KrakenProcessorService,
    CoinbaseImporterService,
    CoinbaseProcessorService,
    // etc.
  ],
  exports: [...CommandHandlers, ...QueryHandlers, ImporterFactoryService, ProcessorFactoryService],
})
export class ImportModule {}
```

#### Critical UniversalToLedgerTransformerService Implementation:

```typescript
// libs/ledger/src/services/universal-to-ledger-transformer.service.ts
@Injectable()
export class UniversalToLedgerTransformerService {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly commandBus: CommandBus,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  /**
   * CRITICAL: This service is the bridge between the existing processor logic
   * and the new ledger architecture. It transforms UniversalTransactions
   * (output from existing processors) into CreateLedgerTransactionDto format.
   *
   * This preserves ALL existing business logic while enabling double-entry bookkeeping.
   */
  async transformUniversalTransaction(
    userId: string,
    universalTx: UniversalTransaction
  ): ResultAsync<CreateLedgerTransactionDto, TransformationError> {
    this.logger.log(`Transforming transaction ${universalTx.id} to ledger format`);

    return this.getOrCreateAccountsForTransaction(userId, universalTx)
      .andThen(accounts => {
        // Generate double-entry bookkeeping entries based on transaction type
        return this.generateLedgerEntries(universalTx, accounts).map(entries => ({
          externalId: universalTx.id,
          source: universalTx.source || 'unknown',
          description: this.generateTransactionDescription(universalTx),
          transactionDate: new Date(universalTx.timestamp).toISOString(),
          entries,
          // Include source-specific details
          blockchainDetails: universalTx.txHash
            ? {
                txHash: universalTx.txHash,
                blockHeight: universalTx.blockHeight,
                status: 'confirmed',
                gasUsed: universalTx.gasUsed,
                gasPrice: universalTx.gasPrice,
              }
            : undefined,
          exchangeDetails: universalTx.side
            ? {
                orderId: universalTx.orderId,
                tradeId: universalTx.tradeId,
                symbol: universalTx.symbol,
                side: universalTx.side,
              }
            : undefined,
          metadata: universalTx.info
            ? {
                rawData: JSON.stringify(universalTx.info),
                processingVersion: '2.0',
                transformedAt: new Date().toISOString(),
              }
            : undefined,
        }));
      })
      .mapErr(error => {
        this.logger.error(`Failed to transform transaction ${universalTx.id}: ${error.message}`);
        return new TransformationError({
          universalTxId: universalTx.id,
          reason: error.message,
        });
      });
  }

  /**
   * CRITICAL: Account creation logic that handles complex scenarios:
   * - Exchange trades (need both base and quote currency accounts)
   * - Blockchain transactions (need wallet accounts, gas accounts)
   * - Fees (need appropriate fee expense accounts)
   * - Complex DeFi operations (LP tokens, staking rewards, etc.)
   */
  private async getOrCreateAccountsForTransaction(tx: UniversalTransaction): Promise<{
    sourceAccount?: AccountDto;
    targetAccount?: AccountDto;
    feeAccount?: AccountDto;
    gasAccount?: AccountDto;
  }> {
    const accounts: any = {};

    switch (tx.type) {
      case 'trade':
        // Exchange trade: need accounts for both currencies
        if (tx.symbol && tx.side) {
          const [baseCurrency, quoteCurrency] = tx.symbol.split('/');

          accounts.sourceAccount = await this.commandBus.execute(
            new CreateAccountCommand({
              currencyTicker: tx.side === 'buy' ? quoteCurrency : baseCurrency,
              accountType: 'ASSET_EXCHANGE',
              source: tx.source,
              network: tx.network,
            })
          );

          accounts.targetAccount = await this.commandBus.execute(
            new CreateAccountCommand({
              currencyTicker: tx.side === 'buy' ? baseCurrency : quoteCurrency,
              accountType: 'ASSET_EXCHANGE',
              source: tx.source,
              network: tx.network,
            })
          );
        }
        break;

      case 'deposit':
      case 'withdrawal':
        accounts.targetAccount = await this.commandBus.execute(
          new CreateAccountCommand({
            currencyTicker: tx.amount.currency,
            accountType: tx.type === 'deposit' ? 'ASSET_EXCHANGE' : 'ASSET_WALLET',
            source: tx.source,
            network: tx.network,
            externalAddress: tx.address,
          })
        );
        break;

      case 'reward':
      case 'staking':
      case 'airdrop':
        accounts.targetAccount = await this.commandBus.execute(
          new CreateAccountCommand({
            currencyTicker: tx.amount.currency,
            accountType: 'ASSET_WALLET',
            source: tx.source,
            network: tx.network,
          })
        );
        break;
    }

    // Create fee account if transaction has fees
    if (tx.fee && tx.fee.amount.greaterThan(0)) {
      accounts.feeAccount = await this.commandBus.execute(
        new CreateAccountCommand({
          currencyTicker: tx.fee.currency,
          accountType: 'EXPENSE_FEES_TRADE',
          source: tx.source,
          network: tx.network,
        })
      );
    }

    // Create gas account for blockchain transactions
    if (tx.gasUsed && tx.gasPrice) {
      accounts.gasAccount = await this.commandBus.execute(
        new CreateAccountCommand({
          currencyTicker: 'ETH', // TODO: Make this dynamic based on network
          accountType: 'EXPENSE_FEES_GAS',
          source: tx.source,
          network: tx.network,
        })
      );
    }

    return accounts;
  }

  /**
   * CRITICAL: Generate double-entry bookkeeping entries based on transaction type
   * This is where the accounting knowledge is encoded - each transaction type
   * must result in balanced entries that follow accounting principles.
   */
  private async generateLedgerEntries(tx: UniversalTransaction, accounts: any): Promise<CreateLedgerEntryDto[]> {
    const entries: CreateLedgerEntryDto[] = [];

    // Convert amounts to smallest currency units (eliminate decimals)
    const currency = await this.currencyService.findByTicker(tx.amount.currency);
    if (!currency) {
      throw new TransformationException(`Currency ${tx.amount.currency} not found`);
    }

    const amountInSmallestUnit = this.toSmallestUnit(tx.amount.amount, currency.decimals);

    switch (tx.type) {
      case 'trade':
        // Exchange trade: debit one currency, credit another
        if (tx.side === 'buy' && accounts.sourceAccount && accounts.targetAccount) {
          // Buying: debit quote currency (payment), credit base currency (received)
          const quoteCurrency = await this.currencyService.findByTicker(tx.price!.currency);
          const costInSmallestUnit = this.toSmallestUnit(
            tx.amount.amount.mul(tx.price!.amount),
            quoteCurrency!.decimals
          );

          entries.push(
            {
              accountId: accounts.sourceAccount.id,
              currencyId: quoteCurrency!.id,
              amount: (-costInSmallestUnit).toString(),
              direction: 'DEBIT',
              entryType: 'TRADE',
            },
            {
              accountId: accounts.targetAccount.id,
              currencyId: currency.id,
              amount: amountInSmallestUnit.toString(),
              direction: 'CREDIT',
              entryType: 'TRADE',
            }
          );
        }
        break;

      case 'deposit':
        // Deposit: credit asset account, debit external (opening balance)
        if (accounts.targetAccount) {
          const openingBalanceAccount = await this.commandBus.execute(
            new CreateAccountCommand({
              currencyTicker: tx.amount.currency,
              accountType: 'EQUITY_OPENING_BALANCE',
              source: tx.source,
              network: tx.network,
            })
          );

          entries.push(
            {
              accountId: accounts.targetAccount.id,
              currencyId: currency.id,
              amount: amountInSmallestUnit.toString(),
              direction: 'CREDIT',
              entryType: 'DEPOSIT',
            },
            {
              accountId: openingBalanceAccount.id,
              currencyId: currency.id,
              amount: (-amountInSmallestUnit).toString(),
              direction: 'DEBIT',
              entryType: 'DEPOSIT',
            }
          );
        }
        break;

      case 'withdrawal':
        // Withdrawal: debit asset account
        if (accounts.targetAccount) {
          entries.push({
            accountId: accounts.targetAccount.id,
            currencyId: currency.id,
            amount: (-amountInSmallestUnit).toString(),
            direction: 'DEBIT',
            entryType: 'WITHDRAWAL',
          });
        }
        break;

      case 'reward':
      case 'staking':
      case 'airdrop':
        // Income: credit asset account, debit income account
        if (accounts.targetAccount) {
          const incomeAccount = await this.commandBus.execute(
            new CreateAccountCommand({
              currencyTicker: tx.amount.currency,
              accountType: tx.type === 'staking' ? 'INCOME_STAKING' : 'INCOME_AIRDROP',
              source: tx.source,
              network: tx.network,
            })
          );

          entries.push(
            {
              accountId: accounts.targetAccount.id,
              currencyId: currency.id,
              amount: amountInSmallestUnit.toString(),
              direction: 'CREDIT',
              entryType: tx.type.toUpperCase(),
            },
            {
              accountId: incomeAccount.id,
              currencyId: currency.id,
              amount: (-amountInSmallestUnit).toString(),
              direction: 'DEBIT',
              entryType: tx.type.toUpperCase(),
            }
          );
        }
        break;
    }

    // Add fee entries if present
    if (tx.fee && tx.fee.amount.greaterThan(0) && accounts.feeAccount) {
      const feeCurrency = await this.currencyService.findByTicker(tx.fee.currency);
      if (feeCurrency) {
        const feeInSmallestUnit = this.toSmallestUnit(tx.fee.amount, feeCurrency.decimals);

        entries.push({
          accountId: accounts.feeAccount.id,
          currencyId: feeCurrency.id,
          amount: feeInSmallestUnit.toString(),
          direction: 'CREDIT',
          entryType: 'FEE',
        });
      }
    }

    return entries;
  }

  private generateTransactionDescription(tx: UniversalTransaction): string {
    const parts = [tx.type.charAt(0).toUpperCase() + tx.type.slice(1)];

    if (tx.symbol) parts.push(tx.symbol);
    if (tx.side) parts.push(tx.side);
    parts.push(`${tx.amount.amount.toString()} ${tx.amount.currency}`);

    if (tx.source) parts.push(`via ${tx.source}`);

    return parts.join(' ');
  }

  private toSmallestUnit(amount: Decimal, decimals: number): bigint {
    const multiplier = new Decimal(10).pow(decimals);
    const amountInSmallestUnit = amount.mul(multiplier);
    return BigInt(amountInSmallestUnit.toFixed(0));
  }
}
```

The import pipeline is broken into focused CQRS handlers while preserving importer/processor domain logic.

## NestJS Applications & Controllers

### Controller Implementation using CQRS:

```typescript
// libs/shared/src/auth/user.decorator.ts
import { ExecutionContext, createParamDecorator } from '@nestjs/common';
// libs/shared/src/auth/jwt-auth.guard.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
}

export const User = createParamDecorator((data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or missing authentication token');
    }
    return user;
  }
}

// apps/api/src/controllers/import.controller.ts
@Controller('import')
@ApiTags('import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post(':sourceId')
  @ApiOperation({ summary: 'Complete import pipeline (import → process → ledger)' })
  async importAndProcess(
    @User() user: AuthenticatedUser,
    @Param('sourceId') sourceId: string,
    @Body() params: ImportParamsDto
  ): Promise<CompleteImportResultDto> {
    return this.commandBus.execute(new CompleteImportPipelineCommand(user.id, sourceId, 'exchange', params));
  }

  @Get('sessions/:sessionId/status')
  @ApiOperation({ summary: 'Get import session status' })
  async getSessionStatus(
    @User() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string
  ): Promise<ImportSessionStatusDto> {
    return this.queryBus.execute(new GetImportSessionStatusQuery(user.id, sessionId));
  }

  @Get('sessions/:sessionId/raw-data')
  @ApiOperation({ summary: 'Get raw data from import session' })
  async getRawData(
    @User() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ): Promise<RawDataItemDto[]> {
    return this.queryBus.execute(new FindRawDataQuery(user.id, sessionId, limit, offset));
  }
}

// apps/api/src/controllers/ledger.controller.ts
@Controller('ledger')
@ApiTags('ledger')
@UseGuards(JwtAuthGuard) // PRODUCTION SECURITY: Add authentication guard
export class LedgerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('transactions')
  @ApiOperation({ summary: 'Record a new ledger transaction' })
  async createTransaction(
    @User() user: AuthenticatedUser,
    @Body() request: CreateLedgerTransactionDto
  ): Promise<LedgerTransactionDto> {
    return this.commandBus.execute(new RecordTransactionCommand(user.id, request));
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Create a new account' })
  async createAccount(@User() user: AuthenticatedUser, @Body() request: FindOrCreateAccountDto): Promise<AccountDto> {
    return this.commandBus.execute(new CreateAccountCommand(user.id, request));
  }

  @Get('accounts/:id/balance')
  @ApiOperation({ summary: 'Get account balance' })
  async getBalance(@User() user: AuthenticatedUser, @Param('id', ParseIntPipe) accountId: number): Promise<BalanceDto> {
    return this.queryBus.execute(new GetAccountBalanceQuery(user.id, accountId));
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get all account balances' })
  async getAllBalances(@User() user: AuthenticatedUser): Promise<BalanceDto[]> {
    return this.queryBus.execute(new GetAllBalancesQuery(user.id));
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  async getTransaction(
    @User() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number
  ): Promise<LedgerTransactionDto> {
    return this.queryBus.execute(new FindTransactionByIdQuery(user.id, id));
  }
}

// apps/api/src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CqrsModule, // Add CQRS module at app level
    DatabaseModule,
    LedgerModule,
    ImportModule,
    ProvidersModule.forRootAsync({
      imports: [TypedConfigModule],
      useFactory: (config: Configuration) => config.providers,
      inject: ['TYPED_CONFIG'],
    }),
  ],
  controllers: [LedgerController, ImportController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

Controllers dispatch commands/queries through CQRS buses instead of calling large services directly.

## Summary: CQRS Architecture Benefits

### Traditional Service Problems Solved:

**Before (Large Services)**:

```typescript
// ❌ Fat service with 15+ methods
@Injectable()
export class LedgerService {
  async recordTransaction(...)
  async getAccountBalance(...)
  async getAllBalances(...)
  async createAccount(...)
  async findAccount(...)
  async updateAccount(...)
  async deleteAccount(...)
  async getTransactionHistory(...)
  async validateTransaction(...)
  async calculateFees(...)
  async processRefund(...)
  async handleDispute(...)
  async archiveTransaction(...)
  async generateReport(...)
  async exportData(...)
}
```

**After (Focused CQRS Handlers)**:

```typescript
// ✅ Single-purpose handlers
@CommandHandler(RecordTransactionCommand)
export class RecordTransactionHandler {
  /* 30 lines */
}

@CommandHandler(CreateAccountCommand)
export class CreateAccountHandler {
  /* 25 lines */
}

@QueryHandler(GetAccountBalanceQuery)
export class GetAccountBalanceHandler {
  /* 15 lines */
}

@QueryHandler(GetAllBalancesQuery)
export class GetAllBalancesHandler {
  /* 20 lines */
}
```

### Key Advantages:

1. **Single Responsibility**: Each handler has exactly one reason to change
2. **Easy Testing**: Mock handler dependencies, not entire services
3. **Clear Intent**: Commands/queries make operations explicit
4. **Maintainability**: Small focused classes are easier to understand
5. **Team Scalability**: Multiple developers can work on different handlers
6. **Performance**: Read/write operations can be optimized independently

### Migration Strategy:

The system provides:

1. Database schema with complete double-entry ledger
2. CQRS handlers replacing large services
3. Import pipeline as focused CQRS commands
4. Controllers dispatching via CommandBus/QueryBus

The CQRS pattern ensures the NestJS system avoids large services while preserving all domain logic and business rules.

## Provider Integration as NestJS Dynamic Modules

### Provider Integration Implementation:

```typescript
// libs/providers/src/providers.module.ts
@Module({})
export class ProvidersModule {
  static forRoot(config: ProvidersConfig): DynamicModule {
    return {
      module: ProvidersModule,
      imports: [SharedModule],
      providers: [
        {
          provide: 'PROVIDERS_CONFIG',
          useValue: config,
        },
        ProviderRegistryService,
        BlockchainProviderManagerService,
        CircuitBreakerService,
      ],
      exports: [ProviderRegistryService, BlockchainProviderManagerService],
      global: true,
    };
  }
}

// libs/providers/src/services/provider-registry.service.ts
@Injectable()
export class ProviderRegistryService {
  private static instance: ProviderRegistryService;

  constructor(
    @Inject('PROVIDERS_CONFIG') private config: ProvidersConfig,
    private logger: LoggerService
  ) {}

  // Keep all existing provider registry logic
  createProvider<T extends IBlockchainProvider>(blockchain: string, providerName: string): T {
    // Preserve existing logic
    const metadata = this.getProviderMetadata(blockchain, providerName);
    const ProviderClass = this.getProviderClass(blockchain, providerName);

    return new ProviderClass({
      logger: this.logger,
      httpClient: this.httpClient,
    });
  }
}
```

All importers/processors work as NestJS services.

## Testing & Deployment

### Testing Strategy:

```typescript
// 1. Unit Tests - Individual CQRS handlers with mocked dependencies
// libs/ledger/src/commands/handlers/__tests__/record-transaction.handler.spec.ts
describe('RecordTransactionHandler', () => {
  let handler: RecordTransactionHandler;
  let ledgerRepository: LedgerRepository;
  let logger: LoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordTransactionHandler,
        {
          provide: LedgerRepository,
          useValue: createMockRepository(),
        },
        {
          provide: LoggerService,
          useValue: createMockLogger(),
        },
      ],
    }).compile();

    handler = module.get<RecordTransactionHandler>(RecordTransactionHandler);
    ledgerRepository = module.get<LedgerRepository>(LedgerRepository);
    logger = module.get<LoggerService>(LoggerService);
  });

  describe('execute', () => {
    it('should record a valid balanced transaction', async () => {
      const command = new RecordTransactionCommand({
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Test transaction',
        transactionDate: new Date().toISOString(),
        entries: [
          { accountId: 1, currencyId: 1, amount: '1000', direction: 'CREDIT', entryType: 'TRADE' },
          { accountId: 2, currencyId: 1, amount: '-1000', direction: 'DEBIT', entryType: 'TRADE' },
        ],
      });

      const result = await handler.execute(command);

      expect(result).toBeDefined();
      expect(ledgerRepository.createTransaction).toHaveBeenCalledTimes(1);
    });

    it('should delegate balance validation to repository', async () => {
      const command = new RecordTransactionCommand({
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Unbalanced transaction',
        transactionDate: new Date().toISOString(),
        entries: [
          { accountId: 1, currencyId: 1, amount: '1000', direction: 'CREDIT', entryType: 'TRADE' },
          { accountId: 2, currencyId: 1, amount: '-500', direction: 'DEBIT', entryType: 'TRADE' },
        ],
      });

      ledgerRepository.createTransaction.mockRejectedValue(new LedgerValidationException('Entries must balance'));

      await expect(handler.execute(command)).rejects.toThrow(LedgerServiceException);
    });
  });
});

// 2. Integration Tests - CQRS module interactions with real DatabaseModule
// libs/import/src/commands/handlers/__tests__/complete-import-pipeline.integration.spec.ts
describe('CompleteImportPipelineHandler Integration', () => {
  let module: TestingModule;
  let handler: CompleteImportPipelineHandler;
  let commandBus: CommandBus;
  let queryBus: QueryBus;
  let db: DrizzleDB;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test' }),
        CqrsModule,
        DatabaseModule,
        LedgerModule,
        ImportModule,
        ProvidersModule.forRootAsync({
          imports: [TypedConfigModule],
          useFactory: () => testProvidersConfig,
        }),
      ],
    }).compile();

    handler = module.get<CompleteImportPipelineHandler>(CompleteImportPipelineHandler);
    commandBus = module.get<CommandBus>(CommandBus);
    queryBus = module.get<QueryBus>(QueryBus);
    db = module.get<DrizzleDB>('DATABASE_CONNECTION');
  });

  it('should orchestrate complete import pipeline via CQRS', async () => {
    const command = new CompleteImportPipelineCommand('kraken', 'exchange', {
      csvDirectories: ['test-data/kraken-sample'],
    });

    const result = await handler.execute(command);

    // Verify pipeline orchestration
    expect(result.imported).toBeGreaterThan(0);
    expect(result.processed).toBeGreaterThan(0);
    expect(result.ledgerTransactions).toBeGreaterThan(0);
    expect(result.balanceSnapshot).toBeDefined();

    // Verify ledger entries are balanced via query handler
    const balances = await queryBus.execute(new GetAllBalancesQuery());
    const totalBalance = balances.reduce((sum, b) => sum + BigInt(b.amount), 0n);
    expect(totalBalance).toBe(0n); // Double-entry requirement

    // Verify idempotency - running again shouldn't create duplicates
    const result2 = await handler.execute(command);
    expect(result2.ledgerTransactions).toBe(0); // Should be 0 due to unique constraint
  });
});

// 3. End-to-End Tests - Full application flow via API controllers using CQRS
describe('Import API with CQRS (e2e)', () => {
  let app: INestApplication;
  let commandBus: CommandBus;
  let queryBus: QueryBus;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test' }),
        CqrsModule,
        DatabaseModule,
        LedgerModule,
        ImportModule,
        ProvidersModule.forRoot(testProvidersConfig),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    commandBus = moduleFixture.get<CommandBus>(CommandBus);
    queryBus = moduleFixture.get<QueryBus>(QueryBus);
  });

  it('should import Kraken transactions via CQRS pipeline', async () => {
    const response = await request(app.getHttpServer())
      .post('/import/kraken')
      .send({
        csvDirectories: ['test-data/kraken'],
      })
      .expect(200);

    expect(response.body.imported).toBeGreaterThan(0);
    expect(response.body.ledgerTransactions).toBe(response.body.processed);
    expect(response.body.balanceSnapshot.length).toBeGreaterThan(0);

    // Verify via query endpoint
    const balancesResponse = await request(app.getHttpServer()).get('/ledger/balances').expect(200);

    const totalBalance = balancesResponse.body.reduce((sum, b) => sum + BigInt(b.amount), 0n);
    expect(totalBalance).toBe(0n);
  });
});
```

#### Docker & Deployment:

```dockerfile
# Dockerfile.api
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY libs/ libs/
COPY apps/api/ apps/api/
RUN npm ci
RUN npm run build api

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist/apps/api ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "main.js"]

# Dockerfile.cli
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY libs/ libs/
COPY apps/cli/ apps/cli/
RUN npm ci
RUN npm run build cli

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist/apps/cli ./
COPY --from=builder /app/node_modules ./node_modules
ENTRYPOINT ["node", "main.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: crypto_tx_import
      POSTGRES_USER: crypto_user
      POSTGRES_PASSWORD: crypto_pass
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  api:
    build:
      dockerfile: Dockerfile.api
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://crypto_user:crypto_pass@postgres:5432/crypto_tx_import
      NODE_ENV: production
    depends_on:
      - postgres
    command: >
      bash -c "pnpm drizzle-kit migrate &&
      node main.js"

  cli:
    build:
      dockerfile: Dockerfile.cli
    environment:
      DATABASE_URL: postgresql://crypto_user:crypto_pass@postgres:5432/crypto_tx_import
    depends_on:
      - postgres
    profiles:
      - cli

volumes:
  postgres_data:
```

The system provides a full NestJS application deployed with API and CLI capabilities using CQRS architecture.

## Queue-Based Async Processing

The system launches with synchronous API (60-second timeout) and async processing as the next priority. This allows market entry with working product while rapidly addressing scalability needs.

### BullMQ Integration for Long-Running Imports:

```typescript
// libs/shared/src/queue/queue.module.ts
import { BullModule } from '@nestjs/bull';
// libs/import/src/processors/import-job.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [TypedConfigModule],
      useFactory: (config: Configuration) => ({
        redis: {
          host: config.redis.REDIS_HOST,
          port: config.redis.REDIS_PORT,
          password: config.redis.REDIS_PASSWORD,
        },
      }),
      inject: ['TYPED_CONFIG'],
    }),
    BullModule.registerQueue({
      name: 'import-jobs',
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

interface ImportJobData {
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  params: ImportParamsDto;
  correlationId: string;
}

@Processor('import-jobs')
export class ImportJobProcessor {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly logger: LoggerService // From @exitbook/shared-logger
  ) {}

  @Process('import-and-process')
  async handleImportJob(job: Job<ImportJobData>): Promise<CompleteImportResultDto> {
    const { sourceId, sourceType, params, correlationId } = job.data;

    this.logger.log(`Processing import job ${job.id} for ${sourceId}`, { correlationId, jobId: job.id });

    // Update job progress
    await job.progress(10);

    try {
      // Use CQRS command instead of direct service call
      const result = await this.commandBus.execute(new CompleteImportPipelineCommand(sourceId, sourceType, params));

      await job.progress(100);
      this.logger.log(`Import job ${job.id} completed successfully`, { jobId: job.id });

      return result;
    } catch (error) {
      this.logger.error(`Import job ${job.id} failed: ${error.message}`, { jobId: job.id, error });
      throw error;
    }
  }
}

// apps/api/src/controllers/async-import.controller.ts
@Controller('async-import')
@ApiTags('async-import')
export class AsyncImportController {
  constructor(
    @InjectQueue('import-jobs') private importQueue: Queue,
    private logger: LoggerService
  ) {}

  @Post(':sourceId')
  @ApiOperation({ summary: 'Start async import and process transactions via CQRS' })
  @ApiResponse({ status: 202, description: 'Import job queued successfully' })
  async queueImportJob(
    @Param('sourceId') sourceId: string,
    @Query('sourceType') sourceType: 'exchange' | 'blockchain',
    @Body() params: ImportParamsDto,
    @Headers('x-correlation-id') correlationId?: string
  ): Promise<{ jobId: string; status: string; estimatedWaitTime?: number }> {
    const jobCorrelationId = correlationId || crypto.randomUUID();

    const job = await this.importQueue.add(
      'import-and-process',
      {
        sourceId,
        sourceType,
        params,
        correlationId: jobCorrelationId,
      },
      {
        attempts: 3,
        backoff: 'exponential',
        removeOnComplete: 50,
        removeOnFail: 50,
      }
    );

    this.logger.log(`Queued import job ${job.id} for ${sourceId}`);

    const waitingCount = await this.importQueue.getWaiting();
    const estimatedWaitTime = waitingCount.length * 30; // Rough estimate: 30s per job

    return {
      jobId: job.id.toString(),
      status: 'queued',
      estimatedWaitTime,
    };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get import job status and progress' })
  async getJobStatus(@Param('jobId') jobId: string): Promise<{
    id: string;
    status: string;
    progress: number;
    result?: CompleteImportResultDto;
    error?: string;
  }> {
    const job = await this.importQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress = job.progress;

    return {
      id: job.id.toString(),
      status: state,
      progress: typeof progress === 'number' ? progress : 0,
      result: state === 'completed' ? job.returnvalue : undefined,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  }

  @Delete('jobs/:jobId')
  @ApiOperation({ summary: 'Cancel a queued import job' })
  async cancelJob(@Param('jobId') jobId: string): Promise<{ cancelled: boolean }> {
    const job = await this.importQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state === 'active') {
      throw new BadRequestException('Cannot cancel active job');
    }

    if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      return { cancelled: true };
    }

    return { cancelled: false };
  }
}
```

The system provides async import processing with progress tracking and job management using CQRS pipeline.

#### CLI Application with User Context:

```typescript
// apps/cli/src/cli.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CqrsModule,
    DatabaseModule,
    LedgerModule,
    ImportModule,
    ProvidersModule.forRootAsync({
      imports: [TypedConfigModule],
      useFactory: (config: Configuration) => config.providers,
      inject: ['TYPED_CONFIG'],
    }),
  ],
  providers: [ImportCommandService, BalanceCommandService, StatusCommandService],
})
export class CliModule {}

// apps/cli/src/commands/import.command.ts
@Injectable()
export class ImportCommandService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly logger: LoggerService
  ) {}

  async import(options: ImportOptionsDto & { userId: string }): Promise<void> {
    if (!options.userId) {
      throw new Error('User ID is required. Usage: --user-id=<uuid>');
    }

    const sourceId = options.exchange || options.blockchain!;
    const sourceType = options.exchange ? 'exchange' : 'blockchain';

    this.logger.log(`Starting import for ${sourceId} (${sourceType}) for user ${options.userId}`);

    // Use CQRS command with user context
    const result = await this.commandBus.execute(
      new CompleteImportPipelineCommand(options.userId, sourceId, sourceType, {
        address: options.addresses?.[0],
        csvDirectories: options.csvDir ? [options.csvDir] : undefined,
        exchangeCredentials: options.credentials,
        providerId: options.providerId,
        since: options.since,
      })
    );

    console.log('Import Results:');
    console.log(`- Raw data imported: ${result.imported}`);
    console.log(`- Universal transactions: ${result.processed}`);
    console.log(`- Ledger transactions: ${result.ledgerTransactions}`);

    if (result.balanceSnapshot.length > 0) {
      console.log('\nBalance Summary:');
      result.balanceSnapshot.forEach(balance =>
        console.log(`- ${balance.currency}: ${this.formatAmount(balance.amount)}`)
      );
    }
  }
}

// apps/cli/src/commands/balance.command.ts
@Injectable()
export class BalanceCommandService {
  constructor(private readonly queryBus: QueryBus) {}

  async showBalances(options: { userId: string }): Promise<void> {
    if (!options.userId) {
      throw new Error('User ID is required. Usage: --user-id=<uuid>');
    }

    // Use CQRS query with user context
    const balances = await this.queryBus.execute(new GetAllBalancesQuery(options.userId));

    console.log('Account Balances:');
    balances.forEach(balance => {
      console.log(`${balance.accountName}: ${this.formatAmount(balance.amount)} ${balance.currency}`);
    });

    const totalAccounts = balances.length;
    const totalValue = balances.reduce((sum, b) => sum + BigInt(b.amount), 0n);
    console.log(`\nTotal: ${totalAccounts} accounts`);
  }
}

// apps/cli/src/main.ts
import { NestFactory } from '@nestjs/core';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module';

async function bootstrap() {
  await CommandFactory.run(CliModule, {
    logger: ['error', 'warn', 'log'],
  });
}
bootstrap();

/**
 * CLI Usage Examples with User Context:
 *
 * Import from exchange:
 * pnpm run dev import --user-id=user-123 --exchange kraken --csv-dir ./data
 *
 * Import from blockchain:
 * pnpm run dev import --user-id=user-123 --blockchain bitcoin --addresses bc1q...
 *
 * Show balances:
 * pnpm run dev balance --user-id=user-123
 *
 * Process existing data:
 * pnpm run dev process --user-id=user-123 --exchange kraken --all
 *
 * Verify balances:
 * pnpm run dev verify --user-id=user-123 --exchange kraken
 *
 * Service Account Usage (for automation):
 * export CLI_SERVICE_USER_ID=service-account-uuid
 * pnpm run dev import --exchange kraken --csv-dir ./data
 */
```

#### API Security Implementation:

```typescript
// libs/shared/src/guards/api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    const validApiKeys = this.configService.get<string[]>('API_KEYS') || [];

    if (!validApiKeys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}

// apps/api/src/controllers/ledger.controller.ts
@Controller('ledger')
@ApiTags('ledger')
@UseGuards(ApiKeyGuard) // Apply to all endpoints
@ApiSecurity('api-key') // Swagger documentation
export class LedgerController {
  // ... existing CQRS-based methods
}

// apps/api/src/main.ts - Add to Swagger config
const config = new DocumentBuilder()
  .setTitle('Crypto Transaction Import API')
  .setVersion('1.0')
  .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
  .build();
```

#### BigInt Precision Strategy:

```typescript
// libs/core/src/types/money.types.ts
export interface MoneyAmount {
  readonly value: bigint; // Always use bigint internally
  readonly currency: string;
  readonly scale: number; // Decimal places (e.g., 8 for BTC)
}

// libs/ledger/src/dto/ledger-transaction.dto.ts
export class CreateLedgerTransactionDto {
  @IsString()
  externalId: string;

  @IsString()
  source: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLedgerEntryDto)
  entries: CreateLedgerEntryDto[];
}

export class CreateLedgerEntryDto {
  @IsNumber()
  accountId: number;

  @IsNumber()
  currencyId: number;

  @IsString()
  @Matches(/^-?\d+$/) // Only accept string integers (no decimals)
  amount: string; // String in DTO, converted to bigint in handler

  @IsEnum(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';

  @IsEnum([
    'TRADE',
    'DEPOSIT',
    'WITHDRAWAL',
    'FEE',
    'REWARD',
    'STAKING',
    'AIRDROP',
    'MINING',
    'LOAN',
    'REPAYMENT',
    'TRANSFER',
    'GAS',
  ])
  entryType: string;
}

// libs/ledger/src/commands/handlers/record-transaction.handler.ts
@CommandHandler(RecordTransactionCommand)
export class RecordTransactionHandler implements ICommandHandler<RecordTransactionCommand> {
  // Always convert string to bigint at handler boundary
  private stringToBigInt(amount: string): bigint {
    if (!/^-?\d+$/.test(amount)) {
      throw new ValidationException('Amount must be a valid integer string');
    }
    return BigInt(amount);
  }

  // Only convert bigint to string when returning to client
  private bigIntToString(amount: bigint): string {
    return amount.toString();
  }

  async execute(command: RecordTransactionCommand): Promise<LedgerTransactionDto> {
    const { transactionRequest } = command;

    const entries = transactionRequest.entries.map(entry => ({
      ...entry,
      amount: this.stringToBigInt(entry.amount), // DTO string -> handler bigint
    }));

    // All internal processing uses bigint
    const ledgerTransaction = await this.ledgerRepository.createTransaction({
      ...transactionRequest,
      entries,
    });

    // Convert back to string for response DTO
    return this.mapToDto(ledgerTransaction);
  }
}
```

## Key Architectural Benefits

### 1. Modern NestJS with CQRS Architecture

- **Command Query Responsibility Segregation**: Clear separation between write operations (commands) and read operations (queries)
- **Single Responsibility**: Each handler has exactly one reason to change
- **Dependency Injection**: Full IoC container with automatic dependency resolution
- **Modular Design**: Clean module boundaries with explicit imports/exports
- **Decorators**: Type-safe decorators for routes, validation, documentation
- **Built-in Features**: Authentication, validation, serialization, exception handling

### 2. Domain Knowledge Architecture

- **Existing Logic**: All importer/processor business logic implemented as NestJS services
- **CQRS Orchestration**: Handlers orchestrate workflows while delegating complex logic to specialized services
- **Provider System**: Implemented with NestJS dynamic modules and configuration
- **Circuit Breakers**: Integrated with NestJS health checks and monitoring

### 3. Scalable CQRS Service Layer

- **Focused Handlers**: Small, single-purpose command and query handlers
- **Repository Pattern**: Clean data access layer with Drizzle integration
- **Service Composition**: Handlers compose specialized worker services for complex operations
- **Exception Handling**: Centralized exception handling with proper HTTP status codes
- **Validation**: Automatic DTO validation with class-validator

### 4. Dual Applications with CQRS

- **REST API**: Production-ready API with OpenAPI documentation using CQRS dispatching
- **CLI Application**: CLI using nest-commander with CQRS command execution
- **Shared Libraries**: Code reuse between applications through NestJS libraries
- **Consistent Architecture**: Both applications use the same CQRS handlers

### 5. Production Ready Features

- **Typed Configuration**: Environment-based configuration with class-validator validation
- **Contextual Logging**: Structured logging with correlation IDs and request context
- **Queue Processing**: BullMQ integration using CQRS pipeline for long-running imports
- **Health Checks**: Built-in health checks for dependencies (database, Redis, external APIs)
- **Schema Migrations**: Drizzle-generated migrations with proper relationships
- **Metrics**: Prometheus metrics integration with CQRS handler performance tracking
- **Documentation**: Automatic OpenAPI/Swagger documentation with CQRS endpoint mapping

## Architecture Summary

### Core CQRS Implementation

The system implements:

- Importer domain knowledge as NestJS services called by command handlers
- Processor business logic as NestJS services orchestrated by CQRS handlers
- Provider registry as NestJS dynamic modules
- Complete double-entry ledger with multi-currency support using CQRS commands and queries
- REST API providing full CRUD operations via CommandBus/QueryBus dispatching
- [ ] CLI application executing operations through CQRS command handlers
- [ ] **CQRS Command and Query Handler Implementation**:
  - [ ] All ledger operations (RecordTransaction, CreateAccount, GetBalance, etc.) implemented as focused handlers
  - [ ] All import operations (ImportFromExchange, ProcessTransactions, etc.) implemented as command handlers
  - [ ] Query handlers for all read operations (GetAllBalances, FindTransaction, etc.)
  - [ ] Proper command/query separation with no business logic in controllers

### Database Schema & CQRS Integration

- [ ] **Complete database schema implemented from day one**:
  - [ ] All core tables (currencies, accounts, ledger_transactions, entries)
  - [ ] All detail tables (blockchain_transaction_details, exchange_transaction_details, transaction_metadata)
  - [ ] All indexes for optimal query performance
  - [ ] Database triggers for data integrity enforcement
  - [ ] Parent account relationships for hierarchical structures
- [ ] **CQRS Repository Integration**:
  - [ ] Repository methods called by command handlers, not directly by controllers
  - [ ] Query handlers optimized for read performance
  - [ ] Command handlers ensure data consistency through proper repository usage

### Production Hardening with CQRS

- [ ] Typed configuration with startup validation (class-validator)
- [ ] Provider configuration driven by typed ConfigModule (not hardcoded)
- [ ] Contextual logging with correlation IDs in all CQRS handlers
- [ ] **Multi-currency transaction validation via CQRS**:
  - [ ] Command handlers delegate validation to repositories
  - [ ] Repository validates currency balance before transaction commit
  - [ ] Error messages from command handlers showing which currency is unbalanced
- [ ] **CQRS Handler Testing**:
  - [ ] Unit tests for each command and query handler with mocked dependencies
  - [ ] Integration tests for CQRS module interactions
  - [ ] E2E tests using CQRS controllers
- [ ] Drizzle migrations generated and tested with currency seeding
- [ ] BigInt precision maintained end-to-end through CQRS pipeline

### Advanced Features & Operational Excellence

- [ ] **Strategic async processing implementation via CQRS** (Priority #1 post-launch):
  - [ ] BullMQ integration executing CQRS commands in job processors
  - [ ] Job progress tracking and status endpoints
  - [ ] Queue management and cancellation capabilities
- [ ] API security with API key authentication on CQRS controllers
- [ ] **Balance and reporting via Query Handlers**:
  - [ ] Balance queries grouped by currency with proper decimals
  - [ ] Multi-currency portfolio balance summaries
  - [ ] Account balance history and trend analysis
  - [ ] P&L reporting using granular account types
- [ ] **Production-ready operational features with CQRS**:
  - [ ] Automated currency seeding on application startup
  - [ ] Database health checks with comprehensive metrics
  - [ ] Prometheus metrics for CQRS handler performance and transaction processing
  - [ ] Structured error responses with currency-specific balance details from command handlers
  - [ ] Correlation ID tracing across all CQRS handlers

### CQRS-Specific Success Criteria

- [ ] **Command Handler Implementation**:
  - [ ] No business logic in controllers - only command/query dispatching
  - [ ] Each command handler has single responsibility
  - [ ] Command handlers orchestrate but delegate complex logic to worker services
  - [ ] Proper error handling and structured exceptions in all handlers
- [ ] **Query Handler Implementation**:
  - [ ] Query handlers optimized for read performance
  - [ ] No side effects in query handlers
  - [ ] Consistent DTO mapping across all query handlers
- [ ] **CQRS Module Organization**:
  - [ ] Clean separation between command and query handlers in module structure
  - [ ] Proper handler registration in CQRS modules
  - [ ] Clear exports and imports between CQRS modules

### Testing with CQRS Architecture

- [ ] Comprehensive testing strategy:
  - [ ] Unit tests for individual CQRS handlers (mocked dependencies)
  - [ ] Integration tests for CQRS module interactions (real database)
  - [ ] E2E tests for full CQRS API workflows
  - [ ] **CQRS-specific testing**:
    - [ ] Command handler testing with proper mocking
    - [ ] Query handler testing with database fixtures
    - [ ] CQRS pipeline integration testing
  - [ ] Multi-currency transaction testing via command handlers
  - [ ] Currency validation and seeding tests
  - [ ] Balance calculation accuracy tests across CQRS queries
  - [ ] Idempotency testing (duplicate imports handled correctly)
  - [ ] Health check and monitoring tests
- [ ] Production deployment with Docker and database migrations
  - [ ] Automated migration execution in CI/CD pipeline
  - [ ] Container health checks and readiness probes
  - [ ] Database connection pooling and optimization
- [ ] Performance matching or exceeding current system through CQRS optimization
- [ ] OpenAPI documentation for all CQRS endpoints with security schemes

## Operational Excellence Considerations

### **1. CQRS Deployment and Migration Strategy**

- **Command Handler Deployment**: CQRS command handlers are stateless and can be deployed independently
- **Query Handler Optimization**: Query handlers can be optimized separately for read performance
- **Database Migration Coordination**: Migrations coordinated with CQRS handler deployments
- **Zero-Downtime Deployments**: CQRS architecture supports rolling deployments without downtime

### **2. Critical CQRS Service Implementation**

- **Handler Orchestration**: CQRS handlers orchestrate workflows while preserving existing business logic in worker services
- **Command Validation**: Command handlers validate inputs and delegate to specialized services
- **Query Optimization**: Query handlers optimized for specific read patterns and performance requirements
- **Error Recovery**: Idempotent command handling with proper exception propagation

### **3. Strategic CQRS API Approach**

- **Command Dispatching**: Controllers dispatch commands through CommandBus without business logic
- **Query Dispatching**: Controllers dispatch queries through QueryBus for consistent read operations
- **Structured Responses**: CQRS handlers return consistent DTOs with proper error handling
- **Async Processing**: BullMQ processors execute CQRS commands for long-running operations

### **4. CQRS Production Monitoring**

- **Handler Performance**: Prometheus metrics for individual command and query handler execution times
- **Command Success Rates**: Monitoring command execution success/failure rates
- **Query Performance**: Tracking query handler performance and optimization opportunities
- **Pipeline Monitoring**: End-to-end CQRS pipeline performance tracking

### **5. CQRS Data Integrity Assurance**

- **Command Validation**: Command handlers validate business rules before repository operations
- **Transaction Management**: Repository methods handle database transactions with proper rollback
- **Query Consistency**: Query handlers ensure data consistency in read operations
- **Handler Idempotency**: Command handlers designed for safe retry operations

## Critical Architecture Decisions Summary

### 1. CQRS Handler Responsibility: Orchestration Only

**Decision**: CQRS handlers are orchestrators that delegate complex business logic to specialized worker services.

**Rationale**:

- Maintains single responsibility principle for handlers
- Preserves existing domain knowledge in focused services
- Enables easy testing by mocking worker service dependencies
- Allows independent optimization of business logic and orchestration

**Implementation**: Command handlers like `ProcessUniversalTransactionsHandler` delegate to `ProcessorFactoryService` while orchestrating the workflow.

### 2. Repository Integration: Command Handlers Only

**Decision**: Only command handlers interact directly with repositories; query handlers use specialized read repositories.

**Rationale**:

- Clear separation between write and read operations
- Enables independent optimization of read vs write paths
- Maintains data consistency through controlled write access
- Supports future read replica optimization

### 3. Controller Responsibility: Pure Dispatching

**Decision**: Controllers contain zero business logic and only dispatch commands/queries through CQRS buses.

**Benefits**:

- Controllers become thin, testable layers
- Business logic centralized in handlers
- Consistent error handling across all endpoints
- Easy migration to different transport layers (GraphQL, gRPC)

### 4. Error Handling Strategy: Structured Exceptions from Handlers

**Decision**: CQRS handlers throw structured domain exceptions that controllers map to HTTP responses.

**Benefits**:

- Domain-specific error information preserved
- Consistent error responses across all endpoints
- Proper HTTP status code mapping
- Detailed error information for debugging

### 5. Testing Strategy: Handler-Focused Testing

**Decision**: Primary testing focus on individual CQRS handlers with mocked dependencies.

**Benefits**:

- Fast, focused unit tests for each handler
- Easy identification of test failures
- Comprehensive coverage of business logic
- Independent testing of orchestration vs domain logic

### 6. Transaction Balance Validation: Application-Level Only

**Decision**: Implement balance validation in `LedgerRepository.createTransaction()` within database transactions, NOT via database triggers.

**Rationale**: Database triggers that fire `AFTER INSERT ON entries` are logically flawed for multi-entry transactions. They would fail on every entry except the last one, making the system unusable.

**Implementation**: The current `LedgerRepository.createTransaction()` implementation is CORRECT - it validates the complete entry set before inserting any data.

### 7. Hybrid Amount + Direction Design: Optimal Approach

**Decision**: Maintain both signed `amount` (BIGINT) and `direction` (ENUM) columns with validation trigger.

**Benefits**:

- **Computational Efficiency**: Signed amounts enable direct mathematical operations
- **Semantic Clarity**: Direction enum provides clear intent in SQL queries and reporting
- **Data Integrity**: Validation trigger ensures consistency between fields
- **Error Detection**: Redundancy helps catch data corruption issues

### 8. Multi-Currency Precision: Currency-Specific Decimals

**Decision**: Store monetary amounts as BIGINT in smallest currency units with currency-specific decimal metadata.

**Rationale**:

- **Eliminates floating-point precision errors** in financial calculations
- **Supports any currency precision** (8 decimals for BTC, 18 for ETH, 6 for USDC)
- **Enables accurate balance calculations** using simple integer arithmetic
- **Prevents rounding errors** that could cause audit failures

This CQRS architecture ensures clean separation of concerns, maintainable code, and scalable design while preserving all domain knowledge and business rules. The focused handler approach eliminates large services while maintaining clear boundaries and testability.

The CQRS pattern provides a solid foundation for complex multi-currency trading scenarios, DeFi protocols, and enterprise reporting requirements while maintaining the flexibility to add new blockchains and exchanges through the provider system. The operational excellence features ensure smooth production deployment, monitoring, and maintenance from day one.

These architectural decisions ensure mathematical precision, data integrity, system reliability, and maintainable CQRS design for production financial applications.

## Neverthrow Integration: Result-Based Error Handling

### Overview

The system will gradually migrate from traditional exception-based error handling to `neverthrow`'s Result type pattern. This provides explicit, type-safe error handling that eliminates entire classes of runtime errors and enables railway-oriented programming for complex operations.

### Why Neverthrow for Financial Systems

For a financial ledger system where errors are not "exceptions" but common, expected outcomes (e.g., "insufficient funds," "invalid transaction," "unbalanced entries"), the Result pattern is the ideal paradigm:

- **Explicit Error Handling**: Function signatures like `ResultAsync<LedgerTransaction, LedgerValidationError>` make success and failure types explicit
- **Railway-Oriented Programming**: Chain operations using `.andThen()` and `.map()` where any failure automatically propagates
- **Eliminates Hidden Throws**: No more defensive `try/catch` blocks - errors are part of the type system
- **Structured Error Data**: Rich, typed error objects with contextual information

### Domain-Specific Error Classes

```typescript
// libs/shared/src/errors/domain.errors.ts
export class DomainError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class LedgerValidationError extends DomainError {
  constructor(details: { unbalancedCurrencies: any[] }) {
    super('Ledger validation failed: entries are unbalanced', 'LEDGER_UNBALANCED', details);
  }
}

export class TransformationError extends DomainError {
  constructor(details: { universalTxId: string; reason: string }) {
    super(`Failed to transform transaction: ${details.universalTxId}`, 'TRANSFORMATION_FAILED', details);
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(accountId: number) {
    super(`Account with ID ${accountId} not found`, 'ACCOUNT_NOT_FOUND');
  }
}

export class ImportSessionError extends DomainError {
  constructor(sessionId: string, reason: string) {
    super(`Import session ${sessionId} failed: ${reason}`, 'IMPORT_SESSION_FAILED', { sessionId, reason });
  }
}

export class ProviderConnectionError extends DomainError {
  constructor(provider: string, endpoint: string) {
    super(`Failed to connect to ${provider} at ${endpoint}`, 'PROVIDER_CONNECTION_FAILED', { provider, endpoint });
  }
}
```

### Repository Layer with Result Types

**Before (Exception-based):**

```typescript
async createTransaction(userId: string, transaction: CreateLedgerTransaction): Promise<LedgerTransaction> {
  // Validation throws LedgerValidationException
  for (const [currencyId, sum] of entriesByCurrency) {
    if (sum !== 0n) {
      throw new LedgerValidationException({ unbalancedCurrencies: [...] });
    }
  }
  // Database operations can throw
  return this.db.transaction(async trx => { /* ... */ });
}
```

**After (Result-based):**

```typescript
import { okAsync, errAsync, ResultAsync } from 'neverthrow';

async createTransaction(
  userId: string,
  transaction: CreateLedgerTransaction
): ResultAsync<LedgerTransaction, LedgerValidationError | DomainError> {
  // Validate entries - return Err instead of throwing
  const entriesByCurrency = new Map<number, bigint>();
  for (const entry of transaction.entries) {
    const currentSum = entriesByCurrency.get(entry.currencyId) || 0n;
    entriesByCurrency.set(entry.currencyId, currentSum + entry.amount);
  }

  for (const [currencyId, sum] of entriesByCurrency) {
    if (sum !== 0n) {
      const currency = await this.getCurrencyTicker(currencyId);
      return errAsync(new LedgerValidationError({
        unbalancedCurrencies: [{ currencyId, ticker: currency, delta: sum.toString() }]
      }));
    }
  }

  // Wrap database transaction in ResultAsync
  return ResultAsync.fromPromise(
    this.db.transaction(async trx => {
      const [dbTransaction] = await trx.insert(ledgerTransactions).values(/* ... */).returning();
      const dbEntries = await trx.insert(entries).values(/* ... */).returning();
      return this.mapToLedgerTransaction(dbTransaction, dbEntries);
    }),
    (error: Error) => new DomainError(error.message, 'DATABASE_ERROR')
  );
}
```

### CQRS Handlers with Railway-Oriented Programming

**Batch Operation Result Type:**

```typescript
export interface BatchTransformResult {
  successfulTransactions: LedgerTransactionDto[];
  failedTransactions: {
    universalTxId: string;
    error: DomainError;
  }[];
}
```

**Command Handler with Result Chaining:**

```typescript
@CommandHandler(TransformToLedgerCommand)
export class TransformToLedgerHandler {
  async execute(command: TransformToLedgerCommand): Promise<BatchTransformResult> {
    const { userId, universalTransactions } = command;
    this.logger.log(`Transforming ${universalTransactions.length} transactions...`);

    // Process all transactions concurrently and get an array of Results
    const processingResults = await Promise.all(
      universalTransactions.map(tx => this.processSingleTransaction(userId, tx))
    );

    // Partition the results into successes and failures
    const result: BatchTransformResult = {
      successfulTransactions: [],
      failedTransactions: [],
    };

    processingResults.forEach((res, index) => {
      if (res.isOk()) {
        result.successfulTransactions.push(res.value);
      } else {
        result.failedTransactions.push({
          universalTxId: universalTransactions[index].id,
          error: res.error,
        });
      }
    });

    this.logger.log(
      `Transformation complete. Success: ${result.successfulTransactions.length}, Failed: ${result.failedTransactions.length}`
    );
    return result;
  }

  // Railway-oriented programming with automatic error propagation
  private async processSingleTransaction(
    userId: string,
    tx: UniversalTransaction
  ): Promise<Result<LedgerTransactionDto, DomainError>> {
    return await this.transformerService
      .transformUniversalTransaction(userId, tx) // Returns ResultAsync<...>
      .andThen(ledgerDto => {
        // Chain the next operation - if previous fails, this is skipped
        return this.commandBus.execute<RecordTransactionCommand, ResultAsync<LedgerTransactionDto, DomainError>>(
          new RecordTransactionCommand(userId, ledgerDto)
        );
      });
  }
}
```

### Controller Layer Result Handling

**Before (Exception-based):**

```typescript
@Post('import/:sourceId')
async import(@User() user: AuthenticatedUser, @Param('sourceId') sourceId: string, @Body() params: ImportParamsDto) {
  try {
    return await this.commandBus.execute(new CompleteImportPipelineCommand(user.id, sourceId, 'exchange', params));
  } catch (error) {
    // Generic error handling
    throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
```

**After (Result-based):**

```typescript
@Post('import/:sourceId')
async import(
  @User() user: AuthenticatedUser,
  @Param('sourceId') sourceId: string,
  @Body() params: ImportParamsDto
): Promise<CompleteImportResultDto> {
  const result = await this.commandBus.execute(
    new CompleteImportPipelineCommand(user.id, sourceId, 'exchange', params)
  );

  return result.match(
    (success) => success, // Return successful result
    (error) => {
      // Map domain errors to appropriate HTTP responses
      switch (error.code) {
        case 'LEDGER_UNBALANCED':
          throw new BadRequestException({
            message: error.message,
            code: error.code,
            details: error.details
          });
        case 'ACCOUNT_NOT_FOUND':
          throw new NotFoundException(error.message);
        case 'IMPORT_SESSION_FAILED':
          throw new UnprocessableEntityException(error.message);
        case 'PROVIDER_CONNECTION_FAILED':
          throw new ServiceUnavailableException(error.message);
        default:
          throw new InternalServerErrorException(error.message);
      }
    }
  );
}
```

### Migration Strategy

**Phase 1: Foundation**

1. Install `neverthrow` dependency
2. Create domain-specific error classes
3. Add Result type definitions and utilities

**Phase 2: Repository Layer**

1. Update repository methods to return `ResultAsync`
2. Replace database error throws with `ResultAsync.fromPromise`
3. Update repository tests to handle Result types

**Phase 3: Service Layer**

1. Update service methods to return `ResultAsync`
2. Use `.andThen()` and `.map()` for operation chaining
3. Implement batch operation patterns with Result partitioning

**Phase 4: Handler Layer**

1. Update CQRS command handlers to return Results
2. Update CQRS query handlers to return Results
3. Implement railway-oriented programming patterns

**Phase 5: Controller Layer**

1. Update controllers to handle Result types
2. Implement proper error-to-HTTP status mapping
3. Remove try/catch blocks in favor of `.match()`

### Benefits of Neverthrow Integration

1. **Type-Safe Error Handling**: Compile-time guarantees that all error cases are handled
2. **Railway-Oriented Programming**: Clean operation chaining with automatic error propagation
3. **Structured Error Information**: Rich, typed error objects for precise debugging and API responses
4. **Elimination of Hidden Exceptions**: No more defensive try/catch blocks
5. **Better Composability**: Functions returning Results are highly composable and testable
6. **Better Error Recovery**: Explicit error handling enables sophisticated recovery strategies

This Result-based error handling approach transforms error handling from a reactive runtime concern into a proactive compile-time concern, which is invaluable for building reliable financial software.

## Implementation Considerations

### CLI User Context Management

The CLI application requires user context for all operations since the architecture is multi-tenant. This is **critical** - without proper user scoping, data leakage between users can occur.

#### **Mandatory User Context Requirements:**

1. **All CQRS commands MUST include userId as first parameter**
2. **All CQRS queries MUST include userId as first parameter**
3. **All repository methods MUST be user-scoped**
4. **CLI commands MUST validate userId presence before execution**

The recommended approach is to implement user context through:

**Command-line Flag Approach**:

```typescript
// apps/cli/src/commands/import.command.ts
@Injectable()
export class ImportCommandService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  async import(options: ImportOptionsDto & { userId: string }): Promise<void> {
    // Use the provided userId in all CQRS command executions
    const result = await this.commandBus.execute(
      new CompleteImportPipelineCommand(
        options.userId, // User context passed explicitly
        sourceId,
        sourceType,
        params
      )
    );
  }
}

// CLI usage: pnpm run dev import --user-id=user-123 --exchange kraken
```

**Service Account Approach** (Alternative):

```typescript
// For non-interactive environments, use a dedicated service account
const SERVICE_USER_ID = 'cli-service-account';

// All CLI operations use this service account context
const result = await this.commandBus.execute(
  new CompleteImportPipelineCommand(SERVICE_USER_ID, sourceId, sourceType, params)
);
```

#### **API Controller User Context:**

Controllers automatically extract user context from authentication and pass it to CQRS handlers:

```typescript
// All API endpoints correctly implement user context flow
@Controller('ledger')
@UseGuards(JwtAuthGuard) // Authentication required
export class LedgerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus
  ) {}

  @Post('transactions')
  async createTransaction(
    @User() user: AuthenticatedUser, // User extracted from JWT
    @Body() request: CreateLedgerTransactionDto
  ): Promise<LedgerTransactionDto> {
    // User context passed as first parameter to command
    return this.commandBus.execute(new RecordTransactionCommand(user.id, request));
  }

  @Get('balances')
  async getAllBalances(
    @User() user: AuthenticatedUser // User extracted from JWT
  ): Promise<BalanceDto[]> {
    // User context passed as first parameter to query
    return this.queryBus.execute(new GetAllBalancesQuery(user.id));
  }
}
```

#### **Repository User Context Pattern:**

All repository methods follow the same pattern - user ID as first parameter:

```typescript
// libs/database/src/repositories/ledger.repository.ts
export class LedgerRepository {
  async createTransaction(userId: string, transaction: CreateLedgerTransaction): Promise<LedgerTransaction> {
    return this.db.transaction(async trx => {
      // All database operations include userId in WHERE clauses
      const [dbTransaction] = await trx
        .insert(ledgerTransactions)
        .values({
          userId, // User scoping
          externalId: transaction.externalId,
          source: transaction.source,
          // ... rest of fields
        })
        .returning();

      const dbEntries = await trx
        .insert(entries)
        .values(
          transaction.entries.map(entry => ({
            userId, // User scoping
            transactionId: dbTransaction.id,
            accountId: entry.accountId,
            // ... rest of fields
          }))
        )
        .returning();

      return this.mapToLedgerTransaction(dbTransaction, dbEntries);
    });
  }

  async getAccountBalance(userId: string, accountId: number): Promise<Balance> {
    const result = await this.db
      .select({
        balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
        currencyTicker: currencies.ticker,
        currencyDecimals: currencies.decimals,
      })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .innerJoin(currencies, eq(accounts.currencyId, currencies.id)) // Global currency join - no user scoping needed
      .where(
        and(
          eq(entries.userId, userId), // User scoping on entries only
          eq(entries.accountId, accountId)
        )
      )
      .groupBy(currencies.ticker, currencies.decimals);

    // ... rest of method
  }
}
```

### Transaction Corrections and Reversals

While not required for initial implementation, a mature ledger system needs formal error correction capabilities. The system design already supports this through immutable transaction principles:

**Future Enhancement - Reversal Command**:

```typescript
// Future: libs/ledger/src/commands/impl/reverse-transaction.command.ts
export class ReverseTransactionCommand {
  constructor(
    public readonly userId: string,
    public readonly originalTransactionId: number,
    public readonly reversalReason: string,
    public readonly correctionData?: CreateLedgerTransactionDto
  ) {}
}

// Future: libs/ledger/src/commands/handlers/reverse-transaction.handler.ts
@CommandHandler(ReverseTransactionCommand)
export class ReverseTransactionHandler implements ICommandHandler<ReverseTransactionCommand> {
  async execute(command: ReverseTransactionCommand): Promise<ReversalResultDto> {
    // 1. Retrieve original transaction
    const originalTx = await this.queryBus.execute(
      new FindTransactionByIdQuery(command.userId, command.originalTransactionId)
    );

    // 2. Create exact opposite entries (reversal transaction)
    const reversalEntries = originalTx.entries.map(entry => ({
      ...entry,
      amount: (-BigInt(entry.amount)).toString(), // Flip amounts
      direction: entry.direction === 'CREDIT' ? 'DEBIT' : ('CREDIT' as const),
    }));

    // 3. Record reversal with audit trail
    const reversal = await this.commandBus.execute(
      new RecordTransactionCommand(command.userId, {
        externalId: `REVERSAL-${originalTx.externalId}`,
        source: `reversal-${originalTx.source}`,
        description: `Reversal: ${command.reversalReason}`,
        transactionDate: new Date().toISOString(),
        entries: reversalEntries,
        metadata: {
          reversalType: 'correction',
          originalTransactionId: originalTx.id,
          reason: command.reversalReason,
          reversedBy: 'system', // Could be user ID
          reversalTimestamp: new Date().toISOString(),
        },
      })
    );

    // 4. Record correction if provided
    let correction = null;
    if (command.correctionData) {
      correction = await this.commandBus.execute(
        new RecordTransactionCommand(command.userId, {
          ...command.correctionData,
          externalId: `CORRECTION-${originalTx.externalId}`,
          source: `correction-${originalTx.source}`,
          metadata: {
            ...command.correctionData.metadata,
            correctionType: 'replacement',
            originalTransactionId: originalTx.id,
            reversalTransactionId: reversal.id,
          },
        })
      );
    }

    return {
      originalTransaction: originalTx,
      reversalTransaction: reversal,
      correctionTransaction: correction,
      auditTrail: {
        reversedAt: new Date().toISOString(),
        reason: command.reversalReason,
        affectedAccounts: [...new Set(originalTx.entries.map(e => e.accountId))],
      },
    };
  }
}
```

**Benefits of This Approach**:

- Maintains complete audit trail
- Preserves immutable transaction history
- Enables temporal balance queries ("balance as of date X")
- Supports regulatory compliance requirements
- Integrates seamlessly with existing CQRS architecture

## Future Enhancement: Chart of Accounts Flexibility

The current hardcoded `account_type_enum` provides structure and is appropriate for v1. Future enterprise features could enhance this with dynamic account management:

**Future Enhancement - Dynamic Chart of Accounts**:

```sql
-- Future: Additional table for custom account types
CREATE TABLE user_account_types (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  parent_type account_type_enum NOT NULL, -- Maps to existing enum
  custom_name VARCHAR(255) NOT NULL,
  custom_code VARCHAR(50) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, custom_code)
);

-- Migration path: accounts table adds optional custom_account_type_id
ALTER TABLE accounts ADD COLUMN custom_account_type_id INTEGER
REFERENCES user_account_types(id) ON DELETE SET NULL;
```

**Implementation Approach**:

```typescript
// Future: Account creation with custom types
export interface CreateAccountDto {
  name: string;
  currencyTicker: string;
  accountType: AccountTypeEnum; // Required: base type
  customAccountTypeId?: number; // Optional: user's custom sub-type
  customAccountTypeName?: string; // Optional: create new custom type
  // ... existing fields
}

// Future: Balance reporting with custom categories
const balances = await this.queryBus.execute(
  new GetBalancesByCategoryQuery(userId, {
    groupByCustomType: true,
    includeSubCategories: true,
  })
);
```

**Migration Strategy**:

- Phase 1: Current enum-based system (ships with v1)
- Phase 2: Add custom account types table (backward compatible)
- Phase 3: Reporting with custom categorization
- Phase 4: Full user-configurable chart of accounts

This approach ensures the current design remains clean and focused while providing a clear path for enterprise-grade account management features.
