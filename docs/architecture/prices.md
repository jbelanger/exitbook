V2 Architecture Audit: @exitbook/price-providers

     Package stats: ~6,000 LOC production code, ~9,000 LOC tests, 6 providers, 2 direct dependencies (neverthrow, zod), 6 peer dependencies.

     ---
     2. Architectural Seams

     2a. Package boundary fitness

     What exists:
     The @exitbook/price-providers package contains the full vertical slice: provider interface, provider implementations, persistence layer
      (database, queries, migrations), manager/orchestrator, and manual price service. It depends on 6 peer packages but has only 2
     consumers: apps/cli (direct use of factory + manager) and packages/accounting (type-only import of PriceProviderManager).

     Assessment: The boundary is well-drawn. The package is cohesive -- everything inside serves the concern of "fetch, cache, and manage
     prices from external APIs." The accounting package's dependency is minimal (a single type import). No circular dependencies detected.
     No shotgun surgery pattern observed.

     No material issues found with package boundaries.

     2b. Dependency graph direction

     What exists:
     The graph flows cleanly:
     - core (types, Currency) -> http, resilience, sqlite, logger, events (infrastructure) -> price-providers (domain) -> accounting (higher
      domain) -> cli (app)

     No layering violations. price-providers does not import from accounting or cli. Infrastructure packages do not import domain packages.

     No material issues found.

     2c. Domain concept placement

     2c-1 Finding: ManualPriceService initializes its own database independently

     What exists:
     ManualPriceService at /Users/joel/Dev/exitbook/packages/price-providers/src/services/manual-price-service.ts creates and initializes
     its own database connection via createPricesDatabase + initializePricesDatabase on every call to ensureInitialized(). Meanwhile, the
     factory at /Users/joel/Dev/exitbook/packages/price-providers/src/core/factory.ts also initializes the same database during
     createPriceProviders().

     Why it's a problem:
     Two independent paths create connections to the same prices.db file. This is not a correctness issue with SQLite's locking, but it is a
      DX issue: the ManualPriceService does not reuse the already-initialized database that the factory created. If the database is already
     open, creating a second connection is wasteful. The saveManualPrice and saveManualFxRate convenience functions create a new
     ManualPriceService per call, meaning each manual price save opens a new DB connection.

     What V2 should do:
     Accept a PricesDB instance (or a PriceQueries instance) as a constructor parameter for ManualPriceService, removing its internal
     database initialization. The convenience functions should accept PricesDB instead of databasePath. This aligns with the "imperative
     shell" pattern used everywhere else in the package.

     Needs coverage:

     Current capability: Lazy initialization
     Covered by DI approach?: Yes
     Notes: Caller controls when DB is created
     ────────────────────────────────────────
     Current capability: Standalone usage without manager
     Covered by DI approach?: Partial
     Notes: Caller must create DB first; could provide a createStandalonePriceQueries() helper

     Surface: 1 file, ~50 lines of initialization code to remove

     Leverage: Low

     ---
     3. Pattern Re-evaluation

     3a. Pattern fitness



     3b. Pattern uniformity

     3c-1 Finding: Two-layer caching creates confusion

     What exists:
     There are two independent cache layers:
     1. Database cache (prices table via PriceQueries.savePrice/getPrice): Persistent across restarts. Checked inside each provider's
     fetchPriceInternal via BasePriceProvider.checkCache().
     2. In-memory cache (requestCache Map in PriceProviderManager): TTL-based (5 min default). Checked in PriceProviderManager.fetchPrice()
     before dispatching to any provider.

     Why it's a problem:
     The in-memory cache at the manager level uses a day-rounded key (createCacheKey rounds to day), while the database cache uses
     multi-granularity lookup (minute -> hour -> day). This means:
     - A minute-granularity price from Binance gets cached in memory with a day-rounded key, so a second request for the same asset on the
     same day but different minute returns the first minute's price from memory.
     - The 5-minute TTL is short enough that this is unlikely to cause problems in practice, but the semantics are inconsistent.

     What V2 should do:
     Either (a) remove the in-memory cache from PriceProviderManager and rely solely on the persistent database cache (simpler, one source
     of truth), or (b) make the in-memory cache granularity-aware by incorporating the actual timestamp (not day-rounded) into the cache
     key.

     Option (a) is preferred: the database cache is SQLite-backed and already fast for single-row lookups. The in-memory cache adds
     complexity for marginal latency benefit.

     Needs coverage:

     ┌──────────────────────────────────┬───────────────────────────┬─────────────────────────────────────────────────────────┐
     │        Current capability        │ Covered by DB-only cache? │                          Notes                          │
     ├──────────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Sub-millisecond repeated lookups │ No                        │ SQLite ~0.1-1ms per lookup; acceptable for CLI          │
     ├──────────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
     │ TTL-based expiry                 │ No                        │ DB cache is permanent (by design for price data)        │
     ├──────────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Memory-bounded                   │ Yes (improvement)         │ Removes unbounded Map growth                            │
     ├──────────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Cross-provider dedup             │ Yes                       │ DB already deduplicates by (asset, currency, timestamp) │
     └──────────────────────────────────┴───────────────────────────┴─────────────────────────────────────────────────────────┘

     Surface: 1 file (provider-manager.ts), ~30 lines of cache logic + timer

     Leverage: Medium

     ---
     5. Toolchain & Infrastructure

     Scoped to price-providers specifically:

     5a-5d. Build, runtime, test infrastructure, CI

     What exists:
     - TypeScript with tsc --noEmit for type checking (no bundling needed -- consumed as source via workspace protocol)
     - Vitest for testing, with both unit tests (*.test.ts) and e2e tests (*.e2e.test.ts)
     - 26 test files, ~9,000 LOC of tests for ~6,000 LOC of production code (1.5:1 ratio)

     Assessment: The toolchain is proportional to the package's complexity. No over-engineering. The test-to-code ratio is healthy. E2e
     tests are appropriately separated by naming convention.

     No material issues found within this package's scope.

     ---
     6. File & Code Organization

     6c. Module size

     6c-1 Finding: CoinGecko provider is the largest file at ~550 lines with multiple concerns

     What exists:
     /Users/joel/Dev/exitbook/packages/price-providers/src/providers/coingecko/provider.ts contains both the provider class (~250 lines) and
      the coin list sync logic (~100 lines). The coin list sync includes pagination, market cap ranking, and DB storage -- a distinct
     concern from price fetching.

     Why it's a problem:
     The syncCoinList method is ~100 lines of imperative logic (pagination, mapping, DB writes) embedded in the provider class. It is only
     called during initialize() but makes the file harder to scan. Other providers (Binance, CryptoCompare, ECB, etc.) are all under 300
     lines because they lack this sync concern.

     What V2 should do:
     Extract the coin list sync logic into a coingecko-sync.ts utility module within the same directory. The provider calls
     syncCoinList(httpClient, providerQueries, config) -- keeping it a pure function with explicit dependencies.

     Needs coverage:

     ┌─────────────────────────────┬────────────────────────┬──────────────────────────────────┐
     │     Current capability      │ Covered by extraction? │              Notes               │
     ├─────────────────────────────┼────────────────────────┼──────────────────────────────────┤
     │ Pagination of coin list     │ Yes                    │ Moves to utility                 │
     ├─────────────────────────────┼────────────────────────┼──────────────────────────────────┤
     │ Market cap priority mapping │ Yes                    │ Moves to utility                 │
     ├─────────────────────────────┼────────────────────────┼──────────────────────────────────┤
     │ DB persistence of mappings  │ Yes                    │ Takes providerQueries as param   │
     ├─────────────────────────────┼────────────────────────┼──────────────────────────────────┤
     │ Lazy sync (only when stale) │ Yes                    │ Staleness check stays in utility │
     └─────────────────────────────┴────────────────────────┴──────────────────────────────────┘

     Surface: 1 file, ~100 lines to extract

     Leverage: Low

     ---
     7. Error Handling & Observability

     7a-1 Finding: executeWithFailover is a 184-line monolith

     What exists:
     PriceProviderManager.executeWithFailover at /Users/joel/Dev/exitbook/packages/price-providers/src/core/provider-manager.ts lines
     172-356.

     Why it's a problem:
     The method handles 6 concerns in a single loop:
     1. Provider selection
     2. Circuit breaker evaluation
     3. Operation execution
     4. Health metric updates
     5. Result caching
     6. Error classification and aggregation

     Each concern is individually simple but the composition is hard to follow. The method's cyclomatic complexity is high due to nested
     if/try/catch/continue paths.

     What V2 should do:
     Split into smaller methods: tryProvider(provider, operation) handles execution + circuit breaker + health update for a single provider.
      classifyFailure(errors) handles the error aggregation at the end. cacheResult(query, result) handles the caching. The main loop
     becomes ~30 lines of orchestration.

     Note: The pure utility functions in provider-manager-utils.ts already handle most decision logic. The remaining refactor is extracting
     the imperative orchestration steps.

     Needs coverage:

     ┌──────────────────────────────────────────┬────────────────────────┬────────────────────────────────────────┐
     │            Current capability            │ Covered by extraction? │                 Notes                  │
     ├──────────────────────────────────────────┼────────────────────────┼────────────────────────────────────────┤
     │ Ordered provider iteration               │ Yes                    │ Main loop stays                        │
     ├──────────────────────────────────────────┼────────────────────────┼────────────────────────────────────────┤
     │ Circuit breaker bypass for last provider │ Yes                    │ In tryProvider                         │
     ├──────────────────────────────────────────┼────────────────────────┼────────────────────────────────────────┤
     │ Recoverable error tracking               │ Yes                    │ In classifyFailure                     │
     ├──────────────────────────────────────────┼────────────────────────┼────────────────────────────────────────┤
     │ Cache write on success                   │ Yes                    │ In cacheResult                         │
     ├──────────────────────────────────────────┼────────────────────────┼────────────────────────────────────────┤
     │ Debug logging                            │ Yes                    │ Each extracted method logs its concern │
     └──────────────────────────────────────────┴────────────────────────┴────────────────────────────────────────┘
