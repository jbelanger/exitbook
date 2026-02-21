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
     ccxt (v4.5.36) is declared in @exitbook/exchange-providers package.json. It is imported in exactly 3 exchange client files:
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
