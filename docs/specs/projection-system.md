---
last_verified: 2026-03-14
status: canonical
---

# Projection System Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, update the spec to match code.

How Exitbook tracks freshness, invalidation, and reset of persisted derived data through a projection graph model.

## Quick Reference

| Concept         | Key Rule                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Projection      | A persisted derived dataset with freshness, invalidation, reset, and rebuild lifecycle              |
| Status          | `fresh`, `stale`, `building`, and `failed` are the only projection lifecycle states                 |
| Graph direction | `processed-transactions` -> `asset-review`, `balances`, `links`                                     |
| Scope model     | Most projections are global; `balances` is scoped per owning account via `balance:<scopeAccountId>` |
| Ownership       | Each projection's lifecycle is owned by its capability package, not the CLI                         |
| Price coverage  | Checked lazily by consumers; intentionally outside the projection graph                             |

## Goals

- **Capability-owned freshness**: Freshness and invalidation rules live in capability packages, not the CLI host.
- **Projection-native reset**: Reset and rebuild operate on projection ids using the dependency graph, not coarse capability buckets.
- **Single state model**: One `projection_state` table replaces bespoke freshness mechanisms.
- **Thin CLI host**: The CLI composes projection runtimes and orchestrates TUI/abort/cleanup, but does not own derived-data lifecycle rules.
- **Scoped freshness**: The same projection system supports both global and scope-specific derived data.

## Non-Goals

- Persisted cost-basis projections.
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
- **stale**: Inputs have changed since last build; rebuild is needed.
- **building**: Rebuild is in progress.
- **failed**: The last rebuild attempt failed.

A lingering `building` row after a crash is treated as rebuildable.

### Projection Definition

