V2 Architecture Audit: @exitbook/blockchain-providers

     Scope: packages/blockchain-providers/ — all 7 analysis dimensions.
     Package size: 185 non-test source files, ~12,000 lines of production code.

     ---
     1. Dependency Audit

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
