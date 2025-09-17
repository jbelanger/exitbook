# Service Layer Architecture

## Overview

The service layer provides a clean abstraction between the data persistence
layer (Drizzle ORM) and the application logic. This design ensures compatibility
with both the current CLI architecture and future NestJS migration while
maintaining separation of concerns.

## Design Principles

1. **Dependency Injection Ready**: All services use constructor injection
   compatible with NestJS
2. **Interface-Based Design**: Services depend on abstractions, not concrete
   implementations
3. **Transaction Management**: Financial operations are atomic with proper
   rollback capabilities
4. **Domain-Driven Design**: Services represent business capabilities, not
   database tables
5. **Async/Await**: All operations return Promises for consistent error handling

## Core Service Interfaces

### ILedgerService

Primary service for managing the double-entry ledger system.

```typescript
export interface ILedgerService {
  // Transaction Management
  recordTransaction(
    transaction: CreateLedgerTransaction,
  ): Promise<LedgerTransaction>;
  getTransaction(id: number): Promise<LedgerTransaction | null>;
  getTransactionByExternalId(
    externalId: string,
    source: string,
  ): Promise<LedgerTransaction | null>;

  // Account Management
  createAccount(account: CreateAccountRequest): Promise<Account>;
  getAccount(id: number): Promise<Account | null>;
  findAccountByIdentifier(
    ticker: string,
    source: string,
    network?: string,
  ): Promise<Account | null>;
  listAccounts(filters?: AccountFilters): Promise<Account[]>;

  // Balance Operations
  getAccountBalance(accountId: number): Promise<Balance>;
  getAccountBalanceAtDate(accountId: number, date: Date): Promise<Balance>;
  getAllBalances(filters?: BalanceFilters): Promise<AccountBalance[]>;

  // Reporting & Analytics
  getTransactionHistory(
    accountId: number,
    options?: HistoryOptions,
  ): Promise<TransactionHistoryEntry[]>;
  calculateCostBasis(
    accountId: number,
    method: 'FIFO' | 'LIFO',
  ): Promise<CostBasisResult>;
  generateBalanceSheet(asOfDate?: Date): Promise<BalanceSheet>;
}
```

### IImportService

Handles the transformation of external data sources into ledger transactions.

```typescript
export interface IImportService {
  // Data Transformation
  importFromAdapter(
    adapterId: string,
    source: ImportSource,
  ): Promise<ImportResult>;
  transformTransaction(
    universalTx: UniversalTransaction,
  ): Promise<CreateLedgerTransaction>;

  // Validation & Deduplication
  validateLedgerTransaction(
    transaction: CreateLedgerTransaction,
  ): Promise<ValidationResult>;
  findDuplicateTransaction(
    transaction: CreateLedgerTransaction,
  ): Promise<LedgerTransaction | null>;

  // Batch Operations
  importBatch(transactions: UniversalTransaction[]): Promise<BatchImportResult>;

  // Status & Progress
  getImportStatus(importId: string): Promise<ImportStatus>;
  listImports(filters?: ImportFilters): Promise<ImportSummary[]>;
}
```

### IAccountService

Manages account creation, hierarchy, and metadata.

```typescript
export interface IAccountService {
  // Account CRUD
  createAccount(request: CreateAccountRequest): Promise<Account>;
  updateAccount(id: number, updates: UpdateAccountRequest): Promise<Account>;
  deleteAccount(id: number): Promise<void>;

  // Account Discovery
  findOrCreateAccount(identifier: AccountIdentifier): Promise<Account>;
  findAccountsByPattern(pattern: AccountSearchPattern): Promise<Account[]>;

  // Hierarchy Management
  createSubAccount(
    parentId: number,
    request: CreateAccountRequest,
  ): Promise<Account>;
  getAccountHierarchy(rootAccountId?: number): Promise<AccountNode[]>;

  // Account Types & Categories
  categorizeAccount(
    accountId: number,
    category: AccountCategory,
  ): Promise<void>;
  getAccountsByType(accountType: AccountType): Promise<Account[]>;
}
```

## Service Implementation Examples

### LedgerService Implementation

