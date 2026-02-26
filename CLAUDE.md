# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration Preferences

- Give precise terminology suggestions and keep docs crisp first-drafts (not revision logs)

## Essential Commands

### Development & Testing (core commands)

- `pnpm install` (workspace deps)
- `pnpm build` (type check + bundle CLI)
- `pnpm test` / `pnpm test:e2e` (local-safe e2e) / `pnpm test:e2e:live` (network e2e, requires `.env` keys)
- `pnpm lint` ; `pnpm prettier:fix`
- Single test: `pnpm vitest run <file>` or `pnpm vitest run --config vitest.e2e.live.config.ts <file>`

### CLI Usage (essentials)

- All commands via `pnpm run dev ...` (tsx + `.env`). Common flows:
  - Import (CSV): `pnpm run dev import --exchange kucoin --csv-dir ./exports/kucoin`
  - Import (API): `pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET`
  - Import (on-chain): `pnpm run dev import --blockchain bitcoin --address bc1q...`
  - Reprocess: `pnpm run dev reprocess` (clears derived data, reprocesses all raw data)
  - Prices enrich: `pnpm run dev prices enrich` (4-stage pipeline; use flags to slice)
  - Discover: `pnpm run dev blockchains view`
- Other commands: `links`, `accounts`, `transactions`, `clear`, `cost-basis`, `balance`, `providers`, `portfolio`
- For full command list: `pnpm run dev --help`

### Provider Management

- `pnpm blockchain-providers:list` - List blockchain providers + metadata
- `pnpm blockchain-providers:validate` - Validate provider registrations
- `pnpm providers:sync` - Sync provider configurations

## Architecture Overview

### Monorepo Structure (pnpm workspaces)

