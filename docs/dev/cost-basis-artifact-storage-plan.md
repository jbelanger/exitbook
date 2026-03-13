# Cost Basis Artifact Storage Plan

Status: target design

## Why This Exists

We want three things at the same time:

- fast UI load when the last cost-basis result is still valid
- durable artifacts that make tax/debug workflows easier to inspect
- an explicit way to retain older calculations without turning every routine run
  into permanent history

The design persists cost-basis artifacts so views do not pay full recomputation
cost when a valid result already exists, and so debug state survives after the
command exits.

## Command Semantics

The command behavior should be:

- `exitbook cost-basis ...`
  - load the latest artifact for the exact calculation scope when it is fresh
  - otherwise recompute and replace the latest artifact for that scope
- `exitbook cost-basis ... --refresh`
  - force recomputation and replace the latest artifact for that scope
- `exitbook cost-basis ... --pin [--label "..."]`
  - keep an immutable historical copy of the current result in addition to the
    latest mutable snapshot

The system always maintains one latest mutable artifact per scope.
Historical retention is explicit and separate from the latest snapshot behavior.

## Goals

- Persist the latest successful cost-basis artifact per calculation scope.
- Reuse the latest artifact only when it is provably fresh.
- Keep older calculations only when the user asks for that explicitly.
- Store enough debug detail to make Canada math and generic lot matching easier
  to inspect after the command exits.
- Fit the existing consumer-readiness model without forcing scoped cost-basis
  artifacts into the global projection graph.

## Non-Goals

- Reintroducing the removed normalized tables for lots, disposals, transfers,
  and calculations.
- Persisting every successful run forever by default.
- Historical browsing surfaces such as snapshot listing or ad hoc historical
  load commands.
- Automatically invalidating cached snapshots when `prices.db` changes after a
  successful run.
- Hiding freshness uncertainty. If freshness cannot be proven, rebuild.

## Cost Basis Freshness Inputs

Today cost-basis depends on more than links:

- processed transactions
- asset-review summaries
- confirmed links
- price coverage for the requested date range
- accounting exclusion policy from override events

That means a `links`-only freshness signal is not sufficient on its own.

For the actual runtime, `cost-basis` should depend on:

- `asset-review`
- `links`

`cost-basis` should remain a consumer-managed artifact cache in v1.
It should not add a new `ProjectionId` or a dedicated `cost-basis`
`projection_state` row.

Price completeness remains a runtime prerequisite.
Successful snapshots are written only after cost-basis completes with fail-closed
price validation.
Later price edits or re-enrichment writes are not part of automatic freshness in
v1; users must rerun with `--refresh` after any price mutation.

That yields a two-part runtime model:

- `ensureConsumerInputsReady('cost-basis')` keeps upstream projections ready
- per-scope snapshot metadata decides whether a cached artifact is reusable

## Artifact Model

### 1. Latest Snapshot

Add a mutable latest snapshot table keyed by a cost-basis scope key.

Table name:

- `cost_basis_snapshots`

One row per scope key.
Each successful rebuild replaces the prior row for that scope.

### 2. Pinned History

Add a second immutable table for user-retained historical copies.

Table name:

- `cost_basis_snapshot_pins`

Pinned rows do not participate in freshness.
They are immutable history and should not be invalidated by upstream changes.

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

- `asset` filter
- `json`

Those are presentation controls, not calculation identity.
An `--asset` run still computes the full artifact for the scope and applies the
asset filter only at render/output time.

Implementation note:

- add a shared helper such as
  `buildCostBasisScopeKey(config: CostBasisInput['config']): string`
- use a stable JSON encoding plus a short hash
- also store the human-readable config columns separately for querying and
  debugging

## Data Shape

Artifact storage uses JSON payloads rather than many normalized result tables.

The storage model is payload-first, with a few queryable metadata columns.

Recommended `cost_basis_snapshots` columns:

- `scope_key`
- `artifact_version`
- `artifact_kind` (`generic` or `canada`)
- `input_fingerprint`
- `links_built_at`
- `asset_review_built_at`
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

Recommended `cost_basis_snapshot_pins` columns:

- `id`
- `scope_key`
- `label`
- `snapshot_created_at`
- `pinned_at`
- `artifact_version`
- `artifact_kind`
- `artifact_json`
- `debug_json`

## Artifact Schema Validation

