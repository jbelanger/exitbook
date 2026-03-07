---
last_verified: 2026-03-07
status: canonical
---

# Projection System Specification

> **Code is law**: If this document disagrees with implementation, the implementation is correct and this spec must be updated.

How exitbook tracks freshness, invalidation, and reset of persisted derived data through a projection graph model.

## Quick Reference

| Concept         | Key Rule                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Projection      | A persisted derived dataset with freshness, invalidation, reset, and rebuild lifecycle                           |
| Prerequisite    | A consumer readiness check that triggers work but has no projection-state row (e.g., transaction price coverage) |
| Cache           | Technical persistence not part of projection readiness or reset (e.g., `prices.db`)                              |
| Graph direction | `processed-transactions` -> `links` (downstream depends on upstream)                                             |
| Ownership       | Each projection's lifecycle is owned by its capability package, not the CLI                                      |
| Price coverage  | Checked lazily by consumers; intentionally outside the projection graph                                          |

## Goals

- **Capability-owned freshness**: Freshness and invalidation rules live in capability packages, not the CLI host.
- **Projection-native reset**: Reset and rebuild operate on projection ids using the dependency graph, not coarse capability buckets.
- **Single state model**: One `projection_state` table replaces bespoke freshness mechanisms.
- **Thin CLI host**: The CLI composes projection runtimes and orchestrates TUI/abort/cleanup, but does not own derived-data lifecycle rules.

## Non-Goals

- Persisted `cost-basis` or `balances` projections (future extension point).
- Projection-scoped concurrency locking.
- `prices.db` cache management or invalidation.
- Automatic rebuild on import completion.

## Definitions

### Projection

A persisted derived dataset with its own lifecycle: freshness, invalidation, reset, and rebuild. Each projection has an owning capability package.

### Projection Status

```ts
type ProjectionStatus = 'fresh' | 'stale' | 'building' | 'failed';
```

- **fresh**: Derived data is up-to-date with its inputs.
- **stale**: Inputs have changed since last build; rebuild needed.
- **building**: Rebuild in progress.
- **failed**: Last rebuild attempt failed.

A lingering `building` row (e.g., after a crash) is treated as rebuildable.

### Projection Definition

```ts
type ProjectionId = 'processed-transactions' | 'links';

interface ProjectionDefinition {
  id: ProjectionId;
  dependsOn: ProjectionId[];
  owner: 'ingestion' | 'accounting';
}
```

### Current Projections

#### `processed-transactions`

Owned by `@exitbook/ingestion`. Includes:

- `transactions`
- `transaction_movements`
- `utxo_consolidated_movements`
- Raw processing status

#### `links`

Owned by `@exitbook/accounting`. Includes:

- `transaction_links`

## Projection Graph

### Current

```
processed-transactions --> links
```

### Future Extension

When persisted cost-basis and balances exist:

```
processed-transactions --> links --> cost-basis
                                 --> balances
```

Transaction price coverage is intentionally not in this graph.

## Data Model

### `projection_state` Table

```sql
CREATE TABLE projection_state (
  projection_id        TEXT NOT NULL,
  scope_key            TEXT NOT NULL DEFAULT '__global__',
  status               TEXT NOT NULL DEFAULT 'stale'
                             CHECK(status IN ('fresh', 'stale', 'building', 'failed')),
  last_built_at        TEXT,
  last_invalidated_at  TEXT,
  invalidated_by       TEXT,
  metadata_json        TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  PRIMARY KEY (projection_id, scope_key)
);
```

#### Field Semantics

| Column                | Purpose                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `projection_id`       | Projection identity from `ProjectionId`                                                 |
| `scope_key`           | Future-proofing for scoped projections; default `__global__`                            |
| `status`              | Current lifecycle state                                                                 |
| `last_built_at`       | Timestamp of last successful build                                                      |
| `last_invalidated_at` | Timestamp of last invalidation                                                          |
| `invalidated_by`      | Mutation or upstream projection that caused invalidation                                |
| `metadata_json`       | Projection-specific data (e.g., account hash fingerprints for `processed-transactions`) |

### Projection State Repository

```ts
interface ProjectionStateRepository {
  get(projectionId: ProjectionId, scopeKey?: string): Promise<Result<ProjectionStateRow | undefined, Error>>;
  upsert(row: ProjectionStateRow): Promise<Result<void, Error>>;
  markStale(projectionId: ProjectionId, invalidatedBy: string, scopeKey?: string): Promise<Result<void, Error>>;
  markBuilding(projectionId: ProjectionId, scopeKey?: string): Promise<Result<void, Error>>;
  markFresh(
    projectionId: ProjectionId,
    metadata: Record<string, unknown> | null,
    scopeKey?: string
  ): Promise<Result<void, Error>>;
  markFailed(projectionId: ProjectionId, scopeKey?: string): Promise<Result<void, Error>>;
}
```

Exposed via `DataContext` as `projectionState`.

## Behavioral Rules

### Graph Utilities

Pure functions in `@exitbook/core` with no runtime dependencies:

- **`cascadeInvalidation(from)`**: Returns downstream projections to invalidate. `processed-transactions` -> `['links']`.
- **`rebuildPlan(target)`**: Returns upstream projections that must be built first. `links` -> `['processed-transactions']`.
- **`resetPlan(target)`**: Returns projections to reset in safe order (downstream first). `processed-transactions` -> `['links', 'processed-transactions']`.

### Invalidation Rules

Invalidation happens at mutation points inside capability workflows, not in the CLI.

#### `processed-transactions`