- **apps/cli/** - Commander CLI (`src/features/`)
- **packages/** - blockchain/exchange/price providers, ingestion, accounting, data, core, http, env, events, logger, resilience, sqlite, tsconfig

### Blockchain Provider System

- Registration is explicit: each blockchain exports provider factory arrays from `blockchains/<blockchain>/register-apis.ts`; `packages/blockchain-providers/src/register-apis.ts` aggregates them.
- Chain lists come from `*-chains.json` (e.g., EVM has many chains; see file instead of enumerating here).
- Core handles failover/circuit-breakers/caching (`packages/blockchain-providers/src/core/`).

### Exchange Integration

- ccxt-based clients + importer/processor per exchange feature folder.
- Supported: Kraken (CSV/API), KuCoin (CSV/API), Coinbase (full API). CSV/API auto-selected by factory.

### Database

- Kysely + SQLite. Auto-migrate via `initializeDatabase()`.
- Data dir: `EXITBOOK_DATA_DIR` if set, else `process.cwd()/data` (CLI default is `apps/cli/data/`).
- Database files:
  - `transactions.db` - Transactional data (accounts, transactions, movements, raw imports)
  - `token-metadata.db` - Token metadata cache (persists across dev cycles)
  - `prices.db` - Price cache (persists across dev cycles)
  - `providers.db` - Provider health/circuit breaker stats (persists across dev cycles)

### Multi-Currency & FX

- Pipeline: Derive → Normalize → Fetch → Re-derive. Storage FX persisted; display FX is ephemeral.
- Providers in `packages/price-providers`; cache in `prices.db` (ADR-003).

## Critical Patterns

### Result Type (neverthrow)

- All fallible functions return `Result<T, Error>` (no throws). Chain/mapErr; propagate/log.
- **`errAsync`/`okAsync` are valid in async contracts:** Do not report `errAsync`/`okAsync` as a type-safety issue when returned from `async` methods typed as `Promise<Result<...>>` or yielded from `async` generators typed as `AsyncIterableIterator<Result<...>>`; `ResultAsync` is `PromiseLike<Result<...>>` and is unwrapped by `async`/`for await` semantics.

### Zod Schemas

Runtime validation. Core schemas in `packages/core/src/schemas/`, feature-specific in `*.schemas.ts`. Use `type Foo = z.infer<typeof FooSchema>`.

### Logging

Custom logger in `packages/logger` — not Pino. Interface: `Logger` with `trace/debug/info/warn/error` methods. Structured context passed as first arg when needed.

```typescript
import { getLogger } from '@exitbook/logger';
const logger = getLogger('component-name');
logger.info('message');
logger.warn({ field: value }, 'message with context');
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
- **Dynamic Over Hardcoded:** Avoid hardcoded lists; rely on registries/metadata (auto-discovers blockchains/exchanges/providers).
- **Functional Core, Imperative Shell:** Extract business logic into pure functions in `*-utils.ts` modules. Use classes for resource management (DB, API clients). Use factory functions for stateless wrappers. Examples: `packages/ingestion/src/services/import-service-utils.ts` (pure), blockchain provider API clients (classes).
- **Testing:** Test pure functions in `*-utils.test.ts` without mocks. Test classes with mocked dependencies.
- **Simplicity Over DRY:** KISS > DRY. Prefer simple, readable code over complex abstractions. Some repetition acceptable for maintainability.
- **Developer Experience:** Prioritize clean DX when developing packages. Intuitive APIs, helpful errors, minimal setup.
- **Meaningful Comments:** Add comments only for meaningful context not expressible in code. Avoid obvious statements or refactoring notes. Explain why, not what.
- **Decimal.js:** Use named import `import { Decimal } from 'decimal.js'` and `.toFixed()` for strings (NOT `.toString()` which outputs scientific notation)
- **Context Management:** When context exceeds 125k tokens, warn and propose sub-tasks after `/clear`
- **Document Naming Issues:** When working on code, identify variables or functions with unclear names. Include rename suggestions in task summaries to track clarity improvements.

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

- Use `gh issue list/view/create` and load comments for context.

### Adding a New Blockchain Provider

1. **Provider:** `packages/blockchain-providers/src/blockchains/<blockchain>/providers/<provider-name>/`
   - API client (extends `BaseApiClient`)
   - Mapper utilities + Zod schemas
   - Export provider factory (optional barrel export from provider directory)
   - Add factory to blockchain `register-apis.ts` array (aggregated by `packages/blockchain-providers/src/register-apis.ts`)

2. **Ingestion:** `packages/ingestion/src/sources/blockchains/<blockchain>/`
   - Importer (implements `IImporter`)
   - Processor (transforms to `UniversalTransaction`)
   - Utilities and types

3. **Configuration:** Add to `<blockchain>-chains.json` if multi-chain

### Adding a New Exchange Adapter

1. **Exchange Client (API):** `packages/exchange-providers/src/exchanges/<exchange>/`
   - Client using ccxt + Zod schemas
   - Credentials validation, error handling
   - Export from `packages/exchange-providers/src/index.ts`

2. **Importer/Processor:** `packages/ingestion/src/sources/exchanges/<exchange>/`
   - Importer (implements `IImporter`) for CSV/API
   - Processor (transforms to `UniversalTransaction`)
   - Schemas, types, utilities

3. **Registration:** Add to factory in `packages/ingestion/src/sources/exchanges/shared/`

### Testing Changes

```bash
pnpm build  # Type check all packages

# Run tests for specific packages
pnpm --filter @exitbook/blockchain-providers test

# Run specific test file
pnpm vitest run packages/blockchain-providers/src/blockchains/bitcoin

pnpm test  # Full test suite

# CLI integration test
pnpm run dev import --exchange kucoin --csv-dir ./test-data
```

## Project Context

**Purpose:** Track cryptocurrency activity across exchanges/blockchains. Import from CSVs/APIs, normalize, verify balances.

**Requirements:** Node.js ≥24, pnpm ≥10.6.2, SQLite

**Data:** `apps/cli/data/`
