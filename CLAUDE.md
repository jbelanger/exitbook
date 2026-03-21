# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration Preferences

- Give precise terminology suggestions and keep docs crisp first-drafts (not revision logs)
- **Surface Decisions & Smells:** While working, track any decisions you had to make, potential code smells, workarounds, or possible tech debt introduced during implementation. Summarize these at the end of the task as a brief "Decisions & Smells" section so we can evaluate what to address post-implementation.
- **Document Naming Issues:** When working on code, identify variables or functions with unclear names. Include rename suggestions in task summaries to track clarity improvements.
- **Architecture:** Capability-first modular monolith. Capability packages own workflows and ports; `data` implements ports; hosts compose directly. Details in `docs/code-assistants/architecture.md`.
- **Detailed Plans:** When planning (especially before `/clear`), write plans with enough detail for a junior dev — explicit file paths, function names, pseudo-code for changes, and step order. No assumptions or shorthand that requires codebase familiarity to interpret.

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
- Runtime and slice modules handle failover/circuit-breakers/caching (`packages/blockchain-providers/src/runtime/`, `packages/blockchain-providers/src/provider-stats/`, `packages/blockchain-providers/src/token-metadata/`).

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

### CLI Command Wiring

Two-tier handler pattern (DB-only vs infrastructure). Details in `docs/code-assistants/cli-command-wiring.md`.

### Result Type (`@exitbook/core`)

- Custom `Result<T, E>` in `packages/core/src/result/` — **not neverthrow**. Constructors: `ok(value)`, `err(error)`.
- All fallible functions return `Result<T, Error>` (no throws). Narrow with `isOk()`/`isErr()`, access `.value`/`.error`.
- Compose with `resultDo`/`resultTry`/`resultDoAsync`/`resultTryAsync` using `yield*` — short-circuits on first `Err`.
- Full API reference and examples: `docs/code-assistants/result-type.md`

### Zod Schemas

Runtime validation. Core schemas in `packages/core/src/schemas/`, feature-specific in `*.schemas.ts`. Use `type Foo = z.infer<typeof FooSchema>`.

### Logging

Custom logger (`@exitbook/logger`) — not Pino. Use `getLogger('name')` with `trace/debug/info/warn/error`. Structured context as first arg: `logger.warn({ field }, 'msg')`.

## Code Requirements

- **Prefer Direct Tools for Small Tasks:** For simple lookups, use direct tool calls (Read, Grep, Glob). Sub-agents are appropriate for multi-package exploration, broad refactors, or parallel research across the codebase.
- **Agent Concurrency Limit:** Never launch more than 4 background agents at a time. Wait for running agents to complete before launching the next batch. This prevents usage exhaustion and wasted work.
- **Correctness Over Speed:** Prioritize doing it right over doing it fast. Address every issue, edge case, and design concern as it surfaces rather than deferring. No shortcuts, no "we'll fix it later." When refactoring, design from scratch rather than patching around existing structure.
- **No Technical Debt:** Stop and report architectural issues immediately. Fix foundational problems first. Prefer over-engineering slightly over accumulating debt — it's cheaper to simplify a robust design than to retrofit correctness later.
- **Never Silently Hide Errors:** This is a financial system where accuracy is critical. Never catch and suppress errors without logging. Never make silent assumptions or apply defaults for unexpected behavior. Always log warnings for edge cases, validation failures, or data inconsistencies. Use `logger.warn()` liberally for unexpected but recoverable conditions. Propagate errors upward via Result types rather than swallowing them.
- Use `exactOptionalPropertyTypes` - add `| undefined` to optional properties
- Add new tables/fields to initial migration (`001_initial_schema.ts`) - database dropped during development, not versioned incrementally
- **Vertical Slices Over Technical Layers:** Organize by feature (e.g., `exchanges/kraken/`) not technical layer (e.g., `importers/`, `processors/`). Keep related code together - each feature directory contains its importer, processor, schemas, and tests.
- **Dynamic Over Hardcoded:** Avoid hardcoded lists; rely on registries/metadata (auto-discovers blockchains/exchanges/providers).
- **Functional Core, Imperative Shell:** Extract business logic into pure functions in `*-utils.ts` modules. Details in `docs/code-assistants/construct-shapes.md`.

- **Interfaces:** `I`-prefixed interfaces for ports (always, even single implementation) and polymorphic contracts. For hexagon-internal classes, extract when a second implementation appears. Use plain `interface` or `z.infer<>` for data shapes.
- **Testing:** Apply DRY within test files — extract shared fixtures, builders, and assertion helpers into `test-utils.ts` files co-located with the tests. Prefer reusable setup over repeated inline boilerplate; maintainable tests read like specs, not setup noise.
- **DRY and Clean Abstractions:** Extract shared logic into well-named helpers, utilities, and abstractions. Prefer eliminating duplication over leaving repeated code "for simplicity." Readable abstractions are simpler than scattered repetition.
- **Decimal.js:** Use named import `import { Decimal } from 'decimal.js'` and `.toFixed()` for strings (NOT `.toString()` which outputs scientific notation)
- **Runtime-Agnostic:** Prefer Web-standard globals over Node-specific modules (e.g. `globalThis.crypto.randomUUID()` not `node:crypto`). Avoid `node:` imports in shared packages — React Native target is planned.

## Common Development Workflows

- `.env` in project root for API keys (loaded via `tsx --env-file-if-exists`)
- Use `gh issue list/view/create` and load comments for context.

## Project Context

**Purpose:** Track cryptocurrency activity across exchanges/blockchains. Import from CSVs/APIs, normalize, verify balances.

**Requirements:** Node.js ≥24, pnpm ≥10.6.2, SQLite

**Data:** `apps/cli/data/`
