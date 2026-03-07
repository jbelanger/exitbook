# Projection System Refactor

## Problem Statement

When a user runs `links`, `cost-basis`, or `portfolio`, the system must ensure upstream derived data is ready.
Today that logic is split across CLI handlers and `apps/cli/src/features/shared/prereqs.ts`:

- processing freshness is checked in the CLI
- linking freshness is checked in the CLI
- transaction price coverage is checked in the CLI
- reset sequencing is duplicated across `prereqs.ts`, `reprocess-handler.ts`, and `clear-handler.ts`

This is the wrong ownership boundary. The CLI is the host and composition root. It should wire TUI, abort handling, cleanup, and rendering. It should not own derived-data lifecycle rules.

This refactor introduces a projection-native model for persisted derived data, while keeping transaction price enrichment as a separate prerequisite rather than forcing it into the projection graph.

## Goals

- Make freshness and invalidation capability-owned instead of CLI-owned
- Make reset and rebuild operate on real projections, not coarse capability buckets
- Replace bespoke freshness mechanisms with a single projection-state model
- Keep transaction price enrichment out of the projection graph
- Keep the CLI as a thin host-layer orchestrator

## Terminology

### Projection

A persisted derived dataset with its own lifecycle:

- freshness
- invalidation
- reset
- rebuild

### Prerequisite

A consumer readiness check that may trigger work, but does not get its own projection-state row.

### Cache

A technical persistence concern that is not part of projection readiness or reset semantics.

## Explicit Boundary

This design separates three different concepts:

1. `processed-transactions` and `links` are projections
2. Transaction price enrichment is a prerequisite
3. `prices.db` is a cache

That means:

- transaction price coverage is checked when a consumer needs it
- transaction price coverage does not have its own `projection_state` row
- `prices.db` is never part of projection reset or invalidation

## Current Problems

### CLI-Owned Freshness

Today the CLI owns three different readiness checks:

- processed transactions: `raw_data_processed_state` + account hash + import timestamp
- links: timestamp comparison
- price coverage: query for missing prices in a requested window

These checks live in `apps/cli/src/features/shared/prereqs.ts`.

### Duplicated Reset Sequencing

Reset sequencing is duplicated across:

- `apps/cli/src/features/shared/prereqs.ts`
- `apps/cli/src/features/reprocess/reprocess-handler.ts`
- `apps/cli/src/features/clear/clear-handler.ts`

### Wrong Reset Boundary

Current reset ports are capability-wide:

- ingestion reset clears processed transactions and raw processing status
- accounting reset clears links and currently also `utxo_consolidated_movements`

For this refactor, that is not the target model.

`utxo_consolidated_movements` belongs to processed output and should move under the `processed-transactions` projection.

## Target Projection Model

### Current Projections

This refactor models the persisted derived data that exists today:

#### `processed-transactions`

Owned by `@exitbook/ingestion`.

Includes all processing-owned persisted outputs:

- `transactions`
- `transaction_movements` if materialized separately from transactions
- `utxo_consolidated_movements`
- raw processing status reset back to `pending`

#### `links`

Owned by `@exitbook/accounting`.

Includes:

- `transaction_links`

### Future Projections

These are not part of the first implementation cut, but the model is designed to extend to them cleanly:

- `cost-basis`
- `balances`

When those become persisted, they will be added as new projections with their own reset and freshness contracts. They should not be modeled ahead of time in the first implementation if they do not yet exist in storage.

## Projection Graph

### Current Graph

```text
processed-transactions
       |
       +---> links
```

### Future Extension

When persisted cost basis and balances exist, the graph becomes:

```text
processed-transactions
       |
       +---> links
                 |
                 +---> cost-basis
                 |
                 +---> balances
```

Transaction price coverage is intentionally not in this graph.

## Shared Projection Vocabulary

Location: `@exitbook/core`

File: `packages/core/src/projections/projection-definitions.ts`

