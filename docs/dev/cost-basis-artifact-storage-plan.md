# Cost Basis Artifact Storage Plan

Status: revised target design

## Why This Exists

We want two things first:

- avoid recomputing cost basis when the latest result is still safe to reuse
- persist enough post-run state to inspect a calculation after the command exits

Correctness comes before cache hit rate.
The system must not silently reuse stale tax results after upstream price or
projection changes.

## Delivery Shape

This work is split into two phases so we do not start with an incomplete
history feature.

### Phase 1: latest snapshot cache

Ship a single reusable latest snapshot per calculation scope.

This phase includes:

- latest mutable snapshot persistence
- strict freshness checks
- automatic invalidation on price writes
- explicit storage DTOs
- domain-owned artifact orchestration

### Phase 2: pinned history

Add immutable retained history only after there is a minimal management
surface.

This phase includes:

- immutable pins created from an exact snapshot id
- pin list/view/delete surfaces
- optional labels

Pinned history is intentionally not part of the first implementation.
Adding permanent history before retrieval and cleanup surfaces exist would
create a write-only archive.

## Phase 1 Command Semantics

The command behavior for the first implementation should be:

- `exitbook cost-basis ...`
  - ensure upstream inputs are ready
  - load the latest artifact for the exact calculation scope when it is fresh
  - otherwise recompute and replace the latest artifact for that scope
- `exitbook cost-basis ... --refresh`
  - ensure upstream inputs are ready
  - force recomputation and replace the latest artifact for that scope

`--pin` and `--label` move to Phase 2.

## Goals

- Persist the latest successful cost-basis artifact per calculation scope.
- Reuse the latest artifact only when freshness can be proven.
- Automatically invalidate reusable snapshots after price mutations.
- Persist enough debug state to inspect a calculation after the command exits.
- Keep artifact orchestration inside the cost-basis domain rather than growing
  CLI-specific cache logic.
- Fit the existing consumer-readiness model without forcing scoped cost-basis
  artifacts into the global projection graph.

## Non-Goals

- Reintroducing normalized result tables for lots, disposals, transfers, and
  calculations.
- Persisting every successful run forever by default.
- Reusing a snapshot when freshness is uncertain.
- Depending on users to remember `--refresh` after price edits.
- Treating current runtime accounting objects as the persistence format.
- Shipping write-only historical pinning in Phase 1.

## Runtime Model

Today cost basis depends on more than links:

- processed transactions
- asset-review summaries
- confirmed links
- price-complete transaction movement data for the requested date range
- accounting exclusion policy from override events

That means reuse cannot depend on a links-only freshness signal.

For the actual runtime, the host should keep the existing upstream consumer
flow:

- `ensureConsumerInputsReady('cost-basis')` keeps upstream projections ready
- snapshot metadata decides whether a cached artifact is reusable

`cost-basis` should remain a consumer-managed artifact cache in Phase 1.
It should not add a new `ProjectionId` or a dedicated `cost-basis`
`projection_state` row.

The runtime split should be:

1. CLI host ensures consumer inputs are ready.
2. CLI host reads current dependency watermarks:
   - `links.lastBuiltAt`
   - `asset-review.lastBuiltAt`
   - current price-mutation version
   - exclusion fingerprint
3. Accounting artifact orchestration decides reuse vs rebuild.
4. Data stores snapshots and dependency versions.

This keeps prerequisite orchestration in the host while keeping artifact policy
inside the cost-basis domain.

## Scope Identity

The scope key should be derived from calculation inputs that change the math or
rendered amounts:

- `method`
- `jurisdiction`
- `taxYear`
- `startDate`
- `endDate`
- `fiatCurrency` / display currency
- `specificLotSelectionStrategy`
- `taxAssetIdentityPolicy`

The scope key should not include:

- `asset`
- `json`

Those are presentation controls, not calculation identity.
An `--asset` run still computes the full artifact for the scope and applies the
asset filter only at render/output time.

Implementation notes:

- add a shared helper such as
  `buildCostBasisScopeKey(config: CostBasisInput['config']): string`
- use stable JSON encoding plus a short hash
- keep the helper future-proof even though some config fields are not exposed by
  current CLI flags yet