```typescript
@Injectable() // NestJS-compatible decorator
export class LedgerService implements ILedgerService {
  constructor(
    @Inject('DATABASE_CONNECTION') private db: DrizzleDB,
    @Inject('LOGGER') private logger: ILogger,
  ) {}

  async recordTransaction(
    request: CreateLedgerTransaction,
  ): Promise<LedgerTransaction> {
    this.logger.debug('Recording transaction', {
      externalId: request.externalId,
      source: request.source,
    });

    // Validate business rules
    await this.validateTransactionRules(request);

    return this.db.transaction(async (trx) => {
      // Check for duplicates
      const existing = await this.findDuplicateInTransaction(trx, request);
      if (existing) {
        this.logger.warn('Duplicate transaction detected', {
          existingId: existing.id,
        });
        return existing;
      }

      // Validate entries balance to zero
      const sum = request.entries.reduce(
        (total, entry) => total + entry.amount,
        0n,
      );
      if (sum !== 0n) {
        throw new LedgerValidationError(
          `Transaction entries must balance to zero, got ${sum}`,
        );
      }

      // Insert transaction
      const [transaction] = await trx
        .insert(transactions)
        .values({
          externalId: request.externalId,
          source: request.source,
          description: request.description,
          transactionDate: request.transactionDate,
          status: request.status ?? 'confirmed',
          blockHeight: request.blockHeight,
          txHash: request.txHash,
          gasUsed: request.gasUsed,
          gasPrice: request.gasPrice,
        })
        .returning();

      // Insert entries
      const entryRecords = await trx
        .insert(entries)
        .values(
          request.entries.map((entry) => ({
            transactionId: transaction.id,
            accountId: entry.accountId,
            amount: entry.amount,
            direction: entry.direction,
            entryType: entry.entryType,
          })),
        )
        .returning();

      // Insert metadata if provided
      if (request.metadata && Object.keys(request.metadata).length > 0) {
        await trx.insert(transactionMetadata).values(
          Object.entries(request.metadata).map(([key, value]) => ({
            transactionId: transaction.id,
            key,
            value: JSON.stringify(value),
            dataType: typeof value,
          })),
        );
      }

      this.logger.info('Transaction recorded successfully', {
        id: transaction.id,
        entriesCount: entryRecords.length,
      });

      return this.mapToLedgerTransaction(transaction, entryRecords);
    });
  }

  async getAccountBalance(accountId: number): Promise<Balance> {
    const result = await this.db
      .select({
        balance: sql<string>`coalesce(sum(${entries.amount}), 0)`,
        currency: accounts.currencyTicker,
      })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(eq(entries.accountId, accountId))
      .groupBy(accounts.currencyTicker);

    if (result.length === 0) {
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new AccountNotFoundError(`Account ${accountId} not found`);
      }
      return { amount: 0n, currency: account.currencyTicker };
    }

    return {
      amount: BigInt(result[0].balance),
      currency: result[0].currency,
    };
  }

  async calculateCostBasis(
    accountId: number,
    method: 'FIFO' | 'LIFO',
  ): Promise<CostBasisResult> {
    // Complex query for cost basis calculation
    const query =
      method === 'FIFO'
        ? sql`
          WITH acquisitions AS (
            SELECT 
              e.amount,
              t.transaction_date,
              e.amount / nullif(tm_price.value::numeric, 0) as unit_price,
              SUM(e.amount) OVER (ORDER BY t.transaction_date ASC) as running_total
            FROM ${entries} e
            JOIN ${transactions} t ON e.transaction_id = t.id
            LEFT JOIN ${transactionMetadata} tm_price ON t.id = tm_price.transaction_id 
              AND tm_price.key = 'unit_price'
            WHERE e.account_id = ${accountId}
              AND e.amount > 0
            ORDER BY t.transaction_date ASC
          ),
          disposals AS (
            SELECT 
              ABS(e.amount) as amount,
              t.transaction_date,
              e.amount / nullif(tm_price.value::numeric, 0) as unit_price
            FROM ${entries} e
            JOIN ${transactions} t ON e.transaction_id = t.id
            LEFT JOIN ${transactionMetadata} tm_price ON t.id = tm_price.transaction_id 
              AND tm_price.key = 'unit_price'
            WHERE e.account_id = ${accountId}
              AND e.amount < 0
            ORDER BY t.transaction_date ASC
          )
          SELECT 
            SUM(a.amount * a.unit_price) as total_cost_basis,
            SUM(a.amount) as total_shares,
            AVG(a.unit_price) as average_cost_per_share
          FROM acquisitions a`
        : sql`/* LIFO query implementation */`;

    const result = await this.db.execute(query);

    return {
      method,
      totalCostBasis: BigInt(result.rows[0]?.total_cost_basis ?? 0),
      totalShares: BigInt(result.rows[0]?.total_shares ?? 0),
      averageCostPerShare: parseFloat(
        result.rows[0]?.average_cost_per_share ?? '0',
      ),
      calculatedAt: new Date(),
    };
  }

  private async validateTransactionRules(
    transaction: CreateLedgerTransaction,
  ): Promise<void> {
    // Business rule validations
    if (transaction.entries.length < 2) {
      throw new LedgerValidationError(
        'Transaction must have at least 2 entries',
      );
    }

    // Validate all referenced accounts exist
    const accountIds = transaction.entries.map((e) => e.accountId);
    const existingAccounts = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));

    if (existingAccounts.length !== accountIds.length) {
      const missing = accountIds.filter(
        (id) => !existingAccounts.some((a) => a.id === id),
      );
      throw new LedgerValidationError(
        `Referenced accounts not found: ${missing.join(', ')}`,
      );
    }

    // Additional business rules can be added here
  }
}
```