```ts
type ProjectionId = 'processed-transactions' | 'asset-review' | 'balances' | 'links';

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
- raw processing status

#### `asset-review`

Owned by `@exitbook/ingestion`. Includes:

- `asset_review_state`
- `asset_review_evidence`

#### `balances`

Owned by `@exitbook/ingestion`. Includes:

- `balance_snapshots`
- `balance_snapshot_assets`
- scoped freshness rows keyed by owning balance scope

#### `links`

Owned by `@exitbook/accounting`. Includes:

- `transaction_links`

## Projection Graph

### Current

```text
processed-transactions --> asset-review
processed-transactions --> balances
processed-transactions --> links
```

### Cost-Basis Boundary

Persisted cost-basis exists today only as an artifact cache, not as a
projection.

That means:

- cost-basis does not add a `ProjectionId`
- cost-basis does not get projection-native freshness rows
- cost-basis reads projection freshness from `links` and `asset-review`
- price coverage and artifact reuse remain outside the projection graph

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

| Column                | Purpose                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `projection_id`       | Projection identity from `ProjectionId`                                                  |
| `scope_key`           | Projection scope; global projections use `__global__`, scoped ones provide their own key |
| `status`              | Current lifecycle state                                                                  |
| `last_built_at`       | Timestamp of last successful build                                                       |
| `last_invalidated_at` | Timestamp of last invalidation                                                           |
| `invalidated_by`      | Mutation or upstream projection that caused invalidation                                 |
| `metadata_json`       | Projection-specific data such as account hash fingerprints                               |

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

Exposed via `DataSession` as `projectionState`.

## Behavioral Rules

### Graph Utilities

Pure functions in `@exitbook/core` with no runtime dependencies:

- **`cascadeInvalidation(from)`**: Returns downstream projections to invalidate.
  `processed-transactions` -> `['asset-review', 'balances', 'links']`
- **`rebuildPlan(target)`**: Returns upstream projections that must be fresh before `target` can build.
  `links` -> `['processed-transactions']`
- **`resetPlan(target)`**: Returns projections to reset in safe order, downstream first.
  `processed-transactions` -> `['links', 'balances', 'asset-review', 'processed-transactions']`

### Scope Rules

- `processed-transactions`, `asset-review`, and `links` currently use the default global scope key.
- `balances` uses one row per owning balance scope:
  - `scope_key = balance:<scopeAccountId>`
- Consumers that require one balance scope must check that scope row, not the global row.

### Invalidation Rules

Invalidation happens at mutation points inside capability workflows, not in the CLI.

#### `processed-transactions`

| Event                       | Action                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Import finalization commits | Mark `processed-transactions` stale; cascade-invalidate downstream in the same write path     |
| Processing starts           | Mark `processed-transactions` building                                                        |
| Processing succeeds         | Mark `processed-transactions` fresh with account-hash metadata; cascade-invalidate downstream |
| Processing fails            | Mark `processed-transactions` failed                                                          |

#### `asset-review`

| Event                                  | Action                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `processed-transactions` becomes stale | Mark `asset-review` stale                                                    |
| Asset review override mutation         | Mark `asset-review` stale                                                    |
| Asset review rebuild begins            | Mark `asset-review` building                                                 |
| Asset review rebuild succeeds          | Replace review rows and mark `asset-review` fresh in the same write sequence |
| Asset review rebuild fails             | Mark `asset-review` failed                                                   |

#### `balances`

| Event                                        | Action                                                        |
| -------------------------------------------- | ------------------------------------------------------------- |
| Import or processed transaction mutation     | Mark affected balance scopes stale                            |
| Scoped reset                                 | Delete affected snapshot rows and mark those scope keys stale |
| Balance snapshot rebuild begins              | Mark that scope `building`                                    |
| Balance snapshot rebuild or refresh succeeds | Persist snapshot rows and mark that scope `fresh`             |
| Balance snapshot rebuild or refresh fails    | Mark that scope `failed`                                      |

Balance invalidation is scoped, not global.

#### `links`

| Event                       | Action                                               |
| --------------------------- | ---------------------------------------------------- |
| Linking begins              | Mark `links` building                                |
| Linking succeeds            | Mark `links` fresh inside the persistence write path |
| Linking fails               | Mark `links` failed                                  |
| Link overrides or mutations | Mark `links` stale                                   |

### Reset Rules

Reset is projection-native: planning uses projection ids, execution uses projection reset contracts.

#### Reset `asset-review`

1. Delete `asset_review_state`
2. Delete `asset_review_evidence`
3. Mark `asset-review` stale

#### Reset `balances`

1. Resolve requested accounts to owning balance scope ids
2. Delete `balance_snapshots` and cascading `balance_snapshot_assets` rows for those scopes
3. Mark the affected `balances` scope rows stale

#### Reset `links`

1. Delete `transaction_links`
2. Mark `links` stale

#### Reset `processed-transactions`

Uses `resetPlan('processed-transactions')` -> `['links', 'balances', 'asset-review', 'processed-transactions']`:

1. Reset `links`
2. Reset `balances`
3. Reset `asset-review`
4. Reset `processed-transactions`:
   - delete processed transaction output
   - reset raw processing status
   - mark affected projections stale

### Consumer Readiness

Consumers declare what they need; the system walks the graph and rebuilds as necessary where the consumer uses the generic readiness runtime.

| Consumer      | Required Projections                     | Price Coverage Window                                                      |
| ------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `links run`   | `processed-transactions`                 | None                                                                       |
| `assets view` | `processed-transactions`, `asset-review` | None                                                                       |
| `cost-basis`  | `processed-transactions`, `links`        | Requested reporting window, if both `startDate` and `endDate` are supplied |
| `portfolio`   | `processed-transactions`, `links`        | `new Date(0)` through the requested `asOf` date                            |

The readiness API walks `rebuildPlan(target)` then the target itself, checking freshness and triggering rebuilds for any non-`fresh` projection (`stale`, `failed`, or lingering `building`). Price coverage is checked separately after projections are ready.

`balances` is intentionally different:

- `accounts` / `accounts view` read stored balance snapshots and fail closed when the scoped balance projection is not fresh
- `accounts refresh` is the explicit rebuild-and-refresh path for `balances`
- `assets view` requires fresh balance snapshots separately from asset-review readiness

## Invariants

- **Cascade on mutation**: Any mutation that changes projection inputs must cascade-invalidate downstream projections in the same write path.
- **Reset order**: Downstream projections are always reset before upstream.
- **No CLI lifecycle logic**: The CLI does not own projection-state transitions; it delegates through capability ports and runtimes.
- **Scoped balances**: Balance freshness is always keyed by the owning scope account, not by a child account id.
- **Price coverage excluded**: `prices.db` is never part of projection reset or invalidation.

## Edge Cases & Gotchas

- A lingering `building` status after a crash is treated as rebuildable on the next readiness check.
- On first run, no `projection_state` row may exist; freshness adapters use projection-specific fallback rules.
- `balances` may have no state row and no snapshot row; fail-closed readers treat that as stale-with-never-built rather than as empty data.

## Known Limitations (Current Implementation)

- There is no concurrency guard to prevent two processes from building the same projection at the same time.
- `balances` uses scoped projection rows, but the generic readiness runtime is still oriented around global consumer flows.
- Cost-basis artifact caching is persisted separately from projection state rather than modeled as a projection.

## Related Specs

- [Cost Basis Artifact Storage](./cost-basis-artifact-storage.md) — persisted latest snapshots that intentionally sit outside the projection graph
- [Balance Projection](./balance-projection.md)
- [Asset Review](./asset-review.md)
- [Accounts & Imports](./accounts-and-imports.md)
- [Price Derivation](./price-derivation.md)

---

_Last updated: 2026-03-14_