- store human-readable config columns separately for querying and debugging

## Artifact Storage Boundary

Artifact storage must use explicit storage DTOs.

Current accounting runtime shapes contain values such as:

- `Decimal`
- `Date`
- `Map`

Those are valid runtime objects but they are not the persistence contract.

The persisted payload must be plain JSON only:

- strings
- numbers
- booleans
- arrays
- objects
- null

Forbidden in stored payloads:

- `Decimal` instances
- `Date` instances
- `Map`
- class instances
- functions

Repository-level JSON serialization should happen only after converting runtime
objects into storage DTOs.
Do not rely on generic `JSON.stringify` helpers to define the storage format.

### Storage DTO rules

- decimals persist as fixed-point strings
- dates persist as ISO 8601 strings
- maps persist as plain objects or entry arrays
- payloads validate against storage schemas before write
- payloads validate against storage schemas on read

Example boundary:

- runtime `CanadaTaxReport.displayContext.transferMarketValueCadByTransferId: Map<string, Decimal>`
- stored DTO `transferMarketValueCadByTransferId: Record<string, string>`

## Artifact Versioning

One version is not enough.

The storage model needs two independent version gates:

- `storage_schema_version`
  - changes when the persisted DTO shape changes
- `calculation_engine_version`
  - changes when cost-basis semantics change even if the DTO shape stays the
    same

Snapshot reuse requires both versions to match current constants.

This avoids silently reusing artifacts after:

- lot-matching rule changes
- Canada tax-engine fixes
- transfer-fee policy changes
- exclusion semantics changes that do not alter payload structure

## Artifact Model

### Phase 1 latest snapshot

Add a mutable latest snapshot table keyed by cost-basis scope.

Table name:

- `cost_basis_snapshots`

One row per scope key.
Each successful rebuild replaces the prior latest row for that scope.

Recommended columns:

- `scope_key`
- `snapshot_id`
- `storage_schema_version`
- `calculation_engine_version`
- `artifact_kind` (`generic` or `canada`)
- `links_built_at`
- `asset_review_built_at`
- `prices_mutation_version`
- `exclusion_fingerprint`
- `calculation_id`
- `jurisdiction`
- `method`
- `tax_year`
- `display_currency`
- `start_date`
- `end_date`
- `artifact_json`
- `debug_json`
- `created_at`
- `updated_at`

Notes:

- `snapshot_id` identifies the exact built artifact instance
- `scope_key` remains unique for latest-row replacement
- remove the old `input_fingerprint` idea from this design; it was underspecified
  and overlapped with explicit dependency fields

### Phase 1 dependency watermark table

Add a small table that tracks coarse mutable inputs outside the projection graph.

Table name:

- `cost_basis_dependency_versions`

Recommended columns:

- `dependency_name`
- `version`
- `last_mutated_at`

Initial dependency names:

- `prices`

This table is intentionally small and explicit.
Do not overload `projection_state` with non-projection ids just to store this.

### Phase 2 pinned history

Add immutable pinned rows only after list/view/delete surfaces exist.

Table name:

- `cost_basis_snapshot_pins`

Recommended columns:

- `id`
- `source_snapshot_id`
- `scope_key`
- `label`
- `pinned_at`
- `storage_schema_version`
- `calculation_engine_version`
- `artifact_kind`
- `artifact_json`
- `debug_json`

Pins should be immutable copies plus provenance.
They should not depend on the mutable latest row after creation.

## Artifact Schema Validation

Artifact JSON is not an untyped blob.

Each stored payload must be validated against versioned storage schemas on both
write and read.

Required properties of the storage format:

- versioned storage envelope
- artifact kind discriminator
- strict validation before persistence
- strict parsing when loading a stored artifact
- explicit runtime-to-storage mapping
- explicit storage-to-runtime mapping

Recommended schema families:

- `StoredCostBasisArtifactEnvelopeSchema`
- `StoredGenericCostBasisArtifactSchema`
- `StoredCanadaCostBasisArtifactSchema`
- `StoredCostBasisDebugSchema`

Recommended envelope shape:

