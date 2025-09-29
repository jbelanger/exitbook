# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

### Core Commands

- `pnpm install` - Install dependencies (~25 seconds, never cancel, set 60+ min timeout)
- `pnpm build` - Build TypeScript (~4 seconds, validates compilation)
- `pnpm test` - Run unit tests with Vitest
- `pnpm test:e2e` - Run end-to-end tests (requires API keys)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm lint` - Run ESLint
- `pnpm prettier:fix` - Auto-fix formatting issues

### CLI Commands

- `pnpm dev --help` - Show CLI help
- `pnpm status` - Show system status (transactions, sessions, verifications)
- `pnpm dev import --blockchain <name> --addresses <address>` - Import from blockchain
- `pnpm dev import --exchange <name>` - Import from exchange
- `pnpm dev verify --exchange <name>` - Verify exchange balances
- `pnpm dev verify --blockchain <name>` - Verify blockchain balances

### Provider Management

- `pnpm blockchain-providers:list` - List all registered blockchain providers
- `pnpm blockchain-providers:validate` - Validate provider registrations and configurations

### Run Single Test

```bash
pnpm vitest run <path/to/test-file.test.ts>
```

## Architecture

### Monorepo Structure

- **apps/cli/** - CLI application entry point using Commander
- **packages/core/** - Domain entities, types, Zod schemas, and universal utilities
- **packages/import/** - Transaction import domain (exchanges, blockchains, processors)
- **packages/balance/** - Balance calculation and verification services
- **packages/data/** - Kysely database layer, migrations, and repositories
- **packages/shared-logger/** - Structured logging with Pino
- **packages/shared-utils/** - Cross-cutting utilities

### Import System Architecture

The import system follows a layered architecture with dependency inversion:

**Importer Layer** → **Processor Layer** → **Repository Layer**

1. **Importers** (`packages/import/src/infrastructure/blockchains/*/importer.ts`, `packages/import/src/infrastructure/exchanges/*/importer.ts`)
   - Fetch raw transaction data from external APIs
   - Return `Result<ImportRunResult, Error>` with `rawData: ApiClientRawData[]`
   - Each importer extends `BaseImporter` and implements `IImporter` interface
   - Handle blockchain/exchange-specific API authentication and pagination

2. **Processors** (`packages/import/src/infrastructure/blockchains/*/processor.ts`, `packages/import/src/infrastructure/exchanges/*/processor.ts`)
   - Transform raw API data into normalized `StoredTransaction` records
   - Return `Result<StoredTransaction[], Error>` using neverthrow
   - Map blockchain/exchange-specific fields to universal transaction format
   - Handle data validation with Zod schemas

3. **Provider System** (Blockchain only)
   - Multi-provider failover architecture for blockchain importers
   - Each blockchain has multiple API providers (e.g., Bitcoin: mempool.space, blockchain.com, blockcypher)
   - Automatic provider selection and failover on errors
   - Configuration in `apps/cli/config/blockchain-explorers.json`

4. **Repository Layer**
   - `TransactionRepository` - Store processed transactions
   - `RawDataRepository` - Store raw API responses with provider metadata
   - `ImportSessionRepository` - Track import sessions and errors

### Result Type Pattern

The codebase uses `neverthrow` for functional error handling:

```typescript
import { ok, err, type Result } from 'neverthrow';

// Functions return Result<T, E> instead of throwing
async function processData(): Promise<Result<Transaction[], Error>> {
  if (hasError) {
    return err(new Error('Failed to process'));
  }
  return ok(transactions);
}

// Chain operations with .map() and .mapErr()
const result = await fetchData()
  .map((data) => transform(data))
  .mapErr((error) => new CustomError(error.message));

