V2 Architecture Audit: @exitbook/blockchain-providers

     Scope: packages/blockchain-providers/ — all 7 analysis dimensions.
     Package size: 185 non-test source files, ~12,000 lines of production code.

     ---
     1. Dependency Audit

DONE
1a. Finding: jose is a ghost dependency

     What exists:
     jose is declared as a runtime dependency in packages/blockchain-providers/package.json line 48 ("jose": "^6.0.13"). A search of all 185 source files finds zero imports or usages
      of the package anywhere in src/.

     Why it's a problem:
     The dependency inflates the install footprint (~40kB minified for a JWT library), appears in security audits, and creates confusion about what the package actually depends on.
     Any CVE scan will flag it unnecessarily.

     What V2 should do:
     Remove jose from dependencies.

     Needs coverage:

     ┌───────────────────────┬─────────────────────────┬─────────────────┐
     │  Current capability   │ Covered by replacement? │      Notes      │
     ├───────────────────────┼─────────────────────────┼─────────────────┤
     │ JWT/JWK functionality │ N/A — not used          │ Remove outright │
     └───────────────────────┴─────────────────────────┴─────────────────┘

     Surface: 1 entry in package.json. Zero code changes required.

     Leverage: Low (maintenance hygiene).

     ---
     1b. Finding: @cardano-sdk/key-management is declared but unused

DONE

     What exists:
     packages/blockchain-providers/package.json declares @cardano-sdk/key-management: ^0.29.12. Searching src/ finds zero imports from this sub-package. Only @cardano-sdk/crypto and
     @cardano-sdk/core are actually used (both in src/blockchains/cardano/utils.ts lines 171–172, as dynamic imports).

     Why it's a problem:
     @cardano-sdk/key-management pulls in considerable transitive dependencies (hardware wallet support, transport layers). It is never imported.

     What V2 should do:
     Remove @cardano-sdk/key-management from dependencies. The actual usage (xpub HD derivation) only needs @cardano-sdk/crypto and @cardano-sdk/core.

     Needs coverage:

     ┌────────────────────┬─────────────────────────┬─────────────────┐
     │ Current capability │ Covered by replacement? │      Notes      │
     ├────────────────────┼─────────────────────────┼─────────────────┤
     │ HD key management  │ Not needed — not used   │ Remove outright │
     └────────────────────┴─────────────────────────┴─────────────────┘

     Surface: 1 entry in package.json. Zero code changes.

     Leverage: Low (footprint hygiene, but Cardano SDK is a large tree).

     ---
     1c. Finding: @polkadot/util declared but only @polkadot/util-crypto is used