- `storageSchemaVersion`
- `calculationEngineVersion`
- `kind`
- `scopeKey`
- `snapshotId`
- `calculationId`
- `createdAt`
- `artifact`
- `debug`

Validation behavior:

- before writing:
  - build runtime artifact
  - map runtime artifact to storage DTO
  - validate with storage Zod schema
  - persist only validated JSON
- when reading:
  - parse with `safeParse`
  - if parsing fails, log a warning and treat the snapshot as unreadable
  - unreadable snapshots are rebuilt rather than partially trusted
- when `storage_schema_version` differs from current:
  - treat the snapshot as stale
  - rebuild instead of migrating in place in Phase 1
- when `calculation_engine_version` differs from current:
  - treat the snapshot as stale
  - rebuild even if the payload still parses

Ownership rule:

- storage schemas live with the cost-basis domain, not in `@exitbook/data`
- `@exitbook/data` stores validated JSON strings and metadata
- `@exitbook/accounting` owns artifact shape, mapping, and versioning rules

## What Goes In `artifact_json`

`artifact_json` is the user-facing render payload.
It should contain what the CLI needs to render JSON/TUI output without rerunning
the calculation.

### Generic path

Store the successful render payload:

- calculation
- lots
- disposals
- lot transfers
- generated report, if present

### Canada path

Store the successful render payload:

- calculation
- tax report
- display report

## What Goes In `debug_json`

`debug_json` is not a dump of every reachable runtime object.

It should be a reference-first debug payload:

- store ids and fingerprints for inputs that already live durably elsewhere
- store derived intermediate state that is difficult to reconstruct later
- avoid duplicating raw transactions or links wholesale when ids are sufficient

### Generic path

Recommended debug content:

- `scopedTransactionIds`
- `appliedConfirmedLinkIds`
- `scopedTransactionFingerprints` when ids alone are insufficient
- selected derived matching context that is not recoverable from final lots and
  transfers alone

### Canada path

Recommended debug content:

- storage-safe input event DTOs
- superficial-loss adjustment event DTOs
- event pool snapshots
- final pool state
- disposition records before display shaping

If a future debug need can be satisfied by following ids back into durable
source tables, prefer that over duplicating the full source record inside
`debug_json`.

## Workflow Changes Required

This work is not just "add tables and cache the current workflow result."

The domain needs an explicit artifact builder boundary.

Recommended domain shape:

- `CostBasisWorkflow`
  - remains responsible for business calculation
- new storage-facing orchestration such as `CostBasisArtifactService`
  - decides reuse vs rebuild
  - builds storage DTOs
  - returns render artifact plus debug payload

Recommended storage-facing result shape:

- `artifact`
- `debug`
- `dependencyWatermark`
- `scopeKey`
- `snapshotId`

Do not make the CLI handler scrape internal workflow objects to assemble stored
artifacts.

## Freshness Contract

A latest snapshot is reusable only if all of these are true:

- a latest snapshot row exists for the scope
- the stored `storage_schema_version` matches the current storage schema version
- the stored `calculation_engine_version` matches the current engine version
- the current `links` projection row exists and is `fresh`
- the current `asset-review` projection row exists and is `fresh`
- the current `links.lastBuiltAt` matches snapshot `links_built_at`
- the current `asset-review.lastBuiltAt` matches snapshot
  `asset_review_built_at`
- the current `prices` dependency version matches snapshot
  `prices_mutation_version`
- the accounting exclusion fingerprint is unchanged

If any of that cannot be proven, treat the snapshot as stale and rebuild.

### Exclusion fingerprint

Build this from the effective excluded asset id set loaded from override events.

## Price Mutation Policy

Silent stale reuse after price edits is not acceptable.

Any successful command that mutates persisted transaction price or FX data must
advance the coarse `prices` dependency version.

That includes:

- `prices enrich`
- `prices set`
- `prices set-fx`
- any future command that writes transaction-level price or FX data

False positives are acceptable here.
False negatives are not.

Recommended behavior:

- add a data adapter such as `cost-basis-artifact-invalidation`
- after a successful price write, bump `cost_basis_dependency_versions('prices')`
- when a snapshot is written, record the current `prices` version on the row
- when a snapshot is reused, require version equality

