# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Testing

```bash
# Build TypeScript to dist/
pnpm run build

# Run all tests
pnpm test

# Run specific test categories
pnpm run test:unit
pnpm run test:e2e
pnpm run test:watch
pnpm run test:coverage

# Run specific exchange tests
pnpm run test:coinbase
pnpm run test:coinbase:e2e
```

### Running the Application

```bash
# Development with hot reload and debug logging
pnpm run dev

# Import from all configured exchanges
pnpm run import

# Import from specific exchange or blockchain
pnpm run import -- --exchange kucoin
pnpm run import -- --blockchain bitcoin --addresses <address1> <address2>

# Import with balance verification
pnpm run import:verify

# Check account status and balances
pnpm run status

# Verify existing balances
pnpm run verify
```

### Provider and Configuration Management

```bash
# List all registered blockchain providers
pnpm run blockchain-providers:list

# Validate provider registrations
pnpm run blockchain-providers:validate

# Generate blockchain config template from providers
pnpm run blockchain-config:generate

# Note: Some exchange management commands may not be fully functional:
# pnpm run exchanges:list
# pnpm run exchanges:validate-config
```

## Architecture Overview

This is a cryptocurrency transaction import tool with multi-provider resilience architecture. The system supports both exchange APIs (via CCXT) and direct blockchain providers with automatic failover.

### Core Components

**Adapters Layer**: Two main types

- **Exchange Adapters**: Import from CEX platforms (KuCoin, Kraken, Coinbase) via CCXT, native APIs, or CSV files
- **Blockchain Adapters**: Direct blockchain data fetching (Bitcoin, Ethereum, Solana, Injective, Avalanche, Substrate chains)

**Provider Registry System**: Type-safe, self-documenting blockchain provider management

- Metadata lives with provider code via `@RegisterProvider` decorators
- JSON config only contains user preferences (enabled/disabled, priorities, overrides)
- Auto-discovery of available providers with runtime validation

**Multi-Provider Resilience**: Production-grade reliability features

- Circuit breakers to prevent cascading failures
- Automatic failover between providers (e.g., mempool.space → blockstream.info)
- Rate limiting and request caching
- Health monitoring and performance tracking

**Storage**: SQLite database with transaction deduplication

### Key Architectural Patterns

1. **Registry-Based Provider Management**: Providers register themselves with metadata using decorators
2. **Circuit Breaker Pattern**: Protects against failed providers with automatic recovery
3. **Adapter Pattern**: Common interfaces for different data sources (exchanges vs blockchains)
4. **Factory Pattern**: Creates adapters and providers based on configuration

### Monorepo Structure

```
crypto-tx-import/
├── apps/
│   └── cli/                    # CLI tool (current main app)
├── packages/
│   ├── core/                   # Domain entities & shared types
│   ├── import/                 # Transaction import domain
│   │   ├── blockchains/        # Blockchain-specific implementations
│   │   │   ├── bitcoin/        # Bitcoin adapter, providers & utilities
│   │   │   ├── ethereum/       # Ethereum adapter, providers & utilities
│   │   │   ├── avalanche/      # Avalanche adapter, providers & utilities
│   │   │   ├── solana/         # Solana adapter, providers & utilities
│   │   │   └── injective/      # Injective adapter, providers & utilities
│   │   ├── exchanges/          # Exchange adapters (CCXT, CSV, native)
│   │   ├── shared/             # Provider registry & shared utilities
│   │   └── services/           # Import orchestration services
│   ├── data/                   # Database, repositories & storage
│   ├── balance/                # Balance verification services
│   └── shared/                 # Cross-cutting concerns
│       ├── logger/             # Structured logging
│       ├── utils/              # Common utilities
│       └── tsconfig/           # TypeScript configurations
```

### Blockchain-Centric Organization

Each blockchain is organized as a self-contained feature module:

```
packages/import/blockchains/bitcoin/
├── adapter.ts              # Bitcoin blockchain adapter
├── providers/
│   ├── mempool-space-provider.ts
│   ├── blockstream-provider.ts
│   └── blockcypher-provider.ts
├── utils.ts               # Bitcoin-specific utilities
└── types.ts              # Bitcoin API response types
```

Benefits:

- **Feature Cohesion**: All blockchain-related code grouped together
- **Developer Experience**: Easy to find and modify blockchain-specific functionality
- **Clear Boundaries**: Each blockchain is a self-contained module
- **Scalability**: Adding new blockchains follows a consistent pattern

### Directory Structure

- `src/adapters/` - Exchange and blockchain adapters
- `src/providers/` - Individual blockchain API providers with registry system
- `src/core/types/` - TypeScript interfaces for different blockchains
- `src/services/` - Business logic (import, verification, wallet)
- `src/infrastructure/` - Database, logging, shared utilities
- `src/scripts/` - Provider management and configuration utilities
- `config/` - JSON configuration files for exchanges and blockchain explorers

## Important Implementation Notes

### Code Cleanup Guidelines

**Legacy AI Comments**: Remove outdated comments left by previous AI sessions that no longer provide value:

- Comments like `// Parameter types removed - using discriminated union`
- Placeholder comments that describe removed functionality
- Implementation notes that are no longer relevant to current code structure
- TODO comments for completed work

