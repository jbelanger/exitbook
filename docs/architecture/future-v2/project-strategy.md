# Implementation Strategy: NestJS Double-Entry Ledger Architecture

## Overview

**Objective**: Build a new NestJS-based cryptocurrency transaction import system implementing a complete double-entry ledger architecture with Drizzle ORM from the ground up.

**Approach**: NestJS implementation using CQRS pattern that leverages existing importer/processor domain knowledge and provider registry patterns while building on modern, production-ready architecture. This eliminates large services/repositories in favor of small, focused command/query handlers. This is a complete rewrite, not a migration of existing data.

## Current System Analysis

### Current Architecture (Importer/Processor Pattern)

The existing system uses a clean ETL pipeline that maps well to NestJS patterns:

1. **Importers**: Fetch raw data from sources → **NestJS Services**
2. **Processors**: Transform raw data → **NestJS Processors/Transformers**
3. **Orchestration**: ETL pipeline management → **NestJS Orchestration Services**
4. **Provider Registry**: Multi-provider failover → **NestJS Provider Modules**

### Assets to Preserve & Enhance

**Core Domain Logic**:

- All importer logic → NestJS Injectable services
- Complex processor logic → NestJS processing services
- Provider registry → NestJS dynamic modules
- Session management → NestJS repository services

## New NestJS Project Structure

```
exitbook/
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
│   ├── core/                         # Domain entities & types
│   │   ├── src/
│   │   │   ├── entities/             # Account, LedgerTransaction, Entry
│   │   │   ├── types/                # Ledger-specific types
│   │   │   ├── validation/           # Zod schemas
│   │   │   └── core.module.ts
│   │   └── test/
│   ├── database/                     # Drizzle ORM integration
│   │   ├── src/
│   │   │   ├── schema/               # Database schema
│   │   │   ├── migrations/           # Migration files
│   │   │   ├── repositories/         # Repository services
│   │   │   └── database.module.ts
│   │   └── test/
│   ├── ledger/                       # Ledger business logic
│   │   ├── src/
│   │   │   ├── services/             # LedgerService, AccountService
│   │   │   ├── dto/                  # DTOs for API
│   │   │   ├── transformers/         # Universal → Ledger transformation
│   │   │   └── ledger.module.ts
│   │   └── test/
│   ├── import/                       # Import domain
│   │   ├── src/
│   │   │   ├── importers/            # Importer services
│   │   │   ├── processors/           # Processor services
│   │   │   ├── orchestration/        # Orchestration services
│   │   │   └── import.module.ts
│   │   └── test/
│   ├── providers/                    # Provider registry & circuit breakers
│   │   ├── src/
│   │   │   ├── registry/             # Provider registry
│   │   │   ├── circuit-breaker/      # Resilience patterns
│   │   │   ├── blockchain/           # Blockchain provider managers
│   │   │   └── providers.module.ts
│   │   └── test/
│   └── shared/                       # Cross-cutting concerns
│       ├── src/
│       │   ├── logger/               # Winston logging
│       │   ├── utils/                # Common utilities
│       │   ├── errors/               # Domain exceptions
│       │   ├── filters/              # Exception filters
│       │   └── shared.module.ts
│       └── test/
```

## NestJS Implementation Plan

### Phase 1: Complete Database Schema & NestJS Foundation

**Duration**: 2-3 weeks

**Goal**: Implement the complete database schema from `data-model.md` with all tables, indexes, and constraints from day one.

#### NestJS Project Setup:

```bash
# Create NestJS monorepo
npm i -g @nestjs/cli
nest new exitbook --package-manager pnpm
cd exitbook

# Generate applications
nest generate app api
nest generate app cli

# Generate libraries
nest generate library core
nest generate library database
nest generate library ledger
nest generate library import
nest generate library providers
nest generate library shared
```

#### Typed Configuration Setup:

```typescript
// libs/shared/src/config/configuration.ts
import { Transform, plainToClass } from 'class-transformer';
import { IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

export class DatabaseConfig {
  @IsString()
  DATABASE_URL: string;

  @IsNumber()
  @Transform(({ value }) => parseInt(value))
  @IsOptional()
  DATABASE_POOL_SIZE?: number = 10;

  @IsString()
  @IsOptional()
  DATABASE_SSL_MODE?: string = 'prefer';
}

export class ProvidersConfig {
  @IsObject()
  bitcoin: {
    enabled: boolean;
    providers: string[];
    priority: string[];
  };

  @IsObject()
  ethereum: {
    enabled: boolean;
    providers: string[];
    priority: string[];
  };

  // Add other blockchains as needed
}

export class AppConfig {
  @IsNumber()
  @Transform(({ value }) => parseInt(value))
  PORT: number = 3000;

  @IsString()
  NODE_ENV: string = 'development';

  @IsString()
  @IsOptional()
  LOG_LEVEL?: string = 'info';
}

export class Configuration {
  database: DatabaseConfig;
  app: AppConfig;
  providers: ProvidersConfig;
}

export function validateConfiguration(config: Record<string, unknown>): Configuration {
  const validatedConfig = plainToClass(Configuration, {
    database: plainToClass(DatabaseConfig, config),
    app: plainToClass(AppConfig, config),
    providers: plainToClass(ProvidersConfig, config.providers || {}),
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Configuration validation error: ${errors.toString()}`);
  }

  return validatedConfig;
}

// libs/shared/src/config/config.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfiguration,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),
  ],
  providers: [
    {
      provide: 'TYPED_CONFIG',
      useFactory: (configService: ConfigService) => {
        return validateConfiguration(configService.get<Record<string, unknown>>(''));
      },
      inject: [ConfigService],
    },
  ],
  exports: ['TYPED_CONFIG'],
})
export class TypedConfigModule {}
```

#### Database Module with Drizzle Schema & Migrations:

```typescript
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
import { pgTable, serial, varchar, timestamp, text, pgEnum, integer } from 'drizzle-orm/pg-core';
import { currencies } from './currencies';

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
  'EXPENSE_FEES_TRADE'
]);

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  currencyId: integer('currency_id').references(() => currencies.id, { onDelete: 'restrict' }).notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  network: varchar('network', { length: 50 }),
  externalAddress: varchar('external_address', { length: 255 }),
  source: varchar('source', { length: 50 }),
  parentAccountId: integer('parent_account_id').references(() => accounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// libs/database/src/schema/ledger.ts
import { pgTable, serial, varchar, timestamp, text, bigint, pgEnum, uniqueIndex, integer } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { currencies } from './currencies';

export const directionEnum = pgEnum('direction', ['CREDIT', 'DEBIT']);
export const entryTypeEnum = pgEnum('entry_type', [
  'TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'REWARD',
  'STAKING', 'AIRDROP', 'MINING', 'LOAN', 'REPAYMENT', 'TRANSFER', 'GAS'
]);

export const ledgerTransactions = pgTable('ledger_transactions', {
  id: serial('id').primaryKey(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  description: text('description').notNull(),
  transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Ensures idempotency - prevents duplicate transactions from retried jobs
  externalIdSourceIdx: uniqueIndex('external_id_source_idx').on(table.externalId, table.source),
}));

export const entries = pgTable('entries', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').references(() => ledgerTransactions.id, { onDelete: 'cascade' }).notNull(),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'restrict' }).notNull(),
  currencyId: integer('currency_id').references(() => currencies.id, { onDelete: 'restrict' }).notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  direction: directionEnum('direction').notNull(),
  entryType: entryTypeEnum('entry_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Critical indexes for performance
  accountCurrencyIdx: index('idx_entries_account_currency').on(table.accountId, table.currencyId),
  transactionIdx: index('idx_entries_transaction').on(table.transactionId),
  currencyIdx: index('idx_entries_currency').on(table.currencyId),
}));

