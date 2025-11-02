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
pnpm run dev import --blockchain bitcoin --address bc1q... --process

# Process raw data into normalized transactions
pnpm run dev process --exchange kraken --session <id>

# Check live balances (from exchange API or blockchain)
pnpm run dev balance --exchange kraken --api-key YOUR_KEY --api-secret YOUR_SECRET
pnpm run dev balance --blockchain bitcoin --address bc1q...

# View import sessions
pnpm run dev sessions view --source kraken --status completed

# View processed transactions
pnpm run dev transactions view --asset BTC --limit 100

# View price coverage statistics
pnpm run dev prices view --asset BTC --missing-only

# Derive prices from transaction history (uses confirmed links for cross-platform price propagation)
pnpm run dev prices derive

# Fetch remaining prices from external providers
pnpm run dev prices fetch --asset BTC --interactive

# View transaction links
pnpm run dev links view --status suggested

# Run linking algorithm
pnpm run dev links run

# View data quality gaps
pnpm run dev gaps view --category fees

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
- **packages/ingestion/** - Importers, processors, blockchain/exchange adapters, balance fetching
- **packages/accounting/** - Transaction analysis: linking, price derivation, cost basis
- **packages/data/** - Kysely/SQLite storage, repositories, migrations
- **packages/core/** - Domain types, Zod schemas, shared utilities
- **packages/shared-logger/** - Pino structured logging
- **packages/shared-utils/** - HTTP client, config, retry logic

### Import Pipeline Architecture

The system follows a two-phase data flow with normalization integrated into import:

**Phase 1: Import (Fetch + Normalize)**

- Importers (`infrastructure/blockchains/*/importer.ts` or `infrastructure/exchanges/*/importer.ts`)
- Extend `BaseImporter`, implement `IImporter` interface
- Fetch data from APIs or parse CSVs
- **API clients immediately normalize data using mappers** during fetch
  - Each API client instantiates its mapper (e.g., `BlockstreamTransactionMapper`)
  - Calls `mapper.map()` for each transaction during fetch
  - Returns `TransactionWithRawData<T>[]` containing both `raw` and `normalized` data
- Zod validation happens during normalization (fail-fast on invalid data)
- Return `Result<ImportRunResult, Error>` with normalized transactions
- Store **both** `raw_data` and `normalized_data` in `external_transaction_data` table with `processing_status = 'pending'`

**Phase 2: Process (Transform to Universal Format)**

- Processors (`infrastructure/blockchains/*/processor.ts` or `infrastructure/exchanges/*/processor.ts`)
- Load **normalized data** from `external_transaction_data` (already validated)
- Transform normalized payloads into universal `UniversalTransaction` format
- Return `Result<UniversalTransaction[], Error>`
- Upsert into `transactions` table (keyed by `external_id`)

**Balance Checking (Separate Command)**

- Use `balance` command to fetch current live balances from exchanges or blockchains
- For exchanges: requires API credentials (flags or `.env`)
- For blockchains: requires wallet address
- Returns unified balance snapshot with timestamp
- Independent of import/process pipeline for flexibility

### Blockchain Provider System

Multi-provider architecture with intelligent failover:

**Provider Registry** (`packages/ingestion/src/infrastructure/blockchains/shared/registry/`)

- Auto-registers providers via decorators (e.g., `@BlockchainProvider`)
- Metadata includes: name, blockchain, capabilities, required API keys

**BlockchainProviderManager** (`packages/ingestion/src/infrastructure/blockchains/shared/provider-manager.ts`)

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

- CSV Importer: `packages/ingestion/src/infrastructure/exchanges/<exchange>/importer.ts`
- API Importer (if supported): `packages/ingestion/src/infrastructure/exchanges/<exchange>/api-importer.ts`
- API Client (if supported): `packages/platform/exchanges/src/<exchange>/client.ts`
- Processor: `packages/ingestion/src/infrastructure/exchanges/<exchange>/processor.ts`
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

- `data_sources` - Tracks each import run with provider, status, metadata
- `external_transaction_data` - Stores raw API/CSV payloads with `processing_status`
- `transactions` - Normalized universal transaction records

**Repositories:**

- `DataSourceRepository` - Manages import sessions
- `RawDataRepository` - Stores raw API responses
- `TransactionRepository` - Stores processed transactions with deduplication

Migrations in `packages/data/src/migrations/` run automatically via `initializeDatabase()`.

### Multi-Currency & FX Rate Handling

**All prices normalized to USD during enrichment** (not at import). Two separate conversions:

1. **Storage normalization** (enrichment phase): EUR/CAD → USD via FX providers, stored with metadata
2. **Display conversion** (report generation): USD → CAD/EUR using historical rates (ephemeral, not stored)

**FX providers** integrated into `packages/platform/price-providers` (same as crypto price providers). FX rates cached in same `prices.db`.

See ADR-003 and Issue #153 for details.

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

- Core domain schemas centralized in `packages/core/src/schemas/` (single source of truth)
- Feature-specific schemas in `*.schemas.ts` files alongside implementation
- Types re-exported from schemas via `packages/core/src/types/` to eliminate duplication
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

- **No Technical Debt:** Stop and report architectural issues immediately before implementing. Fix foundational problems first rather than building on a weak base
- Use `exactOptionalPropertyTypes` - add `| undefined` to optional properties
- Add new tables/fields to initial migration (`001_initial_schema.ts`) - database is dropped during development, not versioned incrementally
- Remove all legacy code paths and backward compatibility when refactoring - clean breaks only
- **Vertical Slices Over Technical Layers:** Organize code by feature/functionality (e.g., `exchanges/kraken/`) rather than by technical layer (e.g., `importers/`, `processors/`, `clients/`). Keep related code together - each feature directory should contain its importer, processor, schemas, and tests
- **Dynamic Over Hardcoded:** Avoid hardcoding lists, enums, or configuration that can be derived dynamically. Use registries, metadata, and runtime discovery instead. The system should automatically discover available blockchains, exchanges, and providers from their registrations rather than maintaining hardcoded lists
- **Functional Core, Imperative Shell:** Extract business logic (validation, transformations) into pure functions in `*-utils.ts` modules. Use classes for resource management (DB, API clients). Use factory functions for stateless API wrappers. See `apps/cli/src/lib/import-utils.ts` (pure functions) and `apps/cli/src/handlers/import-handler.ts` (class managing resources)
- **Testing:** Test pure functions in `*-utils.test.ts` without mocks. Test classes/handlers with mocked dependencies.
- **Simplicity Over DRY:** Follow DRY (Don't Repeat Yourself) principles, but not at the expense of KISS (Keep It Simple, Stupid). Prefer simple, readable code over complex abstractions that eliminate minor duplication. Some repetition is acceptable if it makes code more straightforward and maintainable.
- **Developer Experience:** When developing packages, prioritize a simple and clean developer experience. APIs should be intuitive, error messages helpful, and setup minimal. Consider the ergonomics of how other developers will consume and work with the package.
- **Meaningful Comments Only:** Add comments only when they provide meaningful context that cannot be expressed through code itself. Avoid stating the obvious or documenting refactoring changes (e.g., "changed X to Y"). Prefer self-documenting code through clear naming and structure. Use comments to explain why, not what.
- **Context Management:** Monitor token usage throughout conversations. When context usage exceeds 125,000 tokens, warn the user and propose breaking the remaining work into sub-tasks, suggesting which sub-task to tackle first (after clearing history with `/clear`).

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

### Issue Tracking

- Track implementations and progress via GitHub issues using `gh` CLI tool
- Use `gh issue list`, `gh issue view <number> --comments`, `gh issue create` for workflow management
- Always load comments when viewing issues to get full context

### Adding a New Blockchain Provider

1. Create directory: `packages/ingestion/src/infrastructure/blockchains/<blockchain>/`
2. Implement importer extending `BaseImporter`
3. Implement processor with mapper from raw data to `UniversalTransaction`
4. Create provider API clients with Zod schemas
5. Register provider using `@BlockchainProvider` decorator
6. Add to `packages/ingestion/src/infrastructure/blockchains/registry/register-providers.ts`
7. Optionally add config in `apps/cli/config/blockchain-explorers.json`

### Adding a New Exchange Adapter

1. Create directory: `packages/ingestion/src/infrastructure/exchanges/<exchange>/`
2. Implement importer extending `BaseImporter` (parse CSV or call API)
3. Implement processor transforming raw data to `UniversalTransaction`
4. Create Zod schemas for validation
5. Register in exchange registry

### Testing Changes

```bash
# Type check
pnpm build

# Run related unit tests
pnpm vitest run packages/ingestion/src/infrastructure/blockchains/bitcoin

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
