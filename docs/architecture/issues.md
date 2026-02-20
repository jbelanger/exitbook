Blockchain-Providers Package Review

1. Architecture

1.1 reinitializeHttpClient leaks the previous HttpClient

Severity: High | core/base/api-client.ts:223-243

reinitializeHttpClient() reassigns this.httpClient without calling close() on the old instance first. This leaks HTTP connections/timers from the original client created in the
constructor. 10 provider implementations call this method.

// Fix: close old client before reassigning
protected reinitializeHttpClient(config: { ... }): void {
void this.httpClient.close(); // ← add this
this.httpClient = new HttpClient(clientConfig);
}

1.2 ProviderManager.executeOneShotImpl silently auto-registers providers

Severity: Medium | core/manager/provider-manager.ts:654-657

executeOneShotImpl calls autoRegisterFromConfig as a side effect if no providers exist, but executeStreamingImpl does not. This inconsistency means streaming calls to an
unregistered blockchain yield NO_PROVIDERS, while one-shot calls silently succeed. Either both paths should auto-register, or neither should (caller's responsibility).

1.3 ProviderOperationType union accepts arbitrary strings

Severity: Medium | core/types/operations.ts:37

export type ProviderOperationType =
| 'getAddressTransactions'
| ...
| (string & {}); // ← defeats type safety

The (string & {}) widener preserves autocomplete but allows any string, meaning supportedOperations arrays and supportsOperation() checks silently pass for misspelled operations.
If custom operations are needed, a branded string or explicit registration is safer.

1.4 Dual deduplication runs on streaming transactions

Severity: Low | core/streaming/streaming-adapter.ts:174 + core/manager/provider-manager.ts:559

The streaming adapter deduplicates inside createStreamingIterator, then the manager deduplicates again in executeStreamingImpl. Both maintain independent DeduplicationWindow
instances. The adapter's dedup is useful for within-provider replay; the manager's dedup handles cross-provider failover. This is correct behavior, but worth documenting explicitly
that double-dedup is intentional, since the two windows diverge over time and could confuse future maintainers.

---

2. Code Quality

2.1 wrapOneShotResult fabricates a meaningless cursor

Severity: High | core/manager/provider-manager.ts:850-870

One-shot results (balance, token metadata) get wrapped with a synthetic CursorState containing type: 'blockNumber', value: 0 and empty lastTransactionId. This dummy cursor is
structurally valid but semantically wrong — a consumer could persist it and attempt to resume from "block 0". Consider using a distinct result type for one-shot results rather than
forcing them into the streaming batch shape.

2.2 scoreProvider hardcodes magic thresholds

Severity: Medium | core/manager/provider-manager-utils.ts:41-73

The scoring function uses 8 hardcoded thresholds (0.5 rps, 1.0 rps, 3.0 rps, 1000ms, 5000ms, etc.) embedded directly in the function body. While the function is pure and testable,
the thresholds are undiscoverable and untunable. Extract them into a ScoringConfig object with defaults — makes testing boundary conditions explicit and allows future
per-blockchain tuning.

2.3 ProviderMetadata defined in two places

Severity: Medium | core/types/registry.ts:37-57 + core/manager/provider-manager-utils.ts:479-484

There's a ProviderMetadata interface in types/registry.ts (the canonical one used by the provider system) and a separate ProviderMetadata in provider-manager-utils.ts:479 (used
only by validateProviderApiKey). The second interface has a subset of fields and a different requiresApiKey type. This shadow type is confusing — validateProviderApiKey should
accept the canonical type directly.

2.4 Error in executeWithCircuitBreaker unwraps Result via throw

Severity: Low | core/manager/provider-manager.ts:748-749

if (result.isErr()) {
throw result.error; // ← escapes Result pattern
}

This converts a Result.err into a thrown exception to reuse the catch block's failover logic. It works but violates the codebase's "no throws" convention for fallible operations.
The try/catch failover logic could be restructured to check result.isErr() inline without throwing.

---

3. Tests

3.1 No integration test for streaming failover with real cursor handoff

Severity: High | core/manager/**tests**/provider-manager.test.ts

The manager test file uses MockProvider instances that return empty transaction arrays and static cursors. There's no test verifying the critical path: Provider A streams N batches
→ fails → Provider B receives adjusted cursor → deduplication window filters replay overlap → batches continue without gaps or duplicates. This is the highest-risk flow in the
package and should have a dedicated multi-provider streaming failover test with realistic cursor and transaction data.

3.2 ProviderResponseCache tests don't cover error caching

Severity: Medium | core/cache/**tests**/provider-response-cache.test.ts

executeOneShotImpl caches the full Result including errors (line 675). If a transient error is cached, all subsequent calls for that key will return the cached error until TTL
expires. There's no test verifying this behavior — either error caching is intentional (document it) or errors should be excluded from caching.

3.3 ProviderStatsStore.save tested only via persistence integration tests

Severity: Medium | core/health/**tests**/provider-stats-store.test.ts

The stats store unit test covers load, initializeProvider, and updateHealth, but save() is only tested through the persistence layer's integration tests. A unit test with a mock
ProviderStatsQueries would catch serialization bugs (e.g., the parseProviderKey split failing for provider names containing /).

3.4 scoreProvider boundary conditions undertested

Severity: Low | core/manager/**tests**/provider-manager-utils.test.ts

The scoring function's thresholds (rps boundaries at 0.5, 1.0, 3.0; response time at 1000ms, 5000ms) are not tested at their exact boundaries. Edge cases like
rateLimit.requestsPerSecond = 0.5 (which gets -40 from <=0.5) vs 0.51 (which gets -20 from <=1.0) aren't verified.

---

4. Performance

4.1 getAvailable does a full scan on every call

Severity: Medium | core/registry/provider-registry.ts:106-109

getAvailable(blockchain: string): ProviderInfo[] {
return Array.from(this.providers.values())
.filter((factory) => getSupportedChains(factory.metadata).includes(blockchain))
.map((factory) => toProviderInfo(factory.metadata));
}

This iterates all registered providers and rebuilds the supportedChains array for each on every call. getAvailable is called during provider creation, config validation, and error
message building. With ~30+ providers across 8 blockchains, this is a linear scan per invocation. A reverse index (Map<blockchain, ProviderFactory[]>) built during register() would
make this O(1).

4.2 ProviderHealthMonitor runs health checks sequentially

Severity: Medium | core/health/provider-health-monitor.ts:56-73

performHealthChecks awaits each provider's isHealthy() call serially in nested loops. With 20+ registered providers, each with potential 5s timeout, a single health check cycle
could take 100+ seconds — longer than the 60-second interval, causing cascading delays. Use Promise.allSettled to parallelize per-blockchain checks.

4.3 findFactory fallback does a linear scan with getSupportedChains per entry

Severity: Low | core/registry/provider-registry.ts:246-255

When the exact key miss occurs (multi-chain provider lookup), findFactory iterates all registered factories calling getSupportedChains and .includes() on each. This is hit during
every provider creation for multi-chain providers. Same fix as 4.1 — a reverse index eliminates the scan.

4.4 Response cache cleanup timer interval equals TTL

Severity: Low | core/cache/provider-response-cache.ts:54

The cleanup interval is set to this.timeoutMs (30s default), meaning entries may live up to 2× TTL before eviction. This is partially mitigated by eager eviction on get(), but
entries never read after expiry accumulate until the next cleanup sweep. For a short-lived CLI this is negligible, but if provider count grows, consider a shorter cleanup interval
(e.g., timeoutMs / 2).
