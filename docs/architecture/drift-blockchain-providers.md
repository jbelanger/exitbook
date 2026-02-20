V2 Architecture Audit: @exitbook/blockchain-providers

     Scope: packages/blockchain-providers (295 source files, ~28k LOC non-test)

     ---
     1. Dependency Audit

    1b. Over-dependency

     [1b-1] Heavy crypto dependencies used for address derivation only

     What exists:
     Four chain-specific cryptography packages are declared as dependencies:
     - @cardano-sdk/core + @cardano-sdk/crypto -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/cardano/utils.ts)
     - @polkadot/util-crypto -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/substrate/utils.ts)
     - bitcoinjs-lib + @scure/bip32 -- used in 2 files (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/bitcoin/utils.ts,
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/bitcoin/network-registry.ts)
     - bech32 -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/cosmos/utils.ts)

     Why it's a problem:
     These are large dependency trees (especially @cardano-sdk and @polkadot) pulled into every installation of this package. They are used exclusively for xpub-to-address derivation
      and address validation -- functionality that is consumed by exactly one caller (the gap scanning flow). This inflates install size and introduces native compilation
     requirements (libsodium for Cardano) for all consumers, even those who never use xpub derivation.

     What V2 should do:
     Extract address derivation into a separate @exitbook/address-derivation package. The blockchain-providers package would depend on it only for the gap-scan flow, and the heavy
     crypto libraries would be scoped to a smaller boundary that most consumers never import.

     Needs coverage:

     ┌────────────────────────────┬────────────────────────┬───────────────────────────────┐
     │     Current capability     │ Covered by separation? │             Notes             │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Bitcoin xpub derivation    │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Cardano address derivation │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Substrate SS58 encoding    │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Cosmos bech32 encoding     │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ API client address masking │ Yes                    │ Stays in blockchain-providers │
     └────────────────────────────┴────────────────────────┴───────────────────────────────┘

     Surface: ~6 files, 4 dependency declarations affected

     Leverage: Medium -- reduces install footprint and build complexity; no correctness improvement.

     1b-2] better-sqlite3 + kysely as direct dependencies

     What exists:
     The blockchain-providers package.json declares better-sqlite3 and kysely as direct dependencies. They are used only in
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/persistence/database.ts and the persistence layer (~5 files) for provider stats storage.

     Why it's a problem:
     This is a provider/API client package that should not own database infrastructure. The @exitbook/data package already exists as a peer dependency and is the canonical home for
     database concerns. Having two packages independently creating SQLite connections and running migrations creates split ownership of the data layer.

     What V2 should do:
     Move provider stats persistence into @exitbook/data and inject a query interface into the provider manager. Remove better-sqlite3 and kysely from this package's direct
     dependencies.

     Needs coverage:

     ┌──────────────────────────┬────────────────────────┬───────────────────────────────────────────────────────────────┐
     │    Current capability    │ Covered by extraction? │                             Notes                             │
     ├──────────────────────────┼────────────────────────┼───────────────────────────────────────────────────────────────┤
     │ Provider stats CRUD      │ Yes                    │ Query interface stays, implementation moves to @exitbook/data │
     ├──────────────────────────┼────────────────────────┼───────────────────────────────────────────────────────────────┤
     │ Migration management     │ Yes                    │ Consolidates with other migration paths                       │
     ├──────────────────────────┼────────────────────────┼───────────────────────────────────────────────────────────────┤
     │ WAL mode / pragma config │ Yes                    │ Handled centrally                                             │
     └──────────────────────────┴────────────────────────┴───────────────────────────────────────────────────────────────┘

     Surface: ~5 files in persistence/, database.ts, schema.ts, migrations/, queries

     Leverage: Medium -- cleaner separation of concerns, fewer native dependencies in this package.

     ---
     2. Architectural Seams

     [2b] Package boundary: persistence layer belongs elsewhere

     What exists:
     The persistence/ directory (database.ts, schema.ts, migrations/, queries/, provider-stats-utils.ts) inside blockchain-providers manages its own SQLite database (providers.db)
     with Kysely.

     Why it's a problem:
     This creates a second database lifecycle alongside the main @exitbook/data package. The blockchain-providers package -- conceptually an API client + coordination layer -- is
     also a database owner, which is a boundary violation. The ProviderStatsStore already uses an injected ProviderStatsQueries interface, meaning the data access is already
     abstracted; only the wiring lives in the wrong package.

     What V2 should do:
     Move persistence/ into @exitbook/data. The blockchain-providers package keeps ProviderStatsStore with its injected queries interface (already the case). The database creation,
     migration, and schema definition move to the data package.

     Needs coverage:

     ┌───────────────────────────────┬──────────┬──────────────────────────────────────────────────┐
     │      Current capability       │ Covered? │                      Notes                       │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────────────────┤
     │ Provider stats queries        │ Yes      │ Interface already abstract; implementation moves │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────────────────┤
     │ Separate providers.db         │ Yes      │ Data package manages all databases               │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────────────────┤
     │ Stats persistence across runs │ Yes      │ Unchanged behavior                               │
     └───────────────────────────────┴──────────┴──────────────────────────────────────────────────┘

     Surface: ~7 files in persistence/

     Leverage: Medium -- reduces coupling and consolidates database management.

     [2d] Registration is manual, not decorator-based

     What exists:
     CLAUDE.md mentions @RegisterApiClient decorators, but grep confirms zero uses. Registration is done via explicit factory arrays in register-apis.ts files (e.g.,
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/register-apis.ts), which are aggregated in
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/register-apis.ts.

     Why it's a problem (minor):
     The CLAUDE.md documentation is stale. The actual pattern -- explicit factory arrays imported and concatenated -- is straightforward and debuggable. However, adding a new
     provider requires editing two files: the provider file and the blockchain's register-apis.ts. This is a minor friction point, not a bug.

     What V2 should do:
     Keep the explicit factory registration pattern (it is simpler and more debuggable than decorators). Update CLAUDE.md to reflect reality. Consider barrel-exporting factories from
      each provider directory to reduce the register-apis.ts boilerplate.

     Surface: 8 register-apis.ts files + 1 aggregation file

     Leverage: Low -- documentation fix, minor ergonomic improvement.

     ---
     3. Pattern Re-evaluation

     [3a] execute<T> with switch-case dispatch

     What exists:
     Every BaseApiClient implementation has an execute<T>(operation: OneShotOperation) method containing a switch statement that dispatches on operation.type:
     - /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/providers/alchemy/alchemy.api-client.ts (lines 234-261)
     - /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/bitcoin/providers/blockstream/blockstream-api-client.ts (lines 118-135)
     - Every other API client follows the same pattern.

     The return type is Promise<Result<T, Error>> with an unsafe cast as Result<T, Error> at each case.

     Why it's a problem:
     The T generic is unconstrained and always casted. This means execute<string>(getBalanceOperation) compiles even though getBalance returns RawBalanceData. The type safety is
     illusory. Additionally, every provider duplicates the same switch boilerplate.

     What V2 should do:
     Replace the single execute<T> method with typed operation-specific methods on the interface:
     interface IBlockchainProvider {
       getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>>;
       getTokenMetadata(contracts: string[]): Promise<Result<TokenMetadata[], Error>>;
       // etc.
     }
     The ProviderManager would call the specific method, eliminating the switch and the unsafe generic cast. Providers that don't support an operation simply don't implement the
     optional method (or return an error).

     Needs coverage:

     ┌──────────────────────────────┬──────────┬─────────────────────────────────────────────────────────────────────────────────────────┐
     │      Current capability      │ Covered? │                                          Notes                                          │
     ├──────────────────────────────┼──────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
     │ Dynamic operation dispatch   │ Yes      │ Manager calls typed methods based on operation type                                     │
     ├──────────────────────────────┼──────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
     │ Provider capability checking │ Yes      │ supportsOperation becomes typeof provider.getBalance === 'function' or capability flags │
     ├──────────────────────────────┼──────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
     │ Caching via getCacheKey      │ Yes      │ Remains on the operation object                                                         │
     └──────────────────────────────┴──────────┴─────────────────────────────────────────────────────────────────────────────────────────┘

     Surface: ~25 API client files, 1 interface file, provider-manager dispatch logic

     Leverage: High -- eliminates unsafe casts and boilerplate in every provider.

     [3e] Streaming adapter pattern -- well-designed but complex

     What exists:
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/streaming/streaming-adapter.ts provides createStreamingIterator, a generic pagination engine. Providers supply
     fetchPage and mapItem callbacks. The adapter handles dedup, cursor building, replay windows, and completion detection.

     Why it's a problem (minor):
     The StreamingAdapterOptions interface has 10 fields including optional hooks (derivePageParams, applyReplayWindow). This is necessary complexity for the domain (cross-provider
     failover with heterogeneous pagination), but the interface could benefit from a builder pattern or sensible defaults object to reduce the boilerplate at call sites.

     What V2 should do:
     Keep the adapter. Consider grouping optional hooks into a paginationStrategy object to reduce top-level option sprawl. This is polish, not a structural change.

     Surface: 1 core file, ~25 call sites

     Leverage: Low -- the current design works; improvements are ergonomic.

     ---


     ---
     5. Toolchain & Infrastructure

     [5c] Test infrastructure

     What exists:
     102 test files split between 61 unit tests and 41 e2e tests. E2e tests hit real APIs (gated by .env keys). Unit tests are pure-function focused (*-utils.test.ts,
     mapper-utils.test.ts).

     Why it's a problem (minor):
     The e2e tests are valuable for validating API contracts but slow and non-deterministic. There is no recorded/replay HTTP layer (e.g., nock, msw, or polly.js) that would allow
     testing API client logic without network calls.

     What V2 should do:
     Consider adding HTTP recording/replay for provider API client tests. This would allow testing the full client stack (schema validation, mapping, error handling) without
     requiring API keys or network access. The e2e tests would remain as smoke tests run less frequently.

     Needs coverage:

     ┌───────────────────────────┬──────────┬─────────────────────────────────┐
     │    Current capability     │ Covered? │              Notes              │
     ├───────────────────────────┼──────────┼─────────────────────────────────┤
     │ Real API validation       │ Yes      │ E2e tests remain as smoke tests │
     ├───────────────────────────┼──────────┼─────────────────────────────────┤
     │ Schema validation testing │ Yes      │ Replay captures real responses  │
     ├───────────────────────────┼──────────┼─────────────────────────────────┤
     │ Mapper testing            │ Yes      │ Already covered by unit tests   │
     └───────────────────────────┴──────────┴─────────────────────────────────┘

     Surface: 41 e2e test files could gain replay equivalents

     Leverage: Medium -- improves CI reliability and developer onboarding (no API keys needed for most tests).

     ---
     6. File & Code Organization



     [6b] Naming conventions -- consistent

     Files follow <entity>.<concern>.ts (e.g., alchemy.api-client.ts, alchemy.schemas.ts, alchemy.mapper-utils.ts). The pattern is consistent across all 8 blockchain families. Test
     files use *.test.ts for unit and *.e2e.test.ts for integration.

     No material issues found.

     ---
     7. Error Handling & Observability


     [7b] Silent failure paths

     What exists:
     In alchemy.api-client.ts (line 714-717), when a single transaction fails to map, it returns ok([]) instead of err(), silently dropping the transaction from the stream. The skip
     rate is monitored (lines 708-713) and warns above 5%, which is good.

     Across the codebase, the pattern is consistent: mapper errors in streaming contexts are logged and skipped rather than failing the stream. This is a deliberate design choice for
      resilience (one bad transaction should not abort import of thousands).

     Why it's a problem (minor):
     The skip-on-map-failure pattern is reasonable for resilience, but the caller (import service) has no structured signal about how many transactions were skipped. The BatchStats
     type tracks deduplicated but not skipped_due_to_errors. This could mask data quality issues.

     What V2 should do:
     Add a mapErrors: number field to BatchStats / StreamingBatchResult so the import service can surface "X transactions skipped due to data quality issues" in a structured way.

     Needs coverage:

     ┌─────────────────────────┬──────────┬─────────────────────────────────────┐
     │   Current capability    │ Covered? │                Notes                │
     ├─────────────────────────┼──────────┼─────────────────────────────────────┤
     │ Resilient streaming     │ Yes      │ Skip behavior unchanged             │
     ├─────────────────────────┼──────────┼─────────────────────────────────────┤
     │ Error logging           │ Yes      │ Logger.warn remains                 │
     ├─────────────────────────┼──────────┼─────────────────────────────────────┤
     │ Data quality visibility │ Improved │ Structured count surfaces to caller │
     └─────────────────────────┴──────────┴─────────────────────────────────────┘

     Surface: BatchStats type, streaming adapter, ~25 provider mapItem callbacks

     Leverage: Medium -- improves observability for a financial accuracy system.

     [7c] Observability readiness

     What exists:
     The ProviderEvent type system (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/events.ts) provides 9 event types covering request lifecycle, provider selection,
     failover, rate limiting, circuit breaker state, and cursor adjustments. The InstrumentationCollector (from @exitbook/http) is injected for HTTP-level tracking.

     Why it's a problem:
     This is actually well-designed for a CLI tool. The event bus provides structured telemetry that the CLI dashboard consumes. For a production service, you would want
     OpenTelemetry traces, but for a local CLI, the current approach is proportional.

     No material issues found.

     ---
     V2 Decision Summary

     Rank: 1
     Change: Replace execute<T> switch dispatch with typed operation methods
     Dimension: 3 (Patterns)
     Leverage: High
     One-line Rationale: Eliminates unsafe generic casts and boilerplate in every provider
     ────────────────────────────────────────
     Rank: 2
     Change: Add mapErrors to BatchStats for structured skip tracking
     Dimension: 7 (Observability)
     Leverage: Medium
     One-line Rationale: Financial system should surface data quality issues structurally
     ────────────────────────────────────────
     Rank: 3
     Change: Move persistence layer to @exitbook/data
     Dimension: 2 (Seams)
     Leverage: Medium
     One-line Rationale: Consolidates database ownership; removes sqlite/kysely from provider deps
     ────────────────────────────────────────
     Rank: 4
     Change: Extract address derivation crypto deps into separate package
     Dimension: 1 (Dependencies)
     Leverage: Medium
     One-line Rationale: Reduces install footprint; heavy crypto deps scoped to opt-in boundary
     ────────────────────────────────────────
     Rank: 5
     Change: Add HTTP replay/recording for provider tests
     Dimension: 5 (Toolchain)
     Leverage: Medium
     One-line Rationale: CI reliability without API keys; faster test cycles
     ────────────────────────────────────────
     Rank: 6
     Change: Extract streaming failover from provider-manager.ts
     Dimension: 6 (Organization)
     Leverage: Low
     One-line Rationale: 871-LOC file becomes two focused modules
     ────────────────────────────────────────
     Rank: 7
     Change: Delete dead BaseRawDataMapper class
     Dimension: 2 (Seams)
     Leverage: Low
     One-line Rationale: Zero consumers; false signal about architecture
     ────────────────────────────────────────
     Rank: 8
     Change: Update CLAUDE.md re: @RegisterApiClient
     Dimension: 2 (Seams)
     Leverage: Low
     One-line Rationale: Documentation accuracy

     What V2 Keeps

     Patterns and tools that earned their place:

     - neverthrow Result types -- consistently applied, good fit for fallible API operations. The NormalizationError skip/error discriminated union is well-designed.
     - Zod runtime validation -- every provider validates API responses through colocated schemas. Catches contract drift early.
     - Streaming adapter (createStreamingIterator) -- clean separation of pagination mechanics from provider-specific logic. The fetchPage/mapItem callback design scales well.
     - Factory-based registration -- explicit, debuggable, no magic decorators. The ProviderFactory interface is minimal.
     - Vertical-slice directory structure -- blockchains/<chain>/providers/<provider>/ is clear and self-documenting. New providers follow an obvious pattern.
     - Circuit breaker + health scoring for failover -- production-grade resilience with pure-function scoring logic that is independently testable.
     - Event bus for CLI observability -- 9 well-typed events provide structured telemetry without requiring distributed tracing infrastructure.
     - Chain configuration via JSON -- evm-chains.json, cosmos-chains.json, etc. make adding new chains a data change, not a code change.
     - Peer dependency model -- @exitbook/core, @exitbook/http, @exitbook/resilience as peer deps keeps the dependency graph clean and avoids version conflicts.
