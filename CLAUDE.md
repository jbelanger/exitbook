# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development & Testing

- `pnpm install` - Install all dependencies (uses pnpm workspaces)
- `pnpm build` - Type check all packages (uses TypeScript project references)
- `pnpm test` - Run unit tests across all packages (vitest, excludes e2e)
- `pnpm test:e2e` - Run end-to-end tests (requires API keys in `.env`)
- `pnpm lint` - ESLint with perfectionist plugin
- `pnpm prettier:fix` - Auto-fix formatting issues

### Run Single Test

```bash
# Unit test
pnpm vitest run <path/to/test-file.test.ts>

# E2E test
pnpm vitest run --config vitest.e2e.config.ts <path/to/test.e2e.test.ts>
```

### CLI Usage (via apps/cli)

All CLI commands use `pnpm run dev` which proxies to `tsx` with `.env` loading:

```bash
# Import from exchange CSVs
pnpm run dev import --exchange kraken --csv-dir ./exports/kraken --process

# Import from exchange API (requires API credentials in .env)
pnpm run dev import --exchange kraken --api-key YOUR_KEY --api-secret YOUR_SECRET --process

# Import from blockchain
pnpm run dev import --blockchain bitcoin --address bc1q... --since 2023-01-01 --process

# Process raw data into normalized transactions
pnpm run dev process --exchange kraken --session <id>

# Verify balances
pnpm run dev verify --exchange kraken --report

# Export transactions
pnpm run dev export --exchange kraken --format csv --output ./reports/kraken.csv

# List available blockchains
pnpm run dev list-blockchains
```

### Provider Management

- `pnpm blockchain-providers:list` - List all registered blockchain providers with metadata
- `pnpm blockchain-providers:validate` - Validate provider registrations match config
- `pnpm providers:sync` - Sync blockchain-explorers.json with registered providers

## Architecture Overview

### Monorepo Structure (pnpm workspaces)

