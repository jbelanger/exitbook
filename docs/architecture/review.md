V3 Architecture Review: Blockchain & Price Provider Managers

Mode: BIG CHANGE | Scope: BlockchainProviderManager + PriceProviderManager

---

1. Architecture (up to 4 issues)

1.1 [HIGH] Two divergent manager implementations solving the same core problem

Evidence: BlockchainProviderManager (719 lines, packages/blockchain-providers/src/core/manager/provider-manager.ts) and PriceProviderManager (329 lines,
packages/price-providers/src/core/provider-manager.ts) both implement: provider registration, circuit breaker integration, health tracking, failover
orchestration, response caching, and cleanup lifecycle. They share the same dependencies (CircuitBreakerRegistry, TtlCache, executeWithFailover,
selectProviders) from @exitbook/resilience.

Problem: The blockchain manager has evolved significantly beyond the price manager — it has ProviderStatsStore with SQLite persistence,
ProviderHealthMonitor background tasks, event bus integration, instrumentation hooks, ProviderInstanceFactory, and preferred-provider logic. The price
manager has none of this. As new cross-cutting concerns emerge (e.g., observability, persistent stats for price providers), they'll need to be
implemented twice.

Recommendation: Extract a generic ProviderManager<TProvider, TOperation> base that owns the circuit-breaker + health-store + failover + cache + lifecycle
pattern. Both managers become thin wrappers adding domain-specific behavior (streaming/cursor for blockchain, stablecoin conversion for price). The
@exitbook/resilience package already provides the primitives — the missing piece is the orchestration layer above them.

Surface: ~1050 lines across both managers + ~520 lines across both utils files. ~15 consumer call-sites across ingestion, CLI, and accounting packages.

---

1.2 [MEDIUM] PriceProviderManager lacks persistence and background health monitoring

Evidence: BlockchainProviderManager has ProviderStatsStore with load/save SQLite persistence (provider-stats-store.ts:92-145), ProviderHealthMonitor for
periodic health checks (provider-health-monitor.ts), and event bus integration. PriceProviderManager has none of these — health metrics are in-memory
only and lost on restart.

Problem: Price provider health state resets every CLI invocation. A provider that was failing gets retried from scratch. There's no observability into
price provider selection. The factory (factory.ts:250-276) creates a manager but never wires persistence or monitoring.

Recommendation: Wire ProviderHealthStore persistence for price providers (similar to createProviderManagerWithStats pattern). Consider whether the
ProviderHealthMonitor pattern makes sense for price providers (they may not have health-check endpoints, but the stats persistence alone is valuable).

Surface: factory.ts, provider-manager.ts in @exitbook/price-providers. 1 factory file + 1 manager class.

---

1.3 [MEDIUM] BlockchainProviderManager mixes provider lifecycle, failover orchestration, and event emission in one class

Evidence: provider-manager.ts is 719 lines handling: provider registration (lines 255-267), auto-registration from config (lines 94-133), streaming
failover with dedup (lines 403-582), one-shot failover with caching (lines 587-717), health monitoring wiring (constructor), event bus hook wiring (lines
314-369), stats persistence (lines 297-308), and circuit breaker emission (lines 371-398).

Problem: Adding a new concern (e.g., request tracing, retry budgets) requires modifying this class. The streaming failover loop (executeStreamingImpl) at
~180 lines is the most complex method and hardest to test — evidenced by 4 it.skip tests in provider-manager-streaming.test.ts:298-411 for failover
scenarios.

Recommendation: Consider separating the streaming failover orchestrator into its own module (similar to how executeWithFailover was extracted to
@exitbook/resilience for one-shot operations). The streaming analog could be executeStreamingWithFailover taking the same configuration pattern. This
would make the 4 skipped tests testable against the isolated orchestrator.

Surface: executeStreamingImpl (180 lines), 4 skipped test cases.

---

1.4 [LOW] Post-construction setter ceremony for wiring cross-cutting concerns

Evidence: BlockchainProviderManager requires a 4-step initialization dance: construct → startBackgroundTasks() → setStatsQueries() →
loadPersistedStats(), plus optional setEventBus() and setInstrumentation(). The syncFactoryContext() method (line 314) rebuilds the factory context on
each setter call, using closures that capture this.eventBus/this.instrumentation at call time.

Problem: The factory in provider-manager-factory.ts:39-85 shows how complex this wiring gets. Forgetting a step or calling them out of order can cause
subtle issues (e.g., loadPersistedStats before setStatsQueries silently no-ops). The closure-based hook approach (buildHttpClientHooks at line 317) is
clever but means hooks are reconstructed on every setter call.

Recommendation: Consider a builder pattern or a single initialize(config) method that validates all required dependencies are present. The
closures-over-this pattern works but could be simplified if instrumentation/eventBus were required at construction time (passed via options).

Surface: 5 setter methods on BlockchainProviderManager, 1 factory file, ~6 CLI entry points that wire the manager.

---

2. Code Quality (up to 4 issues)

3. Tests (up to 4 issues)

3.1 [HIGH] 4 streaming failover tests are skipped

Evidence: provider-manager-streaming.test.ts:298, 335, 368, 497 — all in the "Failover Scenarios" describe block and one in "Deduplication":

- it.skip('should failover to second provider when first fails mid-stream')
- it.skip('should yield error when all providers fail')
- it.skip('should preserve cursor state during failover')
- it.skip('should deduplicate across failover boundary')

