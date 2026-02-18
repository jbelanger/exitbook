     V2 Architecture Audit — Data Layer and Repositories

     Scope: packages/data, packages/accounting/src/persistence, and all repository call-sites across the monorepo. All seven analysis dimensions are covered.

     ---
     Dimension 1 — Dependency Audit

     1a. Hand-rolled code duplicating a community package

     ---
     [1.1] Hand-rolled stable JSON serialization

     What exists:

     packages/data/src/repositories/raw-data-repository.ts (lines 442–464) contains a hand-rolled stableStringify function that recursively sorts object keys before calling JSON.stringify. It is used in
     warnOnEventIdCollision to detect content divergence on duplicate event IDs. This is a 22-line recursive normalizer, only called in one diagnostic path.

     private stableStringify(value: unknown): string {
       function normalize(input: unknown): unknown { ... } // sort keys recursively
       return JSON.stringify(normalize(value));
     }

     Why it's a problem:

     The implementation doesn't handle circular references, Date objects, or undefined values consistently with native JSON.stringify. It is only used in a warning path, so correctness issues remain latent
      and untested.

     What V2 should do:

     Use the fast-json-stable-stringify package (~7k weekly downloads, TypeScript-typed, zero dependencies, actively maintained), or if the diagnostic path is the only use, a simpler JSON.stringify(sorted)
      with a comment explaining why.

     Needs coverage:

     ┌──────────────────────────────┬─────────────────────────┬──────────────────────────────────────┐
     │      Current capability      │ Covered by replacement? │                Notes                 │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Sort object keys recursively │ Yes                     │ fast-json-stable-stringify does this │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Handle nested arrays         │ Yes                     │ Covered                              │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Diagnostic-only use          │ Yes                     │ One call site                        │
     └──────────────────────────────┴─────────────────────────┴──────────────────────────────────────┘

     Surface: 1 file, 1 call-site.

     Leverage: Low — only a diagnostic warning path.

     ---
     1b. Over-dependency / API surface under-use

     ---
     [1.2] Three identical database bootstrap functions (shotgun duplication)

     What exists:

     Three separate packages each contain a nearly identical create*Database + initialize*Database + close*Database function set. The implementations differ only in the package-specific schema type and the
      logger name:

     - packages/data/src/storage/database.ts — createDatabase / closeDatabase
     - packages/data/src/persistence/token-metadata/database.ts — createTokenMetadataDatabase / initializeTokenMetadataDatabase / closeTokenMetadataDatabase / clearTokenMetadataDatabase
     - packages/price-providers/src/persistence/database.ts — createPricesDatabase / initializePricesDatabase / closePricesDatabase / clearPricesDatabase
     - packages/blockchain-providers/src/persistence/database.ts — createProviderStatsDatabase / initializeProviderStatsDatabase / closeProviderStatsDatabase

     All four implement the same pragma configuration block (foreign_keys, journal_mode = WAL, synchronous = NORMAL, cache_size = 10000, temp_store = memory), the same FileMigrationProvider setup, and the
     same error/result pattern.

     Why it's a problem:

     A pragma change (e.g., adding busy_timeout) must be made in 4 places. A bug in the migration error-detection logic (e.g., the error check comes after the results loop in prices-providers but before in
      others) is already present and inconsistent. The clearPricesDatabase and clearTokenMetadataDatabase functions are structural copies with different table names.

     What V2 should do:

     Extract a createKyselyDatabase<TSchema>(dbPath, migrationsPath, loggerName) factory into @exitbook/data. Each consumer calls this factory with its schema type. This eliminates ~250 lines of
     duplication across 4 files. The sqliteTypeAdapterPlugin is already shared; the bootstrap should be too.

     Needs coverage:

     ┌───────────────────────────────────┬─────────────────────────┬──────────────────────────┐
     │        Current capability         │ Covered by replacement? │          Notes           │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Per-database pragma configuration │ Yes                     │ Single place to change   │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Per-database migration path       │ Yes                     │ Parameter                │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Per-database schema type          │ Yes                     │ Generic parameter        │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Result-typed creation             │ Yes                     │ Preserve Result wrapping │
     └───────────────────────────────────┴─────────────────────────┴──────────────────────────┘

     Surface: 4 files, ~250 lines of duplication.

     Leverage: Medium — eliminates a category of drift bugs.

     ---
     1c. Missing ecosystem leverage

     No material issues found in the dependency set itself. Kysely, better-sqlite3, neverthrow, zod, and decimal.js are all appropriate choices for their roles.

     ---
     Dimension 2 — Architectural Seams

     [2.1] Interface/concrete-class split on TransactionRepository is incomplete and inconsistent

     What exists:

     ITransactionRepository in packages/data/src/repositories/transaction-repository.interface.ts defines only 4 methods: getTransactions, save, saveBatch, findById.

     The concrete TransactionRepository class implements 10 additional public methods not in the interface: findTransactionsNeedingPrices, updateMovementsWithPrices, countTransactions, deleteByAccountIds,
     getLatestCreatedAt, deleteAll.

     Consumer code is split across two import styles:
     - packages/ingestion and apps/cli/src/features/links use ITransactionRepository (type-safe, mockable boundary).
     - packages/accounting imports TransactionRepository directly (the concrete class) in 7 files including price-enrichment-service.ts, price-normalization-service.ts, lot-matcher.ts,
     cost-basis-calculator.ts.

     IRawDataRepository and IImportSessionRepository are fully defined interfaces, making ITransactionRepository's incompleteness the odd one out.

     Why it's a problem:

     The accounting package is coupled to the concrete data-layer class. Mocking for tests requires as unknown as TransactionRepository casts (observed in price-enrichment-service.test.ts lines 15–20 and
     price-normalization-service.test.ts line 50). This defeats the purpose of the interface. Adding a method to TransactionRepository that accounting services need means changing the concrete class rather
      than the interface, breaking encapsulation.

     What V2 should do:

     Move the full method set into ITransactionRepository. The accounting package should depend only on the interface, not the concrete class. This is a ~7-file change in packages/accounting (import type
     change only) plus extending the interface with the missing 6 methods.

     Needs coverage:

     ┌─────────────────────────────────┬─────────────────────────┬─────────────────────────────────────┐
     │       Current capability        │ Covered by replacement? │                Notes                │
     ├─────────────────────────────────┼─────────────────────────┼─────────────────────────────────────┤
     │ All 10 public methods available │ Yes                     │ Just add to interface               │
     ├─────────────────────────────────┼─────────────────────────┼─────────────────────────────────────┤
     │ Mockable in tests               │ Yes                     │ Improved — no more as unknown casts │
     ├─────────────────────────────────┼─────────────────────────┼─────────────────────────────────────┤
     │ Concrete class unchanged        │ Yes                     │ Interface is a superset             │
     └─────────────────────────────────┴─────────────────────────┴─────────────────────────────────────┘

     Surface: 7 files in packages/accounting, interface file, 1 call-site in ingestion.

     Leverage: High — removes the as-unknown mock antipattern, enables clean seams.

     ---
     [2.2] TransactionLinkRepository lives in accounting/persistence but references @exitbook/data types

     What exists:

     packages/accounting/src/persistence/transaction-link-repository.ts imports DatabaseSchema, KyselyDB, TransactionLinksTable, and BaseRepository from @exitbook/data. The transaction_links table is
     defined in packages/data/src/schema/database-schema.ts and its migration is in packages/data/src/migrations/001_initial_schema.ts.

     The schema (migration + type definition) lives in @exitbook/data, but the repository that operates on that table lives in @exitbook/accounting.

     Why it's a problem:

     This is a split concern: the table definition, index creation, and DDL are in @exitbook/data, but the data access logic for that table is in @exitbook/accounting. Any schema change to
     transaction_links requires touching both packages. The migration adds 7 indexes for the link table — those are in @exitbook/data, not near the code that uses them.

     The boundary also causes @exitbook/accounting to declare @exitbook/data as a peer dependency purely to inherit BaseRepository, creating a bidirectional conceptual coupling even if not a circular
     import.

     What V2 should do:

     Two options, pick one:
     1. Move TransactionLinkRepository into packages/data, alongside all other repositories. The link table schema is already there.
     2. Move the link table schema and migration into packages/accounting, making it self-contained.

     Option 1 is lower friction: ~414 lines move, the accounting package stops importing BaseRepository directly, and the data package exports the full repository set.

     Needs coverage:

     ┌────────────────────────────────────────────┬─────────────────────────┬───────────────────────────────────┐
     │             Current capability             │ Covered by replacement? │               Notes               │
     ├────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────┤
     │ Repository operations on transaction_links │ Yes                     │ Same code, different location     │
     ├────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────┤
     │ Schema + migration co-located with code    │ Yes                     │ Under option 1, both stay in data │
     ├────────────────────────────────────────────┼─────────────────────────┼───────────────────────────────────┤
     │ Accounting package can still use the repo  │ Yes                     │ Via dependency injection          │
     └────────────────────────────────────────────┴─────────────────────────┴───────────────────────────────────┘

     Surface: 1 file (414 lines), 1 schema definition, migration block, ~8 call-sites in accounting.

     Leverage: High — resolves a structural split that causes shotgun-surgery on schema changes.

     ---
     [2.3] ImportSessionRepository split between packages/data and ingestion

     What exists:

     ImportSessionRepository is defined in packages/data/src/repositories/import-session-repository.ts but its consumers and the service that drives it (import-orchestrator.ts, import-service.ts,
     clear-service.ts) live in packages/ingestion. The IImportSessionRepository interface is also in packages/data.

     At the same time, RawDataRepository — which also serves ingestion exclusively — is also in packages/data.

     Why it's a problem:

     Examined against the vertical-slice principle stated in CLAUDE.md: import session tracking is an ingestion concern. It has no consumers outside packages/ingestion and apps/cli/src/features (which call
      through ingestion services). Keeping it in packages/data adds package-boundary overhead without enabling reuse.

     However, since RawDataRepository is also purely an ingestion concern and the stated architecture keeps all repositories in packages/data, this is an accepted tradeoff. The current placement is
     internally consistent, even if not perfectly vertical.

     No change recommended. This is a known pattern tradeoff, documented by the architecture. Calling it out but not flagging it as a finding.



     ---
     Dimension 5 — Toolchain & Infrastructure

     Not in scope for this audit (focus: data and repositories). No analysis performed.


     ---
     V2 Decision Summary

     Rank: 1
     Change: Extend ITransactionRepository to include all 10 public methods; accounting package depends on interface only
     Dimension: 2 — Architectural Seams
     Leverage: High
     One-line Rationale: Eliminates as unknown mock casts and couples accounting to a concrete data class
     ────────────────────────────────────────
     Rank: 2
     Change: Push findTransactionsNeedingPrices filter into SQL (WHERE EXISTS on movements); remove the double-query in PriceEnrichmentService
     Dimension: 3 — Patterns, 7 — Observability
     Leverage: High
     One-line Rationale: Eliminates full-table scan and in-memory filter on the price enrichment hot path
     ────────────────────────────────────────
     Rank: 3
     Change: Move TransactionLinkRepository into packages/data alongside all other repositories
     Dimension: 2 — Architectural Seams
     Leverage: High
     One-line Rationale: Resolves schema-ownership split: table definition and access code in the same package
     ────────────────────────────────────────
     Rank: 4
     Change: Replace OverrideStore JSONL with a SQLite overrides table in transactions.db
     Dimension: 3 — Patterns, 7 — Observability
     Leverage: High
     One-line Rationale: Eliminates O(N) full-file scan on scope reads, eliminates silent write failure path
     ────────────────────────────────────────
     Rank: 5
     Change: Extract shared createKyselyDatabase<T>() factory from the 4 duplicated database bootstrap functions
     Dimension: 1 — Dependencies
     Leverage: Medium
     One-line Rationale: Pragma changes and migration-error logic currently maintained in 4 separate copies
     ────────────────────────────────────────
     Rank: 6
     Change: Replace Record<string, unknown> partial update pattern with Partial<Updateable<T>> in AccountRepository and ImportSessionRepository
     Dimension: 3 — Patterns
     Leverage: Medium
     One-line Rationale: Restores Kysely column-name type-checking that the string-key pattern bypasses
     ────────────────────────────────────────
     Rank: 7
     Change: Replace error message string matching in RawDataRepository.saveBatch with error.code === 'SQLITE_CONSTRAINT_UNIQUE'
     Dimension: 7 — Observability
     Leverage: Medium
     One-line Rationale: Removes dependency on library-specific error message wording
     ────────────────────────────────────────
     Rank: 8
     Change: Extract rowToTokenMetadata(row) private function; extend sqliteTypeAdapterPlugin to handle boolean result coercion
     Dimension: 6 — Organization
     Leverage: Low
     One-line Rationale: Eliminates 20-line duplicate mapper and manual integer-to-boolean conversion
     ────────────────────────────────────────
     Rank: 9
     Change: Replace hand-rolled stableStringify with fast-json-stable-stringify or remove it
     Dimension: 1 — Dependencies
     Leverage: Low
     One-line Rationale: Diagnostic-only path, limited risk

     ---
     What V2 Keeps

     Kysely + better-sqlite3. The type-safe query builder is used correctly, naturally, and without fighting. The SqliteDialect with WAL pragmas is the right configuration for a local CLI.

     BaseRepository as shared infrastructure. serializeToJson, parseWithSchema, parseJson, withTransaction, getCurrentDateTimeForDB, and the logger setup are all genuinely reusable and correctly placed.
     The 36 total call-sites across 7 repository files justify the abstraction.

     Four-database split. Keeping transactions.db, token-metadata.db, prices.db, and providers.db separate allows cache databases to survive reprocess wipes without special-casing rows. The design intent
     is sound.

     sqliteTypeAdapterPlugin for write-side boolean conversion. Intercepting ValueNode in Kysely's query transformer is the correct insertion point for boolean-to-integer conversion. The plugin is already
     shared across all database instances.

     CHECK constraints on all JSON and enum columns. The migration enforces json_valid(), enum membership, and the price all-or-nothing invariant at the database level. This is unusually thorough and
     should be preserved in any V2.

     Result type consistency across all repository methods. Every repository method returns Result<T, Error> without exception. The wrapError pattern from @exitbook/core catches thrown exceptions at the
     boundary and converts them. This is correct and should carry forward.

     Deterministic transaction ID hashing. generateDeterministicTransactionHash in transaction-id-utils.ts is a clean pure function with a clear contract (same data = same hash, gen- prefix marks generated
      IDs). The SHA-256 approach eliminates collision risk. Keep as-is.

     OverrideEvent Zod schema with discriminated union and scope/payload cross-validation. The superRefine check that enforces scope:'link' must pair with payload.type:'link_override' is a good example of
     using Zod's type system to prevent invalid state. This pattern should be replicated in any migration of OverrideStore to SQLite.