This preserves old latest snapshots for debugging while preventing silent reuse.
It is safer than asking users to remember `--refresh`.

## Projection Boundary Decision

Do not add `cost-basis` to `ProjectionId` in Phase 1.

Why:

- cost-basis artifacts are scoped by calculation config, while the current
  projection runtime is mostly global
- the existing consumer path already knows how to refresh upstream inputs via
  `ensureConsumerInputsReady('cost-basis')`
- artifact reuse is a per-scope cache decision, not a global rebuild target

Implications:

- `processed-transactions`, `asset-review`, and `links` remain the projection
  system inputs cost-basis cares about
- `cost-basis` does not get its own projection-state lifecycle
- snapshot reuse happens only after upstream consumer readiness completes

## CLI UX

### Phase 1 main command

`exitbook cost-basis ...`

Behavior:

1. Ensure upstream inputs are ready with the existing consumer flow.
2. Build current dependency watermark.
3. Build scope key from calculation config.
4. If `--refresh` is not set, try latest snapshot load.
5. If snapshot is reusable, load and render/output it immediately.
6. If snapshot is missing or stale, rebuild.
7. Persist the latest snapshot.
8. Render/output the resulting artifact.

### Phase 1 flags

- `--refresh`

### Phase 2 history UX

Add only with management surfaces:

- `exitbook cost-basis ... --pin [--label "..."]`
- `exitbook cost-basis pins list`
- `exitbook cost-basis pins view --id <pin-id>`
- `exitbook cost-basis pins delete --id <pin-id> --confirm`

## Implementation Shape By File

### Data schema

- `packages/data/src/migrations/001_initial_schema.ts`
  - add `cost_basis_snapshots`
  - add `cost_basis_dependency_versions`
  - add `cost_basis_snapshot_pins` in Phase 2
- `packages/data/src/database-schema.ts`
  - add typed table interfaces

### Data repositories + adapters

- `packages/data/src/repositories/cost-basis-snapshot-repository.ts`
  - `findLatest(scopeKey)`
  - `replaceLatest(snapshot)`
  - `deleteLatest(scopeKeys?)`
- `packages/data/src/repositories/cost-basis-dependency-version-repository.ts`
  - `getVersion(dependencyName)`
  - `bumpVersion(dependencyName)`
- `packages/data/src/adapters/cost-basis-artifact-freshness-adapter.ts`
  - read current links / asset-review built timestamps plus price dependency
    version
- `packages/data/src/adapters/cost-basis-artifact-invalidation-adapter.ts`
  - bump coarse dependency versions after price writes
- `packages/data/src/adapters/cost-basis-reset-adapter.ts`
  - delete latest mutable snapshots only
- Phase 2:
  - `packages/data/src/repositories/cost-basis-snapshot-pin-repository.ts`
    - `createPinFromSnapshot(snapshotId, label?)`
    - `findPinById(id)`
    - `listPins(...)`
    - `deletePin(id)`

### Accounting ports

- `packages/accounting/src/ports/cost-basis-persistence.ts`
  - replace `ICostBasisPersistence` with a more precise read port such as
    `ICostBasisContextReader`
- add a new artifact store port for latest snapshot operations
- add a dependency watermark read port

### Existing data adapter split

- `packages/data/src/adapters/cost-basis-ports-adapter.ts`
  - keep input-loading responsibilities only
- add dedicated artifact-store and dependency-state adapters

### Cost-basis domain orchestration

- add a storage-facing domain service such as
  `packages/accounting/src/cost-basis/orchestration/cost-basis-artifact-service.ts`
  - load latest artifact
  - evaluate freshness
  - rebuild when needed
  - map runtime results to storage DTOs
  - persist latest snapshot

### Projection runtime

- `apps/cli/src/features/shared/projection-runtime.ts`
  - keep `cost-basis` as an upstream consumer target only
  - no new `cost-basis` projection runtime or `ProjectionId`

### Cost-basis command

- `apps/cli/src/features/shared/schemas.ts`
  - add `refresh` to `CostBasisCommandOptionsSchema`
  - add `pin` and `label` only in Phase 2
- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
  - wire `--refresh`
  - keep default command as the main entry point
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
  - keep upstream consumer readiness in the host
  - load current dependency watermark
  - delegate artifact reuse/build policy to the accounting domain service

### Price write commands

After any successful transaction-price mutation:

- call the coarse invalidation adapter
- do not rely on cost-basis callers to repair staleness later

## Rebuild Flow Pseudocode

```ts
await ensureConsumerInputsReady('cost-basis', deps, priceConfig, exclusionPolicy);

const dependencyWatermark = await costBasisArtifactFreshness.readCurrentWatermark({
  exclusionFingerprint,
});

const result = await costBasisArtifactService.execute({
  params,
  refresh: options.refresh,
  dependencyWatermark,
});

return result;
```

Inside the domain service:

```ts
const scopeKey = buildCostBasisScopeKey(params.config);

if (!refresh) {
  const latest = await artifactStore.findLatest(scopeKey);
  if (latest.isOk() && latest.value) {
    const freshness = evaluateArtifactFreshness(latest.value.metadata, dependencyWatermark);
    if (freshness.status === 'fresh') {
      return ok(latest.value.runtimeArtifact);
    }
  }
}

const workflowResult = await workflow.execute(...);
if (workflowResult.isErr()) {
  return workflowResult;
}

const storedSnapshot = buildStoredCostBasisSnapshot(workflowResult.value, dependencyWatermark);
await artifactStore.replaceLatest(storedSnapshot);

return ok(storedSnapshot.runtimeArtifact);
```

## Reset / Clear Behavior

Latest mutable snapshots:

- are not projections and do not get their own projection reset lifecycle
- become unreusable automatically when dependency versions or projection
  timestamps no longer match
- should be deleted by explicit artifact cleanup during `clear` / reprocess style
  derived-data resets

Phase 2 pinned history:

- should not be invalidated
- should not be auto-deleted by derived-data cleanup
- should only be deleted by explicit pin-management actions

## Test Plan

### Storage DTO tests

- generic runtime artifact maps to storage DTO without `Decimal`, `Date`, or
  `Map`
- Canada runtime artifact maps to storage DTO without `Decimal`, `Date`, or
  `Map`
- stored DTO round-trips back into runtime artifact
- unreadable stored payload logs and rebuilds

### Repository tests

- replace latest snapshot
- overwrite latest snapshot for same scope with a new `snapshot_id`
- read and write dependency versions
- Phase 2:
  - create pin from exact snapshot id
  - load pinned snapshot by id
  - delete pin

### Freshness tests

- fresh when storage version, engine version, dependency versions, exclusion
  fingerprint, and upstream timestamps match
- stale when links rebuild later
- stale when asset-review rebuild later
- stale when price dependency version changes
- stale when exclusion fingerprint changes
- stale when storage schema version changes
- stale when calculation engine version changes
- stale when no snapshot exists

### Handler / service tests

- loads fresh snapshot without recomputation
- rebuilds on stale snapshot
- rebuilds on `--refresh`
- does not persist a snapshot when cost-basis fails closed on missing prices
- delegates artifact policy to the accounting domain service rather than
  duplicating it in the CLI handler

### Price write invalidation tests

- `prices enrich` bumps the coarse price dependency version when it changes
  persisted transaction prices
- `prices set` bumps the coarse price dependency version
- `prices set-fx` bumps the coarse price dependency version

### Consumer readiness + reset tests

- `ensureConsumerInputsReady('cost-basis')` still manages only upstream
  projections
- derived-data reset deletes latest mutable cost-basis snapshots
- Phase 2:
  - derived-data reset preserves pinned snapshots

## Design Constraints

- latest artifact is always auto-saved on success
- reuse must fail closed when freshness cannot be proven
- payloads are JSON-first storage DTOs, not raw runtime objects
- cost-basis remains a consumer-managed artifact cache in Phase 1
- cost-basis depends on both `asset-review` and `links`
- successful snapshots are written only after fail-closed price validation
- price writes automatically invalidate snapshot reuse via coarse versioning
- historical pinning is Phase 2 and must ship with management surfaces