Artifact JSON is not an untyped blob.

Each stored payload must be validated against versioned Zod schemas on both
write and read.

Required properties of the storage format:

- a versioned envelope
- an artifact kind discriminator
- strict validation before persistence
- strict parsing when loading a stored artifact

Recommended shape:

- `CostBasisArtifactEnvelopeSchema`
  - `version`
  - `kind`
  - `scopeKey`
  - `calculationId`
  - `createdAt`
  - `artifact`
  - `debug`

Recommended validation behavior:

- before writing:
  - build the artifact payload
  - validate with Zod
  - persist only validated JSON
- when reading:
  - parse with `safeParse`
  - if parsing fails, log a warning and treat the snapshot as unreadable
  - unreadable snapshots are rebuilt rather than partially trusted
- when the stored artifact version differs from the current schema version:
  - treat the snapshot as stale
  - rebuild instead of attempting in-place migration in v1

Ownership rule:

- the artifact schemas should live with the cost-basis domain, not in
  `@exitbook/data`
- `@exitbook/data` stores validated JSON strings and metadata
- `@exitbook/accounting` owns the artifact shape and versioning rules

## What Goes In `artifact_json`

### Generic path

Store the full successful workflow result needed to render the current UI/JSON
without recomputation:

- calculation summary
- lots
- disposals
- lot transfers
- generated report, if present
- any warnings that affect interpretation

### Canada path

Store the final user-facing artifact:

- calculation
- tax report
- display report

## What Goes In `debug_json`

The point of this work is not only UI speed.
It is also post-run observability.

For Canada, `debug_json` should include at minimum:

- `eventPoolSnapshots`
- final pool state
- disposition records before display shaping
- superficial-loss adjustment events / outputs

For the generic pipeline, `debug_json` can include:

- scoped transactions after exclusions
- confirmed links that were applied
- any lot-matching intermediate details that are hard to recover later

If a debug artifact is large, that is acceptable.
This is debug storage, not the hot path for list queries.

## Freshness Contract

A latest snapshot is reusable only if all of these are true:

- a latest snapshot row exists for the scope
- the stored artifact version matches the current artifact schema version
- the current `links` projection row exists and is `fresh`
- the current `asset-review` projection row exists and is `fresh`
- the current `links.lastBuiltAt` matches the snapshot `links_built_at`
- the current `asset-review.lastBuiltAt` matches the snapshot
  `asset_review_built_at`
- the accounting exclusion policy fingerprint is unchanged

If any of that cannot be proven, treat the snapshot as stale and rebuild.

### Exclusion fingerprint

Build this from the effective excluded asset id set loaded from override events.

### Price mutation policy

Successful snapshots imply price-complete inputs because cost-basis already
fails closed when required prices are missing.

In v1, later price changes are not tracked automatically for snapshot reuse:

- do not add a price-watermark column
- do not add a price-provider freshness contract for snapshot reuse
- after `prices enrich`, `prices set`, `prices set-fx`, or any future price
  write command, users should rerun `exitbook cost-basis ... --refresh`

If this proves too manual later, the next step should be coarse invalidation of
all latest mutable cost-basis snapshots on any price write, not a scoped price
watermark.

## Projection Boundary Decision

Do not add `cost-basis` to `ProjectionId` in v1.

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

`prices.db` stays outside automatic snapshot freshness in v1.
Exclusion overrides stay outside the graph but remain part of automatic
freshness.

## CLI UX

### Main command

`exitbook cost-basis ...`

Behavior:

1. Ensure upstream inputs are ready with the existing consumer flow.
2. Build scope key from calculation config.
3. If `--refresh` is not set, try latest snapshot load.
4. If snapshot is reusable, load and render/output it immediately.
5. If snapshot is missing or stale, rebuild.
6. Persist the latest snapshot.
7. If `--pin` is set, write an immutable pin row.
8. Render/output the resulting artifact.

### Flags

The command surface for this design is:

- `--refresh`
- `--pin`
- `--label <text>`

## Implementation Shape By File

### Data schema

- `packages/data/src/migrations/001_initial_schema.ts`
  - add `cost_basis_snapshots`
  - add `cost_basis_snapshot_pins`
- `packages/data/src/database-schema.ts`
  - add typed table interfaces

### Data repository + adapters

