V2 Architecture Audit: @exitbook/resilience

     Package Overview

     The resilience package (/Users/joel/Dev/exitbook/packages/resilience/) provides provider failover, circuit breaking, health tracking, scoring,
     selection, and caching primitives. It contains 2,197 lines across 29 TypeScript files (7 modules), with 2 external dependencies (neverthrow,
     @exitbook/logger). It is consumed by two packages: @exitbook/blockchain-providers and @exitbook/price-providers.

     ---
     1. Dependency Audit

     [1a] Hand-Rolled TTL Cache

     What exists:
     /Users/joel/Dev/exitbook/packages/resilience/src/cache/ttl-cache.ts (68 LOC) implements a Map-backed TTL cache with manual expiry on read, periodic
     cleanup via setInterval, and explicit timer lifecycle (startAutoCleanup/stopAutoCleanup/clear).

     Consumers:
     - /Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/manager/provider-manager.ts:56 (one-shot response caching)
     - /Users/joel/Dev/exitbook/packages/price-providers/src/core/provider-manager.ts:42 (price request caching)

     Why it's a problem:
     The implementation lacks: maximum entry count / memory bounding, LRU eviction, cache statistics, and per-key TTL override. Both consumers use it as a
     flat TTL store with no size controls. In a long-running CLI session enriching thousands of prices, the cache grows unbounded until the next cleanup
     tick -- there is no max-size guard.

     What V2 should do:
     Replace with lru-cache (25k+ GitHub stars, TypeScript-native, active maintenance). It provides TTL, max-size, LRU eviction, and dispose callbacks out
     of the box.

     Needs coverage:

     Current capability: Per-key TTL
     Covered by lru-cache?: Yes
     Notes: ttl option per-cache or per-set
     ────────────────────────────────────────
     Current capability: get/set API
     Covered by lru-cache?: Yes
     Notes: Identical shape
     ────────────────────────────────────────
     Current capability: Expired-entry cleanup
     Covered by lru-cache?: Yes
     Notes: Automatic on access + optional sweep
     ────────────────────────────────────────
     Current capability: clear()
     Covered by lru-cache?: Yes
     Notes: Built-in
     ────────────────────────────────────────
     Current capability: Timer lifecycle (startAutoCleanup/stopAutoCleanup)
     Covered by lru-cache?: Partial
     Notes: Not needed -- LRU eviction bounds memory without timers. Can use ttlAutopurge if needed.
     ────────────────────────────────────────
     Current capability: Memory bounding (missing today)
     Covered by lru-cache?: Yes
     Notes: max option -- new capability

     Surface: ~3 source files, ~6 call-sites
     Leverage: Medium

     ---
     2. Architectural Seams

      ---
     [2c] Domain Concept Placement: IProvider Interface Is Too Wide

     What exists:
     IProvider in /Users/joel/Dev/exitbook/packages/resilience/src/provider-health/types.ts:10 requires:
     export interface IProvider {
       readonly name: string;
       destroy(): Promise<void>;
     }

     The resilience package only ever reads provider.name. The destroy() method is never called anywhere in the resilience package. Grep confirms: zero
     usages of .destroy() in /Users/joel/Dev/exitbook/packages/resilience/src/.

     Consumers are forced to stub destroy() in tests:
     - /Users/joel/Dev/exitbook/packages/resilience/src/failover/__tests__/failover.test.ts:21-24
     - /Users/joel/Dev/exitbook/packages/resilience/src/provider-selection/__tests__/provider-selection.test.ts:12-15
     - /Users/joel/Dev/exitbook/packages/resilience/src/provider-health/__tests__/provider-health.test.ts:168-172

     Why it's a problem:
     The resilience package's generic algorithms are coupled to a lifecycle contract they never use. This creates unnecessary test boilerplate and prevents
      the resilience primitives from being used with non-disposable identifiers (e.g., static configuration objects, provider metadata records).

     What V2 should do:
     Define { readonly name: string } as the resilience-level contract. Let consumer packages extend it with destroy() in their own type hierarchy. The
     resilience package already uses TProvider extends IProvider generics -- the change is type-level only.

     Needs coverage:

     ┌───────────────────────────────────┬──────────┬────────────────────────────────────────────────┐
     │        Current capability         │ Covered? │                     Notes                      │
     ├───────────────────────────────────┼──────────┼────────────────────────────────────────────────┤
     │ Provider identification by name   │ Yes      │ Kept                                           │
     ├───────────────────────────────────┼──────────┼────────────────────────────────────────────────┤
     │ Generic type parameter constraint │ Yes      │ extends { readonly name: string }              │
     ├───────────────────────────────────┼──────────┼────────────────────────────────────────────────┤
     │ Consumer lifecycle management     │ Yes      │ Consumers define their own lifecycle interface │
     └───────────────────────────────────┴──────────┴────────────────────────────────────────────────┘

     Surface: ~7 files (types.ts + all test files with stubs), ~6 stub-removal sites
     Leverage: Medium-High

     ---
     3. Pattern Re-evaluation

     [3a] Result Type in Failover: Mixed Error Channels

     What exists:
     executeWithFailover accepts execute: (provider) => Promise<Result<TResult, Error>> (line 17 of
     /Users/joel/Dev/exitbook/packages/resilience/src/failover/types.ts). Inside the loop, it unwraps the Result by throwing result.error (line 91-93 of
     failover.ts) and catching it (line 110-111):

     if (result.isErr()) {
       throw result.error;  // line 91-93
     }
     // ...
     } catch (error) {
       lastError = error as Error;  // line 111

     This creates two error channels in one function: Result types from the callback, and exceptions for internal control flow.

     Why it's a problem:
     1. The throw/catch bridge loses type safety -- error as Error is a cast.
     2. If execute() throws an unexpected exception (not a Result error), it gets silently mixed into the same catch handler, with no way to distinguish
     provider-returned errors from infrastructure failures.
     3. The pattern is confusing to readers: the function takes Results but internally uses exceptions.

     What V2 should do:
     Handle the isErr() branch without throwing. The success/failure paths can be structured as an if/else:

     const result = await execute(provider);
     if (result.isOk()) {
       // record success, return
     } else {
       // record failure, continue
     }

     Wrap the entire block in try/catch only for truly unexpected exceptions (infrastructure crashes), logging them differently.

     Needs coverage:

     ┌───────────────────────────────┬──────────┬──────────────────────────────────────┐
     │      Current capability       │ Covered? │                Notes                 │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Result-based failover         │ Yes      │ Direct pattern matching              │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Unexpected exception handling │ Yes      │ Separate catch for non-Result errors │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Circuit recording on failure  │ Yes      │ In the else branch                   │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ onSuccess/onFailure callbacks │ Yes      │ Unchanged                            │
     ├───────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ buildFinalError               │ Yes      │ Unchanged                            │
     └───────────────────────────────┴──────────┴──────────────────────────────────────┘

     Surface: ~1 file (failover.ts), ~14 test cases unaffected (black-box behavior unchanged)
     Leverage: High

     ---
     4. Data Layer

     [4a] Stringly-Typed Composite Keys

     What exists:
     The resilience package stores health and circuit state keyed by plain strings. The blockchain-providers consumer creates composite keys via
     getProviderKey() (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/health/provider-stats-store.ts:22-24):

     export function getProviderKey(blockchain: string, providerName: string): string {
       return `${blockchain}/${providerName}`;
     }

     And parses them back via parseProviderKey() (lines 29-35), which throws on malformed keys. The price-providers consumer uses flat provider names (no
     composite key).

     Why it's a problem:
     The "blockchain/provider" encoding convention is enforced only by caller discipline. A typo, a provider name containing /, or a missing prefix results
      in a runtime exception or silent key collision. The ProviderHealthStore.getHealthMapForKeys method
     (/Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:77) exists specifically to work around this stringly-typed
     indirection.

     What V2 should do:
     Accept { readonly name: string } identity objects at the resilience level (the maps are already Map<string, ...> -- the change is to standardize key
     derivation). Alternatively, define a ProviderKey branded type: type ProviderKey = string & { readonly __brand: 'ProviderKey' } with a factory
     function, preventing accidental raw string usage.

     Needs coverage:

     ┌─────────────────────────────┬──────────┬──────────────────────────────────────┐
     │     Current capability      │ Covered? │                Notes                 │
     ├─────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Cross-blockchain uniqueness │ Yes      │ Factory function ensures encoding    │
     ├─────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Type-safe key creation      │ Yes      │ Branded type prevents ad-hoc strings │
     ├─────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Persistence serialization   │ Yes      │ .toString() on branded type          │
     ├─────────────────────────────┼──────────┼──────────────────────────────────────┤
     │ Backward compatibility      │ N/A      │ V2 assumption: clean break           │
     └─────────────────────────────┴──────────┴──────────────────────────────────────┘

     Surface: ~4 files in resilience, ~4 files in blockchain-providers
     Leverage: Medium


     ---
     5. Toolchain and Infrastructure

     ---
     6. File and Code Organization

     [6b] Naming Conventions

     One naming concern: ProviderHealthStore.export() in /Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:102 uses
     a JavaScript reserved word as a method name. While not technically a keyword in property position, it creates confusion in imports and code
     navigation. Rename to toSnapshots() or getSnapshots().

     [6c] Module Size

     All files are well within reasonable bounds. The largest source file is failover.ts at 155 LOC. The largest test file is circuit-breaker.test.ts at
     305 LOC. No files have multiple concerns.

     No material issues found beyond the naming item above.

     ---
     7. Error Handling and Observability

     [7a] No Timeout/Cancellation in Failover

     What exists:
     executeWithFailover in /Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts awaits execute(provider) on line 88 with no timeout, no
     AbortSignal, and no per-attempt duration limit. The FailoverOptions type (/Users/joel/Dev/exitbook/packages/resilience/src/failover/types.ts) has no
     timeout or signal fields.

     The HTTP client in @exitbook/http has its own request-level timeouts, but:
     1. Not all provider operations go through the HTTP client
     2. A provider could hang in non-HTTP logic (data transformation, pagination assembly)
     3. The failover executor has no way to bound total wall-clock time across all attempts

     Why it's a problem:
     A single hung provider blocks the entire failover loop indefinitely. In a CLI enrichment run processing thousands of assets, one hung provider means
     the entire pipeline stalls with no signal to the operator. There is no way for the caller to cancel the operation.

     What V2 should do:
     Add to FailoverOptions:
     - signal?: AbortSignal -- caller-driven cancellation
     - perAttemptTimeoutMs?: number -- per-provider timeout (wraps execute() with AbortSignal.timeout())
     - totalTimeoutMs?: number -- overall failover timeout

     The failover loop should check signal?.aborted before each attempt and AbortSignal.timeout(perAttemptTimeoutMs) around each execute() call.

     Needs coverage:

     ┌──────────────────────────────┬──────────┬───────────────────────────────────┐
     │      Current capability      │ Covered? │               Notes               │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Sequential failover          │ Yes      │ Unchanged                         │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Circuit-aware skip           │ Yes      │ Unchanged                         │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Callback hooks               │ Yes      │ Unchanged                         │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Bounded per-attempt duration │ Yes      │ New: AbortSignal.timeout wrapping │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Caller cancellation          │ Yes      │ New: signal propagation           │
     ├──────────────────────────────┼──────────┼───────────────────────────────────┤
     │ Total operation bound        │ Yes      │ New: deadline check in loop       │
     └──────────────────────────────┴──────────┴───────────────────────────────────┘

     Surface: ~2 files (failover.ts, types.ts), consumers opt-in
     Leverage: High

     ---
     [7b] Silent Failure Path in ProviderHealthStore

     What exists:
     ProviderHealthStore.updateHealth() at /Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:47-60:

     updateHealth(key: string, success: boolean, responseTime: number, errorMessage?: string): void {
       const currentHealth = this.healthStatus.get(key);
       if (currentHealth) {
         // ... update
       } else {
         logger.warn(`updateHealth called for uninitialized provider key: ${key} — call initializeProvider first`);
       }
       // Success/failure counters increment regardless of initialization state
       if (success) {
         this.totalSuccesses.set(key, (this.totalSuccesses.get(key) ?? 0) + 1);
       } else {
         this.totalFailures.set(key, (this.totalFailures.get(key) ?? 0) + 1);
       }
     }

     When called with an uninitialized key, health metrics are silently skipped but lifetime counters are still incremented. The export() method (line 102)
      iterates this.healthStatus -- so the orphaned counter entries are never exported or persisted.

     Why it's a problem:
     This creates a data integrity gap: success/failure counts drift from health state for uninitialized keys. The warning is logged but the counter update
      proceeds, creating a partial state that is invisible to persistence. In a financial system, silent counter drift undermines trust in provider
     statistics.

     What V2 should do:
     Either (a) auto-initialize the provider on first updateHealth call (add it to healthStatus map with initial state), or (b) make updateHealth return
     Result<void, Error> and skip counter updates on failure. Option (a) is simpler and matches the getOrCreate pattern already used in
     CircuitBreakerRegistry.

     Needs coverage:

     ┌─────────────────────────┬──────────┬─────────────────────────────────────────────────────┐
     │   Current capability    │ Covered? │                        Notes                        │
     ├─────────────────────────┼──────────┼─────────────────────────────────────────────────────┤
     │ Health tracking         │ Yes      │ Auto-init or explicit error                         │
     ├─────────────────────────┼──────────┼─────────────────────────────────────────────────────┤
     │ Counter tracking        │ Yes      │ Counters aligned with health                        │
     ├─────────────────────────┼──────────┼─────────────────────────────────────────────────────┤
     │ Warning for caller bugs │ Yes      │ Auto-init logs info; error-result returns to caller │
     └─────────────────────────┴──────────┴─────────────────────────────────────────────────────┘

     Surface: ~1 file, ~1 method
     Leverage: Medium

     ---
     [7c] Observability Readiness

     What exists:
     The failover executor logs at debug (success), info (failure + provider skip), and warn (all providers failed) levels. Circuit state transitions are
     logged by consumers, not by the resilience package itself.

     There is no structured attempt report. When all providers fail, the final error contains only lastError and attemptedProviders (list of names). The
     intermediate errors, response times, and circuit transitions for non-final attempts are logged but not returned in the error object.

     Why it's a problem:
     Diagnosing "all providers failed" requires correlating scattered log lines. A structured attempt report in the error object would make this
     self-contained.

     What V2 should do:
     Add an optional attempts array to the final error path:
     interface FailoverAttempt {
       providerName: string;
       durationMs: number;
       error?: string;
       circuitTransition?: { from: CircuitStatus; to: CircuitStatus };
       blockReason?: string;
     }
     Pass this to buildFinalError alongside lastError and attemptedProviders.

     Surface: ~2 files (failover.ts, types.ts)
     Leverage: Medium

     ---
     V2 Decision Summary

     Rank: 1
     Change: Add timeout/cancellation/AbortSignal to failover
     Dimension: 7a
     Leverage: High
     One-line Rationale: Prevents indefinite hangs in provider execution with no escape hatch
     ────────────────────────────────────────
     Rank: 2
     Change: Eliminate Result-to-throw bridge in failover loop
     Dimension: 3a
     Leverage: High
     One-line Rationale: Removes type-safety loss and mixed error channels in core orchestration
     ────────────────────────────────────────
     Rank: 3
     Change: Narrow IProvider to { readonly name: string }
     Dimension: 2c
     Leverage: Medium-High
     One-line Rationale: Removes unused lifecycle coupling from pure resilience algorithms
     ────────────────────────────────────────
     Rank: 4
     Change: Fix ProviderHealthStore counter drift on uninitialized keys
     Dimension: 7b
     Leverage: Medium
     One-line Rationale: Eliminates silent data integrity gap in provider statistics
     ────────────────────────────────────────
     Rank: 5
     Change: Replace TTL cache with lru-cache
     Dimension: 1a
     Leverage: Medium
     One-line Rationale: Adds memory bounding and eliminates hand-rolled timer lifecycle
     ────────────────────────────────────────
     Rank: 6
     Change: Add per-attempt retry policy to failover
     Dimension: 1c
     Leverage: Medium
     One-line Rationale: Avoids unnecessary provider switches on transient errors
     ────────────────────────────────────────
     Rank: 7
     Change: Introduce branded ProviderKey type
     Dimension: 4a
     Leverage: Medium
     One-line Rationale: Prevents stringly-typed composite key encoding bugs
     ────────────────────────────────────────
     Rank: 8
     Change: Add structured attempt report to failover errors
     Dimension: 7c
     Leverage: Medium
     One-line Rationale: Makes "all providers failed" self-diagnosable without log correlation
     ────────────────────────────────────────
     Rank: 9
     Change: Make provider-scoring internal (remove public export)
     Dimension: 3c
     Leverage: Low
     One-line Rationale: Shrinks public API surface with zero consumer impact
     ────────────────────────────────────────
     Rank: 10
     Change: Rename export() to toSnapshots()
     Dimension: 6b
     Leverage: Low
     One-line Rationale: Avoids reserved-word naming confusion

     What V2 Keeps

     - Pure-function decomposition for circuit breaker state machines
     (/Users/joel/Dev/exitbook/packages/resilience/src/circuit-breaker/circuit-breaker.ts), health metric updates (provider-health.ts), scoring
     (provider-scoring.ts), and selection (provider-selection.ts). This is the best-executed pattern in the package and directly enables mock-free testing.
     - Immutable state transitions in circuit breaker -- functions take state and return new state. The CircuitBreakerRegistry is the single mutable shell
     wrapping pure transitions. This separation is textbook and works well.
     - Generic failover executor design with callback-based side effects (onSuccess, onFailure, buildFinalError, isRecoverableError). The callback
     injection pattern keeps the executor decoupled from both blockchain and price provider concerns.
     - Minimal dependency footprint -- two dependencies (neverthrow, @exitbook/logger) for 2,197 LOC. The package is lightweight and fast to compile.
     - Test quality -- 8 test suites with pure-function testing style, no network calls, no complex mocking. Tests document behavior clearly and run in
     milliseconds.

     Naming clarity suggestions for V2:
     - IProvider -> ProviderIdentity (in resilience core)
     - ProviderHealthStore.export() -> toSnapshots()
     - Package description should drop "retry" until a retry primitive is actually added