- **apps/cli/** - Commander-based CLI (`exitbook-cli`)
- **packages/import/** - Importers, processors, blockchain/exchange adapters
- **packages/data/** - Kysely/SQLite storage, repositories, migrations
- **packages/balance/** - Balance calculation and verification services
- **packages/core/** - Domain types, Zod schemas, shared utilities
- **packages/shared-logger/** - Pino structured logging
- **packages/shared-utils/** - HTTP client, config, retry logic

### Import Pipeline Architecture

The system follows a three-phase data flow:

**Phase 1: Import (Raw Data Fetch)**

- Importers (`infrastructure/blockchains/*/importer.ts` or `infrastructure/exchanges/*/importer.ts`)
- Extend `BaseImporter`, implement `IImporter` interface
- Fetch data from APIs or parse CSVs
- Return `Result<ImportRunResult, Error>` with `rawData: ApiClientRawData[]`
- Store in `external_transaction_data` table with `processing_status = 'pending'`

**Phase 2: Process (Normalization)**

- Processors (`infrastructure/blockchains/*/processor.ts` or `infrastructure/exchanges/*/processor.ts`)
- Transform raw API payloads into universal `StoredTransaction` format
- Return `Result<StoredTransaction[], Error>`
- Handle data validation with Zod schemas
- Upsert into `transactions` table (keyed by `external_id`)

**Phase 3: Verify (Balance Reconciliation)**

- Balance calculation services aggregate inflows/outflows by currency
- Compare calculated vs. live balances (live lookups not yet implemented)
- Generate verification reports

### Blockchain Provider System

Multi-provider architecture with intelligent failover:

**Provider Registry** (`packages/import/src/infrastructure/blockchains/shared/registry/`)

- Auto-registers providers via decorators (e.g., `@BlockchainProvider`)
- Metadata includes: name, blockchain, capabilities, required API keys

**BlockchainProviderManager** (`packages/import/src/infrastructure/blockchains/shared/provider-manager.ts`)

- Automatic failover when providers return errors or rate limits
- Per-provider circuit breakers
- Short-term request caching
- Health checks

**Configuration** (`apps/cli/config/blockchain-explorers.json`)

- Optional overrides for enabled providers, priorities, rate limits, retries, timeouts
- Falls back to provider metadata defaults if file is missing

**Blockchain Categories:**

- **Bitcoin** - Blockstream, Mempool.space, Tatum
- **EVM** - Extensive coverage (Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, zkSync, Linea, Scroll, Mantle, Blast, Theta, etc.) using Alchemy, Moralis, chain-specific explorers
- **Solana** - Helius, Solana RPC, Solscan
- **Substrate** - Polkadot, Kusama, Bittensor, Moonbeam, Astar via Subscan, Taostats
- **Cosmos** - Injective via Injective Explorer

### Exchange Integration

**Exchange Package** (`packages/platform/exchanges/`)

- Generic exchange client architecture using ccxt for API connectivity
- `IExchangeClient` interface with `fetchTransactionData()` method
- Generic `ExchangeCredentials = Record<string, string>` type
- Each exchange validates credentials via Zod schemas
- Returns validated raw data as `RawExchangeData[]`

**Supported Exchanges:**

- **Kraken** - CSV importer (parses `ledgers.csv` export) OR API importer (via KrakenClient)
- **KuCoin** - CSV importer (handles multiple CSVs: account history, trading, deposits, withdrawals)
- **Ledger Live** - CSV importer (imports `operations.csv` from desktop app)
- **Coinbase** - Stubbed (not yet implemented)

**Each exchange has:**

- CSV Importer: `packages/import/src/infrastructure/exchanges/<exchange>/importer.ts`
- API Importer (if supported): `packages/import/src/infrastructure/exchanges/<exchange>/api-importer.ts`
- API Client (if supported): `packages/platform/exchanges/src/<exchange>/client.ts`
- Processor: `packages/import/src/infrastructure/exchanges/<exchange>/processor.ts`
- Zod schemas: For both CSV validation and API response validation

**Import Methods:**

- CSV import requires `--csv-dir` flag
- API import requires `--api-key` and `--api-secret` flags (some exchanges may also need `--api-passphrase`)
- ImporterFactory automatically selects CSV or API importer based on provided parameters

### Database Layer

**ORM:** Kysely (type-safe SQL query builder)
**Database:** SQLite at `apps/cli/data/transactions.db`
**Schema:** `packages/data/src/schema/database-schema.ts`

**Key Tables:**

- `import_sessions` - Tracks each import run with provider, status, metadata
- `external_transaction_data` - Stores raw API/CSV payloads with `processing_status`
- `transactions` - Normalized universal transaction records

**Repositories:**

- `ImportSessionRepository` - Manages import sessions
- `RawDataRepository` - Stores raw API responses
- `TransactionRepository` - Stores processed transactions with deduplication

Migrations in `packages/data/src/migrations/` run automatically via `initializeDatabase()`.

## Critical Patterns

### Result Type (neverthrow)

All functions that can fail return `Result<T, Error>` instead of throwing:

```typescript
import { ok, err, type Result } from 'neverthrow';

async function processData(): Promise<Result<Transaction[], Error>> {
  if (hasError) {
    return err(new Error('Failed to process'));
  }
  return ok(transactions);
}

// Chain operations
const result = await fetchData()
  .map((data) => transform(data))
  .mapErr((error) => new CustomError(error.message));

// Check results
if (result.isErr()) {
  logger.error(result.error.message);
  return err(result.error);
}
return ok(result.value);
```

### Zod Schemas

Runtime validation for all external data (API responses, CSV rows):

- Schemas defined in `*.schemas.ts` files
- Used in importers and processors for validation
- Type inference: `type Foo = z.infer<typeof FooSchema>`

### Logging (Pino)

Structured logging configured in `packages/shared-logger`:

```typescript
import { createLogger } from '@exitbook/shared-logger';
const logger = createLogger('component-name');

logger.info('message');
logger.error({ error }, 'error message');
logger.debug({ metadata }, 'debug message');
```

## Code Requirements

- Use `exactOptionalPropertyTypes` - add `| undefined` to optional properties
- Add new tables/fields to initial migration (`001_initial_schema.ts`) - database is dropped during development, not versioned incrementally
- Remove all legacy code paths and backward compatibility when refactoring - clean breaks only

## Environment Variables

Create `.env` in project root with API keys (loaded via `tsx --env-file-if-exists`):

```bash
# Blockchain providers
ALCHEMY_API_KEY=...
MORALIS_API_KEY=...
SNOWTRACE_API_KEY=...
HELIUS_API_KEY=...
SOLSCAN_API_KEY=...
TATUM_API_KEY=...
TAOSTATS_API_KEY=...

# Exchanges (for direct API import, not CSV)
KUCOIN_API_KEY=...
KUCOIN_SECRET=...
KUCOIN_PASSPHRASE=...
```

## Common Development Workflows

### Adding a New Blockchain Provider

1. Create directory: `packages/import/src/infrastructure/blockchains/<blockchain>/`
2. Implement importer extending `BaseImporter`
3. Implement processor with mapper from raw data to `StoredTransaction`
4. Create provider API clients with Zod schemas
5. Register provider using `@BlockchainProvider` decorator
6. Add to `packages/import/src/infrastructure/blockchains/registry/register-providers.ts`
7. Optionally add config in `apps/cli/config/blockchain-explorers.json`

### Adding a New Exchange Adapter

1. Create directory: `packages/import/src/infrastructure/exchanges/<exchange>/`
2. Implement importer extending `BaseImporter` (parse CSV or call API)
3. Implement processor transforming raw data to `StoredTransaction`
4. Create Zod schemas for validation
5. Register in exchange registry

### Testing Changes

```bash
# Type check
pnpm build

# Run related unit tests
pnpm vitest run packages/import/src/infrastructure/blockchains/bitcoin

# Run full test suite
pnpm test

# Test CLI command
pnpm run dev import --exchange kraken --csv-dir ./test-data --process
```

## Project Context

**Purpose:** Track, log, and analyze cryptocurrency activity across exchanges and blockchains. Import raw data from CSVs and APIs, normalize into a universal transaction schema, and verify balances.

**Requirements:**

- Node.js ≥ 23 (specified in package.json engines)
- pnpm ≥ 10.6.2 (workspace manager)
- SQLite (via better-sqlite3)

**Data Location:** All SQLite databases, exports, and reports stored in `apps/cli/data/`