- `packages/data/src/repositories/cost-basis-snapshot-repository.ts`
  - `findLatest(scopeKey)`
  - `replaceLatest(snapshot)`
  - `pinLatest(scopeKey, label?)`
  - `findPinById(id)`
  - `deleteLatest(scopeKeys?)`
- `packages/data/src/adapters/cost-basis-freshness-adapter.ts`
  - compare snapshot metadata against current `asset-review` / `links`
    projection rows plus exclusion fingerprint
- `packages/data/src/adapters/cost-basis-reset-adapter.ts`
  - delete latest mutable snapshots only

### Accounting ports

- `packages/accounting/src/ports/cost-basis-persistence.ts`
  - rename or replace with a read-only context port such as
    `ICostBasisContextReader`
- add a new artifact store port for latest/pin operations

### Existing data adapter split

- `packages/data/src/adapters/cost-basis-ports-adapter.ts`
  - keep input-loading responsibilities
  - do not overload it with artifact persistence without renaming the port shape

### Projection runtime

- `apps/cli/src/features/shared/projection-runtime.ts`
  - keep `cost-basis` as an upstream consumer target only
  - no new `cost-basis` projection runtime or `ProjectionId`

### Cost-basis command

- `apps/cli/src/features/shared/schemas.ts`
  - add `refresh`, `pin`, and `label` to `CostBasisCommandOptionsSchema`
- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
  - wire new flags
  - keep default command as the main entry point
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
  - ensure upstream consumer readiness before snapshot reuse
  - load-if-fresh
  - rebuild-if-stale
  - persist latest
  - optionally pin

## Rebuild Flow Pseudocode

```ts
await ensureConsumerInputsReady('cost-basis', deps, priceConfig, exclusionPolicy);

const scopeKey = buildCostBasisScopeKey(params.config);
let artifact: StoredCostBasisArtifact | undefined;

if (!params.refresh) {
  const freshness = await costBasisFreshness.checkFreshness(scopeKey, params.config);
  if (freshness.isOk() && freshness.value.status === 'fresh') {
    const latestResult = await costBasisSnapshots.findLatest(scopeKey);
    if (latestResult.isOk()) {
      artifact = latestResult.value;
    }
  }
}

if (!artifact) {
  const workflowResult = await workflow.execute(...);
  if (workflowResult.isErr()) {
    return workflowResult;
  }

  artifact = buildStoredCostBasisArtifact(workflowResult.value, debugContext);
  await costBasisSnapshots.replaceLatest(scopeKey, artifact);
}

if (params.pin) {
  await costBasisSnapshots.pinLatest(scopeKey, params.label);
}

return ok(artifact);
```

## Reset / Clear Behavior

Latest mutable snapshots:

- are not projections and do not get their own projection reset lifecycle
- become unreusable automatically when upstream projection timestamps or the
  exclusion fingerprint no longer match
- should be deleted by explicit artifact cleanup during `clear` / reprocess
  style derived-data resets

Pinned history:

- should not be invalidated
- should not be auto-deleted by artifact cleanup
- should only be deleted by an explicit future archive-management action

## Test Plan

### Repository tests

- replace latest snapshot
- overwrite latest snapshot for same scope
- pin latest snapshot
- load pinned snapshot by id

### Freshness tests

- fresh when artifact version, fingerprints, and upstream timestamps match
- stale when links rebuild later
- stale when asset-review rebuild later
- stale when exclusion fingerprint changes
- stale when artifact version changes
- stale when no snapshot exists

### Handler tests

- loads fresh snapshot without recomputation
- rebuilds on stale snapshot
- rebuilds on `--refresh`
- does not persist a snapshot when cost-basis fails closed on missing prices
- pins when `--pin` is passed
- pins a reused fresh snapshot when `--pin` is passed without recomputation

### Consumer readiness + reset tests

- `ensureConsumerInputsReady('cost-basis')` still manages only upstream
  projections
- derived-data reset deletes latest mutable cost-basis snapshots
- derived-data reset preserves pinned snapshots

## Design Constraints

- latest artifact is always auto-saved on success
- historical retention is explicit and uses `--pin`
- payloads are JSON-first, not normalized tables
- cost-basis remains a consumer-managed artifact cache in v1
- cost-basis depends on both `asset-review` and `links`
- successful snapshots are written only after fail-closed price validation
- later price changes require explicit `--refresh` in v1