DONE

     What exists:
     package.json declares both @polkadot/util: ^14.0.1 and @polkadot/util-crypto: ^14.0.1. Searching src/ finds only one file using Polkadot packages:
     src/blockchains/substrate/utils.ts line 2, which imports exclusively from @polkadot/util-crypto (decodeAddress, encodeAddress, isAddress). @polkadot/util is never imported
     directly.

     Why it's a problem:
     @polkadot/util is a peer/transitive dependency of @polkadot/util-crypto. Declaring it explicitly as a direct dep implies the package directly uses it, creates version management
      noise, and would require separate updates.

     What V2 should do:
     Remove @polkadot/util from direct dependencies. Let it remain as an implicit transitive dep of @polkadot/util-crypto.

     Needs coverage:

     ┌────────────────────────────┬─────────────────────────┬─────────────────────────┐
     │     Current capability     │ Covered by replacement? │          Notes          │
     ├────────────────────────────┼─────────────────────────┼─────────────────────────┤
     │ Polkadot utility functions │ Yes, via transitive dep │ Never directly imported │
     └────────────────────────────┴─────────────────────────┴─────────────────────────┘

     Surface: 1 entry in package.json. Zero code changes.

     Leverage: Low.

     ---
     1d. Finding: bech32 package used for two functions; already available via @polkadot/util-crypto

     What exists:
     src/blockchains/cosmos/utils.ts imports { bech32 } from the bech32 package to implement validateBech32Address and decodeBech32/encodeBech32 helpers (lines 2–60). The project
     already has @polkadot/util-crypto which exposes bech32Decode / bech32Encode / bech32Validate from the same underlying spec.

     Why it's a problem:
     This is a redundant dependency for extremely thin usage (3 wrapper functions), and adds a second bech32 implementation to the bundle alongside the one shipped inside
     @polkadot/util-crypto.

     What V2 should do:
     Replace the bech32 package by using @polkadot/util-crypto's bech32 functions, or inline the 3–5 lines of validation logic directly (bech32 validation is a regexp + prefix check
     for the use case here). Either eliminates the standalone bech32 package.

     Needs coverage:

     ┌──────────────────────────────────┬──────────────────────────────────────────────┬───────┐
     │        Current capability        │           Covered by replacement?            │ Notes │
     ├──────────────────────────────────┼──────────────────────────────────────────────┼───────┤
     │ Decode address to bytes + prefix │ Yes, bech32Decode from @polkadot/util-crypto │       │
     ├──────────────────────────────────┼──────────────────────────────────────────────┼───────┤
     │ Validate bech32 format           │ Yes, bech32Validate                          │       │
     ├──────────────────────────────────┼──────────────────────────────────────────────┼───────┤
     │ Encode bytes to address          │ Yes, bech32Encode                            │       │
     └──────────────────────────────────┴──────────────────────────────────────────────┴───────┘

     Surface: 1 file (cosmos/utils.ts), ~60 lines affected.

     Leverage: Low.

     ---
     2. Architectural Seams

     2a. Finding: BlockchainProviderManager violates single-responsibility — 11 distinct responsibilities in 1,389 lines

     What exists:
     src/core/provider-manager.ts (1,389 lines) is one class handling:
     1. Provider auto-registration from config and registry
     2. Per-provider in-memory response cache (30s TTL)
     3. Circuit breaker state (per blockchain/provider key)
     4. Periodic health checks (60s timer)
     5. Streaming failover with pagination and cursor management
     6. One-shot failover with caching
     7. Preferred-provider routing
     8. Cross-run stats persistence (load and save to SQLite)
     9. Event bus emission for CLI progress
     10. Transaction deduplication window management
     11. Provider HTTP client hook injection

     The class has 27 methods (11 private), manages 8 separate internal Map instances, and fires 2 background timers on construction.

     Why it's a problem:
     The constructor unconditionally starts two background setInterval timers (lines 107, 114), meaning any instantiation leaks timers unless destroy() is explicitly called — a
     footgun in test setups and short-lived CLI invocations. The class is untestable in isolation: any test that creates a BlockchainProviderManager must call destroy() or leak timer
      handles. The combination of failover logic, circuit breaking, caching, and stats persistence in one class means every one of those concerns must be understood to reason about
     any single one.

     What V2 should do:
     Extract into distinct, composable objects:
     - ProviderSelector: pure scoring and ordering logic (already partially extracted into provider-manager-utils.ts)
     - CircuitBreakerRegistry: owns circuit state maps and pure state transitions
     - ProviderHealthMonitor: background health checks, timer lifecycle
     - ProviderStatsStore: persistence load/save, isolated from runtime logic
     - BlockchainProviderManager: thin coordinator that delegates to the above

     The background timer problem is solved by making ProviderHealthMonitor independently lifecycle-managed, and by not starting it at all for CLI operations that don't need live
     health checks.

     Needs coverage:

     ┌────────────────────┬────────────────────────────────┬─────────────────────────────────────┐
     │ Current capability │    Covered by replacement?     │                Notes                │
     ├────────────────────┼────────────────────────────────┼─────────────────────────────────────┤
     │ Failover execution │ Yes, in slimmed manager        │ Core responsibility stays           │
     ├────────────────────┼────────────────────────────────┼─────────────────────────────────────┤
     │ Circuit breaking   │ Yes, in CircuitBreakerRegistry │ Decoupled from execution            │
     ├────────────────────┼────────────────────────────────┼─────────────────────────────────────┤
     │ Health monitoring  │ Yes, in ProviderHealthMonitor  │ Opt-in construction                 │
     ├────────────────────┼────────────────────────────────┼─────────────────────────────────────┤
     │ Stats persistence  │ Yes, in ProviderStatsStore     │ Injected dependency                 │
     ├────────────────────┼────────────────────────────────┼─────────────────────────────────────┤
     │ Response caching   │ Yes, small cache helper        │ Could be a simple Map + TTL utility │
     └────────────────────┴────────────────────────────────┴─────────────────────────────────────┘

     Surface: 1 file (1,389 lines). Would be split into ~4–5 files. All consumers of BlockchainProviderManager (ingestion package, CLI) remain unchanged since the public API
     interface stays the same.

     Leverage: High. This is the highest-leverage structural change because it eliminates timer-leak bugs, improves testability, and makes each concern independently comprehensible.

     ---
     2b. Finding: @exitbook/http exports CircuitState but circuit logic logically belongs inside blockchain-providers

     What exists:
     The circuit breaker types (CircuitState, CircuitStatus) and pure functions (recordFailure, recordSuccess, resetCircuit, isCircuitOpen, isCircuitHalfOpen,
     createInitialCircuitState) are defined in packages/http/src/core/circuit-breaker.ts and packages/http/src/core/types.ts. They are imported by blockchain-providers in 61
     call-sites. The @exitbook/http package is primarily an HTTP client with rate limiting — circuit breaking at the provider-selection level is a distinct concern from HTTP
     transport resilience.

     Why it's a problem:
     The @exitbook/http package's public API surface includes concepts (CircuitState, CircuitStatus) that have nothing to do with HTTP. Any consumer of @exitbook/http sees and
     depends on circuit-breaker types as a side effect of importing the HTTP client. The coupling flows in the wrong direction: blockchain-providers uses http as a bag of utilities
     rather than as a transport layer.

     What V2 should do:
     Move CircuitState, CircuitStatus, and the pure circuit functions (recordFailure, recordSuccess, etc.) out of @exitbook/http and into either @exitbook/core (if reused across
     packages) or a new @exitbook/resilience package. @exitbook/http retains only HTTP-specific types (RateLimitConfig, HttpClientHooks, InstrumentationCollector, RateLimitError).

     Needs coverage:

     ┌────────────────────────────────┬─────────────────────────────────────────────────────┬────────────────────┐
     │       Current capability       │               Covered by replacement?               │       Notes        │
     ├────────────────────────────────┼─────────────────────────────────────────────────────┼────────────────────┤
     │ Pure circuit-breaker functions │ Yes, relocated to @exitbook/core or new package     │ No behavior change │
     ├────────────────────────────────┼─────────────────────────────────────────────────────┼────────────────────┤
     │ HTTP rate limiting             │ Yes, stays in @exitbook/http                        │                    │
     ├────────────────────────────────┼─────────────────────────────────────────────────────┼────────────────────┤
     │ Circuit state persistence      │ Yes, blockchain-providers imports from new location │                    │
     └────────────────────────────────┴─────────────────────────────────────────────────────┴────────────────────┘

     Surface: 61 import sites in blockchain-providers. @exitbook/http/src/core/circuit-breaker.ts and types.ts (partial).

     Leverage: Medium. Clarifies the dependency graph; removes conceptual pollution from @exitbook/http.

     ---
     3. Pattern Re-evaluation

     3a. Finding: errAsync misused as err in two places — latent type-safety bug

     What exists:
     In src/core/base/api-client.ts line 122, the default executeStreaming implementation yields errAsync(new Error(...)). In
     src/blockchains/evm/providers/etherscan/etherscan.api-client.ts line 248, execute<T> returns errAsync(new Error(...)).

     errAsync(e) creates a ResultAsync<never, Error> (a Promise-based wrapper), not a Result<never, Error>. The generator's declared return type is
     AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>. Yielding a ResultAsync from a generator that consumers expect to yield Result instances means any for await (const
      r of iter) will receive a Promise object rather than a Result, causing r.isErr() to throw at runtime (no such method on a Promise).

     The same applies to execute() returning errAsync: callers use await provider.execute(...) and then call .isErr() on the Result — but errAsync returns a ResultAsync, which is a
     PromiseLike<Result>. Since execute is already async, await provider.execute(...) awaits the Promise<ResultAsync>, yielding a ResultAsync, not a Result. Calling .isErr() on a
     ResultAsync returns false (no such property), silently swallowing the error.

     TypeScript does not catch this because ResultAsync is assignable to the Promise<Result<T, E>> return type in some configurations.

     Why it's a problem:
     This is a latent silent failure path in a financial system. When the default streaming guard fires (unsupported provider) or when Etherscan's execute() is called directly, the
     error is silently lost rather than surfaced.

     What V2 should do:
     Replace both errAsync(new Error(...)) usages with err(new Error(...)).
     - api-client.ts line 122: yield err(new Error(...))
     - etherscan.api-client.ts line 248: return err(new Error(...))

     Needs coverage:

     ┌───────────────────────────────┬─────────────────────────┬───────────────────────────────────┐
     │      Current capability       │ Covered by replacement? │               Notes               │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────┤
     │ Signal unsupported operations │ Yes, via err()          │ Identical semantics, correct type │
     └───────────────────────────────┴─────────────────────────┴───────────────────────────────────┘

     Surface: 2 files, 2 lines. Trivial fix with correctness impact.

     Leverage: High (correctness bug, financial system).

     ---
     3b. Finding: Four near-identical Tatum client classes — 1,200 lines of duplicated behavior

     What exists:
     src/blockchains/bitcoin/providers/tatum/ contains four nearly-identical BaseApiClient subclasses:
     - tatum-bitcoin.api-client.ts (329 lines)
     - tatum-litecoin.api-client.ts (322 lines)
     - tatum-dogecoin.api-client.ts (322 lines)
     - tatum-bcash.api-client.ts (341 lines)

     A diff between any two reveals ~130 lines of differences out of 330 — the differences are: blockchain name, API URL path segment, chain-specific Zod schemas, mapper function
     name, and health check address. The remaining ~200 lines per file (constructor, execute, executeStreaming, streamAddressTransactions, getAddressBalances, hasAddressTransactions,
      makeRequest) are identical save for type parameters.

     Why it's a problem:
     Any bug fix or feature addition (e.g., the executeStreaming routing inconsistency already visible between tatum-bitcoin which uses streamType dispatch vs tatum-dogecoin/litecoin
      which use operation.type dispatch) must be applied in all four files. The four files have already diverged on this routing pattern, creating inconsistent behavior across
     chains.

     What V2 should do:
     Introduce a generic TatumBitcoinFamilyApiClient<TTransaction, TBalance> base class parameterized by chain config, API path, schema, and mapper function. Each chain registers a
     decorated subclass with a one-liner constructor that calls super(config, tatumBitcoinChainConfig). The 4 × 330-line files collapse to 1 × ~200-line generic base + 4 × ~30-line
     thin subclasses.

     Needs coverage:

     ┌───────────────────────────────────────────┬──────────────────────────────┬──────────────────────────────────┐
     │            Current capability             │   Covered by replacement?    │              Notes               │
     ├───────────────────────────────────────────┼──────────────────────────────┼──────────────────────────────────┤
     │ Per-chain Zod schemas                     │ Yes, as type parameter       │                                  │
     ├───────────────────────────────────────────┼──────────────────────────────┼──────────────────────────────────┤
     │ Per-chain mapper functions                │ Yes, as constructor argument │                                  │
     ├───────────────────────────────────────────┼──────────────────────────────┼──────────────────────────────────┤
     │ Per-chain health check address            │ Yes, as metadata             │                                  │
     ├───────────────────────────────────────────┼──────────────────────────────┼──────────────────────────────────┤
     │ Independent @RegisterApiClient decorators │ Yes, on each thin subclass   │ Decorator still needed per class │
     └───────────────────────────────────────────┴──────────────────────────────┴──────────────────────────────────┘

     Surface: 4 files (1,314 lines total), replaced by ~260 lines.

     Leverage: High. The routing inconsistency already present between files is a correctness issue, not just a style issue.

     ---
     3c. Finding: BIP44 gap scanning algorithm duplicated across Bitcoin and Cardano

     What exists:
     src/blockchains/bitcoin/utils.ts (performBitcoinAddressGapScanning, lines 321–397) and src/blockchains/cardano/utils.ts (CardanoUtils.performAddressGapScanning, lines 338–418)
     implement the same BIP44 gap-scanning algorithm. The logic is structurally identical: iterate derived addresses, track consecutiveUnusedCount and highestUsedIndex, call
     hasAddressTransactions, apply the same MAX_ERRORS = 3 guard, and compute the same slice formula. The only differences are the hardcoded blockchain string ('bitcoin' vs
     'cardano') and the cache key prefix.

     Why it's a problem:
     The two implementations have already diverged: the Cardano version reads gapLimit from walletAddress.addressGap (a field); the Bitcoin version takes gapLimit as a function
     parameter. Any future change to the algorithm (e.g., adjusting MAX_ERRORS, changing gap-limit behavior) must be applied twice and can drift.

     What V2 should do:
     Extract a shared performAddressGapScanning(config: GapScanConfig): Promise<Result<void, Error>> function into src/core/utils/gap-scan-utils.ts. Both Bitcoin and Cardano call the
      shared function with their chain-specific parameters.

     Needs coverage:

     ┌──────────────────────────┬─────────────────────────┬──────────────────────────┐
     │    Current capability    │ Covered by replacement? │          Notes           │
     ├──────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ BIP44 gap detection      │ Yes, parameterized      │ blockchain passed as arg │
     ├──────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Chain-specific cache key │ Yes, as config field    │                          │
     ├──────────────────────────┼─────────────────────────┼──────────────────────────┤
     │ Error threshold          │ Yes, as config field    │ Currently hardcoded to 3 │
     └──────────────────────────┴─────────────────────────┴──────────────────────────┘

     Surface: 2 files (~80 lines of duplicate logic each), replaced by 1 shared utility + 2 thin call-sites (~10 lines each).

     Leverage: Medium. Correctness risk from divergence; algorithm is non-trivial.

     ---
     3d. Finding: Skip-rate tracking closure duplicated three times within alchemy.api-client.ts

     What exists:
     src/blockchains/evm/providers/alchemy/alchemy.api-client.ts (1,199 lines) contains three streamAddress* private methods (lines 659, 828, 994). Each method constructs a mapItem
     closure that maintains identical let totalProcessed = 0; let totalSkipped = 0; counter state and identical skip-rate logging logic (lines 769–806, 935–972, 1106–1143). The three
      closures are character-for-character identical except for the streamType string in one log message.

     Why it's a problem:
     The three streaming methods are themselves near-identical — they differ only in: category parameter (['external'], ['internal'], ['erc20', 'erc721', 'erc1155']), whether
     enrichTransfersWithGasFees is called, and streamType value. The duplication inflates the file by ~300 lines and means the skip-rate threshold (currently 5% after 10 items)
     cannot be changed in one place.

     What V2 should do:
     Consolidate the three methods into one streamAddressAssetTransfers(address, category, streamType, enrichWithGas, resumeCursor) method. Move the mapItem skip-rate logic into a
     shared createMappingWrapper(mapper, logger) factory. The file drops from 1,199 to roughly 700 lines.

     Needs coverage:

     ┌────────────────────────────────────┬────────────────────────────────┬───────┐
     │         Current capability         │    Covered by replacement?     │ Notes │
     ├────────────────────────────────────┼────────────────────────────────┼───────┤
     │ External tx streaming              │ Yes, category: ['external']    │       │
     ├────────────────────────────────────┼────────────────────────────────┼───────┤
     │ Internal tx streaming              │ Yes, category: ['internal']    │       │
     ├────────────────────────────────────┼────────────────────────────────┼───────┤
     │ Token tx streaming                 │ Yes, category: ['erc20', ...]  │       │
     ├────────────────────────────────────┼────────────────────────────────┼───────┤
     │ Gas fee enrichment (external only) │ Yes, enrichWithGas: true/false │       │
     ├────────────────────────────────────┼────────────────────────────────┼───────┤
     │ Skip-rate monitoring               │ Yes, shared wrapper            │       │
     └────────────────────────────────────┴────────────────────────────────┴───────┘

     Surface: 1 file (alchemy.api-client.ts), ~500 lines affected across 3 methods.

     Leverage: Medium. File is hard to navigate at current size; skip-rate logic divergence risk.

     ---
     3e. Finding: @RegisterApiClient decorator forces eager global singleton registration at module load time

     What exists:
     The @RegisterApiClient decorator (defined in src/core/registry/decorators.ts) calls ProviderRegistry.register(factory) when the class is defined. All 20+ provider classes are
     registered by importing src/register-apis.ts, which transitively imports every provider file. The ProviderRegistry is a static class with a module-level Map — effectively a
     global singleton.

     The initializeProviders() function in src/initialize.ts does nothing except import register-apis.ts as a side effect.

     Why it's a problem:
     - The registry is shared across all tests. Any test that imports a provider class mutates the shared singleton, creating implicit ordering dependencies between test files.
     - There is no mechanism to unregister providers or reset the registry in tests.
     - The decorator pattern is TC39 Stage 3 but TypeScript's implementation still requires experimentalDecorators or the newer Stage 3 syntax depending on compiler version —
     introducing friction in toolchain upgrades.
     - initializeProviders() is a misleading no-op function that the codebase requires callers to invoke ("initialize before using") but provides no actual initialization other than
     a side-effect import.

     What V2 should do:
     Replace the static ProviderRegistry singleton with an explicit ProviderRegistry instance that is constructed and passed to BlockchainProviderManager. Each provider registers
     itself by exporting a providerFactory constant (no decorator needed). Tests create isolated registry instances. The initializeProviders() entry point becomes:

     export function createProviderRegistry(): ProviderRegistry {
       const registry = new ProviderRegistry();
       registry.register(alchemyFactory);
       registry.register(etherscanFactory);
       // ...
       return registry;
     }

     This makes registration explicit, testable, and tree-shakeable.

     Needs coverage:

     ┌──────────────────────────────────────────┬─────────────────────────────────────────────┬──────────────────────────────────┐
     │            Current capability            │           Covered by replacement?           │              Notes               │
     ├──────────────────────────────────────────┼─────────────────────────────────────────────┼──────────────────────────────────┤
     │ Auto-discovery of providers              │ Yes, explicit createProviderRegistry()      │ Trade-off: slightly more verbose │
     ├──────────────────────────────────────────┼─────────────────────────────────────────────┼──────────────────────────────────┤
     │ Metadata co-location with implementation │ Yes, providerFactory constant next to class │                                  │
     ├──────────────────────────────────────────┼─────────────────────────────────────────────┼──────────────────────────────────┤
     │ Multi-chain support                      │ Yes, factory carries metadata               │                                  │
     ├──────────────────────────────────────────┼─────────────────────────────────────────────┼──────────────────────────────────┤
     │ Test isolation                           │ Yes, new instance per test                  │ Currently impossible             │
     └──────────────────────────────────────────┴─────────────────────────────────────────────┴──────────────────────────────────┘

     Surface: 1 decorator, 20+ provider files (trivial factory export each), 1 registry class, initialize.ts.

     Leverage: Medium-High. Test isolation and explicit initialization are significant DX improvements.

     ---
     4. Data Layer

     4a. Finding: providers.db persists circuit breaker state across process restarts — stale state semantics are subtle

     What exists:
     src/persistence/ implements a SQLite database (via Kysely) that persists provider health and circuit breaker state between CLI runs. provider-stats-utils.ts implements
     hydrateProviderStats() which applies a "staleness" recovery: if now - lastFailureTime >= recoveryTimeoutMs (5 minutes), the circuit is reset to closed on load (lines 55–56).

     Why it's a problem:
     The staleness threshold (5 minutes) is hardcoded in provider-stats-utils.ts line 40 as DEFAULT_RECOVERY_TIMEOUT_MS, but the circuit state stored in the DB was created with
     whatever recoveryTimeoutMs was set at runtime (typically also 5 min, in createInitialCircuitState). The hydration function uses a hardcoded constant rather than reading the
     stored recoveryTimeoutMs, meaning if the timeout is ever changed at runtime the persisted stale-circuit recovery applies the wrong threshold.

     More importantly, for a CLI tool, persisting failure state across invocations is questionable: a provider that was rate-limited during yesterday's import should not be penalized
      today. The 5-minute recovery window is appropriate for a long-running daemon but too long for a CLI that runs once and exits.

     What V2 should do:
     Make recoveryTimeoutMs configurable at construction time (it already is in createInitialCircuitState but the hydration ignores the stored value). For CLI use specifically,
     either clear circuit state on startup (fresh start semantics) or apply a much shorter default recovery timeout (e.g., 30 seconds for CLI mode vs 5 minutes for daemon mode). The
     persisted stats for health scoring (averageResponseTime, errorRate) retain long-term value and should stay — only the circuit state (failureCount, lastFailureTime) warrants the
     shorter window.

     Needs coverage:

     ┌────────────────────────────────────────┬──────────────────────────────────────────────────┬───────┐
     │           Current capability           │             Covered by replacement?              │ Notes │
     ├────────────────────────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Long-term health scoring               │ Yes, persisted separately from circuit state     │       │
     ├────────────────────────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Circuit recovery after process restart │ Yes, configurable timeout per invocation context │       │
     ├────────────────────────────────────────┼──────────────────────────────────────────────────┼───────┤
     │ Provider ordering by historic health   │ Yes, unchanged                                   │       │
     └────────────────────────────────────────┴──────────────────────────────────────────────────┴───────┘

     Surface: persistence/provider-stats-utils.ts (~84 lines), persistence/schema.ts.

     Leverage: Medium. Incorrect stale-state recovery is a behavioral correctness issue.

     ---
     4b. Finding: Schema duplication across Tatum providers — 4 sets of nearly-identical schemas

     What exists:
     The Tatum provider directory contains:
     - tatum.schemas.ts (Bitcoin)
     - tatum-litecoin.schemas.ts
     - tatum-dogecoin.schemas.ts
     - tatum-bcash.schemas.ts

     Each defines TatumXxxTransactionSchema and TatumXxxBalanceSchema. Examining these, the structural differences are minimal: field names are identical, the only variation is
     whether amounts are returned as numbers or strings (Bitcoin returns numbers; Litecoin/Dogecoin/BCash return strings).

     Why it's a problem:
     This is a direct consequence of Finding 3b (Tatum class duplication). The schema duplication amplifies the maintenance surface — Zod schema changes (e.g., adding a new field
     that Tatum started returning) require edits in 4 files.

     What V2 should do:
     Define a single TatumTransactionSchema with a amountType: 'number' | 'string' discriminator, or use Zod's .or() to accept both. Resolved by the same consolidation as Finding 3b.

     Surface: 4 schema files, affected by 3b fix.

     Leverage: Low in isolation; resolved by 3b.

     ---
     5. Toolchain & Infrastructure

     5a. Finding: Benchmark tool embedded in production BaseApiClient (300-line method, with emoji-decorated log messages)

     What exists:
     src/core/base/api-client.ts lines 173–468 implement a benchmarkRateLimit() method (295 lines) that performs multi-stage HTTP load testing against a live API. This includes:
     - Two nested timing loops with 60-second setTimeout delays between iterations
     - Emoji characters in log strings (e.g., ⏱️ , 🔥, ✅, ❌, 📊) on lines 213, 332, 345, 421, 425, 441
     - A BURST_BENCHMARK_BATCH_SIZE = 5 constant at the file's top level
     - Temporarily swapping this.httpClient to a benchmark client (lines 203, 467)

     The benchmark method is part of the IBlockchainProvider interface, meaning it appears on every provider instance and is callable in production contexts.

     Why it's a problem:
     A 295-line benchmarking method on every provider instance adds ~2kB to every provider class, pollutes the interface with a tool-only concern, and creates a footgun: any code
     holding an IBlockchainProvider can accidentally call benchmarkRateLimit() and spend several minutes making HTTP requests to a live API. The httpClient swap (mutating instance
     state during the benchmark) is a concurrency hazard if any request is in flight.

     The CLAUDE.md explicitly states "Avoid obvious statements" and this code contains exactly those emoji log statements that provide no signal in a structured Pino logging
     environment.

     What V2 should do:
     Remove benchmarkRateLimit from IBlockchainProvider and BaseApiClient. Instead, provide a standalone BenchmarkTool class in a src/tools/ directory (or the scripts directory) that
      accepts a provider instance and runs the same logic externally. The benchmark capability is preserved for developers without contaminating the production interface.

     Needs coverage:

     ┌──────────────────────────────────────────┬─────────────────────────────┬───────────────────────────────────────┐
     │            Current capability            │   Covered by replacement?   │                 Notes                 │
     ├──────────────────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
     │ Rate limit discovery per provider        │ Yes, in BenchmarkTool class │ Takes IBlockchainProvider as argument │
     ├──────────────────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
     │ onProgress callback for live TUI updates │ Yes, same API               │                                       │
     ├──────────────────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
     │ Burst and sustained rate tests           │ Yes, same algorithm         │                                       │
     └──────────────────────────────────────────┴─────────────────────────────┴───────────────────────────────────────┘

     Surface: IBlockchainProvider interface (1 method removed), BaseApiClient (~300 lines removed), BenchmarkProgressEvent type moves to tools/.

     Leverage: High. Interface simplification, removal of production footgun, cleanup of emoji log pollution.

     ---
     6. File & Code Organization

     6a. Finding: alchemy.api-client.ts at 1,199 lines has three distinct streaming concerns

     What exists:
     src/blockchains/evm/providers/alchemy/alchemy.api-client.ts (1,199 lines) combines:
     - Provider registration and HTTP client setup (1–172)
     - execute() dispatch for 4 operation types (223–250)
     - getAddressInfo, getAddressBalances, getAddressTokenBalances, getTokenMetadata implementations (~200 lines)
     - streamAddressTransactions with dual-pagination FROM/TO logic (~167 lines)
     - streamAddressInternalTransactions (~164 lines, near-duplicate of above)
     - streamAddressTokenTransactions (~169 lines, near-duplicate of above)
     - enrichTransfersWithGasFees (receipt fetching, ~85 lines)
     - deduplicateRawTransfers (~40 lines)
     - parseDualPageToken / buildDualPageToken (~30 lines)

     Why it's a problem:
     The dual-pagination token encoding (parseDualPageToken/buildDualPageToken) and the receipt enrichment (enrichTransfersWithGasFees) are self-contained utilities that would
     naturally live in alchemy.mapper-utils.ts or a new alchemy.pagination-utils.ts. At 1,199 lines the file exceeds the 400-line CLAUDE.md guideline by 3x and requires scrolling ~40
      screens to navigate.

     What V2 should do:
     Extract: (a) the dual-pagination token utilities into alchemy.pagination-utils.ts; (b) the three nearly-identical streamAddress* methods into a single parameterized method
     (resolves Finding 3d); (c) the receipt enrichment into alchemy.enrichment-utils.ts. The main client file drops to ~400–500 lines.

     Surface: 1 file (1,199 lines), split into 3 files.

     Leverage: Medium (same as Finding 3d).

     ---
     6b. Finding: etherscan.api-client.ts has 4 nearly-identical stream methods for 809 lines

     What exists:
     src/blockchains/evm/providers/etherscan/etherscan.api-client.ts (809 lines) implements four private streaming methods: streamAddressBeaconWithdrawals (313),
     streamAddressNormalTransactions (443), streamAddressInternalTransactions (568), streamAddressTokenTransactions (693). Each follows the same structure: construct fetchPage
     closure with offset-based pagination, create createStreamingIterator. The differences are the API action parameter and the mapper/schema used.

     Why it's a problem:
     Same as Alchemy: duplication inflates the file and creates divergence risk. Any change to the pagination logic (e.g., handling a new Etherscan API error format) must be
     replicated in 4 methods.

     What V2 should do:
     Extract a parameterized streamEtherscanTransactions<TRaw, TOut>(action, mapper, cursorExtracter, resumeCursor) method. All four become ~10-line calls to the shared method.

     Surface: 1 file (809 lines, ~400 lines of duplication).

     Leverage: Medium.

     ---
     7. Error Handling & Observability

     7a. Finding: errAsync bug creates silent failure paths (cross-references Finding 3a)

     Already covered in 3a above. This is the highest-priority correctness issue in the package.

     ---
     7b. Finding: BlockchainProviderManager constructor starts background timers unconditionally — forces callers to manage lifecycle

     What exists:
     BlockchainProviderManager constructor (line 107–114) unconditionally starts:
     - healthCheckTimer: setInterval(performHealthChecks, 60000)
     - cacheCleanupTimer: setInterval(cleanupCache, 30000)

     These fire even in unit tests, even for single-operation CLI invocations where the process will exit in under 1 second, and even when no providers are registered. The destroy()
     method must be called to clear them.

     Why it's a problem:
     Timer leaks in tests prevent clean exits, cause Jest/Vitest to warn about open handles, and can interfere with test isolation. In CLI usage, the timers are meaningless overhead
     for a process that runs for 2 seconds and exits.

     What V2 should do:
     Make timer initialization opt-in: either defer timer start until the first provider is registered, or accept a { enableHealthMonitoring: boolean } option in the constructor. For
      CLI, health monitoring should be disabled.

     Needs coverage:

     ┌───────────────────────────────────────┬──────────────────────────────────┬───────┐
     │          Current capability           │     Covered by replacement?      │ Notes │
     ├───────────────────────────────────────┼──────────────────────────────────┼───────┤
     │ Periodic health checks in daemon mode │ Yes, opt-in via constructor flag │       │
     ├───────────────────────────────────────┼──────────────────────────────────┼───────┤
     │ Cache cleanup                         │ Yes, same                        │       │
     └───────────────────────────────────────┴──────────────────────────────────┴───────┘

     Surface: provider-manager.ts constructor, ~8 lines.

     Leverage: High for test DX; Medium for production correctness.

     ---
     7c. Finding: No structured tracing context propagated through failover chain

     What exists:
     The failover execution path (executeStreamingImpl, executeWithCircuitBreaker) logs provider switching events via logger.info/warn/error and emits events to the event bus. Log
     messages include provider name and operation type but not a correlation ID or trace ID that would tie together "this streaming operation started here, failed over here,
     succeeded here" in a log aggregator.

     Why it's a problem:
     For post-hoc debugging of a failed import (e.g., "why did Ethereum import use Etherscan instead of Moralis?"), the logs from a single operation are scattered across multiple log
      lines with no stable identifier linking them. If two imports run concurrently (which the CLI doesn't currently support but could), the logs are interleaved with no way to
     distinguish them.

     What V2 should do:
     Generate a traceId (a short random string or UUID v4) per executeWithFailover invocation and include it in every log/event emitted within that execution. No OpenTelemetry
     required — this is a 3-line change (generate once at entry, thread through log calls as structured metadata).

     Needs coverage:

     ┌─────────────────────────────┬─────────────────────────────────────┬───────┐
     │     Current capability      │       Covered by replacement?       │ Notes │
     ├─────────────────────────────┼─────────────────────────────────────┼───────┤
     │ Provider transition logging │ Yes, enriched with traceId          │       │
     ├─────────────────────────────┼─────────────────────────────────────┼───────┤
     │ Event bus emissions         │ Yes, traceId added to event payload │       │
     └─────────────────────────────┴─────────────────────────────────────┴───────┘

     Surface: provider-manager.ts, ~15 log call-sites in executeStreamingImpl and executeWithCircuitBreaker.

     Leverage: Medium. Directly improves diagnosability for the core failure mode (provider failover during import).

     ---
     V2 Decision Summary

     Rank: 1
     Change: Fix errAsync → err in two places (api-client.ts:122, etherscan.api-client.ts:248)
     Dimension: 3 / 7
     Leverage: High
     One-line Rationale: Silent failure path in a financial system — errors are silently swallowed in the IBlockchainProvider default implementation and the Etherscan execute()
     method
     ────────────────────────────────────────
     Rank: 2
     Change: Extract benchmark tool out of IBlockchainProvider into a standalone BenchmarkTool
     Dimension: 5
     Leverage: High
     One-line Rationale: 295-line tool method on every provider instance with emoji logs pollutes the production interface and is a misuse footgun
     ────────────────────────────────────────
     Rank: 3
     Change: Refactor BlockchainProviderManager into composable objects; make timers opt-in
     Dimension: 2
     Leverage: High
     One-line Rationale: 1,389-line class with 11 responsibilities unconditionally starts background timers, making it untestable without destroy() calls
     ────────────────────────────────────────
     Rank: 4
     Change: Consolidate four Tatum chain clients into one generic base class
     Dimension: 3
     Leverage: High
     One-line Rationale: 1,314 lines of near-identical code have already diverged on executeStreaming routing semantics across chains
     ────────────────────────────────────────
     Rank: 5
     Change: Replace @RegisterApiClient decorator singleton with explicit factory-based registry
     Dimension: 3
     Leverage: Medium-High
     One-line Rationale: Global singleton registry makes test isolation impossible; explicit createProviderRegistry() factory is idiomatic and testable
     ────────────────────────────────────────
     Rank: 6
     Change: Move CircuitState/circuit functions from @exitbook/http to @exitbook/core
     Dimension: 2
     Leverage: Medium
     One-line Rationale: HTTP package should not export circuit-breaker domain types
     ────────────────────────────────────────
     Rank: 7
     Change: Extract shared gap-scanning algorithm from Bitcoin and Cardano utils
     Dimension: 3
     Leverage: Medium
     One-line Rationale: Two ~80-line implementations of the same BIP44 algorithm have already diverged in parameter passing style
     ────────────────────────────────────────
     Rank: 8
     Change: Consolidate Alchemy's three streamAddress* methods + skip-rate tracking
     Dimension: 6
     Leverage: Medium
     One-line Rationale: 450 lines of copy-paste across 3 methods in a 1,199-line file; skip-rate threshold cannot be changed in one place
     ────────────────────────────────────────
     Rank: 9
     Change: Add traceId to failover execution path log calls
     Dimension: 7
     Leverage: Medium
     One-line Rationale: No way to correlate logs across a single import operation that spans multiple provider failures
     ────────────────────────────────────────
     Rank: 10
     Change: Fix circuit state staleness: use stored recoveryTimeoutMs, add CLI fast-recovery mode
     Dimension: 4
     Leverage: Medium
     One-line Rationale: 5-minute circuit recovery is for daemons, not CLI; hydration ignores stored timeout value
     ────────────────────────────────────────
     Rank: 11
     Change: Remove jose, @cardano-sdk/key-management, @polkadot/util from deps
     Dimension: 1
     Leverage: Low
     One-line Rationale: Three unused/redundant dependencies inflate install footprint and security audit surface
     ────────────────────────────────────────
     Rank: 12
     Change: Replace standalone bech32 package with @polkadot/util-crypto bech32 functions
     Dimension: 1
     Leverage: Low
     One-line Rationale: Redundant bech32 implementation alongside the one shipped in @polkadot/util-crypto

     ---
     What V2 Keeps

     The following patterns earned their place and should carry forward unchanged:

     - neverthrow Result types. They enforce explicit error handling at every boundary and are applied consistently across ~185 files. The one bug (items 1 and 2 above) is a misuse
     of errAsync, not an indictment of the pattern.
     - BaseApiClient inheritance model. The base class correctly centralizes HTTP client initialization, API key resolution, and the streaming adapter bridge. The inheritance
     boundary is clean: concrete providers only need to implement execute, executeStreaming, getHealthCheckConfig, and the cursor methods.
     - createStreamingIterator / StreamingAdapterOptions. The streaming adapter pattern is the right abstraction. Providing fetchPage + mapItem + extractCursors as pure callbacks
     with the adapter owning the loop, dedup, and cursor state building is clean and well-tested.
     - Zod schemas co-located with providers. Each provider's *.schemas.ts next to its *.api-client.ts is correct vertical-slice organization. No suggestion to centralize schemas.
     - @exitbook/http HttpClient with built-in rate limiting and retries. The HTTP client abstraction is appropriate and well-designed. Rate limiting at the client level (not the
     provider level) is correct.
     - Vertical slice directory structure. blockchains/<chain>/providers/<provider>/ is clear, discoverable, and consistent across 8 blockchains.
     - Separate SQLite databases (transactions.db, prices.db, providers.db). The separation keeps schema concerns isolated and allows independent persistence of ephemeral (providers)
      vs durable (transactions) data.
     - Pure functions in provider-manager-utils.ts for scoring, selection, and dedup. These are well-extracted and tested without mocks, exactly as CLAUDE.md prescribes.
