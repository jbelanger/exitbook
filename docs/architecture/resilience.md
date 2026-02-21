### [1] Hand-Rolled TTL Cache Duplicates a Mature Package

**What exists:**  
`TtlCache` is implemented in `/Users/joel/Dev/exitbook/packages/resilience/src/cache/ttl-cache.ts:18` with manual expiry, periodic cleanup, and lifecycle controls. It is consumed in:

- `/Users/joel/Dev/exitbook/packages/price-providers/src/core/provider-manager.ts:52`
- `/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/manager/provider-manager.ts:56`

**Why it's a problem:**  
This custom cache handles basic TTL but leaves memory-bounding and advanced eviction semantics to app code. It adds custom timer lifecycle behavior that V2 could offload to a battle-tested cache library.

**What V2 should do:**  
Replace `TtlCache` with [`lru-cache`](https://www.npmjs.com/package/lru-cache) (mature, active; GitHub stars and recent npm publish indicate active maintenance as of February 21, 2026).  
Reference: [GitHub](https://github.com/isaacs/node-lru-cache), [npm](https://www.npmjs.com/package/lru-cache).

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Per-key TTL | Yes | Native TTL support |
| `get` / `set` API | Yes | Direct mapping |
| Expired-entry cleanup | Yes | TTL expiry + purge options |
| Clear all cache entries | Yes | Built-in clear API |
| Timer lifecycle control | Partial | Usually unnecessary; can still emulate if needed |

**Surface:** ~5 files, ~10-12 call-sites affected  
**Leverage:** Medium

---

### [2] Provider Contract Boundary Is Too Wide for Resilience Core

**What exists:**  
`IProvider` requires `name` and `destroy()` in `/Users/joel/Dev/exitbook/packages/resilience/src/provider-health/types.ts:10`.  
But resilience selection/health logic only reads `provider.name`:

- `/Users/joel/Dev/exitbook/packages/resilience/src/provider-selection/provider-selection.ts:33`
- `/Users/joel/Dev/exitbook/packages/resilience/src/provider-health/provider-health.ts:106`  
  Tests are forced to stub `destroy()`:
- `/Users/joel/Dev/exitbook/packages/resilience/src/failover/__tests__/failover.test.ts:21`
- `/Users/joel/Dev/exitbook/packages/resilience/src/provider-selection/__tests__/provider-selection.test.ts:12`

**Why it's a problem:**  
Lifecycle concerns leak into pure resilience algorithms, increasing coupling and fake implementation noise.

**What V2 should do:**  
Split contracts:

- `ProviderIdentity` in resilience core (`{ name: string }`)
- `ProviderLifecycle` in manager-layer packages (`destroy()` etc.)

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Provider identification by name | Yes | Kept in core interface |
| Compatibility with provider managers | Yes | Managers compose both interfaces |
| Cleanup lifecycle hooks | Yes | Moved to manager-layer interface |
| Reuse with non-disposable providers | Yes | Core no longer requires `destroy()` |

**Surface:** ~8-9 files, ~24 references affected  
**Leverage:** Medium-High

---

### [3] Failover Uses Two Error Channels (Result + Throw/Catch)

**What exists:**  
`execute` callback is typed as `Promise<Result<...>>` in `/Users/joel/Dev/exitbook/packages/resilience/src/failover/types.ts:17`, but the implementation throws `result.error` and catches it:

- throw: `/Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts:91`
- catch cast: `/Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts:111`

**Why it's a problem:**  
This mixes functional and exception models inside one loop, increasing ceremony and reducing clarity of error provenance.

**What V2 should do:**  
Use one internal error transport in resilience orchestration:

- Preferred: `execute: Promise<T>` and typed thrown errors internally.
- Convert to `Result` only at package boundaries if needed by callers.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Ordered provider failover | Yes | Unchanged loop semantics |
| Recoverable vs non-recoverable classification | Yes | Keep classification callback |
| Circuit updates on success/failure | Yes | Keep hooks/registry integration |
| Typed final error building | Yes | Keep final-error factory |
| Simpler control flow | Yes | Eliminates Result->throw bridge |

**Surface:** ~4-5 files, ~2 core call-sites (+ tests)  
**Leverage:** High

---

### [4] Data Identity Is Stringly-Typed Across Store/Persistence Boundary

**What exists:**  
Resilience store supports remapped string keys (`getHealthMapForKeys`) in `/Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:77`.  
Blockchain wrapper builds/parses composite keys:

- `/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/health/provider-stats-store.ts:22`
- `/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/health/provider-stats-store.ts:29`

**Why it's a problem:**  
Key encoding rules are distributed across modules, and parsing failures are runtime-only.

**What V2 should do:**  
Introduce typed provider IDs (e.g., `{ blockchain, providerName }`) at the resilience boundary and move key serialization to persistence adapters only.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Cross-chain uniqueness | Yes | Explicit typed identity |
| In-memory health map lookup | Yes | Deterministic key derivation |
| Persistence hydration/export | Yes | Adapter serializes/deserializes |
| Provider-name remapping | Yes | Adapter-level mapping, not core |

**Surface:** ~4 files, ~8 call-sites affected  
**Leverage:** Medium

---

### [5] Toolchain & Infrastructure

No material issues found for resilience package scope. Current `tsc --noEmit` + `vitest` setup is proportional, and package tests/build pass (`96` tests passed; build clean).

---

### [6] Public API Surface Is Larger Than Real Usage

**What exists:**  
`provider-scoring` is exported publicly:

- `/Users/joel/Dev/exitbook/packages/resilience/package.json:13`
- `/Users/joel/Dev/exitbook/packages/resilience/src/index.ts:5`  
  But there are no non-test external imports of `@exitbook/resilience/provider-scoring` (consumer scan).

**Why it's a problem:**  
Unneeded public exports become contractual baggage in a rewrite and increase compatibility burden.

**What V2 should do:**  
Make scoring internal to selection, or expose only one higher-level provider-selection API.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Provider scoring logic reuse | Yes | Internal reuse remains |
| Provider ordering by score | Yes | Through selection API |
| Extension hooks for domain bonuses | Yes | Keep `bonusScore` in selection options |

**Surface:** ~2 files, ~0 external call-sites affected  
**Leverage:** Low-Medium

---

### [7] Failover Observability and Failure Safety Are Under-Specified

**What exists:**  
No timeout or cancellation in failover options (`FailoverOptions`) and no `AbortSignal` support:

- `/Users/joel/Dev/exitbook/packages/resilience/src/failover/types.ts:12`
- `/Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts:88`  
  Final failure context collapses to `lastError` + provider names:
- `/Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts:49`
- `/Users/joel/Dev/exitbook/packages/resilience/src/failover/failover.ts:147`  
  Consumers also build final errors from last error only:
- `/Users/joel/Dev/exitbook/packages/price-providers/src/core/provider-manager.ts:210`
- `/Users/joel/Dev/exitbook/packages/blockchain-providers/src/core/manager/provider-manager.ts:705`

Additionally, `updateHealth` warns on uninitialized key but still increments counters, while `export()` serializes only initialized health keys:

- warning/counter increment: `/Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:53`
- export behavior: `/Users/joel/Dev/exitbook/packages/resilience/src/provider-stats/provider-health-store.ts:104`

**Why it's a problem:**  
A hung provider can block failover progression. Postmortem detail is limited. The uninitialized update path can create counter drift that is warned but not strongly prevented.

**What V2 should do:**  
Add:

- per-attempt timeout + cancellation contract,
- structured attempt report (`provider`, `duration`, `blockReason`, `error`, circuit transition),
- explicit policy for uninitialized health updates (fail-fast `Result` or auto-init + deterministic persistence).  
  Mature optional library fit: [`opossum`](https://github.com/nodeshift/opossum) for breaker/fallback primitives, with recent npm activity as of February 21, 2026 ([npm](https://www.npmjs.com/package/opossum)).

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Sequential failover across providers | Yes | Keep provider order policy |
| Circuit-aware skip/half-open handling | Yes | Preserve circuit semantics |
| Recoverable-error classification | Yes | Keep callback or policy mapping |
| Success/failure side-effect hooks | Yes | Preserve hooks/events |
| Bounded attempt duration | Yes | Add timeout/abort |
| Actionable final diagnostics | Yes | Add attempt-level report |

**Surface:** ~5-6 files, ~2 main call-sites (+ failover tests)  
**Leverage:** High

---

## V2 Decision Summary

| Rank | Change                                                         | Dimension | Leverage    | One-line Rationale                                                            |
| ---- | -------------------------------------------------------------- | --------- | ----------- | ----------------------------------------------------------------------------- |
| 1    | Add timeout/cancellation + structured failover attempt reports | 7         | High        | Prevent hangs and make provider failures debuggable under real incidents.     |
| 2    | Unify failover error channel (remove Result->throw bridge)     | 3         | High        | Reduces control-flow complexity and error-context loss in core orchestration. |
| 3    | Narrow resilience core provider contract to identity-only      | 2         | Medium-High | Removes lifecycle leakage and makes core primitives reusable/cleaner.         |
| 4    | Replace custom TTL cache with `lru-cache`                      | 1         | Medium      | Offloads eviction/TTL edge cases to a maintained library.                     |
| 5    | Replace string composite keys with typed provider IDs          | 4         | Medium      | Eliminates brittle key parsing/remapping at storage boundaries.               |
| 6    | Trim unused public exports (`provider-scoring`)                | 6         | Low-Medium  | Shrinks API maintenance surface with near-zero migration risk.                |

## What V2 keeps

- Pure function decomposition for circuit, health, scoring, and selection (`/Users/joel/Dev/exitbook/packages/resilience/src/circuit-breaker/circuit-breaker.ts:9`, `/Users/joel/Dev/exitbook/packages/resilience/src/provider-selection/provider-selection.ts:21`).
- Strong unit-test focus in resilience (`96` tests passing).
- Separation of in-memory resilience state from persistence concerns (keep the concept, but with typed IDs).

Naming clarity suggestions to track in V2 notes:

- `IProvider` -> `ProviderIdentity` (core) and `ProviderLifecycle` (shell).
- `ProviderHealthStore.export()` -> `toSnapshots()` to avoid keyword-shaped naming and clarify intent.
