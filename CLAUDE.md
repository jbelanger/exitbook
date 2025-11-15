# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration Preferences

- **Vocabulary Feedback:** Suggest accurate alternatives when imprecise technical terminology is used
- **Fresh Documentation:** Write as first draft - clean and cohesive, not revision history

## Essential Commands

### Development & Testing

- `pnpm install` - Install dependencies (pnpm workspaces)
- `pnpm build` - Type check + bundle CLI (tsup for CLI, tsc --noEmit for packages)
- `pnpm test` - Unit tests (vitest, excludes e2e)
- `pnpm test:e2e` - E2E tests (requires `.env` API keys)
- `pnpm lint` - ESLint + perfectionist
- `pnpm prettier:fix` - Auto-fix formatting

### Run Single Test

```bash
# Unit test
pnpm vitest run <path/to/test-file.test.ts>

# E2E test
pnpm vitest run --config vitest.e2e.config.ts <path/to/test.e2e.test.ts>
```

### CLI Usage

All commands use `pnpm run dev` (tsx + `.env` loading):

```bash
pnpm run dev import --exchange kraken --csv-dir ./exports/kraken --process
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET --process
pnpm run dev import --blockchain bitcoin --address bc1q... --process
pnpm run dev process --exchange kraken --session <id>
pnpm run dev balance --exchange kraken --api-key KEY --api-secret SECRET
pnpm run dev balance --blockchain bitcoin --address bc1q...
pnpm run dev sessions view --source kraken --status completed
pnpm run dev transactions view --asset BTC --limit 100
pnpm run dev prices view --asset BTC --missing-only
pnpm run dev prices enrich  # 4-stage pipeline: derive → normalize → fetch → re-derive
pnpm run dev prices enrich --derive-only
pnpm run dev prices enrich --normalize-only
pnpm run dev prices enrich --fetch-only --asset BTC --interactive
pnpm run dev links view --status suggested
pnpm run dev links run
pnpm run dev gaps view --category fees
pnpm run dev export --exchange kraken --format csv --output ./reports/kraken.csv
pnpm run dev list-blockchains
```

### Provider Management

- `pnpm blockchain-providers:list` - List blockchain providers + metadata
- `pnpm blockchain-providers:validate` - Validate provider registrations
- `pnpm providers:sync` - Sync provider configurations

## Architecture Overview

### Monorepo Structure (pnpm workspaces)

