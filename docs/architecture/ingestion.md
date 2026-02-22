V2 Architecture Audit: @exitbook/ingestion

     Package scope: packages/ingestion/ -- 153 TypeScript files, ~19,800 LOC (production + test).

     ---
     1. Dependency Audit

     1.1 csv-filters-utils: Hand-Rolled Array Utilities

     What exists:
     /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-filters-utils.ts (80 LOC) implements filterCsvByField, filterCsvByFields,
      filterCsvByTimestamp, filterCsvByUid, and groupCsvByField. These are generic array filter/group functions with no CSV-specific logic.

     Why it's a problem:
     These are standard Array.prototype.filter and Map grouping patterns -- four one-liner wrappers over native JS. They add a module, its test file, and
     an import chain for zero type-safety or correctness benefit. A grep for csv-filters-utils shows zero import sites in production code (only the test
     file imports it). The code is dead.

     What V2 should do:
     Delete the module entirely. If needed, inline native array methods at call sites. Node 21+ has Object.groupBy / Map.groupBy natively.

     Needs coverage:

     ┌───────────────────────────┬─────────────────────────────┬───────┐
     │    Current capability     │   Covered by replacement?   │ Notes │
     ├───────────────────────────┼─────────────────────────────┼───────┤
     │ Filter by single field    │ Yes (native .filter)        │       │
     ├───────────────────────────┼─────────────────────────────┼───────┤
     │ Filter by multiple fields │ Yes (native .filter)        │       │
     ├───────────────────────────┼─────────────────────────────┼───────┤
     │ Filter by timestamp range │ Yes (native .filter)        │       │
     ├───────────────────────────┼─────────────────────────────┼───────┤
     │ Group by field            │ Yes (Map.groupBy or manual) │       │
     └───────────────────────────┴─────────────────────────────┴───────┘

     Surface: 2 files (utils + test), 0 production call-sites (dead code).

     Leverage: Low (dead code removal, but signals cleanup debt).

     ---
     1.2 csv-parse: Right-Sized Dependency

     What exists:
     csv-parse (sync mode) is imported in exactly one file: /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-parser-utils.ts.
     It is used only by the KuCoin CSV importer (importer-csv.ts).

     Why it's a problem:
     Not a significant problem. The package is well-maintained and the sync API is appropriate for the small CSV files expected from exchange exports.
     However, the entire file is read into memory (fs.readFile) before parsing, which would fail on multi-GB CSV exports. This is fine for current use
     (exchange CSVs are typically <100MB).

     What V2 should do:
     Keep csv-parse. If large CSV support becomes needed, switch from csv-parse/sync to the streaming csv-parse API. No action required today.

     Leverage: No issue.

     ---
     1.3 Zod Usage: Minimal Within Ingestion

     What exists:
     Zod is a direct dependency in package.json, but within ingestion itself, only 4 files import it:
     - processors.ts (schema definition for ProcessedTransactionSchema)
     - balance-command-status.ts (schema)
     - kucoin/utils.ts and kucoin/schemas.ts (KuCoin CSV validation)

     Most Zod usage comes transitively through @exitbook/core schemas.

     Why it's a problem:
     Not a significant problem. Zod is a reasonable choice for runtime validation in a financial system. The dependency is proportional to usage.

     What V2 should do:
     Keep Zod. No change.

     Leverage: No issue.

     ---
     2. Architectural Seams

     2.1 Module-Level Mutable Registry Singletons

     What exists:
     Two files hold module-scoped Map singletons as adapter registries:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts -- const adapters = new Map<string, BlockchainAdapter>()
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/exchange-adapter.ts -- const adapters = new Map<string, ExchangeAdapter>()

     Registration happens imperatively via registerAllBlockchains() / registerAllExchanges() called from the CLI entrypoint. Lookups happen via
     getBlockchainAdapter() / getExchangeAdapter() from ImportExecutor, TransactionProcessService, and register files.

     Why it's a problem:
     1. Hidden coupling via global state. Any code can call getBlockchainAdapter() without an explicit dependency on the registry. This makes dependency
     injection impossible and test isolation fragile (requires clearBlockchainAdapters() between tests).
     2. No guarantee of initialization order. If getBlockchainAdapter() is called before registerAllBlockchains(), it silently returns undefined. The error
      surfaces only at runtime, deep in the import flow.
     3. The createProcessor signature on BlockchainAdapter has grown to 5 optional parameters (providerManager, tokenMetadataService, scamDetectionService,
      rawDataQueries, accountId) -- this is a symptom of the registry pattern forcing all configuration through a single factory closure.

     What V2 should do:
     Replace module-level singletons with an explicit AdapterRegistry class passed via constructor injection. Each service that needs adapters receives the
      registry as a dependency. This eliminates global state, makes initialization explicit, and allows the createProcessor factory to take a typed context
      object instead of positional optionals.

     Needs coverage:

     ┌──────────────────────────────┬─────────────────────────┬────────────────────────────────────────────────┐
     │      Current capability      │ Covered by replacement? │                     Notes                      │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ Lazy registration at startup │ Yes                     │ Explicit registry.register()                   │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ Lookup by name               │ Yes                     │ registry.get(name)                             │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ List all registered          │ Yes                     │ registry.getAll()                              │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ Test isolation (clear)       │ Yes                     │ Create new registry per test                   │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────┤
     │ Global access from any file  │ Partial                 │ Must be passed explicitly -- this is the point │
     └──────────────────────────────┴─────────────────────────┴────────────────────────────────────────────────┘

     Surface: 2 registry files, 8 blockchain register files, 3 exchange register files, ImportExecutor, TransactionProcessService -- ~15 files total.

     Leverage: High -- affects test isolation, initialization safety, and the growing createProcessor parameter list.

     ---
     2.2 NEAR Special-Casing in TransactionProcessService

     What exists:
     /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts contains two NEAR-specific if branches (lines 242-244 and 462-469)
      that create NearRawDataQueries and NearStreamBatchProvider. The NEAR queries object is cast via as unknown as RawDataQueries (line 468).

     Why it's a problem:
     1. The as unknown as RawDataQueries cast discards type safety in a financial data path. If NearRawDataQueries diverges from RawDataQueries, data
     corruption happens silently.
     2. Process service contains knowledge of specific blockchain implementations. Adding another blockchain with special storage needs requires modifying
     the service directly (shotgun surgery).
     3. The batch provider selection (createBatchProvider) and processor selection (getProcessor) both branch on source name, creating parallel conditional
      trees.

     What V2 should do:
     Move batch provider selection and query specialization into the BlockchainAdapter interface. Each blockchain adapter would expose a
     createBatchProvider(rawDataQueries, db, accountId) method (or return a typed queries interface that satisfies a common contract). The process service
     would call adapter.createBatchProvider() without knowing which blockchain it is.

     Needs coverage:

     ┌───────────────────────────────────────┬─────────────────────────┬──────────────────────────┐
     │          Current capability           │ Covered by replacement? │          Notes           │
     ├───────────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Hash-grouped batching for blockchains │ Yes                     │ Default in base adapter  │
     ├───────────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ All-at-once for exchanges             │ Yes                     │ Exchange adapter default │
     ├───────────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ NEAR multi-stream batching            │ Yes                     │ NEAR adapter override    │
     ├───────────────────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ NearRawDataQueries injection          │ Yes                     │ Adapter receives db      │
     └───────────────────────────────────────┴─────────────────────────┴──────────────────────────┘

     Surface: 1 file (process-service.ts), ~30 lines affected. Adapter interface changes touch all 8 register files.

     Leverage: High -- eliminates unsafe cast, prevents shotgun surgery for future blockchain-specific storage patterns.

     ---
     2.3 Balance Service Does Not Belong in Ingestion

     What exists:
     /Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/ contains 6 files (~1,500 LOC):
     - balance-service.ts (675 LOC) -- orchestrates live balance fetch + calculated balance comparison
     - balance-calculator.ts (93 LOC) -- pure function summing transaction movements
     - balance-utils.ts (500 LOC) -- fetches live balances from providers and exchanges
     - balance-verifier.ts, balance-verifier.types.ts, balance-command-status.ts

     Why it's a problem:
     Balance verification is conceptually independent from ingestion (importing + processing raw data). It depends on @exitbook/exchange-providers (to
     create exchange clients for live balance fetching), which is a peer dependency of ingestion. The balance service imports createExchangeClient
     directly. This means the ingestion package has a hidden runtime dependency on exchange-providers for a non-core feature.

     The BalanceService class has 5 constructor parameters and orchestrates concerns spanning three domains: account management, transaction querying, and
     live provider interaction. Its 675 LOC makes it the second-largest file in the package.

     What V2 should do:
     Extract balance verification into its own package (@exitbook/balance or similar) or move it to the CLI layer as an orchestration concern. The balance
     calculator (pure function) could remain in ingestion or move to @exitbook/core.

     Needs coverage:

     ┌─────────────────────────────────────┬─────────────────────────┬───────────────────────────────────────────┐
     │         Current capability          │ Covered by replacement? │                   Notes                   │
     ├─────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Calculate balance from transactions │ Yes                     │ Pure function, movable anywhere           │
     ├─────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Fetch live exchange balance         │ Yes                     │ Direct dependency on exchange-providers   │
     ├─────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Fetch live blockchain balance       │ Yes                     │ Direct dependency on blockchain-providers │
     ├─────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Compare and report discrepancies    │ Yes                     │ Pure logic                                │
     ├─────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Persist verification results        │ Yes                     │ Depends on account queries                │
     └─────────────────────────────────────┴─────────────────────────┴───────────────────────────────────────────┘

     Surface: 6 files (~1,500 LOC), re-exported from index.ts (11 export lines).

     Leverage: Medium -- reduces ingestion scope, clarifies package purpose, eliminates hidden exchange-providers coupling.

     ---
     2.4 createProcessor Parameter Explosion

     What exists:
     The BlockchainAdapter.createProcessor signature in /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts (lines 20-26):
     createProcessor: (
       providerManager: BlockchainProviderManager,
       tokenMetadataService?: ITokenMetadataService,
       scamDetectionService?: IScamDetectionService,
       rawDataQueries?: RawDataQueries,
       accountId?: number
     ) => Result<ITransactionProcessor, Error>;

     Five parameters, four optional, with varying usage across blockchains:
     - EVM: requires tokenMetadataService, uses providerManager and scamDetectionService
     - Bitcoin: uses only scamDetectionService
     - NEAR: uses rawDataQueries and accountId (unique)
     - Cosmos, Substrate, XRP: use tokenMetadataService optionally

     Why it's a problem:
     Adding any new processor dependency requires modifying the interface, all 8 register files, and the process service. The optionality makes it unclear
     which combinations are valid. The NEAR adapter's need for rawDataQueries and accountId forced these into the common interface even though no other
     blockchain uses them.

     What V2 should do:
     Replace positional parameters with a typed context object:
     interface ProcessorContext {
       providerManager: BlockchainProviderManager;
       tokenMetadataService?: ITokenMetadataService;
       scamDetectionService?: IScamDetectionService;
       rawDataQueries?: RawDataQueries;
       db?: KyselyDB;
       accountId?: number;
     }
     createProcessor: (context: ProcessorContext) => Result<ITransactionProcessor, Error>;
     Adding new context fields becomes non-breaking. Each adapter destructures only what it needs.

     Needs coverage:

     ┌───────────────────────┬─────────────────────────┬──────────────────────────────────────────┐
     │  Current capability   │ Covered by replacement? │                  Notes                   │
     ├───────────────────────┼─────────────────────────┼──────────────────────────────────────────┤
     │ Pass all dependencies │ Yes                     │ Single object parameter                  │
     ├───────────────────────┼─────────────────────────┼──────────────────────────────────────────┤
     │ Optional dependencies │ Yes                     │ Optional object fields                   │
     ├───────────────────────┼─────────────────────────┼──────────────────────────────────────────┤
     │ Type safety           │ Yes                     │ Same types                               │
     ├───────────────────────┼─────────────────────────┼──────────────────────────────────────────┤
     │ Extensibility         │ Improved                │ New fields don't break existing adapters │
     └───────────────────────┴─────────────────────────┴──────────────────────────────────────────┘

     Surface: 1 interface, 8 register files, process-service.ts -- ~12 files.

     Leverage: Medium -- reduces interface churn and makes the API self-documenting.

     ---
     3. Pattern Re-evaluation

     3.1 neverthrow Result Types: Earned Their Place

     What exists:
     78 files import neverthrow. Every fallible operation returns Result<T, Error>. The pattern is applied uniformly across importers, processors,
     services, and queries.

     Assessment:
     The Result type pattern is well-suited for a financial system where silent failure means data corruption. The codebase applies it consistently. Error
     messages are detailed and include context ("This would corrupt portfolio calculations"). The pattern composes well with the async streaming import
     flow.

     One friction point: okAsync is used in correlating-exchange-processor.ts line 151 (return okAsync(transactions)) where plain ok() would suffice
     (already in an async function). This is harmless but slightly misleading.

     What V2 should do:
     Keep neverthrow. No change.

     Leverage: No issue.

     ---
     3.2 Strategy Pattern for Exchange Processing: Well-Designed

     What exists:
     Exchange processing uses composable strategies:
     - GroupingStrategy (byCorrelationId, byTimestamp, noGrouping)
     - InterpretationStrategy (standardAmounts, coinbaseGrossAmounts)

     CorrelatingExchangeProcessor composes these strategies. DefaultExchangeProcessor and CoinbaseProcessor extend it with different strategy combinations.

     Assessment:
     This is one of the strongest architectural patterns in the package. It cleanly separates concerns: how entries are grouped vs. how amounts are
     interpreted. Adding a new exchange requires choosing or implementing strategies, not modifying the base processor. The strategy interfaces are small
     and testable.

     What V2 should do:
     Keep this pattern. Consider converting CorrelatingExchangeProcessor from class inheritance to composition (pass strategies without extending), but the
      current approach works and the inheritance tree is shallow (max 2 levels).

     Leverage: No issue.

     ---
     3.3 BaseTransactionProcessor Inheritance: Adequate but Rigid

     What exists:
     /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/base-transaction-processor.ts (198 LOC) provides:
     - Template method pattern (process() calls abstract processInternal())
     - Post-processing: zero-value contract interaction filtering, Zod validation
     - Scam detection application (applyScamDetection())
     - Logging

     12 concrete processors extend it.

     Why it's a problem (mild):
     The inheritance forces all processors through the same post-processing pipeline. If a processor needs different validation (e.g., skip zero-value
     filtering for a specific blockchain), it cannot opt out without overriding private methods. Currently this has not been a problem, but the private
     post-processing methods prevent extension.

     What V2 should do:
     Make post-processing steps composable (pipeline of functions) rather than hardcoded in the base class. This is a minor enhancement -- the current
     design works for all existing processors.

     Leverage: Low.

     ---
     4. Data Layer

     4.1 Process Service Receives Both RawDataQueries AND KyselyDB

     What exists:
     TransactionProcessService constructor takes 8 parameters including both rawDataQueries: RawDataQueries and db: KyselyDB. The db is needed solely to
     create NearRawDataQueries (lines 243, 463).

     Why it's a problem:
     Receiving both a query abstraction and the raw database handle breaks the abstraction boundary. The service should not need to know about the
     underlying database to create specialized queries -- that responsibility belongs to the adapter layer (see finding 2.2).

     What V2 should do:
     Eliminate the db parameter from TransactionProcessService. Push NEAR-specific query creation into the NEAR adapter's createProcessor or
     createBatchProvider method. The service should only receive abstract query interfaces.

     Surface: 1 constructor, 2 call sites (where TransactionProcessService is instantiated).

     Leverage: Medium -- strengthens abstraction boundaries.

     ---
     4.2 normalizeRawData Branches on sourceType String

     What exists:
     TransactionProcessService.normalizeRawData() (lines 489-536) branches on sourceType === 'exchange-api' || sourceType === 'exchange-csv' to determine
     how to unwrap raw data. Exchange data gets wrapped in { raw, normalized, eventId }. Blockchain data gets validated against
     NormalizedTransactionBaseSchema.

     Why it's a problem:
     The normalization logic is tightly coupled to the process service and uses string matching on source types. This is a transformation concern that
     should live closer to the data source. If a new source type is added (e.g., "manual-entry"), this method needs modification.

     What V2 should do:
     Move normalization into the adapter interface. Each adapter would implement normalizeRawData(items: RawTransaction[]): Result<unknown[], Error> with
     source-specific logic. The process service calls it polymorphically.

     Surface: 1 method (~50 LOC), would touch adapter interface + all register files.

     Leverage: Medium -- eliminates string-matching and makes the process service source-agnostic.

     ---
     5. Toolchain & Infrastructure

     5.1 Test Infrastructure is Well-Structured

     What exists:
     - 49 test files with good coverage across processors, importers, and pure utility functions
     - Shared test utilities in /Users/joel/Dev/exitbook/packages/ingestion/src/shared/test-utils/ with assertion helpers, mock factories, test constants,
     and fluent entry builders
     - Pattern: pure functions tested without mocks (*-utils.test.ts), classes tested with mocked dependencies

     Assessment:
     The test infrastructure is one of the package's strengths. The ExchangeEntryBuilder, BitcoinTransactionBuilder, etc. provide a clean fluent API for
     constructing test data. The expectMovement, expectFee, expectOperation assertion helpers reduce test boilerplate while keeping assertions readable.

     What V2 should do:
     Keep this pattern. No change needed.

     Leverage: No issue.

     ---
     5.2 Peer Dependencies as De Facto Hard Dependencies

     What exists:
     package.json declares @exitbook/blockchain-providers, @exitbook/core, @exitbook/data, @exitbook/exchange-providers, and @exitbook/logger as
     peerDependencies. In practice, these are always present (this is a private monorepo package, not published to npm).

     Why it's a problem (mild):
     Using peerDependencies for internal monorepo packages is unconventional. It works because pnpm resolves workspace dependencies, but it means:
     1. The package's actual dependency graph is invisible to tools that analyze dependencies.
     2. pnpm install won't error if a peer is missing -- the error surfaces only at build/runtime.

     What V2 should do:
     Move workspace peers to dependencies for internal packages. Keep peerDependencies only for packages intended for external consumption. This is a
     monorepo-wide decision, not ingestion-specific.

     Leverage: Low.

     ---
     6. File & Code Organization

     6.1 Large processor-utils Files

     What exists:
     Five processor-utils.ts files exceed 400 LOC:
     - near/processor-utils.ts: 945 LOC
     - solana/processor-utils.ts: 845 LOC
     - kucoin/processor-utils.ts: 844 LOC
     - evm/processor-utils.ts: 664 LOC
     - substrate/processor-utils.ts: 503 LOC

     Why it's a problem:
     These files serve as the functional core for each blockchain/exchange processor. The size is proportional to the complexity of each chain's
     transaction model (NEAR has receipts + function calls + staking; Solana has instruction parsing). Each file is internally cohesive -- the functions
     are related and compose together.

     The real question is whether 945 LOC of pure functions in a single file is a problem. For pure functions with extensive test coverage, it's
     acceptable. The alternative (splitting into multiple files per blockchain) would scatter related logic without clear benefit.

     What V2 should do:
     No change required. These files are large because the domain is complex, not because they lack cohesion. If any single file grows past ~1,200 LOC,
     split along natural function groupings (e.g., separate staking utils from transfer utils in NEAR).

     Leverage: No issue.

     ---
     6.2 Consistent Vertical Slice Organization

     What exists:
     Each blockchain is organized as:
     sources/blockchains/<chain>/
       register.ts          -- adapter registration
       importer.ts          -- IImporter implementation
       processor.ts         -- BaseTransactionProcessor subclass
       processor-utils.ts   -- pure processing functions
       types.ts             -- chain-specific types
       __tests__/           -- tests

     Each exchange follows a similar pattern with register.ts, importers, processors, schemas, and tests.

     Assessment:
     This organization is exemplary. Adding a new blockchain or exchange requires creating a self-contained directory with predictable file names. The
     pattern makes it immediately obvious where code belongs.

     What V2 should do:
     Keep this pattern. No change.

     Leverage: No issue.

     ---
     7. Error Handling & Observability

     7.1 Event System: Well-Designed but Verbose Type Definitions

     What exists:
     /Users/joel/Dev/exitbook/packages/ingestion/src/events.ts (307 LOC) defines discriminated union types for all ingestion events: ImportEvent,
     ProcessEvent, TokenMetadataEvent, ScamDetectionEvent. Each event variant has extensive JSDoc comments explaining when and where it's emitted.

     The @exitbook/events package is a zero-dependency wrapper providing a typed EventBus<T> class. 8 files in ingestion import it.

     Assessment:
     The event system enables clean decoupling between the ingestion pipeline and the CLI dashboard. Events carry enough context for progress display. The
     discriminated union type ensures event handlers are exhaustive.

     Three event types are marked "RESERVED: defined but not currently emitted" (process.batch, process.group.processing, process.skipped). These are
     forward declarations for future observability, which is reasonable.

     What V2 should do:
     Keep the event system. Consider extracting the event type definitions into a shared location if other packages need to consume them, but currently
     only the CLI consumes them, so the current placement in ingestion is correct.

     Leverage: No issue.

     ---
     7.2 Error Context is Thorough

     What exists:
     Error messages throughout the package include:
     - Account IDs and batch numbers for traceability
     - Explicit corruption risk warnings ("This would corrupt portfolio calculations")
     - Source names and stream types for debugging
     - The checkForIncompleteImports guard prevents processing during active imports

     The wrapError utility from @exitbook/core is used consistently for catch blocks, preserving stack traces.

     Assessment:
     Error handling is one of the package's strengths. The financial-system mindset is evident: errors fail loudly, partial processing is rejected, and the
      impact of data loss is communicated clearly.

     One minor gap: BalanceService.verifyBalance() catches at the top level with wrapError(error, 'Failed to verify balance'), which could swallow context
     from deeply nested errors. But this is in a read-only verification path, not a data mutation path, so the risk is low.

     What V2 should do:
     Keep the current approach. No change.

     Leverage: No issue.

     ---
     V2 Decision Summary

     Rank: 1
     Change: Replace module-level mutable registry singletons with injected AdapterRegistry
     Dimension: 2. Architectural Seams
     Leverage: High
     One-line Rationale: Eliminates global state, enables test isolation without clear*() hacks, makes initialization order explicit
     ────────────────────────────────────────
     Rank: 2
     Change: Move NEAR special-casing from TransactionProcessService into BlockchainAdapter interface
     Dimension: 2. Architectural Seams
     Leverage: High
     One-line Rationale: Eliminates as unknown as RawDataQueries unsafe cast and prevents shotgun surgery for future chain-specific storage
     ────────────────────────────────────────
     Rank: 3
     Change: Replace createProcessor positional parameters with a typed context object
     Dimension: 2. Architectural Seams
     Leverage: Medium
     One-line Rationale: Stops the 5-parameter positional optional drift, makes adding new dependencies non-breaking
     ────────────────────────────────────────
     Rank: 4
     Change: Remove db: KyselyDB from TransactionProcessService constructor
     Dimension: 4. Data Layer
     Leverage: Medium
     One-line Rationale: Service should not hold both the abstraction and the underlying database handle
     ────────────────────────────────────────
     Rank: 5
     Change: Move normalizeRawData into the adapter interface
     Dimension: 4. Data Layer
     Leverage: Medium
     One-line Rationale: Eliminates source-type string matching in the process service
     ────────────────────────────────────────
     Rank: 6
     Change: Extract balance verification into its own package
     Dimension: 2. Architectural Seams
     Leverage: Medium
     One-line Rationale: Clarifies ingestion's purpose (import + process), removes hidden exchange-providers coupling
     ────────────────────────────────────────
     Rank: 7
     Change: Delete dead csv-filters-utils.ts
     Dimension: 1. Dependency Audit
     Leverage: Low
     One-line Rationale: Zero production call-sites; pure noise
     ────────────────────────────────────────
     Rank: 8
     Change: Move workspace peers to dependencies
     Dimension: 5. Toolchain
     Leverage: Low
     One-line Rationale: Monorepo-wide convention change for clearer dependency graphs

     ---
     What V2 Keeps

     The following patterns and tools have earned their place and should carry forward unchanged:

     - neverthrow Result types. 78 files, uniformly applied, appropriate for a financial system where silent failure means data corruption.
     - Strategy pattern for exchange processing. GroupingStrategy + InterpretationStrategy composition is clean, testable, and extensible.
     - Vertical slice directory organization. Each blockchain/exchange is a self-contained directory with predictable file structure. Makes onboarding and
     new source addition frictionless.
     - Event-driven CLI decoupling. Typed discriminated union events with thorough JSDoc. Clean separation between pipeline and display.
     - Shared test utilities. Fluent builders (ExchangeEntryBuilder, BitcoinTransactionBuilder), assertion helpers (expectMovement, expectFee), and mock
     factories reduce test boilerplate while maintaining readability.
     - csv-parse. Right-sized dependency for exchange CSV import. Used in exactly one file.
     - Zod for runtime validation. Proportional usage, appropriate for validating financial data at processor boundaries.
     - Functional core / imperative shell. Pure *-utils.ts files tested without mocks alongside classes with injected dependencies. The separation is
     consistent and well-maintained.
     - Error messages with corruption risk context. "This would corrupt portfolio calculations" is the right level of alarm for a financial data pipeline.