// libs/database/src/database.module.ts
@Module({
  imports: [TypedConfigModule],
  providers: [
    {
      provide: 'DATABASE_CONNECTION',
      inject: ['TYPED_CONFIG'],
      useFactory: async (config: Configuration) => {
        const client = postgres(config.database.DATABASE_URL, {
          max: config.database.DATABASE_POOL_SIZE,
          ssl: config.database.DATABASE_SSL_MODE !== 'disable' ? { rejectUnauthorized: false } : false,
        });
        return drizzle(client, {
          schema: {
            currencies,
            accounts,
            ledgerTransactions,
            entries,
            blockchainTransactionDetails,
            exchangeTransactionDetails,
            transactionMetadata
          }
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
    private logger: Logger,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing database module...');

    // Ensure currencies are seeded on every application startup
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
@Injectable()
export class CurrencySeederService {
  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private logger: Logger,
  ) {}

  async seedDefaultCurrencies(): Promise<void> {
    this.logger.log('Starting currency seeding process...');

    const defaultCurrencies = [
      { ticker: 'BTC', name: 'Bitcoin', decimals: 8, assetClass: 'CRYPTO', isNative: true },
      { ticker: 'ETH', name: 'Ethereum', decimals: 18, assetClass: 'CRYPTO', network: 'ethereum', isNative: true },
      { ticker: 'USDC', name: 'USD Coin', decimals: 6, assetClass: 'CRYPTO', network: 'ethereum', contractAddress: '0xA0b86a33E6441e0fD4f5f6aF08e6E56fF29b4c3D' },
      { ticker: 'SOL', name: 'Solana', decimals: 9, assetClass: 'CRYPTO', network: 'solana', isNative: true },
      { ticker: 'USD', name: 'US Dollar', decimals: 2, assetClass: 'FIAT', isNative: true },
    ];

    let seededCount = 0;
    for (const currency of defaultCurrencies) {
      try {
        const result = await this.db
          .insert(currencies)
          .values(currency)
          .onConflictDoNothing({ target: currencies.ticker })
          .returning({ ticker: currencies.ticker });

        if (result.length > 0) {
          seededCount++;
          this.logger.debug(`Seeded currency: ${currency.ticker}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to seed currency ${currency.ticker}: ${error.message}`);
      }
    }

    this.logger.log(`Currency seeding completed. New currencies added: ${seededCount}, Total currencies: ${defaultCurrencies.length}`);
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

export const blockchainTransactionDetails = pgTable('blockchain_transaction_details', {
  transactionId: integer('transaction_id').primaryKey().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
  txHash: varchar('tx_hash', { length: 100 }).unique().notNull(),
  blockHeight: integer('block_height'),
  status: blockchainStatusEnum('status').notNull(),
  gasUsed: integer('gas_used'),
  gasPrice: bigint('gas_price', { mode: 'bigint' }), // Use bigint to prevent overflow with high gas prices
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  txHashIdx: index('idx_blockchain_tx_hash').on(table.txHash),
  statusIdx: index('idx_blockchain_status').on(table.status),
  blockHeightIdx: index('idx_blockchain_block_height').on(table.blockHeight),
}));

// libs/database/src/schema/exchange-transaction-details.ts
import { pgTable, integer, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { ledgerTransactions } from './ledger';

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const exchangeTransactionDetails = pgTable('exchange_transaction_details', {
  transactionId: integer('transaction_id').primaryKey().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
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

export const transactionMetadata = pgTable('transaction_metadata', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').references(() => ledgerTransactions.id, { onDelete: 'cascade' }).notNull(),
  key: varchar('key', { length: 100 }).notNull(),
  value: text('value').notNull(),
  dataType: metadataTypeEnum('data_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueKeyPerTransaction: uniqueIndex('unique_transaction_metadata_key').on(table.transactionId, table.key),
}));

// libs/database/src/schema/index.ts
export * from './currencies';
export * from './accounts';
export * from './ledger';
export * from './blockchain-transaction-details';
export * from './exchange-transaction-details';
export * from './transaction-metadata';

// Generate initial migration
// pnpm drizzle-kit generate:pg --schema=libs/database/src/schema/index.ts --out=libs/database/src/migrations
// After generation, run CurrencySeederService.seedDefaultCurrencies() in bootstrap

// libs/database/src/repositories/base.repository.ts
@Injectable()
export abstract class BaseRepository<T> {
  constructor(
    @Inject('DATABASE_CONNECTION') protected db: DrizzleDB,
    protected logger: Logger,
  ) {}
}

// libs/database/src/repositories/ledger.repository.ts
@Injectable()
export class LedgerRepository extends BaseRepository<LedgerTransaction> {
  async createTransaction(transaction: CreateLedgerTransaction): Promise<LedgerTransaction> {
    return this.db.transaction(async (trx) => {
      // CRITICAL: Validate entries balance per currency BEFORE inserting
      // This is the CORRECT way to validate transaction balance - at application level
      // within a database transaction, NOT via database triggers
      const entriesByCurrency = new Map<number, bigint>();

      for (const entry of transaction.entries) {
        const currentSum = entriesByCurrency.get(entry.currencyId) || 0n;
        entriesByCurrency.set(entry.currencyId, currentSum + entry.amount);
      }

      for (const [currencyId, sum] of entriesByCurrency) {
        if (sum !== 0n) {
          // ENHANCEMENT: Structured error with machine-readable data for API responses
          throw new LedgerValidationException({
            message: `Entries for currency ${currencyId} must balance to zero, got ${sum}`,
            code: 'ENTRIES_UNBALANCED',
            unbalancedCurrencies: [{
              currencyId,
              delta: sum.toString(),
              // Include currency ticker if available
              ticker: await this.getCurrencyTicker(currencyId),
            }],
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
        await trx
          .insert(blockchainTransactionDetails)
          .values({
            transactionId: dbTransaction.id,
            ...transaction.blockchainDetails,
          });
      }

      if (transaction.exchangeDetails) {
        await trx
          .insert(exchangeTransactionDetails)
          .values({
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
        currencyDecimals: currencies.decimals
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
        currencyDecimals: currencies.decimals
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

**IMPORTANT**: Transaction balance validation is handled at the application level (see LedgerRepository.createTransaction), not via database triggers, due to the logical impossibility of validating multi-entry balance during individual row insertion.

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

#### Enhanced Database Health Service:

```typescript
// libs/database/src/services/database-health.service.ts
@Injectable()
export class DatabaseHealthService {
  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private currencySeeder: CurrencySeederService,
    private logger: Logger
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

**Validation**: Complete database schema with all tables, indexes, constraints, triggers, automated seeding, health checks, and production monitoring implemented from day one

### Phase 2: Core Services & Domain Logic

**Duration**: 2-3 weeks

#### Enhanced Logging with Context:

```typescript
// libs/shared/src/logger/contextual-logger.service.ts
import { Injectable, Logger, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface LogContext {
  correlationId?: string;
  sessionId?: string;
  userId?: string;
  operation?: string;
}

@Injectable({ scope: Scope.REQUEST })
export class ContextualLoggerService extends Logger {
  private static asyncLocalStorage = new AsyncLocalStorage<LogContext>();

  static runWithContext<T>(context: LogContext, callback: () => T): T {
    return this.asyncLocalStorage.run(context, callback);
  }

  private getContext(): LogContext {
    return ContextualLoggerService.asyncLocalStorage.getStore() || {};
  }

  private formatMessage(message: string): string {
    const context = this.getContext();
    const contextStr = Object.entries(context)
      .filter(([_, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');

    return contextStr ? `[${contextStr}] ${message}` : message;
  }

  log(message: string, context?: string) {
    super.log(this.formatMessage(message), context);
  }

  error(message: string, trace?: string, context?: string) {
    super.error(this.formatMessage(message), trace, context);
  }

  warn(message: string, context?: string) {
    super.warn(this.formatMessage(message), context);
  }

  debug(message: string, context?: string) {
    super.debug(this.formatMessage(message), context);
  }
}

// libs/shared/src/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const correlationId = request.headers['x-correlation-id'] || crypto.randomUUID();

    return new Observable(observer => {
      ContextualLoggerService.runWithContext(
        { correlationId, operation: `${context.getClass().name}.${context.getHandler().name}` },
        () => {
          next.handle().subscribe(observer);
        }
      );
    });
  }
}
```

#### Ledger Services:

```typescript
// libs/ledger/src/services/ledger.service.ts
@Injectable()
export class LedgerService {
  constructor(
    private ledgerRepository: LedgerRepository,
    private accountService: AccountService,
    private logger: ContextualLoggerService
  ) {}

  async recordTransaction(request: CreateLedgerTransactionDto): Promise<LedgerTransactionDto> {
    this.logger.log(`Recording transaction from ${request.source}`);

    try {
      const ledgerTransaction = await this.ledgerRepository.createTransaction({
        externalId: request.externalId,
        source: request.source,
        description: request.description,
        transactionDate: new Date(request.transactionDate),
        entries: request.entries.map(entry => ({
          accountId: entry.accountId,
          amount: BigInt(entry.amount), // DTOs use string, convert to bigint in service layer
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

  async getAccountBalance(accountId: number): Promise<BalanceDto> {
    const balance = await this.ledgerRepository.getAccountBalance(accountId);

    return {
      accountId,
      amount: balance.amount.toString(),
      currency: balance.currency,
      decimals: balance.decimals,
    };
  }

  async getAllBalances(): Promise<BalanceDto[]> {
    const startTime = Date.now();

    try {
      const accounts = await this.accountService.findAll();
      const balances = await Promise.all(accounts.map(account => this.getAccountBalance(account.id)));

      const nonZeroBalances = balances.filter(balance => BigInt(balance.amount) !== 0n);

      // Record performance metrics
      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Balance calculation completed in ${duration}s for ${accounts.length} accounts`);

      return nonZeroBalances;
    } catch (error) {
      this.logger.error(`Balance calculation failed: ${error.message}`);
      throw new LedgerServiceException(`Failed to calculate balances: ${error.message}`);
    }
  }
}

// libs/ledger/src/services/account.service.ts
@Injectable()
export class AccountService {
  constructor(
    private accountRepository: AccountRepository,
    private currencyService: CurrencyService,
    private logger: Logger
  ) {}

  async findOrCreateAccount(request: FindOrCreateAccountDto): Promise<AccountDto> {
    // Try to find existing account
    const existing = await this.accountRepository.findByIdentifier(
      request.currencyTicker,
      request.source,
      request.network
    );

    if (existing) {
      return this.mapToDto(existing);
    }

    // Create new account
    const account = await this.accountRepository.create({
      name: this.generateAccountName(request),
      currencyTicker: request.currencyTicker,
      accountType: request.accountType,
      network: request.network,
      externalAddress: request.externalAddress,
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

  /**
   * ENHANCEMENT: Create or find LP (Liquidity Pool) parent account with hierarchical structure
   * Supports DeFi LP positions that contain multiple token sub-accounts
   */
  async findOrCreateLpAccount(request: {
    poolSymbol: string;
    protocol: string;
    source: string;
    network?: string;
  }): Promise<AccountDto> {
    // Try to find existing LP parent account
    const existing = await this.accountRepository.findLpAccount(
      request.poolSymbol,
      request.protocol,
      request.source,
      request.network
    );

    if (existing) {
      return this.mapToDto(existing);
    }

    // Create parent LP account (using a special LP currency or null)
    const lpAccount = await this.accountRepository.create({
      name: `LP ${request.poolSymbol} (${request.protocol})`,
      // LP accounts might use a special currency or be currency-agnostic
      currencyId: null, // Special case for LP parent accounts
      accountType: 'ASSET_DEFI_LP',
      network: request.network,
      source: request.source,
      externalAddress: `${request.protocol}:${request.poolSymbol}`,
      parentAccountId: null, // This is the parent
    });

    this.logger.log(`Created LP parent account: ${lpAccount.name}`);
    return this.mapToDto(lpAccount);
  }

  /**
   * ENHANCEMENT: Create child token accounts under LP parent for tracking individual tokens
   * Each token in the LP pair gets its own sub-account linked to the parent LP account
   */
  async findOrCreateLpTokenAccount(request: {
    currencyTicker: string;
    lpParentAccountId: number;
    source: string;
    network?: string;
  }): Promise<AccountDto> {
    const existing = await this.accountRepository.findLpTokenAccount(
      request.currencyTicker,
      request.lpParentAccountId,
      request.source
    );

    if (existing) {
      return this.mapToDto(existing);
    }

    const currency = await this.currencyService.findByTicker(request.currencyTicker);
    if (!currency) {
      throw new AccountCreationException(`Currency ${request.currencyTicker} not found`);
    }

    const tokenAccount = await this.accountRepository.create({
      name: `LP Token ${request.currencyTicker}`,
      currencyId: currency.id,
      accountType: 'ASSET_DEFI_LP',
      network: request.network,
      source: request.source,
      parentAccountId: request.lpParentAccountId, // Link to LP parent
    });

    this.logger.log(`Created LP token sub-account: ${tokenAccount.name} (parent: ${request.lpParentAccountId})`);
    return this.mapToDto(tokenAccount);
  }

  /**
   * ENHANCEMENT: Get all sub-accounts for a given parent account
   * Useful for reporting on complete LP positions
   */
  async getSubAccounts(parentAccountId: number): Promise<AccountDto[]> {
    const subAccounts = await this.accountRepository.findByParentId(parentAccountId);
    return subAccounts.map(account => this.mapToDto(account));
  }

  /**
   * ENHANCEMENT: Get hierarchical account structure with balances
   * Returns parent accounts with their sub-accounts for complete position view
   */
  async getAccountHierarchy(accountId: number): Promise<{
    account: AccountDto;
    subAccounts: AccountDto[];
    parentAccount?: AccountDto;
  }> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new AccountNotFoundException(`Account ${accountId} not found`);
    }

    const subAccounts = await this.getSubAccounts(accountId);
    let parentAccount: AccountDto | undefined;

    if (account.parentAccountId) {
      const parent = await this.accountRepository.findById(account.parentAccountId);
      if (parent) {
        parentAccount = this.mapToDto(parent);
      }
    }

    return {
      account: this.mapToDto(account),
      subAccounts,
      parentAccount,
    };
  }
}

// libs/ledger/src/transformers/universal-to-ledger-transformer.service.ts
@Injectable()
export class UniversalToLedgerTransformerService {
  constructor(
    private accountService: AccountService,
    private currencyService: CurrencyService,
    private logger: ContextualLoggerService
  ) {}

  /**
   * Transforms a UniversalTransaction to a CreateLedgerTransactionDto.
   * Implementation based on transformToLedger() function from data-model.md.
   * This is the critical bridge between existing domain logic and the new ledger architecture.
   */
  async transformUniversalTransaction(tx: UniversalTransaction): Promise<CreateLedgerTransactionDto> {
    this.logger.log(`Transforming universal transaction ${tx.id} from ${tx.source}`);

    const entries: CreateLedgerEntryDto[] = [];

    try {
      // Resolve main currency first
      const mainCurrency = await this.currencyService.findByTicker(tx.symbol);
      if (!mainCurrency) {
        throw new TransformationException(`Currency ${tx.symbol} not found`);
      }

      // Get or create main account
      const mainAccount = await this.accountService.findOrCreateAccount({
        currencyTicker: tx.symbol,
        accountType: this.determineAccountType(tx),
        source: tx.source,
        network: tx.network,
        externalAddress: tx.address,
      });

      // Convert amount to raw units (smallest currency unit)
      const rawAmount = this.convertToRawAmount(tx.amount, mainCurrency.decimals);

      // Main transaction entry
      entries.push({
        accountId: mainAccount.id,
        currencyId: mainCurrency.id,
        amount: (tx.side === 'buy' ? rawAmount : -rawAmount).toString(),
        direction: tx.side === 'buy' ? 'CREDIT' : 'DEBIT',
        entryType: this.mapTransactionTypeToEntryType(tx.type),
      });

      // Handle counterparty entry for trades
      if (tx.type === 'trade' && tx.price && tx.quoteCurrency) {
        await this.addCounterpartyEntry(tx, entries);
      }

      // Handle fee entries
      if (tx.fee && tx.fee.amount > 0) {
        await this.addFeeEntries(tx, entries);
      }

      // Validate entries balance per currency
      this.validateEntriesBalance(entries);

      return {
        externalId: tx.id,
        source: tx.source,
        description: this.generateDescription(tx),
        transactionDate: new Date(tx.timestamp).toISOString(),
        entries,
        // Include blockchain/exchange details if available
        blockchainDetails: tx.blockchainHash
          ? {
              txHash: tx.blockchainHash,
              blockHeight: tx.blockHeight,
              status: tx.status || 'confirmed',
              gasUsed: tx.gasUsed,
              gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : null,
            }
          : undefined,
        exchangeDetails: tx.exchangeOrderId
          ? {
              orderId: tx.exchangeOrderId,
              tradeId: tx.exchangeTradeId,
              symbol: tx.symbol + (tx.quoteCurrency ? `/${tx.quoteCurrency}` : ''),
              side: tx.side,
            }
          : undefined,
        metadata: tx.metadata,
      };
    } catch (error) {
      this.logger.error(`Failed to transform transaction ${tx.id}: ${error.message}`);

      // ENHANCEMENT: Detailed atomicity error reporting
      if (error instanceof TransactionAtomicityException) {
        this.logger.error(`Atomicity violation in transaction ${tx.id}:`, {
          completedOperations: error.completedOperations,
          failedOperation: error.failedOperation,
          transactionId: tx.id,
          source: tx.source,
        });
        throw error;
      }

      throw new TransformationException(`Transaction transformation failed: ${error.message}`, tx.id, tx.source, error);
    }
  }

  private async addCounterpartyEntry(tx: UniversalTransaction, entries: CreateLedgerEntryDto[]): Promise<void> {
    const quoteCurrency = await this.currencyService.findByTicker(tx.quoteCurrency!);
    if (!quoteCurrency) {
      throw new TransformationException(`Quote currency ${tx.quoteCurrency} not found`);
    }

    const counterAmount = tx.amount * tx.price!;
    const rawCounterAmount = this.convertToRawAmount(counterAmount, quoteCurrency.decimals);

    const counterAccount = await this.accountService.findOrCreateAccount({
      currencyTicker: tx.quoteCurrency!,
      accountType: this.determineAccountType(tx),
      source: tx.source,
      network: tx.network,
    });

    entries.push({
      accountId: counterAccount.id,
      currencyId: quoteCurrency.id,
      amount: (tx.side === 'buy' ? -rawCounterAmount : rawCounterAmount).toString(),
      direction: tx.side === 'buy' ? 'DEBIT' : 'CREDIT',
      entryType: 'TRADE',
    });
  }

  private async addFeeEntries(tx: UniversalTransaction, entries: CreateLedgerEntryDto[]): Promise<void> {
    const feeCurrency = await this.currencyService.findByTicker(tx.fee!.currency);
    if (!feeCurrency) {
      throw new TransformationException(`Fee currency ${tx.fee!.currency} not found`);
    }

    const rawFeeAmount = this.convertToRawAmount(tx.fee!.amount, feeCurrency.decimals);

    // Fee expense account
    const feeAccount = await this.accountService.findOrCreateAccount({
      currencyTicker: tx.fee!.currency,
      accountType: tx.type === 'trade' ? 'EXPENSE_FEES_TRADE' : 'EXPENSE_FEES_GAS',
      source: tx.source,
    });

    // Source account (where fee is deducted from)
    const sourceAccount =
      tx.symbol === tx.fee!.currency
        ? entries[0].accountId
        : (
            await this.accountService.findOrCreateAccount({
              currencyTicker: tx.fee!.currency,
              accountType: this.determineAccountType(tx),
              source: tx.source,
              network: tx.network,
            })
          ).id;

    // Debit from source account
    entries.push({
      accountId: sourceAccount,
      currencyId: feeCurrency.id,
      amount: (-rawFeeAmount).toString(),
      direction: 'DEBIT',
      entryType: 'FEE',
    });

    // Credit to fee expense account
    entries.push({
      accountId: feeAccount.id,
      currencyId: feeCurrency.id,
      amount: rawFeeAmount.toString(),
      direction: 'CREDIT',
      entryType: 'FEE',
    });
  }

  private validateEntriesBalance(entries: CreateLedgerEntryDto[]): void {
    const entriesByCurrency = new Map<number, bigint>();

    for (const entry of entries) {
      const currentSum = entriesByCurrency.get(entry.currencyId) || 0n;
      entriesByCurrency.set(entry.currencyId, currentSum + BigInt(entry.amount));
    }

    for (const [currencyId, sum] of entriesByCurrency) {
      if (sum !== 0n) {
        throw new TransformationException(`Currency ${currencyId} entries don't balance: ${sum}`);
      }
    }
  }

  private convertToRawAmount(amount: number, decimals: number): bigint {
    const multiplier = BigInt(10) ** BigInt(decimals);
    // Handle floating point precision by converting to string first
    const amountStr = amount.toFixed(decimals);
    const [whole, fraction = ''] = amountStr.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0');
    return BigInt(whole + paddedFraction);
  }

  private determineAccountType(tx: UniversalTransaction): string {
    switch (tx.type) {
      case 'trade':
        return 'ASSET_EXCHANGE';
      case 'deposit':
        return 'ASSET_WALLET';
      case 'withdrawal':
        return 'ASSET_WALLET';
      case 'staking':
        return 'ASSET_DEFI_LP';
      default:
        return 'ASSET_WALLET';
    }
  }

  private mapTransactionTypeToEntryType(type: string): string {
    const mapping = {
      trade: 'TRADE',
      deposit: 'DEPOSIT',
      withdrawal: 'WITHDRAWAL',
      staking: 'STAKING',
      reward: 'REWARD',
      airdrop: 'AIRDROP',
    };
    return mapping[type] || 'TRADE';
  }

  private generateDescription(tx: UniversalTransaction): string {
    switch (tx.type) {
      case 'trade':
        return `${tx.side?.toUpperCase()} ${tx.amount} ${tx.symbol}${tx.quoteCurrency ? ` for ${tx.quoteCurrency}` : ''}`;
      case 'deposit':
        return `Deposit ${tx.amount} ${tx.symbol}`;
      case 'withdrawal':
        return `Withdrawal ${tx.amount} ${tx.symbol}`;
      default:
        return `${tx.type} ${tx.amount} ${tx.symbol}`;
    }
  }

  /**
   * ENHANCEMENT: Handle complex DeFi transactions with multiple asset outputs
   * Example: DEX swap receiving both primary tokens and governance rewards
   */
  private async addMultiAssetOutputEntries(tx: UniversalTransaction, entries: CreateLedgerEntryDto[]): Promise<void> {
    for (const output of tx.additionalOutputs || []) {
      const outputCurrency = await this.currencyService.findByTicker(output.currency);
      if (!outputCurrency) {
        throw new TransformationException(`Output currency ${output.currency} not found`);
      }

      const rawAmount = this.convertToRawAmount(output.amount, outputCurrency.decimals);
      const outputAccount = await this.accountService.findOrCreateAccount({
        currencyTicker: output.currency,
        accountType: output.type === 'reward' ? 'INCOME_TRADING' : this.determineAccountType(tx),
        source: tx.source,
        network: tx.network,
      });

      entries.push({
        accountId: outputAccount.id,
        currencyId: outputCurrency.id,
        amount: rawAmount.toString(),
        direction: 'CREDIT',
        entryType: output.type === 'reward' ? 'REWARD' : 'TRADE',
      });
    }
  }

  /**
   * ENHANCEMENT: Handle LP position entries with hierarchical account structure
   * Creates parent LP account with child token accounts for proper tracking
   */
  private async addLiquidityPositionEntries(tx: UniversalTransaction, entries: CreateLedgerEntryDto[]): Promise<void> {
    // Create or find LP parent account
    const lpAccount = await this.accountService.findOrCreateLpAccount({
      poolSymbol: tx.lpPoolSymbol || `${tx.symbol}-${tx.quoteCurrency}`,
      protocol: tx.protocol || 'unknown',
      source: tx.source,
      network: tx.network,
    });

    // Handle token pair deposits/withdrawals under LP parent
    if (tx.type === 'liquidity_add') {
      await this.addLpDepositEntries(tx, entries, lpAccount.id);
    } else if (tx.type === 'liquidity_remove') {
      await this.addLpWithdrawalEntries(tx, entries, lpAccount.id);
    }
  }
}

// libs/ledger/src/services/currency.service.ts
@Injectable()
export class CurrencyService {
  private currencyCache = new Map<string, CurrencyDto>();
  private currencyByIdCache = new Map<number, CurrencyDto>();
  private cacheInitialized = false;

  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    private logger: ContextualLoggerService
  ) {}

  /**
   * CRITICAL ENHANCEMENT: In-memory currency cache for high-performance imports
   * Preloads all currencies on service initialization to avoid database calls during import processing
   * This provides significant performance gains for large imports with minimal implementation complexity
   */
  async onModuleInit(): Promise<void> {
    await this.initializeCache();
  }

  private async initializeCache(): Promise<void> {
    if (this.cacheInitialized) {
      return;
    }

    try {
      this.logger.log('Initializing currency cache...');
      const startTime = Date.now();

      const currencies = await this.db
        .select({
          id: currencies.id,
          ticker: currencies.ticker,
          name: currencies.name,
          decimals: currencies.decimals,
          assetClass: currencies.assetClass,
          network: currencies.network,
          contractAddress: currencies.contractAddress,
          isNative: currencies.isNative,
        })
        .from(currencies);

      // Build both ticker -> currency and id -> currency maps
      currencies.forEach(currency => {
        const currencyDto = this.mapToDto(currency);
        this.currencyCache.set(currency.ticker.toUpperCase(), currencyDto);
        this.currencyByIdCache.set(currency.id, currencyDto);
      });

      this.cacheInitialized = true;
      const duration = Date.now() - startTime;
      this.logger.log(`Currency cache initialized with ${currencies.length} currencies in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to initialize currency cache: ${error.message}`);
      throw new CurrencyServiceException('Currency cache initialization failed');
    }
  }

  /**
   * High-performance currency lookup by ticker (cached)
   * Critical for import processing where currency lookups happen in tight loops
   */
  async findByTicker(ticker: string): Promise<CurrencyDto | null> {
    await this.ensureCacheInitialized();
    return this.currencyCache.get(ticker.toUpperCase()) || null;
  }

  /**
   * High-performance currency lookup by ID (cached)
   */
  async findById(id: number): Promise<CurrencyDto | null> {
    await this.ensureCacheInitialized();
    return this.currencyByIdCache.get(id) || null;
  }

  /**
   * Get all cached currencies (for reporting/admin purposes)
   */
  async findAll(): Promise<CurrencyDto[]> {
    await this.ensureCacheInitialized();
    return Array.from(this.currencyCache.values());
  }

  /**
   * Create new currency and update cache
   * Used for dynamic currency addition during imports
   */
  async create(request: CreateCurrencyDto): Promise<CurrencyDto> {
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

    // Update cache immediately
    this.currencyCache.set(currencyDto.ticker, currencyDto);
    this.currencyByIdCache.set(currencyDto.id, currencyDto);

    this.logger.log(`Created and cached new currency: ${currencyDto.ticker}`);
    return currencyDto;
  }

  /**
   * Refresh cache from database (useful for admin operations)
   */
  async refreshCache(): Promise<void> {
    this.currencyCache.clear();
    this.currencyByIdCache.clear();
    this.cacheInitialized = false;
    await this.initializeCache();
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; initialized: boolean; memoryUsage: number } {
    return {
      size: this.currencyCache.size,
      initialized: this.cacheInitialized,
      memoryUsage: this.currencyCache.size * 256, // Rough estimate in bytes
    };
  }

  private async ensureCacheInitialized(): Promise<void> {
    if (!this.cacheInitialized) {
      await this.initializeCache();
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

// libs/ledger/src/ledger.module.ts
@Module({
  imports: [DatabaseModule, SharedModule],
  providers: [LedgerService, AccountService, CurrencyService, UniversalToLedgerTransformerService],
  exports: [LedgerService, AccountService, CurrencyService, UniversalToLedgerTransformerService],
})
export class LedgerModule {}
```

**Validation**: Core ledger services working with dependency injection

### Phase 3: Enhanced Import Services

**Duration**: 2-3 weeks

#### Preserve Existing Logic as NestJS Services:

```typescript
// libs/import/src/importers/exchanges/kraken/kraken.importer.service.ts
@Injectable()
export class KrakenImporterService extends BaseImporterService<CsvKrakenLedgerRow> {
  constructor(logger: Logger) {
    super('kraken', logger);
  }

  // Keep all existing logic from KrakenCsvImporter
  async import(params: ImportParamsDto): Promise<ImportRunResultDto<CsvKrakenLedgerRow>> {
    // Preserve existing implementation exactly
    this.logger.log(`Starting Kraken CSV import from directories: ${params.csvDirectories}`);

    if (!params.csvDirectories?.length) {
      throw new ImportValidationException('CSV directories are required for Kraken import');
    }

    // Keep all existing CSV parsing, validation, file processing logic
    const allTransactions: CsvKrakenLedgerRow[] = [];

    // ... existing implementation from KrakenCsvImporter

    return {
      rawData: allTransactions.map(rawData => ({
        providerId: 'kraken',
        rawData,
      })),
    };
  }
}

// libs/import/src/processors/exchanges/kraken/kraken.processor.service.ts
@Injectable()
export class KrakenProcessorService extends BaseProcessorService<ApiClientRawData<CsvKrakenLedgerRow>> {
  constructor(logger: Logger) {
    super('kraken', logger);
  }

  // Keep ALL existing business logic from KrakenProcessor
  async processInternal(
    rawDataItems: StoredRawData<ApiClientRawData<CsvKrakenLedgerRow>>[]
  ): Promise<UniversalTransaction[]> {
    // Preserve existing complex logic:
    // - Trade pairing
    // - Failed transaction detection
    // - Token migration handling
    // - Dustsweeping logic
    const rows = rawDataItems.map(item => item.rawData.rawData);
    return this.parseLedgers(rows); // Keep existing method
  }

  // Preserve all existing private methods:
  // - parseLedgers()
  // - convertTradeToTransaction()
  // - filterFailedTransactions()
  // - processTokenMigrations()
  // - convertDepositToTransaction()
  // etc.
}

// libs/import/src/orchestration/import-orchestration.service.ts
@Injectable()
export class ImportOrchestrationService {
  constructor(
    private importerFactory: ImporterFactoryService,
    private processorFactory: ProcessorFactoryService,
    private ledgerService: LedgerService,
    private transformerService: UniversalToLedgerTransformerService,
    private sessionRepository: ImportSessionRepository,
    private rawDataRepository: RawDataRepository,
    private logger: Logger
  ) {}

  async importAndProcessToLedger(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParamsDto
  ): Promise<ImportResultDto> {
    const session = await this.sessionRepository.create(sourceId, sourceType, params.providerId);

    try {
      // Phase 1: Import raw data (preserve existing logic)
      const importer = await this.importerFactory.create(sourceId, sourceType, params.providerId);
      const importResult = await importer.import(params);

      // Save raw data
      await this.rawDataRepository.save(sourceId, sourceType, importResult.rawData, {
        importSessionId: session.id,
        metadata: importResult.metadata,
      });

      // Phase 2: Process to UniversalTransactions (preserve existing logic)
      const processor = await this.processorFactory.create(sourceId, sourceType);
      const universalTransactions = await processor.process({
        id: session.id,
        sourceId,
        sourceType,
        rawDataItems: importResult.rawData,
        sessionMetadata: importResult.metadata,
      });

      // Phase 3: Transform to ledger entries (new)
      const ledgerTransactions = await Promise.all(
        universalTransactions.map(tx => this.transformerService.transformUniversalTransaction(tx))
      );

      // Phase 4: Record in ledger (new)
      const recordedTransactions = await Promise.all(
        ledgerTransactions.map(tx => this.ledgerService.recordTransaction(tx))
      );

      await this.sessionRepository.finalize(session.id, 'completed');

      return {
        sessionId: session.id,
        imported: importResult.rawData.length,
        processed: universalTransactions.length,
        ledgerTransactions: recordedTransactions.length,
        balanceSnapshot: await this.ledgerService.getAllBalances(),
      };
    } catch (error) {
      await this.sessionRepository.finalize(session.id, 'failed', error.message);
      throw new ImportOrchestrationException(`Import failed: ${error.message}`);
    }
  }
}
```

#### Provider Integration as NestJS Dynamic Modules:

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
    private logger: Logger
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

**Validation**: All existing importers/processors work as NestJS services

### Phase 4: NestJS Applications

**Duration**: 2-3 weeks

#### REST API Application:

```typescript
// apps/api/src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LedgerModule,
    ImportModule,
    ProvidersModule.forRootAsync({
      imports: [TypedConfigModule],
      useFactory: (config: Configuration) => config.providers,
      inject: ['TYPED_CONFIG'],
    }),
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}

// apps/api/src/controllers/ledger.controller.ts
@Controller('ledger')
@ApiTags('ledger')
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Post('transactions')
  @ApiOperation({ summary: 'Record a new ledger transaction' })
  async createTransaction(@Body() request: CreateLedgerTransactionDto): Promise<LedgerTransactionDto> {
    return this.ledgerService.recordTransaction(request);
  }

  @Get('accounts/:id/balance')
  @ApiOperation({ summary: 'Get account balance' })
  async getBalance(@Param('id', ParseIntPipe) accountId: number): Promise<BalanceDto> {
    return this.ledgerService.getAccountBalance(accountId);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get all account balances' })
  async getAllBalances(): Promise<BalanceDto[]> {
    return this.ledgerService.getAllBalances();
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  async getTransaction(@Param('id', ParseIntPipe) id: number): Promise<LedgerTransactionDto> {
    return this.ledgerService.getTransaction(id);
  }
}

// apps/api/src/controllers/import.controller.ts
@Controller('import')
@ApiTags('import')
export class ImportController {
  constructor(private importService: ImportOrchestrationService) {}

  @Post(':sourceId')
  @ApiOperation({
    summary: 'Import and process transactions (synchronous)',
    description: 'Processes transactions synchronously with 60-second timeout. For large imports, use async endpoint.',
  })
  @ApiResponse({ status: 200, description: 'Import completed successfully' })
  @ApiResponse({ status: 408, description: 'Request timeout - use async import for large datasets' })
  @ApiResponse({
    status: 400,
    description: 'Validation error - unbalanced entries or invalid data',
    schema: {
      example: {
        statusCode: 400,
        message: 'Transaction entries must balance per currency',
        details: {
          unbalancedCurrencies: [
            { currency: 'USDC', delta: '-500000', ticker: 'USDC' },
            { currency: 'ETH', delta: '100000000000000000', ticker: 'ETH' },
          ],
        },
      },
    },
  })
  async importTransactions(
    @Param('sourceId') sourceId: string,
    @Query('sourceType') sourceType: 'exchange' | 'blockchain',
    @Body() params: ImportParamsDto,
    @Headers('x-correlation-id') correlationId?: string
  ): Promise<ImportResultDto> {
    // Strategic compromise: Launch with synchronous API and 60-second timeout
    // Async processing becomes Priority #1 for next development cycle
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new RequestTimeoutException(
              'Import took longer than 60 seconds. Please use the async import endpoint for large datasets.'
            )
          ),
        60000
      );
    });

    const importPromise = this.importService.importAndProcessToLedger(sourceId, sourceType, params);

    try {
      return await Promise.race([importPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof RequestTimeoutException) {
        throw error;
      }
      // Enhanced error handling for validation failures
      if (error.message.includes('balance')) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Transaction entries must balance per currency',
          details: this.extractBalanceErrorDetails(error),
        });
      }
      throw error;
    }
  }

  private extractBalanceErrorDetails(error: any): any {
    // ENHANCEMENT: Extract structured error data from LedgerValidationException
    if (error instanceof LedgerValidationException && error.details) {
      return {
        code: error.details.code,
        unbalancedCurrencies: error.details.unbalancedCurrencies || [],
        transactionId: error.details.transactionId,
        source: error.details.source,
      };
    }

    // Fallback for other error types
    return {
      code: 'UNKNOWN_VALIDATION_ERROR',
      message: error.message || 'Unknown validation error occurred',
    };
  }

  @Get('status/:sourceId')
  @ApiOperation({ summary: 'Get import status' })
  async getImportStatus(@Param('sourceId') sourceId: string): Promise<ImportStatusDto> {
    return this.importService.getImportStatus(sourceId);
  }
}
```

#### CLI Application:

```typescript
// apps/cli/src/cli.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LedgerModule,
    ImportModule,
    ProvidersModule.forRootAsync({
      imports: [TypedConfigModule],
      useFactory: (config: Configuration) => config.providers,
      inject: ['TYPED_CONFIG'],
    }),
  ],
  providers: [
    ImportCommandService,
    BalanceCommandService,
    StatusCommandService,
  ],
})
export class CliModule {}

// apps/cli/src/commands/import.command.ts
@Injectable()
export class ImportCommandService {
  constructor(
    private importService: ImportOrchestrationService,
    private logger: Logger,
  ) {}

  async import(options: ImportOptionsDto): Promise<void> {
    const sourceId = options.exchange || options.blockchain!;
    const sourceType = options.exchange ? 'exchange' : 'blockchain';

    this.logger.log(`Starting import for ${sourceId} (${sourceType})`);

    const result = await this.importService.importAndProcessToLedger(sourceId, sourceType, {
      address: options.addresses?.[0],
      csvDirectories: options.csvDir ? [options.csvDir] : undefined,
      exchangeCredentials: options.credentials,
      providerId: options.providerId,
      since: options.since,
    });

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
  constructor(private ledgerService: LedgerService) {}

  async showBalances(): Promise<void> {
    const balances = await this.ledgerService.getAllBalances();

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
```

**Validation**: Both API and CLI applications working with full NestJS features

### Phase 5: Testing & Deployment

**Duration**: 1-2 weeks

#### Comprehensive Testing Strategy:

```typescript
// 1. Unit Tests - Individual services with mocked dependencies
// libs/ledger/src/services/ledger.service.spec.ts
describe('LedgerService', () => {
  let service: LedgerService;
  let ledgerRepository: LedgerRepository;
  let accountService: AccountService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        {
          provide: LedgerRepository,
          useValue: createMockRepository(),
        },
        {
          provide: AccountService,
          useValue: createMockAccountService(),
        },
        {
          provide: Logger,
          useValue: createMockLogger(),
        },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
    ledgerRepository = module.get<LedgerRepository>(LedgerRepository);
    accountService = module.get<AccountService>(AccountService);
  });

  describe('recordTransaction', () => {
    it('should record a valid balanced transaction', async () => {
      const request: CreateLedgerTransactionDto = {
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Test transaction',
        transactionDate: new Date().toISOString(),
        entries: [
          { accountId: 1, amount: '1000', direction: 'CREDIT', entryType: 'TRADE' },
          { accountId: 2, amount: '-1000', direction: 'DEBIT', entryType: 'TRADE' },
        ],
      };

      const result = await service.recordTransaction(request);

      expect(result).toBeDefined();
      expect(ledgerRepository.createTransaction).toHaveBeenCalledTimes(1);
    });

    it('should reject unbalanced transactions', async () => {
      const request: CreateLedgerTransactionDto = {
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Unbalanced transaction',
        transactionDate: new Date().toISOString(),
        entries: [
          { accountId: 1, amount: '1000', direction: 'CREDIT', entryType: 'TRADE' },
          { accountId: 2, amount: '-500', direction: 'DEBIT', entryType: 'TRADE' },
        ],
      };

      await expect(service.recordTransaction(request)).rejects.toThrow(LedgerServiceException);
    });
  });
});

// 2. Integration Tests - Module interactions with real DatabaseModule
// libs/import/src/orchestration/__tests__/import-orchestration.integration.spec.ts
describe('ImportOrchestration Integration', () => {
  let module: TestingModule;
  let orchestrationService: ImportOrchestrationService;
  let ledgerService: LedgerService;
  let db: DrizzleDB;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test' }),
        DatabaseModule,
        LedgerModule,
        ImportModule,
        ProvidersModule.forRootAsync({
          imports: [TypedConfigModule],
          useFactory: () => testProvidersConfig,
        }),
      ],
    }).compile();

    orchestrationService = module.get<ImportOrchestrationService>(ImportOrchestrationService);
    ledgerService = module.get<LedgerService>(LedgerService);
    db = module.get<DrizzleDB>('DATABASE_CONNECTION');
  });

  it('should correctly transform and record Kraken transactions in ledger', async () => {
    // Test the full pipeline: import -> process -> transform -> ledger
    const result = await orchestrationService.importAndProcessToLedger('kraken', 'exchange', {
      csvDirectories: ['test-data/kraken-sample'],
    });

    // Verify ledger entries are balanced
    const balances = await ledgerService.getAllBalances();
    const totalBalance = balances.reduce((sum, b) => sum + BigInt(b.amount), 0n);
    expect(totalBalance).toBe(0n); // Double-entry requirement

    // Verify idempotency - running again shouldn't create duplicates
    const result2 = await orchestrationService.importAndProcessToLedger('kraken', 'exchange', {
      csvDirectories: ['test-data/kraken-sample'],
    });
    expect(result2.ledgerTransactions).toBe(0); // Should be 0 due to unique constraint
  });
});

// 3. End-to-End Tests - Full application flow via API endpoints
describe('Import API (e2e)', () => {
  let app: INestApplication;
  let importService: ImportOrchestrationService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test' }),
        DatabaseModule,
        LedgerModule,
        ImportModule,
        ProvidersModule.forRoot(testProvidersConfig),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    importService = moduleFixture.get<ImportOrchestrationService>(ImportOrchestrationService);
  });

  it('should import Kraken transactions correctly', async () => {
    const result = await importService.importAndProcessToLedger('kraken', 'exchange', {
      csvDirectories: ['test-data/kraken'],
    });

    expect(result.imported).toBeGreaterThan(0);
    expect(result.ledgerTransactions).toBe(result.processed);
    expect(result.balanceSnapshot.length).toBeGreaterThan(0);
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
    depends_on:
      - postgres

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

**Validation**: Full NestJS application deployed with API and CLI capabilities

### Phase 4.5: Queue-Based Async Processing (Strategic Priority #1 Post-Launch)

**Duration**: 1-2 weeks

**Strategic Decision**: Launch with synchronous API (60-second timeout) and make async processing the immediate next priority. This allows market entry with working product while rapidly addressing scalability needs.

#### BullMQ Integration for Long-Running Imports:

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
    private importService: ImportOrchestrationService,
    private logger: ContextualLoggerService
  ) {}

  @Process('import-and-process')
  async handleImportJob(job: Job<ImportJobData>): Promise<ImportResultDto> {
    const { sourceId, sourceType, params, correlationId } = job.data;

    return ContextualLoggerService.runWithContext(
      { correlationId, sessionId: `job-${job.id}`, operation: 'async-import' },
      async () => {
        this.logger.log(`Processing import job ${job.id} for ${sourceId}`);

        // Update job progress
        await job.progress(10);

        try {
          const result = await this.importService.importAndProcessToLedger(sourceId, sourceType, params);

          await job.progress(100);
          this.logger.log(`Import job ${job.id} completed successfully`);

          return result;
        } catch (error) {
          this.logger.error(`Import job ${job.id} failed: ${error.message}`);
          throw error;
        }
      }
    );
  }
}

// apps/api/src/controllers/async-import.controller.ts
@Controller('async-import')
@ApiTags('async-import')
export class AsyncImportController {
  constructor(
    @InjectQueue('import-jobs') private importQueue: Queue,
    private logger: ContextualLoggerService
  ) {}

  @Post(':sourceId')
  @ApiOperation({ summary: 'Start async import and process transactions' })
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
    result?: ImportResultDto;
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

**Validation**: Async import processing with progress tracking and job management

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
  // ... existing methods
}

// apps/api/src/controllers/import.controller.ts
@Controller('import')
@ApiTags('import')
@UseGuards(ApiKeyGuard)
@ApiSecurity('api-key')
export class ImportController {
  // ... existing methods
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

  @IsString()
  @Matches(/^-?\d+$/) // Only accept string integers (no decimals)
  amount: string; // String in DTO, converted to bigint in service

  @IsEnum(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';
}

// libs/ledger/src/services/ledger.service.ts
export class LedgerService {
  // Always convert string to bigint at service boundary
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

  async recordTransaction(request: CreateLedgerTransactionDto): Promise<LedgerTransactionDto> {
    const entries = request.entries.map(entry => ({
      ...entry,
      amount: this.stringToBigInt(entry.amount), // DTO string -> service bigint
    }));

    // All internal processing uses bigint
    const ledgerTransaction = await this.ledgerRepository.createTransaction({
      ...request,
      entries,
    });

    // Convert back to string for response DTO
    return this.mapToDto(ledgerTransaction);
  }
}
```

## Key Architectural Benefits

### 1. Modern NestJS Architecture

- **Dependency Injection**: Full IoC container with automatic dependency resolution
- **Modular Design**: Clean module boundaries with explicit imports/exports
- **Decorators**: Type-safe decorators for routes, validation, documentation
- **Built-in Features**: Authentication, validation, serialization, exception handling

### 2. Preserved Domain Knowledge

- **Existing Logic**: All importer/processor business logic preserved as NestJS services
- **Provider System**: Enhanced with NestJS dynamic modules and configuration
- **Circuit Breakers**: Integrated with NestJS health checks and monitoring

### 3. Scalable Service Layer

- **Repository Pattern**: Clean data access layer with Drizzle integration
- **Service Composition**: Services can be easily composed and tested
- **Exception Handling**: Centralized exception handling with proper HTTP status codes
- **Validation**: Automatic DTO validation with class-validator

### 4. Dual Applications

- **REST API**: Production-ready API with OpenAPI documentation
- **CLI Application**: Enhanced CLI using nest-commander for complex workflows
- **Shared Libraries**: Code reuse between applications through NestJS libraries

### 5. Production Ready Features

- **Typed Configuration**: Environment-based configuration with class-validator validation preventing runtime errors
- **Contextual Logging**: Structured logging with correlation IDs and request context for distributed tracing
- **Queue Processing**: BullMQ integration for handling long-running imports with progress tracking
- **Health Checks**: Built-in health checks for dependencies (database, Redis, external APIs)
- **Schema Migrations**: Drizzle-generated migrations with proper foreign key relationships
- **Metrics**: Prometheus metrics integration
- **Documentation**: Automatic OpenAPI/Swagger documentation

## Success Criteria

### Core Implementation

- [ ] All existing importer domain knowledge implemented as NestJS services
- [ ] All existing processor business logic implemented as NestJS services
- [ ] Provider registry enhanced with NestJS dynamic modules
- [ ] Complete double-entry ledger with multi-currency support working with accurate balance calculations
- [ ] REST API providing full CRUD operations with structured transaction details
- [ ] CLI application with enhanced functionality beyond current system
- [ ] **Complete database schema implemented from day one**:
  - [ ] All core tables (currencies, accounts, ledger_transactions, entries)
  - [ ] All detail tables (blockchain_transaction_details, exchange_transaction_details, transaction_metadata)
  - [ ] All indexes for optimal query performance
  - [ ] Database triggers for data integrity enforcement
  - [ ] Parent account relationships for hierarchical structures

### Production Hardening

- [ ] Typed configuration with startup validation (class-validator)
- [ ] Provider configuration driven by typed ConfigModule (not hardcoded)
- [ ] Contextual logging with correlation IDs implemented
- [ ] **Currencies table and proper normalization**:
  - [ ] Currencies table with ticker, name, decimals, asset_class
  - [ ] Foreign key from accounts.currency_id to currencies.id
  - [ ] Default currency seeding (BTC, ETH, USDC, SOL, USD)
  - [ ] Currency validation in account creation
- [ ] Database schema with proper foreign key relationships and constraints:
  - [ ] `.notNull()` constraints applied appropriately
  - [ ] `onDelete: 'cascade'` for entries when transactions deleted
  - [ ] `onDelete: 'restrict'` for accounts and currencies to prevent data loss
  - [ ] Unique constraint on `(external_id, source)` for idempotency
  - [ ] Foreign key from entries.currency_id to currencies.id
- [ ] **Multi-currency transaction validation**:
  - [ ] Entries must balance to zero per currency (not globally)
  - [ ] Repository validates currency balance before transaction commit
  - [ ] Enhanced error messages showing which currency is unbalanced
- [ ] **Enhanced account type granularity**:
  - [ ] Asset types: ASSET_WALLET, ASSET_EXCHANGE, ASSET_DEFI_LP
  - [ ] Income types: INCOME_STAKING, INCOME_TRADING, INCOME_AIRDROP
  - [ ] Expense types: EXPENSE_FEES_GAS, EXPENSE_FEES_TRADE
  - [ ] Account name generation reflects granular types
- [ ] Drizzle migrations generated and tested with currency seeding
- [ ] BigInt precision maintained end-to-end:
  - [ ] DTOs use strings for amounts
  - [ ] Services convert to/from bigint at boundaries
  - [ ] Database stores as bigint
  - [ ] No precision loss through number conversion
- [ ] **Timezone handling**:
  - [ ] All timestamps use `timestamptz` (WITH TIME ZONE)
  - [ ] Consistent timezone handling across import sources

### Advanced Features & Operational Excellence

- [ ] **Strategic async processing implementation** (Priority #1 post-launch):
  - [ ] BullMQ integration with 60-second synchronous API fallback
  - [ ] Job progress tracking and status endpoints
  - [ ] Queue management and cancellation capabilities
- [ ] API security with API key authentication implemented
- [ ] **Enhanced balance and reporting capabilities**:
  - [ ] Balance queries grouped by currency with proper decimals
  - [ ] Multi-currency portfolio balance summaries
  - [ ] Account balance history and trend analysis
  - [ ] P&L reporting using granular account types
- [ ] **Production-ready operational features**:
  - [ ] Automated currency seeding on application startup
  - [ ] Database health checks with comprehensive metrics
  - [ ] Prometheus metrics for transaction processing and performance
  - [ ] Structured error responses with currency-specific balance details
  - [ ] Correlation ID tracing across all services
- [ ] **Complete UniversalToLedgerTransformerService implementation**:
  - [ ] Currency and account resolution logic
  - [ ] Multi-currency balance validation
  - [ ] Blockchain and exchange detail handling
  - [ ] Comprehensive error handling and recovery
- [ ] **Deployment pipeline automation**:
  - [ ] Automated database migrations before application startup
  - [ ] Health check validation during deployment
  - [ ] Zero-downtime deployment strategy
- [ ] Comprehensive testing strategy:
  - [ ] Unit tests (mocked dependencies)
  - [ ] Integration tests (real database, module interactions)
  - [ ] E2E tests (full API workflows)
  - [ ] **Multi-currency transaction testing**
  - [ ] **Currency validation and seeding tests**
  - [ ] **Transformer service accuracy tests**
  - [ ] Idempotency testing (duplicate imports handled correctly)
  - [ ] **Balance calculation accuracy tests across currencies**
  - [ ] **Health check and monitoring tests**
- [ ] Production deployment with Docker and database migrations
  - [ ] Automated migration execution in CI/CD pipeline
  - [ ] Container health checks and readiness probes
  - [ ] Database connection pooling and optimization
- [ ] Performance matching or exceeding current system
- [ ] OpenAPI documentation for all endpoints with security schemes and error examples

## Operational Excellence Considerations

### **1. Deployment and Migration Strategy**

- **Automated Currency Seeding**: `CurrencySeederService.seedDefaultCurrencies()` runs on every application startup via `onModuleInit()` lifecycle hook
- **Migration Execution**: Database migrations run automatically before application startup in deployment pipeline
- **Health Validation**: Database health checks validate connectivity, currency seeding, and relationship integrity
- **Zero-Downtime Deployments**: Proper foreign key constraints and migration ordering prevent data corruption during updates

### **2. Critical Service Implementation**

- **UniversalToLedgerTransformerService**: Core service implementing the `transformToLedger()` logic from `data-model.md`
- **Multi-Currency Resolution**: Automatic currency ID resolution and account creation during transformation
- **Balance Validation**: Pre-transaction validation ensures all currencies balance to zero before database insertion
- **Error Recovery**: Idempotent transaction handling with proper unique constraint violation recovery

### **3. Strategic API Approach**

- **Launch Strategy**: Synchronous API with documented 60-second timeout for immediate market entry
- **Structured Error Responses**: Multi-currency validation errors return detailed currency-specific balance information
- **Post-Launch Priority**: Async/BullMQ processing becomes Priority #1 for next development cycle
- **Timeout Handling**: Clear messaging directs users to upcoming async endpoints for large datasets

### **4. Production Monitoring**

- **Prometheus Metrics**: Transaction processing times, validation failures, import success rates
- **Health Endpoints**: Comprehensive health checks with database connectivity and seeding validation
- **Performance Tracking**: Balance calculation performance monitoring across currencies and account types
- **Correlation Tracing**: Request correlation IDs for distributed tracing across services

### **5. Data Integrity Assurance**

- **Database Triggers**: PostgreSQL triggers enforce multi-currency balancing and currency consistency
- **Application Validation**: Service-layer validation provides detailed error messages and recovery options
- **Foreign Key Constraints**: Proper cascade and restrict policies prevent orphaned data
- **Idempotency Guarantees**: Unique constraints on `(external_id, source)` prevent duplicate imports

This approach provides a modern, scalable NestJS foundation built from the ground up with complete architectural integrity and operational excellence. By implementing the full data model specification from day one, we ensure optimal performance, data integrity, and feature completeness. The implementation preserves all valuable domain knowledge from the existing system while building on a solid, production-ready foundation that includes:

- **Multi-currency ledger architecture** with proper normalization and per-currency balancing
- **Granular account types** enabling detailed financial reporting and categorization
- **Currency metadata management** with precision handling for different asset types
- **Typed configuration validation** preventing runtime configuration errors
- **Contextual logging** with correlation IDs for distributed tracing
- **Proper database relationships** with foreign key constraints and data integrity
- **Strategic async processing approach** with immediate market entry and rapid scalability enhancement
- **Complete operational excellence** with automated deployment, monitoring, and health validation
- **Production-ready error handling** with structured responses and correlation tracing

This foundation supports complex multi-currency trading scenarios, DeFi protocols, and enterprise reporting requirements while maintaining the flexibility to add new blockchains and exchanges through the existing provider system. The operational excellence features ensure smooth production deployment, monitoring, and maintenance from day one.

## Critical Architecture Decisions Summary

### 1. Transaction Balance Validation: Application-Level Only

**Decision**: Implement balance validation in `LedgerRepository.createTransaction()` within database transactions, NOT via database triggers.

**Rationale**: Database triggers that fire `AFTER INSERT ON entries` are logically flawed for multi-entry transactions. They would fail on every entry except the last one, making the system unusable.

**Implementation**: The current `LedgerRepository.createTransaction()` implementation is CORRECT - it validates the complete entry set before inserting any data.

### 2. entry_type Column: Required Field

**Decision**: `entry_type` is `NOT NULL` in the schema.

**Rationale**: This field is essential for:

- Financial categorization and reporting
- Tax preparation and compliance
- Transaction analysis and insights

Making this field optional would severely limit the system's analytical capabilities.

### 3. Hybrid Amount + Direction Design: Optimal Approach

**Decision**: Maintain both signed `amount` (BIGINT) and `direction` (ENUM) columns with validation trigger.

**Benefits**:

- **Computational Efficiency**: Signed amounts enable direct mathematical operations
- **Semantic Clarity**: Direction enum provides clear intent in SQL queries and reporting
- **Data Integrity**: Validation trigger ensures consistency between fields
- **Error Detection**: Redundancy helps catch data corruption issues

**Alternative Rejected**: Pure signed amount approach loses semantic clarity in complex financial queries.

### 4. Provider Registry Architecture: Metadata-Driven

**Decision**: Store provider metadata with code via decorators, JSON config only for user preferences.

**Benefits**:

- Self-documenting code with metadata co-located with implementation
- Eliminates configuration drift between available providers and config files
- Type-safe provider instantiation with runtime validation
- Automatic discovery of new providers without manual config updates

### 5. Multi-Currency Precision: Currency-Specific Decimals

**Decision**: Store monetary amounts as BIGINT in smallest currency units with currency-specific decimal metadata.

**Rationale**:

- **Eliminates floating-point precision errors** in financial calculations
- **Supports any currency precision** (8 decimals for BTC, 18 for ETH, 6 for USDC)
- **Enables accurate balance calculations** using simple integer arithmetic
- **Prevents rounding errors** that could cause audit failures

These architectural decisions ensure mathematical precision, data integrity, and system reliability for production financial applications.