| Event                       | Action                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Import finalization commits | Mark `processed-transactions` stale; cascade-invalidate downstream (same transaction)         |
| Processing starts           | Mark `processed-transactions` building                                                        |
| Processing succeeds         | Mark `processed-transactions` fresh with account-hash metadata; cascade-invalidate downstream |
| Processing fails            | Mark `processed-transactions` failed                                                          |

#### `links`

| Event                       | Action                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| Linking begins              | Mark `links` building                                                      |
| Linking succeeds            | Mark `links` fresh (inside persistence transaction, atomic with link data) |
| Linking fails               | Mark `links` failed                                                        |
| Link overrides or mutations | Mark `links` stale                                                         |

#### Transaction Price Coverage

No projection-state row. Checked lazily when a consumer (cost-basis, portfolio) requires it, using accounting's coverage contract.

### Reset Rules

Reset is projection-native: planning uses projection ids, execution uses projection reset contracts.

#### Reset `links`

1. Delete `transaction_links`
2. Mark `links` stale

#### Reset `processed-transactions`

Uses `resetPlan('processed-transactions')` -> `['links', 'processed-transactions']`:

1. Reset `links` (downstream first)
2. Reset `processed-transactions`:
   - Delete processed transaction output
   - Delete `utxo_consolidated_movements`
   - Reset raw processing status
   - Mark affected projections stale

No independent reset step for transaction price enrichment.

### Consumer Readiness

Consumers declare what they need; the system walks the graph and rebuilds as necessary:

| Consumer     | Required Projections              | Also Requires Price Coverage |
| ------------ | --------------------------------- | ---------------------------- |
| `links run`  | `processed-transactions`          | No                           |
| `cost-basis` | `processed-transactions`, `links` | Yes                          |
| `portfolio`  | `processed-transactions`, `links` | Yes                          |

The readiness API walks `rebuildPlan(target)` then the target itself, checking freshness and triggering rebuilds for any stale/failed/building projections. Price coverage is checked separately after projections are ready.

### Links Freshness Semantics

- If a `projection_state` row exists, its status is authoritative.
- If no row exists, the adapter falls back to timestamp/no-links heuristics for first-run behavior.

## Ownership Boundaries

### Capability-Owned Projection Contracts

Each projection defines its own freshness and reset interfaces in its owning capability package:

**Ingestion** (`@exitbook/ingestion`):

- `IProcessedTransactionsFreshness` — checks if processing is current
- `IProcessedTransactionsReset` — resets processed output, UTXO consolidations, and raw status

**Accounting** (`@exitbook/accounting`):

- `ILinksFreshness` — checks if links are current
- `ILinksReset` — resets transaction links
- `IPriceCoverageData` — loads transactions for coverage checks

### Capability-Owned Lifecycle Writes

Projection state transitions are written by the same capability ports that own the underlying mutations. There is no generic projection-state writer in `@exitbook/core`.

- **Import ports** expose `invalidateProjections(reason)` — marks `processed-transactions` stale with cascade.
- **Processing ports** expose `markProcessedTransactions{Building,Fresh,Failed}()` — `Fresh` computes and persists account hash, then cascade-invalidates downstream.
- **Linking ports** expose `markLinks{Building,Fresh,Failed}()` — `Building` is called before the linking transaction; `Fresh` runs inside the persistence transaction for atomicity.

### Data Adapters

`@exitbook/data` implements all projection contracts:

- `buildProcessedTransactionsFreshnessPorts`
- `buildProcessedTransactionsResetPorts`
- `buildLinksFreshnessPorts`
- `buildLinksResetPorts`
- `buildPriceCoverageDataPorts`

### CLI Composition

The CLI is the composition root. It builds a projection runtime registry mapping `ProjectionId` to `{ checkFreshness, rebuild, reset }` and uses it for consumer readiness and reset commands. TUI, abort wiring, and provider lifecycle remain CLI concerns.

## Invariants

- **Cascade on mutation**: Any mutation that changes projection inputs must cascade-invalidate downstream projections in the same transaction.
- **Atomic fresh**: `markFresh` for links runs inside the persistence transaction — fresh state commits atomically with link data.
- **Reset order**: Downstream projections are always reset before upstream (enforced by `resetPlan`).
- **No CLI lifecycle logic**: The CLI never directly reads or writes `projection_state`; it delegates through projection runtime contracts.
- **Price coverage excluded**: `prices.db` is never part of projection reset or invalidation.

## Edge Cases & Gotchas

- **Crash during build**: A lingering `building` status after a crash is treated as rebuildable on next consumer readiness check.
- **First run**: No `projection_state` row exists; freshness adapters use fallback heuristics (e.g., "no links exist" implies stale).
- **Account hash metadata**: `processed-transactions` freshness uses an account hash fingerprint stored in `metadata_json` to detect when accounts have changed since last build.
- **`utxo_consolidated_movements` ownership**: Belongs to `processed-transactions` (ingestion), not to links (accounting), despite being related to UTXO accounting concerns.

## Known Limitations (Current Implementation)

- `scope_key` is always `__global__`; per-account scoped projections are not yet implemented.
- Only two projections exist (`processed-transactions`, `links`); `cost-basis` and `balances` will be added when they gain persistent storage.
- No concurrency guard prevents two processes from building the same projection simultaneously.

## Related Specs

- [Price Derivation](./price-derivation.md) — transaction price enrichment pipeline (the prerequisite that lives outside the projection graph)
- [Accounts & Imports](./accounts-and-imports.md) — raw data that feeds into `processed-transactions`

---

_Last updated: 2026-03-07_
