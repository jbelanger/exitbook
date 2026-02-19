V2 Architecture Audit

     Codebase: 887 TypeScript files, ~223k LOC across 11 packages + 1 CLI app
     Scope: Full codebase, all 7 dimensions

     ---
     1. Dependency Audit

     1a. Hand-Rolled Logger Duplicating Pino/Winston

     What exists:
     Custom logger in /Users/joel/Dev/exitbook/packages/logger/src/logger.ts (~170 LOC). Implements: level filtering, sink-based output, category namespacing, context serialization
     (circular refs, BigInt, Error), and a simple cache of logger instances. Zero external dependencies.

     Why it's a problem:
     Not a problem. The custom logger is lean, has no dependencies, matches the Pino API shape (which is stated in CLAUDE.md), and handles exactly what the project needs. The sink
     abstraction (ConsoleSink, BufferedSink, FileSink) is clean. Replacing with Pino would add ~150KB, a native dependency, and features that go unused (child loggers, redaction,
     transport workers). The CLAUDE.md references "Pino" in documentation but the actual implementation is custom -- this is a good trade.

     What V2 should do: Keep this. It earns its place.

     ---
     1b. ccxt Over-Dependency (56MB, ~5% API Surface Used)

     What exists:
     ccxt (v4.5.36) is declared in @exitbook/exchanges-providers package.json. It is imported in exactly 3 exchange client files:
     - /Users/joel/Dev/exitbook/packages/exchange-providers/src/exchanges/kraken/client.ts
     - /Users/joel/Dev/exitbook/packages/exchange-providers/src/exchanges/kucoin/client.ts
     - /Users/joel/Dev/exitbook/packages/exchange-providers/src/exchanges/coinbase/client.ts

     Usage: import * as ccxt from 'ccxt' -- instantiates exchange-specific classes, calls fetchLedger() and fetchBalance(). That is 2 methods per exchange on a library that exports
     100+ exchange classes and dozens of methods per class.

     Why it's a problem:
     56MB on disk. Pulls in >100 exchange implementations that are never used. The project only supports 3 exchanges. ccxt's untyped response shapes require Zod re-validation anyway
     (the code already does this). The tsup bundle must noExternal or handle ccxt's dual CJS/ESM issues. Startup time is affected by loading the entire ccxt module graph.

     What V2 should do:
     Replace ccxt with direct HTTP calls using the existing @exitbook/http HttpClient. Each exchange already has Zod schemas for response validation. The Kraken, KuCoin, and Coinbase
      REST APIs are well-documented and simple. The project's HttpClient already handles retries, rate limiting, and auth header injection.

     Needs coverage:

     Current capability: HTTP client for exchange APIs
     Covered by replacement?: Yes
     Notes: @exitbook/http already provides this
     ────────────────────────────────────────
     Current capability: Response parsing
     Covered by replacement?: Yes
     Notes: Zod schemas already re-validate everything
     ────────────────────────────────────────
     Current capability: Rate limit handling
     Covered by replacement?: Yes
     Notes: HttpClient has built-in rate limiting
     ────────────────────────────────────────
     Current capability: Auth/signing (Kraken HMAC, KuCoin HMAC, Coinbase JWT)
     Covered by replacement?: Partial
     Notes: Need to implement signing per exchange (~50 LOC each). Kraken/KuCoin use HMAC-SHA256/512; Coinbase uses JWT.
     ────────────────────────────────────────
     Current capability: Pagination (fetchLedger)
     Covered by replacement?: Yes
     Notes: Already handled in importer code

     Surface: ~3 files directly, ~5 files including tests

     Leverage: High -- eliminates 56MB dependency, removes startup overhead, removes fix-libsodium.mjs postinstall hack (ccxt pulls libsodium transitively for Coinbase)

     ---
     1c. @cardano-sdk Dependencies (16MB, Used in 1 File)

     What exists:
     Three @cardano-sdk packages in blockchain-providers/package.json:
     - @cardano-sdk/core
     - @cardano-sdk/crypto
     - @cardano-sdk/key-management

     Used only in /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/cardano/utils.ts via dynamic import for xpub-to-address derivation. The key-management
     package is declared but never imported anywhere.

     Why it's a problem:
     16MB for a single file's xpub derivation. @cardano-sdk/key-management is a phantom dependency -- declared but unused. The Cardano SDK has heavy transitive deps (libsodium-sumo
     at 3.7MB combined) and forced a postinstall script (scripts/fix-libsodium.mjs) in the root package.json.

     What V2 should do:
     Use @stricahq/bip32ed25519 (~50KB) or @scure/bip32 (already a dependency) + bech32 (already a dependency) for Cardano HD derivation. The actual derivation logic is: ED25519
     BIP32 soft derivation + Blake2b-224 hash + Bech32 encoding. Remove @cardano-sdk/key-management immediately (unused).

     Needs coverage:

     ┌─────────────────────────────────────────────┬─────────────────────────┬───────────────────────────────────────────────────────────┐
     │             Current capability              │ Covered by replacement? │                           Notes                           │
     ├─────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────────────┤
     │ Bip32PublicKey.fromHex()                    │ Yes                     │ @stricahq/bip32ed25519 or manual ED25519                  │
     ├─────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────────────┤
     │ Soft key derivation (derive([role, index])) │ Yes                     │ Standard BIP32-ED25519                                    │
     ├─────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────────────┤
     │ BaseAddress.fromCredentials()               │ Yes                     │ Cardano address construction is well-specified (CIP-0019) │
     ├─────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────────────┤
     │ Bech32 encoding                             │ Yes                     │ bech32 already a dependency                               │
     ├─────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────────────┤
     │ Blake2b-224 hashing                         │ Partial                 │ Need @noble/hashes (already transitive via @scure/bip32)  │
     └─────────────────────────────────────────────┴─────────────────────────┴───────────────────────────────────────────────────────────┘

     Surface: ~1 file + 1 test file

     Leverage: High -- eliminates 16MB + 3.7MB libsodium + postinstall hack

     ---
     1d. uuid Package vs crypto.randomUUID()

     What exists:
     uuid package in @exitbook/accounting/package.json. Used in 6 files:
     - /Users/joel/Dev/exitbook/packages/accounting/src/linking/transaction-linking-service.ts
     - /Users/joel/Dev/exitbook/packages/accounting/src/services/lot-matcher-utils.ts
     - /Users/joel/Dev/exitbook/packages/accounting/src/services/strategies/average-cost-strategy.ts
     - /Users/joel/Dev/exitbook/packages/accounting/src/services/strategies/matching-utils.ts
     - /Users/joel/Dev/exitbook/packages/accounting/src/services/cost-basis-calculator.ts
     - /Users/joel/Dev/exitbook/packages/accounting/src/persistence/__tests__/transaction-link-queries.test.ts

     All usage: import { v4 as uuidv4 } from 'uuid'.

     Why it's a problem:
     Node.js 24 (the project minimum) ships crypto.randomUUID() natively. The uuid package is an unnecessary dependency.

     What V2 should do:
     Replace import { v4 as uuidv4 } from 'uuid' with crypto.randomUUID(). Remove uuid from @exitbook/accounting/package.json.

     Needs coverage:

     ┌────────────────────┬─────────────────────────┬────────────────────────────────────────────────┐
     │ Current capability │ Covered by replacement? │                     Notes                      │
     ├────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ v4 UUID generation │ Yes                     │ crypto.randomUUID() produces RFC 4122 v4 UUIDs │
     └────────────────────┴─────────────────────────┴────────────────────────────────────────────────┘

     Surface: ~6 files, ~6 call-sites

     Leverage: Low -- trivial cleanup

     ---
     1e. undici Package vs Node.js Built-in fetch

     What exists:
     undici (v7.6.5) in @exitbook/http/package.json. Used in exactly 1 file:
     /Users/joel/Dev/exitbook/packages/http/src/client.ts -- imports Agent for connection pooling and fetch for HTTP requests.

     Why it's a problem:
     Node.js 24 includes undici as its built-in fetch implementation. The Agent import is the only feature used beyond what global fetch provides. However, the Agent is used for
     connection pooling and proper lifecycle cleanup (agent.close()), which is legitimate.

     What V2 should do:
     Keep undici for now. The Agent with dispatcher pattern for per-client connection pooling and deterministic cleanup is not available via global fetch. This is a deliberate
     choice.

     ---
     1f. jose Package (Declared but Unused)

     What exists:
     jose (v6.0.13) in @exitbook/blockchain-providers/package.json. Grep across the entire blockchain-providers src directory finds zero imports of jose.

     Why it's a problem:
     Dead dependency adding to install time and audit surface.

     What V2 should do:
     Remove from package.json immediately.

     Surface: 0 files (unused)

     Leverage: Low -- cleanup only

     ---
     2. Architectural Seams

     2a. Database Init Duplication Across 4 Packages

     What exists:
     Database initialization (create SQLite, configure pragmas, run Kysely migrations) is copy-pasted across 4 locations:
     - /Users/joel/Dev/exitbook/packages/data/src/storage/database.ts (transactions.db)
     - /Users/joel/Dev/exitbook/packages/data/src/persistence/token-metadata/database.ts (token-metadata.db)
     - /Users/joel/Dev/exitbook/packages/price-providers/src/persistence/database.ts (prices.db)
     - /Users/joel/Dev/exitbook/packages/blockchain-providers/src/persistence/database.ts (providers.db)

     Each file: imports better-sqlite3 + kysely, creates DB instance, sets identical pragmas (WAL, foreign_keys, synchronous, cache_size, temp_store), runs Kysely Migrator, exports
     create/initialize/close functions. The pattern is nearly identical across all four.

     Additionally, better-sqlite3 and kysely are declared as direct dependencies in 3 packages: @exitbook/data, @exitbook/blockchain-providers, @exitbook/price-providers.
     @types/better-sqlite3 is a devDep in all 3 as well.

     Why it's a problem:
     Shotgun surgery -- any change to pragma configuration, error handling, or migration strategy requires updating 4 files. Each package independently manages its SQLite lifecycle.
     The pragma "synchronous = NORMAL" might need to change for data integrity in a financial system, and it would need to be changed in 4 places.

     What V2 should do:
     Centralize database creation in @exitbook/data with a factory function: createTypedDatabase<TSchema>(dbPath: string, migrationsFolder: string): Result<Kysely<TSchema>, Error>.
     The price-providers and blockchain-providers packages would consume this factory rather than duplicating it. better-sqlite3 and kysely would be dependencies of @exitbook/data
     only.

     Needs coverage:

     ┌───────────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────┐
     │        Current capability         │ Covered by replacement? │                    Notes                     │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Typed Kysely per database         │ Yes                     │ Generic factory parameterized on schema type │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Per-database migration folders    │ Yes                     │ Accept migration path as parameter           │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Pragma configuration              │ Yes                     │ Centralized with optional overrides          │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Create/close/initialize lifecycle │ Yes                     │ Factory returns lifecycle handle             │
     └───────────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────┘

     Surface: ~4 database.ts files, ~3 package.json files (remove direct kysely/better-sqlite3)

     Leverage: Medium

     ---
     2b. Package Boundary: @exitbook/events is a Single-Class Wrapper

     What exists:
     /Users/joel/Dev/exitbook/packages/events/ contains:
     - event-bus.ts (~100 LOC) -- a generic typed event bus
     - index.ts -- re-exports it

     No other files. No tests. The EventBus class is simple: subscribe, emit, async microtask delivery.

     Why it's a problem:
     This is a package with a single class that could be a file in @exitbook/core. It adds workspace overhead (package.json, tsconfig.json, build step) for ~100 LOC. The EventBus has
      no dependencies, making it a natural fit for core utilities.

     What V2 should do:
     Move EventBus into @exitbook/core/src/utils/event-bus.ts. Remove the @exitbook/events package. Update ~5 consumer package.json peer dependencies.

     Needs coverage:

     ┌───────────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────────┐
     │        Current capability         │ Covered by replacement? │                      Notes                       │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────┤
     │ Generic typed event bus           │ Yes                     │ Same code, different location                    │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────┤
     │ No dependencies on other packages │ Yes                     │ Core has no deps except Decimal, neverthrow, zod │
     └───────────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────────┘

     Surface: ~1 source file to move, ~5 package.json peerDependency updates, ~15 import path updates

     Leverage: Low

     ---
     2c. ingestion Has Sub-Path Exports Suggesting Internal Layer Confusion

     What exists:
     @exitbook/ingestion package.json exports:
     ".": "./src/index.ts",
     "./app/*": "./src/app/*",
     "./domain/*": "./src/domain/*",
     "./infrastructure/*": "./src/infrastructure/*"

     The ESLint config enforces layer boundaries within ingestion (domain cannot import app/infrastructure, app cannot import infrastructure). Yet the package exposes these internal
     layers as public sub-path exports.

     Why it's a problem:
     Consumers can bypass the barrel export and reach into internal layers. This defeats the purpose of the layered architecture. If external packages import
     @exitbook/ingestion/domain/types, changing ingestion's internal structure becomes a breaking change across the monorepo.

     What V2 should do:
     Remove sub-path exports. Everything external consumers need should go through the barrel index.ts. Same applies to @exitbook/blockchain-providers which has similar sub-path
     exports.

     Surface: ~2 package.json files, audit consumers for sub-path imports

     Leverage: Low

     ---
     3. Pattern Re-evaluation

     3a. neverthrow Result Type -- Right Pattern, Earning Its Place

     What exists:
     neverthrow is used across 221 files with 266 imports. It is the error handling backbone of the entire codebase. Every fallible function returns Result<T, Error>. The pattern is
     applied uniformly across all packages.

     Why it's a problem:
     It is not a problem. The pattern is well-applied and consistent. The main friction is verbosity in chain operations (each .isErr() check adds 2 lines), but this is the explicit
     trade-off for typed error handling. The codebase avoids the alternative antipattern (try/catch with untyped errors) in all domain and data code.

     One consideration: neverthrow is duplicated as a direct dependency in 8 package.json files. Since it is a workspace, pnpm deduplicates it, but the declaration overhead is real.

     What V2 should do: Keep neverthrow. Consider declaring it only in @exitbook/core and relying on peer dependency resolution for other packages, but this is minor.

     ---
     3b. Factory Function Pattern for Queries is Well-Executed

     What exists:
     All query modules (createAccountQueries, createTransactionQueries, etc.) use the factory function pattern:
     function createFooQueries(db: KyselyDB) {
       // closure over db
       return { findById, findAll, create, ... };
     }
     type FooQueries = ReturnType<typeof createFooQueries>;

     This is consistent across all ~11 query files in /Users/joel/Dev/exitbook/packages/data/src/queries/.

     Why it's a problem:
     Not a problem. The factory-over-closure pattern avoids class boilerplate, enables easy testing (pass an in-memory DB), and the ReturnType<typeof> pattern provides types without
     separate interface declarations. This is clean functional-core style.

     What V2 should do: Keep this pattern.

     ---
     3c. @RegisterApiClient Decorator -- Justified but Has a Cost

     What exists:
     TC39 Stage 3 decorator in /Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/registry/decorators.ts. Applied to ~20+ blockchain provider API client classes.
     Combined with register-apis.ts files per blockchain that import providers to trigger decorator side effects.

     Why it's a problem:
     Minor: decorators are side-effectful (registration happens at import time), which makes it non-obvious when providers are available. The initializeProviders() function exists to
      force all imports, but forgetting to call it causes silent failures. This is documented in the JSDoc.

     The decorator itself is simple and clean. The alternative (explicit registration array) would be more verbose but more discoverable.

     What V2 should do: Keep this pattern. The auto-discovery benefit outweighs the initialization footgun, which is already mitigated by the initializeProviders() call at startup.

     ---
     3d. Zod Schemas -- Correct Choice, Uniformly Applied

     What exists:
     Zod is used across 108 files. Used for: API response validation in HttpClient, domain type validation in core schemas, database row parsing in queries, CLI option validation.
     Version is Zod 4.3.6 (latest major).

     Why it's a problem:
     Not a problem. Zod is the standard for TypeScript runtime validation. The z.infer<typeof Schema> pattern is used consistently. The HttpClient integrates Zod schemas directly in
     get() and post() overloads. No competing validation library exists in the codebase.

     What V2 should do: Keep Zod.

     ---
     4. Data Layer

     4a. Kysely + SQLite -- Good Fit for the Project

     What exists:
     Kysely v0.28.11 with better-sqlite3 v12.6.2 as the SQLite driver. Type-safe query builder. Used across all database operations. Queries are written naturally --
     db.selectFrom('accounts').selectAll().where(...) -- no fighting with the tool.

     Why it's a problem:
     Minor: Kysely 0.28 is pre-1.0 but stable and actively maintained. The queries are clean and readable. The only mild friction is the JSON column handling (manual
     serializeToJson/parseWithSchema helpers in /Users/joel/Dev/exitbook/packages/data/src/queries/query-utils.ts), but this is inherent to SQLite's lack of native JSON columns.

     Drizzle ORM would not be materially better -- Kysely's query-builder style matches the codebase's functional approach better than Drizzle's schema-first pattern. Prisma would be
      worse (codegen, binary engine, SQLite support is weaker).

     What V2 should do: Keep Kysely + better-sqlite3. Upgrade to Kysely 1.0 when released.

     ---
     4b. Single Migration File Strategy is Appropriate

     What exists:
     One migration file: /Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts. Per CLAUDE.md: "Add new tables/fields to initial migration -- database dropped
     during development, not versioned incrementally."

     Why it's a problem:
     Not a problem for the current stage (development/pre-production). The database is local SQLite with no multi-user concurrency. The "drop and recreate" strategy is explicitly
     chosen and documented.

     What V2 should do: When the project reaches production, introduce versioned migrations. For now, keep the single-migration approach. This is a conscious stage-appropriate
     decision.

     ---
     4c. Four Separate SQLite Databases

     What exists:
     The project uses 4 SQLite database files:
     - transactions.db -- core transactional data
     - token-metadata.db -- token metadata cache
     - prices.db -- price cache
     - providers.db -- provider health/circuit breaker stats

     Why it's a problem:
     The separation is actually well-motivated. CLAUDE.md explains: token-metadata, prices, and providers databases "persist across dev cycles" while transactions.db is dropped and
     recreated during development. This is a deliberate lifecycle separation.

     What V2 should do: Keep the multi-database design. The lifecycle separation is valuable. Consider consolidating to 2 databases (transactional + cache) if the cache databases
     grow complex enough to warrant cross-database joins.

     ---
     5. Toolchain & Infrastructure

     5a. Build System is Minimal and Correct

     What exists:
     - pnpm workspaces for monorepo management
     - tsc --noEmit for type-checking (all packages)
     - tsup for bundling only the CLI app
     - Source packages use main: "src/index.ts" (no build step -- consumed via TypeScript directly)
     - tsx for development execution

     The tsconfig base uses "module": "NodeNext", "target": "ES2024", "exactOptionalPropertyTypes": true, "noUncheckedIndexedAccess": true -- aggressive correctness settings.

     Why it's a problem:
     Not a problem. The "no build for library packages" approach is enabled by pnpm workspaces + TypeScript project references and eliminates an entire class of build issues. Only
     the CLI has a bundle step (tsup). This is modern best practice for monorepos.

     What V2 should do: Keep this approach. It is the optimal configuration for a TypeScript-only monorepo.

     ---
     5b. ESLint Configuration is Comprehensive and Well-Structured

     What exists:
     Single eslint.config.js at root using flat config with:
     - typescript-eslint recommended + type-checked
     - Unicorn plugin for Node.js best practices
     - Perfectionist for deterministic ordering
     - Custom layer boundary enforcement (core purity, CLI cannot access KyselyDB)
     - Barrel import enforcement
     - .js extension enforcement for ESM imports

     Why it's a problem:
     Minor: eslint-plugin-import (v2.32.0) is the legacy version -- the newer eslint-plugin-import-x is recommended for ESLint flat config. Also, eslint-plugin-eslint-comments
     (v3.2.0) has not been released since 2020 (6+ years). Consider @eslint-community/eslint-plugin-eslint-comments.

     What V2 should do:
     - Replace eslint-plugin-import with eslint-plugin-import-x
     - Replace eslint-plugin-eslint-comments with @eslint-community/eslint-plugin-eslint-comments

     Needs coverage:

     ┌─────────────────────────────────────┬─────────────────────────┬──────────────────────────────────────┐
     │         Current capability          │ Covered by replacement? │                Notes                 │
     ├─────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ import/no-relative-packages         │ Yes                     │ eslint-plugin-import-x supports this │
     ├─────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ import/no-restricted-paths          │ Yes                     │ Same rule in import-x                │
     ├─────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ eslint-comments/require-description │ Yes                     │ Same rule in community fork          │
     └─────────────────────────────────────┴─────────────────────────┴──────────────────────────────────────┘

     Surface: 1 config file, 2 package.json dependency swaps

     Leverage: Low

     ---
     5c. Ink + React for CLI TUI -- Heavyweight for Current Usage

     What exists:
     ink (v6.6.0) + react (v19.2.4) in the CLI for terminal UI rendering. Used across ~28 TSX files for table rendering, spinners, status icons, prompts. Also depends on ink-spinner
     and ink-testing-library.

     Why it's a problem:
     React 19 + Ink 6 is a significant dependency graph for what is primarily tabular output and progress spinners. The TSX components are mostly "render a formatted table" and "show
      a spinner while loading." The reactive render model (re-render on state change) is useful for the import progress monitor but overkill for static table display.

     However, the code is clean and the component model is well-organized. The prompt components (TextPrompt, ConfirmPrompt, SelectPrompt) provide good UX.

     What V2 should do:
     This is borderline. Keep Ink if the TUI will grow more interactive. If the project remains primarily a command-line batch tool with tabular output, consider replacing with
     @clack/prompts + cli-table3 for a lighter footprint. But the current Ink usage is not causing active pain.

     Needs coverage (if replaced):

     ┌──────────────────────────────────┬─────────────────────────┬────────────────────────────────────┐
     │        Current capability        │ Covered by replacement? │               Notes                │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Table rendering                  │ Yes                     │ cli-table3 or similar              │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Spinners with live updates       │ Yes                     │ ora (already a dependency)         │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Interactive prompts              │ Yes                     │ @clack/prompts or @inquirer        │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Reactive import progress monitor │ Partial                 │ Would need custom state management │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────┤
     │ Component testing                │ No                      │ Would lose ink-testing-library     │
     └──────────────────────────────────┴─────────────────────────┴────────────────────────────────────┘

     Surface: ~28 TSX files, ~41 React imports

     Leverage: Medium (only if TUI stays simple)

     ---
     6. File & Code Organization

     6a. Directory Structure is Clear and Consistent

     What exists:
     The codebase follows a well-defined structure:
     - Feature-based organization in CLI (apps/cli/src/features/)
     - Blockchain providers organized by chain then provider (packages/blockchain-providers/src/blockchains/<chain>/providers/<provider>/)
     - Each feature folder contains: importer, processor, schemas, types, utils, tests
     - Consistent *-utils.ts for pure functions, *-service.ts for stateful operations

     Why it's a problem:
     Not a problem. The structure is self-documenting. New blockchains and exchanges follow an obvious pattern.

     What V2 should do: Keep this structure.

     ---
     6b. File Sizes are Appropriate with Two Exceptions

     What exists:
     Most files are well-sized. Two notable exceptions:
     - BlockchainProviderManager at /Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/provider-manager.ts: ~1390 LOC. Contains provider registration, failover logic,
     circuit breaker orchestration, caching, health checks, and streaming pagination.
     - lot-matcher-utils.ts at /Users/joel/Dev/exitbook/packages/accounting/src/services/lot-matcher-utils.ts: ~1281 LOC.

     Why it's a problem:
     The ProviderManager at 1390 LOC mixes multiple responsibilities. The streaming implementation (executeStreamingImpl) alone is ~200 LOC. The configuration handling
     (handleOverrideConfig, autoRegisterFromRegistry) duplicates significant logic.

     What V2 should do:
     Extract from ProviderManager:
     - provider-configuration.ts -- autoRegisterFromConfig, autoRegisterFromRegistry, handleOverrideConfig (~250 LOC)
     - streaming-executor.ts -- executeStreamingImpl + dedup logic (~200 LOC)
     - Keep core failover + circuit breaker in the manager

     Surface: 1 file -> 3 files

     Leverage: Medium

     ---
     6c. Naming: Exchange Package Name Inconsistency

     What exists:
     The exchange providers package is named @exitbook/exchanges-providers (note the plural "exchanges") in package.json, but the directory is packages/exchange-providers (singular).
      The CLI references it as @exitbook/exchanges-providers in its dependencies.

     Why it's a problem:
     Naming inconsistency between directory name and package name. Developers must remember "exchanges-providers" (unusual hyphenation) rather than the more natural
     "exchange-providers."

     What V2 should do:
     Rename package to @exitbook/exchange-providers (match directory name). Update all consumer package.json references.

     Surface: ~5 package.json files

     Leverage: Low

     ---
     7. Error Handling & Observability

     7a. Error Strategy is Strong

     What exists:
     neverthrow Result<T, Error> used pervasively. Error types are domain-specific (ProviderError, RateLimitError, ServiceError, ResponseValidationError). Error context is preserved
     in structured objects. The HttpClient logs all failures with provider name, endpoint, and status.

     Why it's a problem:
     Not a problem. This is above-average error handling for a TypeScript project. The wrapError utility in core provides consistent error wrapping.

     What V2 should do: Keep this approach.

     ---
     7b. Database Error Handling Mixes throw and Result

     What exists:
     The main @exitbook/data package's initializeDatabase() throws on migration failure (classic JavaScript style), but all query functions return Result<T, Error>. The
     price-providers and blockchain-providers databases return Result for everything including initialization.

     Why it's a problem:
     Inconsistency. A consumer calling initializeDatabase() must use try/catch while all other database operations use .isErr(). This is a boundary mixing issue in the oldest code
     (data package).

     What V2 should do:
     Change initializeDatabase to return Result<KyselyDB, Error>. Same for runMigrations. This aligns with the rest of the codebase.

     Needs coverage:

     ┌─────────────────────────────────────┬─────────────────────────┬────────────────────────────┐
     │         Current capability          │ Covered by replacement? │           Notes            │
     ├─────────────────────────────────────┼─────────────────────────┼────────────────────────────┤
     │ Initialization with error reporting │ Yes                     │ Same logic, Result wrapper │
     ├─────────────────────────────────────┼─────────────────────────┼────────────────────────────┤
     │ Throw on migration failure          │ Yes                     │ Return err() instead       │
     └─────────────────────────────────────┴─────────────────────────┴────────────────────────────┘

     Surface: ~2 files in data package, ~3 consumer call-sites in CLI

     Leverage: Low

     ---
     7c. Observability: Provider Event Bus Provides Adequate Tracing

     What exists:
     The EventBus<ProviderEvent> emits structured events for all provider operations: request start, success, failure, rate limiting, backoff, circuit breaker open. The CLI
     subscribes and renders these in real-time during import operations.

     The logger package supports structured context objects with all log calls.

     Why it's a problem:
     Not a problem for a local CLI tool. OpenTelemetry would be overkill. The current event + log approach is proportional.

     What V2 should do: Keep current approach. Add OpenTelemetry only if the project moves to a server deployment model.

     ---
     V2 Decision Summary

     Rank: 1
     Change: Replace ccxt with direct HTTP via @exitbook/http
     Dimension: 1b Dependency
     Leverage: High
     One-line Rationale: Eliminates 56MB dependency; the project already has everything needed
     ────────────────────────────────────────
     Rank: 2
     Change: Replace @cardano-sdk with lightweight crypto primitives
     Dimension: 1c Dependency
     Leverage: High
     One-line Rationale: Eliminates 20MB (SDK + libsodium) for 1 file's xpub derivation
     ────────────────────────────────────────
     Rank: 3
     Change: Centralize database initialization in @exitbook/data
     Dimension: 2a Architecture
     Leverage: Medium
     One-line Rationale: 4 copy-pasted database.ts files -> 1 generic factory
     ────────────────────────────────────────
     Rank: 4
     Change: Extract ProviderManager into focused modules
     Dimension: 6b Organization
     Leverage: Medium
     One-line Rationale: 1390-LOC file with 4+ responsibilities -> 3 focused files
     ────────────────────────────────────────
     Rank: 5
     Change: Replace eslint-plugin-import + eslint-comments with maintained forks
     Dimension: 5b Toolchain
     Leverage: Low
     One-line Rationale: Current plugins are unmaintained (2020+)
     ────────────────────────────────────────
     Rank: 6
     Change: Replace uuid with crypto.randomUUID()
     Dimension: 1d Dependency
     Leverage: Low
     One-line Rationale: Node 24 built-in; remove unnecessary dependency
     ────────────────────────────────────────
     Rank: 7
     Change: Remove jose from blockchain-providers
     Dimension: 1f Dependency
     Leverage: Low
     One-line Rationale: Declared but never imported
     ────────────────────────────────────────
     Rank: 8
     Change: Remove sub-path exports from ingestion/blockchain-providers
     Dimension: 2c Architecture
     Leverage: Low
     One-line Rationale: Leaks internal structure as public API
     ────────────────────────────────────────
     Rank: 9
     Change: Fix exchange-providers package naming inconsistency
     Dimension: 6c Organization
     Leverage: Low
     One-line Rationale: Directory "exchange-providers" vs package "@exitbook/exchanges-providers"
     ────────────────────────────────────────
     Rank: 10
     Change: Make initializeDatabase return Result instead of throw
     Dimension: 7b Error Handling
     Leverage: Low
     One-line Rationale: Aligns with codebase error handling convention

     ---
     What V2 Keeps

     These patterns and tools earned their place and should carry forward unchanged:

     - Custom logger (@exitbook/logger) -- zero dependencies, matches the project's needs perfectly, sink-based architecture is extensible
     - neverthrow Result types -- 266 imports across 221 files, uniformly applied, provides typed error handling throughout
     - Zod schemas -- 108 files, used consistently for validation at all boundaries
     - Kysely + better-sqlite3 -- natural query builder fit, type-safe, no ORM impedance mismatch
     - pnpm workspaces with no-build library packages -- eliminates build complexity, source packages consumed directly as TypeScript
     - Factory function pattern for queries -- clean functional-core style, easy to test, idiomatic TypeScript
     - Feature-based directory structure -- self-documenting organization across CLI, ingestion, blockchain providers
     - @RegisterApiClient decorator -- auto-discovery justified by 20+ provider classes
     - EventBus for provider observability -- proportional to project needs, clean separation of concerns
     - Multi-database SQLite design -- lifecycle separation (transactional vs cache) is well-motivated
     - Custom HTTP client with pure-function rate limiting and circuit breaker -- well-tested, effects-injectable, no unnecessary abstraction
     - tsup for CLI bundling only -- single bundle point, correct noExternal strategy
     - Aggressive TypeScript settings (exactOptionalPropertyTypes, noUncheckedIndexedAccess) -- catches real bugs in a financial system
