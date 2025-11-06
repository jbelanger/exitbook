# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration Preferences

- **Vocabulary Feedback:** When your request uses imprecise technical jargon or terminology, I'll suggest more accurate alternatives alongside my response to help improve technical communication.
- **Fresh Documentation:** When updating documentation, write as if it's a first draft. Keep content clean and cohesive rather than showing revision history.

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

- Importers extend `BaseImporter`, implement `IImporter` interface
- Fetch from APIs or parse CSVs
- **API clients normalize data using mappers during fetch** (e.g., `BlockstreamTransactionMapper.map()`)
- Returns `TransactionWithRawData<T>[]` with both `raw` and `normalized` data
- Zod validation during normalization (fail-fast)
- Store both payloads in `external_transaction_data` with `processing_status = 'pending'`

**Phase 2: Process (Transform to Universal Format)**

- Processors load normalized data from `external_transaction_data`
- Transform to `UniversalTransaction` format
- Upsert into `transactions` table (keyed by `external_id`)

**Balance Checking:** Separate `balance` command fetches live balances from exchanges (requires API credentials) or blockchains (requires address). Returns unified snapshot with timestamp.

### Blockchain Provider System

Multi-provider architecture with intelligent failover:

**Provider Registry:** Auto-registers via `@BlockchainProvider` decorator. Metadata: name, blockchain, capabilities, required API keys.

**BlockchainProviderManager:** Automatic failover, circuit breakers, request caching, health checks.

**Configuration:** Optional overrides in `apps/cli/config/blockchain-explorers.json` (enabled providers, priorities, rate limits, retries, timeouts). Falls back to metadata defaults.

**Supported Blockchains:** Bitcoin (Blockstream, Mempool.space, Tatum), EVM chains (Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, zkSync, Linea, Scroll, Mantle, Blast via Alchemy, Moralis, chain explorers), Solana (Helius, Solana RPC, Solscan), Substrate (Polkadot, Kusama, Bittensor, Moonbeam, Astar via Subscan, Taostats), Cosmos (Injective).

### Exchange Integration

Generic exchange client architecture using ccxt. `IExchangeClient` interface with `fetchTransactionData()`, credentials validated via Zod, returns `RawExchangeData[]`.

**Supported:** Kraken (CSV/API), KuCoin (CSV), Ledger Live (CSV), Coinbase (stubbed).

**Structure:** Each exchange contains importer, processor, Zod schemas, and optionally API client/importer in `infrastructure/exchanges/<exchange>/` and `platform/exchanges/src/<exchange>/`.

**Import Methods:** CSV (`--csv-dir`) or API (`--api-key`, `--api-secret`, optionally `--api-passphrase`). ImporterFactory auto-selects based on flags.

### Database Layer

**Stack:** Kysely + SQLite at `apps/cli/data/transactions.db`

**Tables:** `data_sources` (import runs), `external_transaction_data` (raw payloads with `processing_status`), `transactions` (universal records)

**Repositories:** `DataSourceRepository`, `RawDataRepository`, `TransactionRepository`

Migrations auto-run via `initializeDatabase()`.

### Multi-Currency & FX Rate Handling

Prices normalized to USD during enrichment (not import). Four-stage pipeline: **Derive** (extract from trades) → **Normalize** (fiat→USD via ECB/BoC/Frankfurter) → **Fetch** (crypto prices) → **Re-derive** (propagate via links).

Two conversions: **Storage** (EUR/CAD→USD, persisted) vs **Display** (USD→user currency, ephemeral).

FX providers in `packages/platform/price-providers`, cached in `prices.db`. See ADR-003.

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

Runtime validation for external data. Core schemas in `packages/core/src/schemas/`, feature-specific in `*.schemas.ts`. Types re-exported from `packages/core/src/types/`. Use `type Foo = z.infer<typeof FooSchema>`.

### Logging (Pino)

```typescript
import { createLogger } from '@exitbook/shared-logger';
const logger = createLogger('component-name');
logger.info('message');
logger.error({ error }, 'error message');
```

## Code Requirements

- **No Sub-Agents:** Do not use Task tool with sub-agents (Explore, Plan, etc.) unless explicitly requested by the user. Sub-agents are costly in terms of tokens. Use direct tool calls (Read, Grep, Glob, etc.) instead.
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
- **Decimal.js:** Use named import `import { Decimal } from 'decimal.js'` and always use `.toFixed()` for string conversion (NOT `.toString()` which outputs scientific notation)
- **Context Management:** Monitor token usage throughout conversations. When context usage exceeds 125,000 tokens, warn the user and propose breaking the remaining work into sub-tasks, suggesting which sub-task to tackle first (after clearing history with `/clear`).

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

- Track implementations and progress via GitHub issues using `gh` CLI tool
- Use `gh issue list`, `gh issue view <number> --comments`, `gh issue create` for workflow management
- Always load comments when viewing issues to get full context

### Adding a New Blockchain Provider

1. Create `packages/ingestion/src/infrastructure/blockchains/<blockchain>/`
2. Implement importer (extends `BaseImporter`), processor (mapper to `UniversalTransaction`), API clients with Zod schemas
3. Register via `@BlockchainProvider` decorator in `registry/register-providers.ts`
4. Optional config in `apps/cli/config/blockchain-explorers.json`

### Adding a New Exchange Adapter

1. Create `packages/ingestion/src/infrastructure/exchanges/<exchange>/`
2. Implement importer (extends `BaseImporter`), processor (to `UniversalTransaction`), Zod schemas
3. Register in exchange registry

### Testing Changes

```bash
pnpm build  # Type check
pnpm vitest run packages/ingestion/src/infrastructure/blockchains/bitcoin  # Specific tests
pnpm test  # Full suite
pnpm run dev import --exchange kraken --csv-dir ./test-data --process  # CLI test
```

## Project Context

**Purpose:** Track and analyze cryptocurrency activity across exchanges and blockchains. Import from CSVs/APIs, normalize to universal schema, verify balances.

**Requirements:** Node.js ≥23, pnpm ≥10.6.2, SQLite (better-sqlite3)

**Data Location:** `apps/cli/data/`