**When cleaning up code**:

- Remove comments that don't explain "why" or provide useful context
- Keep comments that explain complex business logic or non-obvious implementation details
- Update comments when refactoring to ensure they remain accurate

### Provider Development

When adding new blockchain providers:

1. Use `@RegisterProvider` decorator with complete metadata
2. Implement `IBlockchainProvider` interface
3. Import provider in corresponding adapter to trigger registration
4. Update configuration files and add tests

### Exchange Adapter Development

When adding new exchange adapters:

1. Use `@RegisterExchangeAdapter` decorator with metadata
2. Implement `IExchangeAdapter` interface
3. Register in `packages/import/src/exchanges/registry/register-adapters.ts`
4. Add configuration validation and tests

### Data Validation with Zod Schemas

The system includes comprehensive data validation using Zod schemas to ensure data integrity:

**Validation Pipeline:**

- All `UniversalTransaction` and `UniversalBalance` data is automatically validated in `BaseAdapter`
- Invalid data is filtered out and logged with detailed error messages
- Processing continues with valid data only (log + filter strategy)

**Validation Schemas:**

- Located in `packages/core/src/validation/universal-schemas.ts`
- `UniversalTransactionSchema`: Validates transaction structure, types, and constraints
- `UniversalBalanceSchema`: Validates balance data with mathematical constraints (total >= free + used)
- `MoneySchema`: Validates monetary amounts using Decimal.js for precision

**For Adapter Developers:**

- Validation occurs automatically in `BaseAdapter.fetchTransactions()` and `BaseAdapter.fetchBalances()`
- No additional code required - validation is built into the base class
- Invalid transactions/balances are logged with detailed error information:
  ```
  ERROR: 3 invalid transactions from KucoinAdapter. Invalid: 3, Valid: 97, Total: 100.
  Errors: id: Transaction ID must not be empty; timestamp: Expected number, received string
  ```
- Performance impact is minimal (< 5ms per transaction for typical batches)

**Schema Validation Rules:**

- Transaction IDs must be non-empty strings
- Timestamps must be positive integers (Unix milliseconds)
- Transaction types must match enum values ('trade', 'deposit', 'withdrawal', etc.)
- Money amounts must use Decimal.js instances for precision
- Balance totals must be >= free + used amounts
- All required fields must be present and valid

**Testing Validation:**

- Unit tests are provided in `packages/core/src/__tests__/universal-schemas.test.ts`
- Tests cover valid data, invalid data, edge cases, and performance scenarios
- BaseAdapter integration tests in `packages/import/src/shared/adapters/__tests__/base-adapter.test.ts`

### Configuration Management

- Exchange configs in `config/exchanges.json` with adapter types (ccxt/native/universal)
- Blockchain explorer configs in `config/blockchain-explorers.json` with provider priorities
- Environment variables for API keys (never commit secrets)

### Testing Strategy

- Unit tests for individual components
- E2E tests for full import workflows
- Provider connection tests for API validation
- Separate E2E test flags for external API calls

### Error Handling

- Circuit breaker protection for provider failures
- Automatic failover with exponential backoff
- Comprehensive logging with structured output
- Transaction deduplication to prevent duplicate imports

## Package Manager

Uses `pnpm` as the package manager (specified in package.json). All npm commands should use `pnpm` instead.

## Node Version

Requires Node.js >= 23.0.0 (see package.json engines field).

## Database

Uses SQLite3 for local transaction storage. Database initialization happens automatically on first run.

## Transaction Flow

The system processes transactions through a unified pipeline:

1. **Data Sources**: Exchange APIs (CCXT/native) or Blockchain APIs (multiple providers)
2. **Adapters**: Convert source-specific data to `CryptoTransaction` format
3. **Enhancement**: Add metadata, calculate fees, detect duplicates
4. **Storage**: Persist to SQLite with deduplication
5. **Verification**: Optional balance verification against live data

### Key Types

```typescript
// Universal transaction format across all sources
interface CryptoTransaction {
  id: string;
  type: TransactionType;
  timestamp: number;
  amount: Money; // Uses Decimal.js for precision
  symbol?: string;
  side?: 'buy' | 'sell';
  price?: Money;
  fee?: Money;
  status?: TransactionStatus;
  info?: any; // Raw source data
}

// High-precision money type
interface Money {
  amount: Decimal;
  currency: string;
}
```

## Provider Registry System

The registry system eliminates configuration drift by:

- Storing provider metadata with code via decorators
- Auto-discovering available providers at runtime
- Validating configurations against registered providers
- Enabling type-safe provider instantiation

Example provider registration:

```typescript
@RegisterProvider({
  blockchain: 'bitcoin',
  name: 'mempool-space',
  displayName: 'Mempool.space',
  type: 'api',
  requiresApiKey: false,
  networks: {
    mainnet: { baseUrl: 'https://mempool.space/api' },
  },
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance'],
    maxBatchSize: 1,
    supportsHistoricalData: true,
  },
})
export class MempoolSpaceProvider implements IBlockchainProvider {
  // Implementation
}
```

- exactOptionalPropertyTypes need to have optional properties with | undefined