- **apps/cli/** - Commander CLI, feature-based organization (`src/features/`)
- **packages/blockchain-providers/** - Blockchain API clients, provider registry, failover
- **packages/exchange-providers/** - Exchange API clients (ccxt-based)
- **packages/price-providers/** - Price/FX provider integrations
- **packages/ingestion/** - Import/process orchestration, CSV parsing, balance verification
- **packages/accounting/** - Linking, price derivation, cost basis
- **packages/data/** - Kysely/SQLite, repositories, migrations
- **packages/core/** - Domain types, Zod schemas, utilities
- **packages/http/** - HTTP client, retry, rate limiting
- **packages/env/** - Environment config validation
- **packages/logger/** - Pino logging
- **packages/tsconfig/** - Shared TypeScript config

### Blockchain Provider System

Multi-provider architecture with failover:

**Registry:** Auto-registers via `@RegisterApiClient` decorator (imported in `register-apis.ts`). Metadata: name, blockchain, capabilities, API keys, rate limits.

**Manager:** `packages/blockchain-providers/src/core/` - Failover, circuit breakers, caching, health checks.

**Configuration:** Metadata in provider implementations. Chain configs in `<blockchain>-chains.json` (bitcoin, evm, cosmos, substrate).

**Supported:** Bitcoin (Blockstream, Mempool.space, Blockchain.com, BlockCypher, Tatum), EVM (Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, zkSync, Linea, Scroll, Mantle, Blast, Theta via Alchemy, Moralis, Routescan, ThetaScan, Theta Explorer), Solana (Helius, RPC, Solscan), Substrate (Polkadot, Kusama, Bittensor, Moonbeam, Astar via Subscan, Taostats), Cosmos (Injective), Cardano (Blockfrost), NEAR (Nearblocks).

### Exchange Integration

ccxt-based architecture:

**Supported:** Kraken (CSV/API), KuCoin (CSV/API), Coinbase (API/stubbed)

**Structure:**

- **API Clients:** `packages/exchange-providers/src/exchanges/<exchange>/` - ccxt, Zod schemas, credentials
- **Importers/Processors:** `packages/ingestion/src/infrastructure/exchanges/<exchange>/` - CSV parsing, transformation

**Import:** CSV (`--csv-dir`) or API (`--api-key`, `--api-secret`, `--api-passphrase`). Factory auto-selects.

### Database

Kysely + SQLite (`apps/cli/data/transactions.db`). Auto-migrations via `initializeDatabase()`.

**Tables:** `import_sessions` (imports), `external_transaction_data` (raw + `processing_status`), `transactions` (universal)

**Repositories:** `DataSourceRepository`, `RawDataRepository`, `TransactionRepository`

### Multi-Currency & FX

Four-stage enrichment pipeline: **Derive** (trades) → **Normalize** (fiat→USD) → **Fetch** (crypto) → **Re-derive** (links).

**Storage** (EUR/CAD→USD, persisted) vs **Display** (USD→user currency, ephemeral).

Providers in `packages/price-providers`, cached in `prices.db`. See ADR-003.

## Critical Patterns

### Result Type (neverthrow)

All functions that can fail return `Result<T, Error>` instead of throwing:

```typescript
import { ok, err, type Result } from 'neverthrow';

async function processData(): Promise<Result<Transaction[], Error>> {
  if (hasError) return err(new Error('Failed'));
  return ok(transactions);
}

// Chain and check
const result = await fetchData()
  .map(transform)
  .mapErr((e) => new CustomError(e.message));

if (result.isErr()) return err(result.error);
```

### Zod Schemas

Runtime validation. Core schemas in `packages/core/src/schemas/`, feature-specific in `*.schemas.ts`. Use `type Foo = z.infer<typeof FooSchema>`.

### Logging (Pino)

```typescript
import { getLogger } from '@exitbook/logger';
const logger = getLogger('component-name');
logger.info('message');
logger.error({ error }, 'error message');
```

## Code Requirements

- **No Sub-Agents:** Use direct tool calls (Read, Grep, Glob) instead of Task tool with sub-agents unless explicitly requested. Sub-agents are costly.
- **No Technical Debt:** Stop and report architectural issues immediately. Fix foundational problems first.
- **Never Silently Hide Errors:** This is a financial system where accuracy is critical. Never catch and suppress errors without logging. Never make silent assumptions or apply defaults for unexpected behavior. Always log warnings for edge cases, validation failures, or data inconsistencies. Use `logger.warn()` liberally for unexpected but recoverable conditions. Propagate errors upward via Result types rather than swallowing them.
- Use `exactOptionalPropertyTypes` - add `| undefined` to optional properties
- Add new tables/fields to initial migration (`001_initial_schema.ts`) - database dropped during development, not versioned incrementally
- Remove all legacy code paths and backward compatibility when refactoring - clean breaks only
- **Vertical Slices Over Technical Layers:** Organize by feature (e.g., `exchanges/kraken/`) not technical layer (e.g., `importers/`, `processors/`). Keep related code together - each feature directory contains its importer, processor, schemas, and tests.
- **Dynamic Over Hardcoded:** Avoid hardcoding lists, enums, or config that can be derived dynamically. Use registries, metadata, and runtime discovery. System auto-discovers blockchains, exchanges, and providers from their registrations.
- **Functional Core, Imperative Shell:** Extract business logic into pure functions in `*-utils.ts` modules. Use classes for resource management (DB, API clients). Use factory functions for stateless wrappers. Examples: `packages/ingestion/src/services/import-service-utils.ts` (pure), blockchain provider API clients (classes).
- **Testing:** Test pure functions in `*-utils.test.ts` without mocks. Test classes with mocked dependencies.
- **Simplicity Over DRY:** KISS > DRY. Prefer simple, readable code over complex abstractions. Some repetition acceptable for maintainability.
- **Developer Experience:** Prioritize clean DX when developing packages. Intuitive APIs, helpful errors, minimal setup.
- **Meaningful Comments:** Add comments only for meaningful context not expressible in code. Avoid obvious statements or refactoring notes. Explain why, not what.
- **Decimal.js:** Use named import `import { Decimal } from 'decimal.js'` and `.toFixed()` for strings (NOT `.toString()` which outputs scientific notation)
- **Context Management:** When context exceeds 125k tokens, warn and propose sub-tasks after `/clear`

## Environment Variables

Create `.env` in project root (loaded via `tsx --env-file-if-exists`):

```bash
# Blockchain providers (examples)
ALCHEMY_API_KEY=...
HELIUS_API_KEY=...

# Exchanges (for API import, not CSV)
KUCOIN_API_KEY=...
KUCOIN_SECRET=...
KUCOIN_PASSPHRASE=...
```

## Common Development Workflows

### Issue Tracking

- Track progress via GitHub issues with `gh` CLI
- Use `gh issue list`, `gh issue view <number> --comments`, `gh issue create`
- Always load comments for full context

### Adding a New Blockchain Provider

1. **Provider:** `packages/blockchain-providers/src/blockchains/<blockchain>/providers/<provider-name>/`
   - API client (extends `BaseApiClient`)
   - Mapper utilities + Zod schemas
   - `@RegisterApiClient` decorator on client
   - Import in blockchain's `register-apis.ts`

2. **Ingestion:** `packages/ingestion/src/infrastructure/blockchains/<blockchain>/`
   - Importer (implements `IImporter`)
   - Processor (transforms to `UniversalTransaction`)
   - Utilities and types

3. **Configuration:** Add to `<blockchain>-chains.json` if multi-chain

### Adding a New Exchange Adapter

1. **Exchange Client (API):** `packages/exchange-providers/src/exchanges/<exchange>/`
   - Client using ccxt + Zod schemas
   - Credentials validation, error handling
   - Export from `packages/exchange-providers/src/index.ts`

2. **Importer/Processor:** `packages/ingestion/src/infrastructure/exchanges/<exchange>/`
   - Importer (implements `IImporter`) for CSV/API
   - Processor (transforms to `UniversalTransaction`)
   - Schemas, types, utilities

3. **Registration:** Add to factory in `packages/ingestion/src/infrastructure/exchanges/shared/`

### Testing Changes

```bash
pnpm build  # Type check all packages

# Run tests for specific packages
pnpm --filter @exitbook/blockchain-providers test

# Run specific test file
pnpm vitest run packages/blockchain-providers/src/blockchains/bitcoin

pnpm test  # Full test suite

# CLI integration test
pnpm run dev import --exchange kraken --csv-dir ./test-data --process
```

## Project Context

**Purpose:** Track cryptocurrency activity across exchanges/blockchains. Import from CSVs/APIs, normalize, verify balances.

**Requirements:** Node.js ≥23, pnpm ≥10.6.2, SQLite

**Data:** `apps/cli/data/`