```ts
export type ProjectionId = 'processed-transactions' | 'links';

export type ProjectionStatus = 'fresh' | 'stale' | 'building' | 'failed';

export interface ProjectionDefinition {
  id: ProjectionId;
  dependsOn: ProjectionId[];
  owner: 'ingestion' | 'accounting';
}

export const PROJECTION_DEFINITIONS: ProjectionDefinition[] = [
  { id: 'processed-transactions', dependsOn: [], owner: 'ingestion' },
  { id: 'links', dependsOn: ['processed-transactions'], owner: 'accounting' },
];
```

When persisted `cost-basis` or `balances` land, extend this file in the same change that adds their storage.

## Projection State Table

The current `raw_data_processed_state` table is replaced by a generalized `projection_state` table.

During migration, both tables can coexist temporarily so the refactor can land incrementally without breaking the old CLI prereq path. The old table is removed only in cleanup.

Location: `packages/data/src/migrations/001_initial_schema.ts`

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

### Column Rationale

| Column                | Purpose                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `projection_id`       | Projection identity from `ProjectionId`                                                                             |
| `scope_key`           | Future-proofing for scoped projections; default is global                                                           |
| `status`              | `building` and `failed` are explicit lifecycle states; for now a lingering `building` row is treated as rebuildable |
| `last_built_at`       | Last successful build                                                                                               |
| `last_invalidated_at` | Last invalidation time                                                                                              |
| `invalidated_by`      | Mutation or upstream projection that invalidated this row                                                           |
| `metadata_json`       | Projection-specific metadata such as account hash fingerprints                                                      |

## Projection State Repository

Location: `packages/data/src/repositories/projection-state-repository.ts`

```ts
export interface ProjectionStateRow {
  projectionId: ProjectionId;
  scopeKey: string;
  status: ProjectionStatus;
  lastBuiltAt: Date | null;
  lastInvalidatedAt: Date | null;
  invalidatedBy: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ProjectionStateRepository {
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

Add `projectionState` to `DataContext`.

## Pure Graph Utilities

Location: `packages/core/src/projections/projection-graph-utils.ts`

```ts
export function cascadeInvalidation(from: ProjectionId): ProjectionId[] {
  // processed-transactions => ['links']
}

export function rebuildPlan(target: ProjectionId): ProjectionId[] {
  // links => ['processed-transactions']
}

export function resetPlan(target: ProjectionId): ProjectionId[] {
  // processed-transactions => ['links', 'processed-transactions']
}
```

These functions stay pure and have no runtime dependencies.

## Projection-Owned Contracts

This refactor replaces capability-wide reset as the architectural target.

The target unit is projection, not capability.

### Ingestion Projection Contracts

Location: `@exitbook/ingestion`

```ts
export interface IProcessedTransactionsFreshness {
  checkFreshness(): Promise<Result<{ status: ProjectionStatus; reason: string | null }, Error>>;
}