The comment at line 297 says: "Note: These tests require full integration testing with real provider implementations. The mock approach doesn't fully
simulate the streaming iteration behavior."

Problem: These are the most critical behavioral tests for the streaming failover system — the exact scenarios where bugs cause data loss or duplicate
transactions in a financial application. They're all skipped.

Recommendation: The MockProvider in the test (line 24-102) doesn't implement destroy(), which means it can't be registered properly with the manager. Fix
the mock to implement the full IBlockchainProvider interface and unskip these tests. The mock is close — it just needs the destroy method and possibly
proper type assertions.

Surface: 4 test cases covering the most critical failover paths.

---

3.2 [MEDIUM] BlockchainProviderManager test accesses private field via type assertion

Evidence: provider-manager.test.ts:423, 443, 463, 501:
(manager as unknown as { preferredProviders: Map<string, string> }).preferredProviders.set('ethereum', 'routescan');

Problem: 4 tests directly mutate private preferredProviders via as unknown as. This creates a tight coupling to the internal representation. If the field
is renamed or restructured, all 4 tests break silently (TypeScript won't catch it since as unknown as bypasses all checks).

Recommendation: Either expose a public setPreferredProvider(blockchain, name) method (it's a legitimate operation for the CLI), or test
preferred-provider behavior through autoRegisterFromConfig which naturally sets the preferred provider.

Surface: 4 test cases in the "Preferred Provider Behavior" describe block.

---

3.3 [MEDIUM] Price manager test mocks logger globally, masking real issues

Evidence: provider-manager.test.ts:19-26:
vi.mock('@exitbook/logger', () => ({
getLogger: () => ({
debug: vi.fn(),
error: vi.fn(),
info: vi.fn(),
warn: vi.fn(),
}),
}));

The blockchain manager tests don't mock the logger at all — they let it run naturally (line 1-10 of blockchain test file, no logger mock).

Problem: By mocking the logger globally, warning and error logs that might indicate real issues during test execution are silently swallowed. The
blockchain manager tests prove the logger doesn't interfere with test execution when left unmocked.

Recommendation: Remove the logger mock. If specific tests need to verify logging behavior, use vi.spyOn on the specific logger instance.

Surface: 1 mock affecting all 14 test cases in the price manager test file.

---

3.4 [LOW] No test coverage for ProviderStatsStore.save() round-trip

Evidence: provider-stats-store.ts:116-145 — the save() method iterates snapshots and upserts each one. There are tests for load() behavior (via
provider-manager.test.ts lifecycle tests) but no test that verifies save → load round-trip integrity.

Problem: The save path serializes health metrics + circuit state into a flat DB row. If field mapping changes (e.g., the avgResponseTime column vs
averageResponseTime property), there's no test to catch the mismatch.

Recommendation: Add an integration test that saves stats, clears in-memory state, reloads, and verifies the round-trip preserves all fields.

Surface: 1 method (30 lines), no direct test coverage.

---

4. Performance (up to 4 issues)

4.2 [MEDIUM] PriceProviderManager.selectProvidersForOperation calls getMetadata() per provider per request

Evidence: provider-manager-utils.ts:121-124:
const metadataCache = new Map<string, ProviderMetadata>();
for (const p of providers) {
metadataCache.set(p.name, p.getMetadata());
}

This builds a local metadata cache, but it's rebuilt on every fetchPrice call. With the price enrichment pipeline processing thousands of prices,
getMetadata() is called 6× per price request (once per provider).

Problem: Provider metadata is immutable after construction. Calling getMetadata() thousands of times for the same static data is wasteful. The blockchain
manager avoids this by embedding capabilities directly on the provider interface (provider.capabilities), not behind a method call.

Recommendation: Either cache metadata at registration time in the manager, or align with the blockchain pattern where capabilities are a direct property.

Surface: 1 function, called ~6,000 times during a typical prices enrich run (1000 prices × 6 providers).

---

4.3 [LOW] BlockchainProviderManager.destroy() serializes stats save before provider cleanup

Evidence: provider-manager.ts:140-175:
async destroy(): Promise<void> {
this.healthMonitor.stop();
this.responseCache.stopAutoCleanup();
try {
await this.statsStore.save(this.circuitBreakers); // Blocks here
} catch (error) { ... }
const closePromises: Promise<void>[] = [];
for (const providerList of this.providers.values()) { ... }
await Promise.allSettled(closePromises); // Then waits for providers

Problem: Stats save and provider cleanup are independent operations but run sequentially. On a slow SQLite write, this extends shutdown time
unnecessarily.

Recommendation: Run statsStore.save() and provider destroy() calls in parallel via Promise.allSettled.

Surface: 1 method, affects CLI shutdown time.

---

4.4 [LOW] ProviderHealthMonitor checks all providers on every tick regardless of registration time

Evidence: provider-health-monitor.ts:65-79 — iterates all registered providers every 60 seconds:
for (const [blockchain, providers] of this.getProviders().entries()) {
for (const provider of providers) {
checks.push(this.checkProviderHealth(blockchain, provider));
}
}

Problem: When many blockchains are registered (e.g., 10+ blockchains × 2-3 providers each), all health checks fire simultaneously every minute. This
creates burst API traffic and may trigger rate limits on providers that have low rate limits (e.g., requestsPerSecond: 0.5).

Recommendation: Stagger health checks or only check providers that have been used recently. A simple improvement: track lastUsed timestamp per provider
and skip health checks for providers unused in the last 5 minutes.

Surface: 1 method, affects background traffic during long-running CLI sessions.