// Check result with .isOk() / .isErr()
if (result.isErr()) {
  logger.error(result.error.message);
  return err(result.error);
}
return ok(result.value);
```

### Key Domain Types

From `packages/core/src/types/`:

- `Transaction` - Universal transaction model
- `Balance` - Balance snapshot with verification metadata
- `ImportSession` - Import run tracking with errors

### Database

- **ORM**: Kysely (type-safe SQL query builder)
- **Database**: SQLite (`apps/cli/data/transactions.db`)
- **Schema**: `packages/data/src/schema/database-schema.ts`
- **Migrations**: `packages/data/src/migrations/`
- Initialized automatically on first run via `initializeDatabase()`

### Blockchain Provider System

Each blockchain (Bitcoin, Ethereum, Avalanche, Solana, Injective, Polkadot) has:

- Multiple API providers for failover resilience
- Provider-specific API client implementations
- Shared mapper interfaces for data normalization
- Configuration-driven provider registration

Provider registration happens in:

- `register-apis.ts` - Register API clients
- `register-mappers.ts` - Register data mappers
- Auto-loaded by `BlockchainProviderManager` from config

### Exchange Integration

Exchanges use three adapter patterns:

- **CCXT Adapter** - For exchanges supported by CCXT library
- **Native Adapter** - Direct API integration (KuCoin, Kraken, Coinbase)
- **Universal Adapter** - CSV/Ledger Live file imports

## Environment Setup

### Required for Testing

Create `apps/cli/.env` with API keys:

```bash
# Bitcoin providers (mempool.space is free)
BLOCKCYPHER_API_KEY=your_key

# Ethereum providers
ETHERSCAN_API_KEY=your_key
ALCHEMY_API_KEY=your_key

# Exchange APIs
KUCOIN_API_KEY=your_key
KUCOIN_SECRET=your_secret
KUCOIN_PASSPHRASE=your_passphrase
```

### Logger Configuration

See `packages/shared-logger/.env.example` for logging options.

## Development Guidelines

### Error Handling

- Use `Result<T, Error>` from neverthrow, not exceptions
- Return descriptive error messages
- Log errors at appropriate levels (error, warn, info, debug)

### Type Safety

- All schemas defined with Zod in `*.schemas.ts` files
- Runtime validation for external API data
- Strict TypeScript compilation enabled

### Testing

- Unit tests alongside source files: `*.test.ts`
- E2E tests in `__tests__/` directories
- Mock external API calls in unit tests
- Real API integration in E2E tests (requires keys)

### Code Organization

- Keep importers focused on data fetching
- Keep processors focused on data transformation
- Separate concerns: ports (interfaces) vs infrastructure (implementations)
- Use dependency injection for testability

## Common Workflows

### Adding New Blockchain Provider

1. Create provider directory: `packages/import/src/infrastructure/blockchains/<blockchain>/`
2. Implement importer extending `BaseImporter`
3. Implement processor with mapper from raw data to `StoredTransaction`
4. Create provider API clients and schemas
5. Register in `register-apis.ts` and `register-mappers.ts`
6. Add configuration to `apps/cli/config/blockchain-explorers.json`

### Adding New Exchange Adapter

1. Create adapter directory: `packages/import/src/infrastructure/exchanges/<exchange>/`
2. Implement importer extending `BaseImporter`
3. Implement processor transforming raw data
4. Create API client or CCXT adapter
5. Add exchange configuration

### Running Import Pipeline

1. Importer fetches raw data from API
2. Raw data saved to `raw_data` table with provider metadata
3. Processor transforms raw data to normalized transactions
4. Transactions saved to `transactions` table with deduplication
5. Import session created in `import_sessions` table

## Known Issues

- Some TypeScript errors exist in older blockchain providers
- Some lint errors exist in CCXT adapters
- Node.js version warnings (requires v23, works on v20)
- Ignore existing test failures unless modifying those files

## Package Dependencies

- `neverthrow` - Result type for error handling
- `zod` - Runtime type validation and schemas
- `decimal.js` - Precise financial calculations
- `ccxt` - Exchange integration library
- `bitcoinjs-lib` - Bitcoin address utilities
- `commander` - CLI framework
- `kysely` - Type-safe SQL query builder
- `pino` - Structured logging