### ImportService Implementation

```typescript
@Injectable()
export class ImportService implements IImportService {
  constructor(
    private ledgerService: ILedgerService,
    private accountService: IAccountService,
    @Inject('LOGGER') private logger: ILogger,
  ) {}

  async transformTransaction(
    universalTx: UniversalTransaction,
  ): Promise<CreateLedgerTransaction> {
    const entries: CreateLedgerEntry[] = [];

    // Get or create primary account
    const primaryAccount = await this.accountService.findOrCreateAccount({
      currencyTicker: universalTx.symbol,
      source: universalTx.source,
      accountType: this.determineAccountType(universalTx.source),
    });

    // Transform based on transaction type
    switch (universalTx.type) {
      case 'trade':
        return this.transformTradeTransaction(universalTx, primaryAccount);

      case 'deposit':
        return this.transformDepositTransaction(universalTx, primaryAccount);

      case 'withdrawal':
        return this.transformWithdrawalTransaction(universalTx, primaryAccount);

      default:
        throw new TransformationError(
          `Unsupported transaction type: ${universalTx.type}`,
        );
    }
  }

  private async transformTradeTransaction(
    tx: UniversalTransaction,
    primaryAccount: Account,
  ): Promise<CreateLedgerTransaction> {
    const entries: CreateLedgerEntry[] = [];

    // Primary currency movement
    const primaryAmount = this.convertToSmallestUnit(tx.amount, tx.symbol);
    entries.push({
      accountId: primaryAccount.id,
      amount: tx.side === 'buy' ? primaryAmount : -primaryAmount,
      direction: tx.side === 'buy' ? 'CREDIT' : 'DEBIT',
      entryType: 'TRADE',
    });

    // Counter currency movement (if available)
    if (tx.price && tx.quoteCurrency) {
      const counterAccount = await this.accountService.findOrCreateAccount({
        currencyTicker: tx.quoteCurrency,
        source: tx.source,
        accountType: this.determineAccountType(tx.source),
      });

      const counterAmount = this.convertToSmallestUnit(
        tx.amount.mul(tx.price),
        tx.quoteCurrency,
      );
      entries.push({
        accountId: counterAccount.id,
        amount: tx.side === 'buy' ? -counterAmount : counterAmount,
        direction: tx.side === 'buy' ? 'DEBIT' : 'CREDIT',
        entryType: 'TRADE',
      });
    }

    // Fee handling
    if (tx.fee) {
      const feeEntries = await this.createFeeEntries(tx.fee, tx.source);
      entries.push(...feeEntries);
    }

    return {
      externalId: tx.id,
      source: tx.source,
      description: this.generateTransactionDescription(tx),
      transactionDate: new Date(tx.timestamp),
      entries,
      metadata: {
        originalTransaction: tx.info,
        side: tx.side,
        price: tx.price?.toString(),
      },
    };
  }

  async importBatch(
    transactions: UniversalTransaction[],
  ): Promise<BatchImportResult> {
    const results: ImportItemResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const [index, tx] of transactions.entries()) {
      try {
        const ledgerTx = await this.transformTransaction(tx);
        const result = await this.ledgerService.recordTransaction(ledgerTx);

        results.push({
          index,
          success: true,
          transaction: result,
          originalId: tx.id,
        });
        successCount++;
      } catch (error) {
        this.logger.error('Failed to import transaction', {
          originalId: tx.id,
          error: error.message,
        });

        results.push({
          index,
          success: false,
          error: error.message,
          originalId: tx.id,
        });
        errorCount++;
      }
    }

    return {
      totalProcessed: transactions.length,
      successCount,
      errorCount,
      results,
      importedAt: new Date(),
    };
  }
}
```

## Service Registration (Current Architecture)

For the current CLI-based system, services can be registered using a simple
dependency injection container:

```typescript
// services/container.ts
export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  register<T>(token: string, factory: () => T): void {
    this.services.set(token, factory);
  }

  get<T>(token: string): T {
    const factory = this.services.get(token);
    if (!factory) {
      throw new Error(`Service ${token} not registered`);
    }
    return factory();
  }
}

// services/registration.ts
export function registerServices(container: ServiceContainer): void {
  // Database connection
  container.register('DATABASE_CONNECTION', () => {
    const client = postgres(process.env.DATABASE_URL!);
    return drizzle(client, { schema });
  });

  // Logger
  container.register('LOGGER', () => new ConsoleLogger());

  // Core services
  container.register(
    'LEDGER_SERVICE',
    () =>
      new LedgerService(
        container.get('DATABASE_CONNECTION'),
        container.get('LOGGER'),
      ),
  );

  container.register(
    'ACCOUNT_SERVICE',
    () =>
      new AccountService(
        container.get('DATABASE_CONNECTION'),
        container.get('LOGGER'),
      ),
  );

  container.register(
    'IMPORT_SERVICE',
    () =>
      new ImportService(
        container.get('LEDGER_SERVICE'),
        container.get('ACCOUNT_SERVICE'),
        container.get('LOGGER'),
      ),
  );
}
```