export interface IProcessedTransactionsReset {
  countResetImpact(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
  reset(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
}
```

`reset()` owns:

- deleting processed transaction output
- deleting `utxo_consolidated_movements`
- resetting raw processing status

### Accounting Projection Contracts

Location: `@exitbook/accounting`

```ts
export interface ILinksFreshness {
  checkFreshness(): Promise<Result<{ status: ProjectionStatus; reason: string | null }, Error>>;
}

export interface ILinksReset {
  countResetImpact(accountIds?: number[]): Promise<Result<LinksResetImpact, Error>>;
  reset(accountIds?: number[]): Promise<Result<LinksResetImpact, Error>>;
}
```

`reset()` owns:

- deleting `transaction_links`

### Price Coverage Contract

Transaction price coverage stays outside the projection system, but it still should not live in the CLI.

Location: `@exitbook/accounting`

```ts
export interface ITransactionPriceCoverage {
  checkCoverage(input: {
    startDate: Date;
    endDate: Date;
    currency: string;
  }): Promise<Result<{ complete: boolean; reason: string | null }, Error>>;
}
```

`PriceEnrichmentPipeline` remains the rebuild path for this prerequisite.

## Data Adapters

Location: `@exitbook/data`

Create adapters for the new projection contracts:

- `buildProcessedTransactionsFreshnessPorts`
- `buildProcessedTransactionsResetPorts`
- `buildLinksFreshnessPorts`
- `buildLinksResetPorts`
- `buildTransactionPriceCoveragePorts`

This is the point where `utxo_consolidated_movements` moves from the accounting reset adapter into the processed-transactions reset adapter.

## Invalidation Rules

Invalidation happens at mutation points, not in the CLI.

### Processed Transactions

- After import completes: mark `processed-transactions` stale
- After processing rebuild succeeds: mark `processed-transactions` fresh, cascade-invalidate downstream projections

### Links

- After linking rebuild succeeds: mark `links` fresh
- If link overrides or other link mutations occur: mark `links` stale

### Transaction Price Coverage

Transaction price coverage has no projection-state row.

It is checked lazily when a consumer requires it, using the accounting capability's coverage contract.

## Reset Model

Reset is fully projection-native in the target design.

That means:

- planning uses projection ids
- execution uses projection reset contracts
- there is no architectural fallback to capability-wide reset

### Current Reset Semantics

#### Reset `links`

- delete `transaction_links`
- mark `links` stale

#### Reset `processed-transactions`

Use `resetPlan('processed-transactions')`:

1. reset `links`
2. reset `processed-transactions`

Resetting `processed-transactions`:

- deletes processed transaction output
- deletes `utxo_consolidated_movements`
- resets raw processing status
- marks affected projections stale in `projection_state`

There is no independent reset step for transaction price enrichment.

## CLI Composition

The CLI remains the composition root, but now composes projection-native pieces.

### Host Context

The host-layer contract should be explicit:

```ts
export interface HostContext {
  isJsonMode: boolean;
  dataDir: string;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}
```

This can be richer in implementation, but the design should name the host concerns explicitly:

- TUI controller lifecycle
- abort wiring
- provider-manager construction and cleanup
- data-dir access for overrides or caches

### Projection Runtime Registry

The CLI composes a projection runtime registry by projection id.

This is composition, not domain logic.

```ts
interface ProjectionRuntime {
  checkFreshness(): Promise<Result<{ status: ProjectionStatus; reason: string | null }, Error>>;
  rebuild(): Promise<Result<void, Error>>;
  reset(accountIds?: number[]): Promise<Result<void, Error>>;
}

const PROJECTION_RUNTIME: Record<ProjectionId, ProjectionRuntime> = {
  'processed-transactions': { ... },
  'links': { ... },
};
```

## Consumer Readiness API

Replace the current bespoke CLI prereq calls with a consumer-oriented API:

```ts
export async function ensureConsumerInputsReady(
  target: 'links-run' | 'cost-basis' | 'portfolio',
  ctx: HostContext,
  db: DataContext,
  registry: AdapterRegistry
): Promise<Result<void, Error>> {
  const projectionTarget = target === 'links-run' ? 'processed-transactions' : 'links';
  const plan = [...rebuildPlan(projectionTarget), projectionTarget];

  for (const projectionId of plan) {
    const freshness = await PROJECTION_RUNTIME[projectionId].checkFreshness();
    if (freshness.isErr()) return err(freshness.error);

    if (
      freshness.value.status === 'stale' ||
      freshness.value.status === 'failed' ||
      freshness.value.status === 'building'
    ) {
      const rebuild = await PROJECTION_RUNTIME[projectionId].rebuild();
      if (rebuild.isErr()) return err(rebuild.error);
    }
  }

  if (target === 'cost-basis' || target === 'portfolio') {
    const pricing = await ensureTransactionPricesReady(/* command-specific window/currency */);
    if (pricing.isErr()) return err(pricing.error);
  }

  return ok(undefined);
}
```

Semantics are explicit:

- `links-run` ensures `processed-transactions`
- `cost-basis` ensures `processed-transactions` and `links`, then ensures price coverage
- `portfolio` ensures `processed-transactions` and `links`, then ensures price coverage

## Implementation Order

Each phase should leave the repo runnable.

### Phase 1: Foundation

1. Add projection definitions and graph utilities to `@exitbook/core`
2. Add `projection_state` alongside `raw_data_processed_state`
3. Add `ProjectionStateRepository` and `projectionState` to `DataContext`
4. Keep old repo/table/CLI path intact

### Phase 2: New Projection Contracts

1. Add projection-specific freshness and reset contracts:
   - `IProcessedTransactionsFreshness`
   - `IProcessedTransactionsReset`
   - `ILinksFreshness`
   - `ILinksReset`
   - `ITransactionPriceCoverage`
2. Implement new adapters in `@exitbook/data`
3. Keep old capability-wide reset ports temporarily so commands still work

### Phase 3: Move Ownership

1. Move `utxo_consolidated_movements` reset ownership into processed-transactions reset
2. Reduce links reset to `transaction_links` only
3. Add projection-state updates to import, processing, and linking workflows

### Phase 4: Rewrite CLI Orchestration

1. Replace bespoke prereq functions with `ensureConsumerInputsReady`
2. Replace duplicated reset sequencing with `resetPlan(...)` + projection runtime registry
3. Keep TUI, abort, and provider lifecycle in the CLI

### Phase 5: Cleanup

1. Remove `raw_data_processed_state`
2. Remove `RawDataProcessedStateRepository`
3. Remove old capability-wide reset ports if no callers remain
4. Remove old `ensureRawDataIsProcessed`, `ensureLinks`, and `ensurePrices`

## Files to Create

- `packages/core/src/projections/projection-definitions.ts`
- `packages/core/src/projections/projection-graph-utils.ts`
- `packages/core/src/projections/index.ts`
- `packages/ingestion/src/ports/processed-transactions-freshness.ts`
- `packages/ingestion/src/ports/processed-transactions-reset.ts`
- `packages/accounting/src/ports/links-freshness.ts`
- `packages/accounting/src/ports/links-reset.ts`
- `packages/accounting/src/ports/transaction-price-coverage.ts`
- `packages/data/src/repositories/projection-state-repository.ts`
- `packages/data/src/adapters/processed-transactions-freshness-adapter.ts`
- `packages/data/src/adapters/processed-transactions-reset-adapter.ts`
- `packages/data/src/adapters/links-freshness-adapter.ts`
- `packages/data/src/adapters/links-reset-adapter.ts`
- `packages/data/src/adapters/transaction-price-coverage-adapter.ts`

## Files to Modify

- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/data-context.ts`
- `packages/data/src/index.ts`
- `packages/core/src/index.ts`
- `packages/ingestion/src/ports/index.ts`
- `packages/accounting/src/ports/index.ts`
- `packages/ingestion/src/features/import/import-workflow.ts`
- `packages/ingestion/src/features/process/process-workflow.ts`
- `packages/accounting/src/linking/linking-orchestrator.ts`
- `apps/cli/src/features/shared/prereqs.ts`
- `apps/cli/src/features/links/links-run.ts`
- `apps/cli/src/features/cost-basis/cost-basis-handler.ts`
- `apps/cli/src/features/portfolio/portfolio-handler.ts`
- `apps/cli/src/features/reprocess/reprocess-handler.ts`
- `apps/cli/src/features/clear/clear-handler.ts`

## Files to Delete in Cleanup

- `packages/data/src/repositories/raw-data-processed-state-repository.ts`
- old capability-wide reset adapters if fully replaced
- obsolete CLI prereq helpers

## Testing Strategy

### Pure Tests

- `cascadeInvalidation`
- `rebuildPlan`
- `resetPlan`

### Repository Tests

- `ProjectionStateRepository` CRUD and state transitions

### Adapter Tests

- processed-transactions freshness detects account-hash and import-session changes
- links freshness reads projection-state correctly
- processed-transactions reset clears `utxo_consolidated_movements`
- links reset only clears `transaction_links`
- transaction price coverage detects missing coverage for requested window/currency

### E2E

Existing CLI behavior must hold:

- `links run` auto-processes when needed
- `cost-basis` auto-processes, auto-links, and auto-enriches prices when needed
- `portfolio` auto-processes, auto-links, and auto-enriches prices when needed
- `clear` and `reprocess` preserve correct reset order via the projection graph

## Out of Scope

- Persisted `cost-basis` projection implementation
- Persisted `balances` projection implementation
- Projection-scoped concurrency locking
- `prices.db` cache management
- Automatic rebuild on import completion
