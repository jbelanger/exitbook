V2 Architecture Audit: Data Layer

     Scope

     This audit evaluates dimension 4 (Data Layer) in depth: the ORM/query builder (Kysely), the schema strategy, the storage architecture (SQLite via better-sqlite3), and the patterns surrounding
     repository construction, JSON column management, and type conversion.

     ---
     4a. ORM / Query Builder Fit: Kysely + better-sqlite3

     What exists:

     The data layer uses Kysely 0.28 as a type-safe query builder on top of better-sqlite3 12.6. There are two separate SQLite databases:

     1. transactions.db -- the main database with 12 tables (users, accounts, import_sessions, raw_transactions, transactions, token_metadata, symbol_index, transaction_links, cost_basis_calculations
      acquisition_lots, lot_disposals, lot_transfers)
     2. prices.db -- a separate database for cached price data (3 tables: providers, provider_coin_mappings, prices)

     Kysely is used for:
     - Schema DDL in migrations (/packages/data/src/migrations/001_initial_schema.ts)
     - Type-safe SELECT, INSERT, UPDATE, DELETE across ~5,288 lines of repository code (8 repository files)
     - CTE queries (with in RawDataRepository.loadPendingByHashBatch)
     - Raw SQL via sql template tag (CHECK constraints, partial indexes, json_extract)
     - Expression builders for complex WHERE clauses

     Repositories and call-sites (measured):
     - packages/data/src/repositories/ -- 6 repositories, 3,348 lines
     - packages/accounting/src/persistence/ -- 3 repositories, 1,940 lines
     - packages/price-providers/src/persistence/repositories/ -- 2 repositories
     - Total: ~11 repository classes, ~5,288+ lines, consumed by 63 files across the monorepo

     Why this dimension matters:

     The data layer is the most boilerplate-heavy part of the codebase. Every repository follows an identical pattern: build Kysely query, execute, iterate rows through a toXyz mapper method with JSO
      parsing/Zod validation, wrap in Result. The mapper pattern alone accounts for ~44 distinct toXyz conversion call-sites.

     ---
     4a-1. The Manual snake_case-to-camelCase Mapping Tax

     What exists:

     Every repository has a private toXyz method that manually converts snake_case database columns to camelCase domain objects. Examples:

     - TransactionRepository.toUniversalTransaction -- /packages/data/src/repositories/transaction-repository.ts lines 494-563
     - AccountRepository.toAccount -- /packages/data/src/repositories/account-repository.ts lines 496-558
     - CostBasisRepository.toAcquisitionLot, .toLotDisposal, .toCostBasisCalculation -- /packages/accounting/src/persistence/cost-basis-repository.ts lines 953-1063
     - TransactionLinkRepository.toTransactionLink -- /packages/accounting/src/persistence/transaction-link-repository.ts lines 505-538
     - And 4 more across other repositories

     Each mapper manually maps every column (e.g., row.account_id to accountId, row.source_name to sourceName) plus handles JSON deserialization and null-to-undefined coercion. The comment on line 82
     of database.ts explicitly says: "No CamelCasePlugin - we use snake_case to match database columns exactly."

     Similarly, every INSERT and UPDATE manually maps camelCase domain fields back to snake_case columns. For example, AccountRepository.findOrCreate at lines 122-137 manually constructs the
     snake_case insert object.

     Why it's a problem:

     - Maintenance burden: ~153 ?? null coercions counted in repository files alone. Every new column requires updating both the mapper and the insert builder -- two places to forget.
     - Bug risk: If a domain field is added but the mapper is not updated, the data is silently lost. The Zod validation on read catches some of this, but the write path has no equivalent guard.
     - Proportional cost: This mapping is ~30% of every repository file's line count.

     What V2 should do:

     Use Kysely's CamelCasePlugin (already available in kysely@0.28) to eliminate manual snake_case-to-camelCase mapping. The plugin transforms column names at the dialect level, meaning the
     TypeScript interface can use camelCase properties while the SQL uses snake_case. The DatabaseSchema interface would use camelCase field names, and Kysely handles the transformation transparently

     Needs coverage:


     ┌────────────────────────────────────┬─────────────────────────────┬─────────────────────────────────────────────────────────────┐
     │         Current capability         │ Covered by CamelCasePlugin? │                            Notes                            │
     ├────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────────────────────┤
     │ snake_case in SQL, camelCase in TS │ Yes                         │ Primary purpose of the plugin                               │
     ├────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────────────────────┤
     │ Custom JSON column handling        │ No change                   │ Still needs serializeToJson/parseJson                       │
     ├────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────────────────────┤
     │ null-to-undefined coercion         │ Partial                     │ Plugin does not handle this; a thin adapter is still needed │
     ├────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────────────────────┤
     │ Zod validation on read             │ No change                   │ Still needed for JSON columns                               │
     └────────────────────────────────────┴─────────────────────────────┴─────────────────────────────────────────────────────────────┘
     Surface: ~11 repository files, ~44 mapper methods, ~153 null-coercion sites

     Leverage: High -- this is the single largest source of mechanical boilerplate in the codebase.

     ---
     4a-2. The Type-Adapter Proxy Workaround

     What exists:

     The file /packages/data/src/storage/database.ts (lines 17-51) wraps the entire better-sqlite3 Database instance in a JavaScript Proxy that intercepts prepare(), and then wraps the returned
     Statement in another Proxy that intercepts run(), get(), and all() to convert boolean to 0/1 and undefined to null via convertValueForSqlite() in
     /packages/data/src/plugins/sqlite-type-adapter-plugin.ts.

     This double-proxy approach is used instead of a Kysely plugin because it intercepts at the better-sqlite3 statement level.

     Why it's a problem:

     - Performance: Every SQL parameter goes through two proxy trap dispatches. For batch inserts (e.g., RawDataRepository.saveBatch processing thousands of items), this adds up.
     - Fragility: The proxy intercepts run, get, all by string name -- if better-sqlite3 adds new methods or changes internals, the proxy silently misses them.
     - Debugging opacity: Stack traces through proxies are harder to read. The Proxy wrapping is invisible to TypeScript's type system.
     - Narrower than needed: The conversion only handles boolean and undefined. It does not handle Date objects, which is why all date handling is done as ISO strings in application code. Kysely has
      proper plugin system (KyselyPlugin with transformQuery and transformResult) that would be more maintainable.

     What V2 should do:

     Replace the double-proxy with a proper KyselyPlugin that implements transformQuery to convert parameter types. This is the intended extension point. Alternatively, since Kysely 0.27+ the
     SqliteDialect can accept a onCreateConnection callback for pragma setup, and type conversion can be done in a plugin.

     Needs coverage:
     ┌────────────────────────────────────┬──────────────────────────┬───────────────────────────────────────────────────┐
     │         Current capability         │ Covered by KyselyPlugin? │                       Notes                       │
     ├────────────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────┤
     │ boolean -> 0/1 conversion          │ Yes                      │ Plugin transformQuery can handle                  │
     ├────────────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────┤
     │ undefined -> null conversion       │ Yes                      │ Plugin transformQuery can handle                  │
     ├────────────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────┤
     │ Intercepts all statement methods   │ Yes                      │ Plugin operates on compiled query, not statements │
     ├────────────────────────────────────┼──────────────────────────┼───────────────────────────────────────────────────┤
     │ Works with all better-sqlite3 APIs │ Better                   │ Plugin is dialect-agnostic                        │
     └────────────────────────────────────┴──────────────────────────┴───────────────────────────────────────────────────┘
     Surface: 2 files (database.ts, sqlite-type-adapter-plugin.ts), affects every query execution

     Leverage: Medium -- fixes a correctness/maintenance risk, moderate effort

     ---
     4a-3. Duplicated Database Initialization

     What exists:

     There are two separate database initialization codepaths:

     1. /packages/data/src/storage/database.ts -- createDatabase() for transactions.db
     2. /packages/price-providers/src/persistence/database.ts -- createPricesDatabase() for prices.db

     Both duplicate:
     - Directory existence check + mkdirSync
     - Pragma configuration (identical 5 pragmas: foreign_keys, journal_mode, synchronous, cache_size, temp_store)
     - Kysely instantiation with SqliteDialect
     - Connection closing utility

     The key difference: transactions.db uses the proxy wrapper; prices.db does not.

     Why it's a problem:

     - Pragma configuration drift: if one database changes pragmas, the other may be forgotten.
     - The proxy wrapper inconsistency means boolean/undefined handling works differently between the two databases.

     What V2 should do:

     Extract a shared createSqliteKyselyDatabase(path, schema, options?) factory in @exitbook/data that handles directory creation, pragma configuration, plugin setup, and Kysely instantiation. Both
     transactions.db and prices.db would use it.

     Needs coverage:
     ┌───────────────────────┬────────────────────────────┬─────────────────────────────┐
     │  Current capability   │ Covered by shared factory? │            Notes            │
     ├───────────────────────┼────────────────────────────┼─────────────────────────────┤
     │ Custom DB path        │ Yes                        │ Parameter                   │
     ├───────────────────────┼────────────────────────────┼─────────────────────────────┤
     │ Pragma configuration  │ Yes                        │ Shared default, overridable │
     ├───────────────────────┼────────────────────────────┼─────────────────────────────┤
     │ Type conversion proxy │ Yes                        │ Replaced with shared plugin │
     ├───────────────────────┼────────────────────────────┼─────────────────────────────┤
     │ Schema type safety    │ Yes                        │ Generic <T> parameter       │
     └───────────────────────┴────────────────────────────┴─────────────────────────────┘
     Surface: 2 database initialization files, ~150 lines total

     Leverage: Low -- small duplication, but prevents drift

     ---
     4b. Schema Strategy

     4b-1. Single-Migration "Drop and Recreate" Approach
     Status: Done on 2026-02-06. `down()` cleanup shipped in `/Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts` (removed explicit `idx_accounts_parent_account_id` drop).

     What exists:

     CLAUDE.md explicitly states: "Add new tables/fields to initial migration (001_initial_schema.ts) - database dropped during development, not versioned incrementally." The single migration file is
     380 lines. The FileMigrationProvider + Migrator from Kysely is set up in /packages/data/src/storage/migrations.ts, but there is only one migration file.

     Why it's a problem (or not):

     For a development-stage CLI tool used locally, this is entirely appropriate. The migration infrastructure exists and works. When the schema stabilizes and real users have data they want to keep,
     adding incremental migrations is a one-step process. This is a conscious, documented decision.

     However, one issue: the down() migration in 001_initial_schema.ts (lines 361-380) drops indexes before tables, which can fail because DROP TABLE implicitly drops indexes on that table. The
     dropIndex('idx_accounts_parent_account_id') at line 377 would fail if accounts was already dropped. This is a minor bug, but since down() is only used in testing, it is low priority.

     What V2 should do:

     - Keep the single-migration approach for now. When the first production user exists, freeze the schema and begin incremental migrations.
     - Fix the down() migration ordering: drop tables in correct FK order and remove explicit index drops (SQLite drops indexes with their tables).

     Needs coverage: N/A -- this is a strategy validation, not a replacement.

     Surface: 1 file, 380 lines

     Leverage: Low -- current approach is appropriate for project stage

     ---
     4b-2. Weak Database Constraints vs. Application-Only Validation
     Status: Done on 2026-02-06. Enum and JSON `CHECK` constraints were added in `/Users/joel/Dev/exitbook/packages/data/src/migrations/001_initial_schema.ts`.

     What exists:

     The schema has minimal database-level constraints beyond:
     - Primary keys (all tables)
     - Foreign keys (properly declared with references())
     - NOT NULL on required columns
     - 3 unique indexes (accounts, raw_transactions event_id, transactions blockchain_hash)
     - 1 CHECK constraint (lot_transfers_quantity_positive)

     What is enforced only in application code:
     - account_type values ('blockchain' | 'exchange-api' | 'exchange-csv') -- no CHECK constraint
     - transaction_status values ('pending' | 'success' | 'failed' | 'open' | 'closed' | 'canceled') -- no CHECK constraint
     - operation_category and operation_type enums -- no CHECK constraints
     - processing_status values ('pending' | 'processed') -- no CHECK constraint
     - link_type values -- no CHECK constraint
     - cost_basis_calculations.status -- no CHECK constraint
     - Decimal string validity -- all DecimalString columns are just TEXT with no format validation
     - JSON structure validity -- all JSON columns are TEXT with no JSON validation

     Why it's a problem:

     For a financial system where accuracy is critical (per CLAUDE.md), relying solely on application code for data integrity means:
     - A bug in any one of 11 repository classes or 63 consuming files can write invalid data
     - Direct SQL operations (debugging, data fixes) have no guard rails
     - A malformed enum value in the database silently propagates until a Zod parse fails much later

     SQLite supports CHECK constraints that could catch these at write time.

     What V2 should do:

     Add CHECK constraints for all enum columns in the migration:

     CHECK(account_type IN ('blockchain', 'exchange-api', 'exchange-csv'))
     CHECK(transaction_status IN ('pending', 'success', 'failed', 'open', 'closed', 'canceled'))
     CHECK(processing_status IN ('pending', 'processed'))
     CHECK(operation_category IN ('trade', 'transfer', 'staking', 'defi', 'fee', 'governance') OR operation_category IS NULL)
     -- etc.

     For JSON columns, SQLite 3.38+ (which better-sqlite3 bundles) supports json_valid():
     CHECK(movements_inflows IS NULL OR json_valid(movements_inflows))

     Needs coverage:


     ┌───────────────────────────┬───────────────────────────────┬──────────────────────────────────────────────────────┐
     │    Current capability     │ Covered by CHECK constraints? │                        Notes                         │
     ├───────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────┤
     │ Enum validation           │ Yes                           │ CHECK with IN clause                                 │
     ├───────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────┤
     │ JSON format validation    │ Yes                           │ json_valid() in SQLite 3.38+                         │
     ├───────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────┤
     │ Decimal format validation │ Partial                       │ CHECK with regex or CAST, but cumbersome             │
     ├───────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────────┤
     │ Zod schema validation     │ No                            │ Still needed for complex nested structure validation │
     └───────────────────────────┴───────────────────────────────┴──────────────────────────────────────────────────────┘
     Surface: 1 migration file, ~15-20 new CHECK constraints

     Leverage: High -- defense-in-depth for financial accuracy

     ---
     4b-3. Dual Schema Declaration (TypeScript + Migration DDL)

     What exists:

     The database schema is declared in two places that must stay synchronized:

     1. TypeScript interfaces in /packages/data/src/schema/database-schema.ts (326 lines) -- defines the shape Kysely uses for type checking
     2. Migration DDL in /packages/data/src/migrations/001_initial_schema.ts (380 lines) -- defines the actual SQL CREATE TABLE statements

     These two files define the same 12 tables independently. If a column is added to one and not the other, either:
     - The TypeScript types allow querying a column that does not exist (runtime SQL error)
     - The database has a column that TypeScript does not know about (silently ignored)

     Why it's a problem:

     706 combined lines of schema definition that must be manually kept in sync. The TypeScript interfaces use Kysely's Generated<>, ColumnType<>, etc. while the migration uses .addColumn() builder
     calls. There is no compile-time or runtime check that they match.

     What V2 should do:

     Consider Drizzle ORM for V2, which solves this with a single schema definition that serves as both the TypeScript type source and the migration generator. With Drizzle:
     - One schema file generates both types AND migrations
     - drizzle-kit push or drizzle-kit generate creates migrations from schema changes
     - Type safety is derived from the schema definition, not manually maintained

     Alternatively, if staying with Kysely, use kysely-codegen to generate the TypeScript interfaces from the actual SQLite database, making the migration the single source of truth.

     Needs coverage:
     ┌───────────────────────────────────────┬──────────────────────────────────┬────────────────────────────┐
     │          Current capability           │       Covered by Drizzle?        │ Covered by kysely-codegen? │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Type-safe queries                     │ Yes                              │ Yes                        │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Schema as single source of truth      │ Yes (schema file)                │ Yes (migration file)       │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Migration generation                  │ Yes (drizzle-kit)                │ No (still manual)          │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Complex expressions (CTEs, raw SQL)   │ Yes (sql template)               │ N/A (stays Kysely)         │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ SQLite dialect support                │ Yes                              │ Yes                        │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ better-sqlite3 driver                 │ Yes (drizzle-orm/better-sqlite3) │ N/A                        │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Result type integration               │ No (would need wrapper)          │ N/A                        │
     ├───────────────────────────────────────┼──────────────────────────────────┼────────────────────────────┤
     │ Existing Kysely knowledge in codebase │ Lost (new API)                   │ Preserved                  │
     └───────────────────────────────────────┴──────────────────────────────────┴────────────────────────────┘
     Surface: 2 files (706 lines) plus all 11 repositories if switching to Drizzle

     Leverage: Medium -- eliminates a class of drift bugs, but migration is substantial

     ---
     4b-4. JSON Columns: Structured Data in TEXT Columns

     What exists:

     The schema uses 20 JSON columns (counted via JSONString type usage in database-schema.ts):
     - accounts.credentials, accounts.last_cursor, accounts.verification_metadata, accounts.metadata
     - raw_transactions.provider_data, raw_transactions.normalized_data
     - transactions.notes_json, transactions.movements_inflows, transactions.movements_outflows, transactions.fees
     - cost_basis_calculations.config_json, cost_basis_calculations.assets_processed, cost_basis_calculations.metadata_json
     - acquisition_lots.metadata_json
     - lot_disposals.metadata_json
     - lot_transfers.metadata_json
     - transaction_links.match_criteria_json, transaction_links.metadata_json

     All stored as TEXT columns. Each one requires manual JSON.stringify on write and JSON.parse + Zod validation on read, totaling 49 serializeToJson/parseJson/parseWithSchema call-sites across 8
     files.

     Why it's a problem:

     - No database-level validation: A malformed JSON string in any of these 20 columns will only be caught when a repository reads it, potentially much later than when it was written.
     - No indexing capability: The json_extract queries in RawDataRepository (NEAR receipt ID lookups) work, but are limited to 2 specific columns. The other 18 JSON columns cannot be efficiently
     queried.
     - Serialization friction: The BaseRepository.serializeToJson method (lines 45-77 in base-repository.ts) implements custom Decimal handling with both instanceof and duck-type checks, adding
     fragile logic to every write path.

     What V2 should do:

     For the subset of JSON columns that are queried (like normalized_data which uses json_extract), keep them as JSON but add json_valid() CHECK constraints.

     For JSON columns that represent structured, predictable data (like movements_inflows, movements_outflows, fees), consider normalizing into separate tables in V2. Each movement would be a row in
      transaction_movements table, each fee a row in a transaction_fees table. This would:
     - Enable direct SQL queries on asset symbols, amounts
     - Remove the JSON serialization/deserialization overhead
     - Allow proper indexes on frequently-queried fields
     - Eliminate 6 of the 20 JSON columns

     For JSON columns that represent opaque blobs (provider_data, credentials, metadata), TEXT is appropriate. Add json_valid() CHECK constraints.

     Needs coverage:
     ┌───────────────────────────────┬───────────────────────────┬────────────────────────────────┐
     │      Current capability       │ Covered by normalization? │             Notes              │
     ├───────────────────────────────┼───────────────────────────┼────────────────────────────────┤
     │ Store arbitrary movement data │ Yes                       │ Rows in dedicated table        │
     ├───────────────────────────────┼───────────────────────────┼────────────────────────────────┤
     │ Single-row transaction read   │ Requires JOIN             │ Adds query complexity          │
     ├───────────────────────────────┼───────────────────────────┼────────────────────────────────┤
     │ Zod validation on read        │ Partially eliminated      │ Schema validation at DB level  │
     ├───────────────────────────────┼───────────────────────────┼────────────────────────────────┤
     │ Flexible metadata storage     │ Kept as JSON              │ Only normalize structured data │
     ├───────────────────────────────┼───────────────────────────┼────────────────────────────────┤
     │ Bulk inserts                  │ More INSERT statements    │ But simpler per-statement      │
     └───────────────────────────────┴───────────────────────────┴────────────────────────────────┘
     Surface: 6-8 JSON columns that could be normalized, 49 JSON helper call-sites

     Leverage: Medium -- high correctness benefit for movements/fees; significant migration effort

     ---
     4c. Storage Architecture

     4c-1. SQLite Fitness for Workload

     What exists:

     SQLite via better-sqlite3 with WAL mode, used as the sole storage engine for a single-user CLI application.

     Workload characteristics observed:
     - Single concurrent user -- CLI tool, no multi-user access
     - Read-heavy after import -- bulk imports write raw + processed data, then reads dominate (balance reports, exports, cost basis calculations)
     - No concurrent writes -- all writes are sequential within CLI commands
     - Data volume: Moderate -- thousands to low millions of transactions for a typical crypto user
     - Complex queries: Subqueries, CTEs, JOINs (cost basis repository uses 3-level nested subqueries), partial indexes, json_extract
     - Two databases: transactions.db (dropped during dev) + prices.db (persisted across dev cycles)

     Why SQLite is a good fit:

     - Zero deployment complexity for a CLI tool
     - WAL mode provides good read performance during imports
     - better-sqlite3 is synchronous, which simplifies the Result<T, Error> pattern (no need to handle async connection pool failures)
     - The data volume is well within SQLite's capabilities (tested to billions of rows)
     - The two-database split for prices is a pragmatic choice: prices are expensive to re-fetch and should survive dev resets

     No material issues found. SQLite is the right storage engine for this workload. Moving to PostgreSQL or another server database would add deployment complexity without proportional benefit for a
     single-user CLI tool.

     One observation: The separate prices.db database uses its own Kysely instance, schema, migration, and repository pattern -- but cannot do cross-database JOINs with transactions.db. If V2 needs
     queries that span both databases (e.g., "find transactions where the price is missing from the price cache"), this would require application-level coordination. SQLite's ATTACH DATABASE could
     solve this, but Kysely does not support it natively.

     ---
     4c-2. Decimal Handling: .toString() vs .toFixed()
     Status: Done on 2026-02-06. All `Decimal#toString()` persistence writes were replaced with `.toFixed()` in `/Users/joel/Dev/exitbook/packages/accounting/src/persistence/cost-basis-repository.ts`.

     What exists:

     CLAUDE.md explicitly states: "Use .toFixed() for strings (NOT .toString() which outputs scientific notation)." The BaseRepository.serializeToJson properly uses .toFixed(). However, the
     CostBasisRepository at /packages/accounting/src/persistence/cost-basis-repository.ts uses .toString() for Decimal values in 29 locations (e.g., lines 91, 92, 93, etc.):

     quantity: lot.quantity.toString(),
     cost_basis_per_unit: lot.costBasisPerUnit.toString(),

     While Decimal.js only uses scientific notation for very large or very small numbers (and typical crypto quantities are in normal range), this is a latent bug for edge cases with very small token
     amounts or very large supplies.

     Why it's a problem:

     A token with amount 0.000000000000000001 (1 wei) stored via .toString() could produce "1e-18", which would fail when parsed back via DecimalSchema.parse() or cause comparison errors.

     What V2 should do:

     Replace all .toString() calls with .toFixed() in the CostBasisRepository. This is a mechanical fix.

     Surface: 29 call-sites in 1 file (cost-basis-repository.ts)

     Leverage: Medium -- latent correctness bug in a financial system

     ---
     V2 Decision Summary


     ┌──────┬──────────────────────────────────────────────────────────────────┬───────────┬──────────┬────────────────────────────────────────────────────────────────────────────────────────────────
     ┐
     │ Rank │                              Change                              │ Dimension │ Leverage │                                       One-line Rationale
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 1    │ Add CamelCasePlugin to eliminate manual snake_case mapping       │ 4a-1      │ High     │ Removes ~30% of repository boilerplate and a class of missing-field bugs across 11 repositories
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 2    │ Add CHECK constraints for all enum and JSON columns              │ 4b-2      │ High     │ Defense-in-depth for a financial system that currently has 0 enum constraints in the database [DONE 2026-02-06]
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 3    │ Fix Decimal .toString() to .toFixed() in CostBasisRepository     │ 4c-2      │ Medium   │ 29 sites that violate CLAUDE.md convention and risk scientific notation in financial data [DONE 2026-02-06]
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 4    │ Replace Proxy-based type adapter with KyselyPlugin               │ 4a-2      │ Medium   │ Eliminates fragile double-proxy in the critical path of every query
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 5    │ Unify dual schema declaration (either Drizzle or kysely-codegen) │ 4b-3      │ Medium   │ 706 lines of manually-synced schema definition across 2 files
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 6    │ Normalize movement/fee JSON columns into relational tables       │ 4b-4      │ Medium   │ Enables SQL queries on 6 JSON columns with proper indexing, at cost of migration effort
     │
     ├──────┼──────────────────────────────────────────────────────────────────┼───────────┼──────────┼────────────────────────────────────────────────────────────────────────────────────────────────
     ┤
     │ 7    │ Extract shared SQLite database factory                           │ 4a-3      │ Low      │ Prevents pragma drift between transactions.db and prices.db
     │
     └──────┴──────────────────────────────────────────────────────────────────┴───────────┴──────────┴────────────────────────────────────────────────────────────────────────────────────────────────
     ┘








     ---
     What V2 Keeps

     These patterns and tools earned their place and should carry forward unchanged:

     - Kysely as query builder. It provides genuine type safety, composes well with the Result<T, Error> pattern, handles CTEs and subqueries, and its sql template tag handles SQLite-specific feature
      cleanly. Drizzle is a viable alternative (4b-3) but Kysely is not causing friction in the queries themselves -- only in the mapping layer.
     - better-sqlite3 + SQLite + WAL mode. Perfect fit for a single-user CLI tool. Zero deployment burden, synchronous API simplifies error handling, tested at scale.
     - Two-database split (transactions.db / prices.db). Pragmatic separation of volatile development data from expensive-to-refetch price data.
     - Repository pattern with interfaces. The ITransactionRepository, IRawDataRepository, IImportSessionRepository interfaces enable testing with mocks. The BaseRepository class provides shared
     utilities. The pattern is clean.
     - Zod validation on database reads. For JSON columns, runtime validation on read is essential and correctly implemented. The parseWithSchema utility in BaseRepository handles this consistently.
     - FileMigrationProvider + Migrator. The Kysely migration infrastructure is properly set up and ready for incremental migrations when the project leaves development stage.
     - Result<T, Error> wrapping on all repository methods. Consistent error propagation without exceptions. Every repository method returns Result, and the wrapError utility from @exitbook/core is
     used uniformly.