## NestJS Migration Path

The service layer is designed to seamlessly transition to NestJS:

```typescript
// ledger.module.ts (Future NestJS structure)
@Module({
  imports: [DrizzleModule],
  providers: [
    LedgerService,
    AccountService,
    ImportService,
    {
      provide: 'LOGGER',
      useClass: NestJSLogger,
    },
  ],
  exports: [LedgerService, AccountService, ImportService],
})
export class LedgerModule {}

// Usage remains identical
@Controller('ledger')
export class LedgerController {
  constructor(
    private ledgerService: LedgerService, // Same interface, no changes needed
    private importService: ImportService,
  ) {}

  @Post('transactions')
  async createTransaction(@Body() request: CreateLedgerTransaction) {
    return this.ledgerService.recordTransaction(request);
  }

  @Get('accounts/:id/balance')
  async getBalance(@Param('id') accountId: number) {
    return this.ledgerService.getAccountBalance(accountId);
  }
}
```

## Error Handling Strategy

```typescript
// Custom error types for domain-specific errors
export class LedgerError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class LedgerValidationError extends LedgerError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor(message: string) {
    super(message, 'ACCOUNT_NOT_FOUND');
  }
}

export class DuplicateTransactionError extends LedgerError {
  constructor(message: string, public existingTransactionId: number) {
    super(message, 'DUPLICATE_TRANSACTION');
  }
}

// Error handling in services
async recordTransaction(request: CreateLedgerTransaction): Promise<LedgerTransaction> {
  try {
    // ... implementation
  } catch (error) {
    if (error.code === '23505') { // PostgreSQL unique constraint violation
      throw new DuplicateTransactionError(
        'Transaction already exists',
        await this.findExistingTransactionId(request)
      );
    }

    if (error instanceof LedgerError) {
      throw error; // Re-throw domain errors
    }

    // Log and wrap unexpected errors
    this.logger.error('Unexpected error in recordTransaction', { error, request });
    throw new LedgerError('Internal ledger error', 'INTERNAL_ERROR');
  }
}
```

## Testing Strategy

Services are designed with testability in mind:

```typescript
// __tests__/ledger.service.test.ts
describe('LedgerService', () => {
  let service: LedgerService;
  let mockDb: jest.Mocked<DrizzleDB>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockDb = createMockDrizzleDB();
    mockLogger = createMockLogger();
    service = new LedgerService(mockDb, mockLogger);
  });

  describe('recordTransaction', () => {
    it('should record a valid balanced transaction', async () => {
      const request: CreateLedgerTransaction = {
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Test transaction',
        transactionDate: new Date(),
        entries: [
          {
            accountId: 1,
            amount: 1000n,
            direction: 'CREDIT',
            entryType: 'TRADE',
          },
          {
            accountId: 2,
            amount: -1000n,
            direction: 'DEBIT',
            entryType: 'TRADE',
          },
        ],
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        return callback(mockDb as any);
      });

      const result = await service.recordTransaction(request);

      expect(result).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Transaction + entries
    });

    it('should reject unbalanced transactions', async () => {
      const request: CreateLedgerTransaction = {
        externalId: 'test-tx-1',
        source: 'test',
        description: 'Unbalanced transaction',
        transactionDate: new Date(),
        entries: [
          {
            accountId: 1,
            amount: 1000n,
            direction: 'CREDIT',
            entryType: 'TRADE',
          },
          {
            accountId: 2,
            amount: -500n,
            direction: 'DEBIT',
            entryType: 'TRADE',
          }, // Unbalanced!
        ],
      };

      await expect(service.recordTransaction(request)).rejects.toThrow(
        LedgerValidationError,
      );
    });
  });
});
```

## Benefits of This Architecture

1. **Clean Separation**: Business logic separated from data access and
   presentation
2. **Testable**: Services can be easily unit tested with mocked dependencies
3. **Framework Agnostic**: Works with current CLI and future NestJS migration
4. **Type Safe**: Full TypeScript coverage with compile-time validation
5. **Domain-Focused**: Services represent business capabilities, not technical
   concerns
6. **Error Handling**: Consistent error types and handling across the
   application
7. **Performance**: Direct database access when needed, with proper query
   optimization
8. **Scalable**: Service layer can be extended with caching, events, etc.

This service layer design provides a solid foundation that bridges the current
architecture with future NestJS migration while maintaining the flexibility
needed for a complex financial system.
