# Asset Review Read Model Plan

This document defines the next implementation plan for suspicious-asset review
after the first slice landed.

It is subordinate to:

- `docs/dev/token-metadata-enrichment-under-analysis.md`

The goal is not to add another SQLite file or explode the schema into four new
capabilities in one pass.

The goal is:

- keep the override store as the audit trail for user intent
- stop recomputing asset review state ad hoc inside CLI read paths
- fix asset-scoping bugs in current evidence derivation
- persist a small current-state read model in `transactions.db`
- keep provider/reference cache data in `token-metadata.db`
- make accounting block only on the evidence classes the plan actually intended
- make `assets view` show real evidence, not only a flattened warning string

## Goals

- Keep `asset facts`, `risk evidence`, `reference evidence`, and `review state`
  conceptually separate.
- Do not introduce a new physical database file in this phase.
- Keep the override store for `confirm`, `clear`, `exclude`, and `include`
  events.
- Add a persisted asset-review read model backed by SQL tables in
  `transactions.db`.
- Make `cost-basis` and `portfolio` read projected review state instead of
  recomputing it from raw transactions at command time.
- Restrict accounting blocking to:
  - unresolved same-symbol ambiguity
  - unresolved high-confidence risk evidence
- Allow warning-only evidence to remain visible in `assets view` without
  automatically breaking accounting.
- Show structured evidence in `assets view`, including same-symbol collision
  details.

## Non-Goals

- Adding a new `asset-review.db`.
- Replacing the override store.
- Moving CoinGecko/reference cache tables out of `token-metadata.db` in this
  phase.
- Adding four separate persisted table groups for the four conceptual concerns.
- Integrating asset review into the full `projection_state` graph in this
  phase.
- Solving non-EVM trust semantics beyond the current first-slice scope.

## Current Problems

### 1. Review state is recomputed inside read paths

Current files:

- `apps/cli/src/features/shared/asset-review-runtime.ts`
- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
- `apps/cli/src/features/portfolio/command/portfolio-handler.ts`

Today the system does this every time:

1. load all processed transactions
2. read override events
3. open `token-metadata.db`
4. resolve CoinGecko references
5. rebuild review summaries in memory

That is simple to start with, but it creates three problems:

- every consumer owns a copy of the review-assembly path
- review state is not queryable as first-class persisted data
- small evidence bugs affect every consumer at once

### 2. Transaction-scoped scam notes are too coarse

Current files:

- `packages/ingestion/src/features/process/base-transaction-processor.ts`
- `packages/ingestion/src/features/scam-detection/scam-detection-service.ts`
- `packages/ingestion/src/features/asset-review/asset-review-service.ts`

`SCAM_TOKEN` and `SUSPICIOUS_AIRDROP` notes are attached at the transaction
level, then review evidence is derived by iterating every asset in the
transaction.

That can incorrectly mark unrelated assets in the same transaction, especially:

- native fee assets such as ETH
- multi-asset transactions where only one token triggered scam heuristics

### 3. Accounting blocks on UI workflow state instead of evidence policy

Current files:

- `packages/accounting/src/cost-basis/shared/asset-review-preflight.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts`
- `packages/accounting/src/cost-basis/canada/canada-acb-workflow.ts`

The current gate treats any `needs-review` asset as blocking.

That is broader than the design in the original plan, which only called for
fail-closed behavior on unresolved ambiguity and unresolved high-confidence
spam/spoof signals.

### 4. `assets view` does not surface enough evidence

Current files:

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/assets/view/assets-view-components.tsx`

The current TUI mostly shows:

- review badge
- reference badge
- one warning summary string

It does not show:

- individual evidence items
- same-symbol conflicting asset IDs
- enough detail to make confirm vs exclude a well-informed action

## Decision Summary

### 1. Keep the override store

The override store remains the write-side audit log for:

- `asset-review-confirm`
- `asset-review-clear`
- `asset-exclude`
- `asset-include`

We are not replacing it.

### 2. Add a small persisted read model in `transactions.db`

Add two new tables to `packages/data/src/migrations/001_initial_schema.ts`:

- `asset_review_state`
- `asset_review_evidence`

This is the only new persistence shape in this phase.

### 3. Keep provider/reference caches in `token-metadata.db`

Do not move these current tables:

- `token_metadata`
- `token_reference_matches`
- `reference_platform_mappings`

Those remain cache/reference data, not user workflow state.

### 4. Add an asset-review projector, not a new database

The new flow is:

1. read processed transactions
2. read review decisions from override store
3. read cached token/reference evidence
4. compute current review state
5. replace the persisted read model tables

### 5. Block accounting only on blocking evidence

Use a separate pure policy function.

Rules for this phase:

- `same-symbol-ambiguity` remains blocking even if a user confirmed one asset
- warning-only evidence never blocks accounting by itself
- high-confidence `error` evidence blocks while unresolved
- user confirmation may resolve non-ambiguity high-confidence evidence

### 6. `assets view` reads persisted review state

`assets view`, `cost-basis`, and `portfolio` should all read the same persisted
review projection.

No consumer should rebuild review summaries directly in its handler.

## Target Data Model

### `asset_review_state`

Add to:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Columns:

- `asset_id text primary key`
- `review_status text not null`
  - `clear`
  - `needs-review`
  - `reviewed`
- `reference_status text not null`
  - `matched`
  - `unmatched`
  - `unknown`
- `warning_summary text null`
- `evidence_fingerprint text not null`
- `confirmed_evidence_fingerprint text null`
- `confirmation_is_stale integer not null`
- `accounting_blocked integer not null`
- `computed_at text not null`

Indexes:

- primary key on `asset_id`
- index on `review_status`
- index on `accounting_blocked`

### `asset_review_evidence`

Add to:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Columns:

- `id integer primary key autoincrement`
- `asset_id text not null`
- `position integer not null`
- `kind text not null`
- `severity text not null`
- `message text not null`
- `metadata_json text null`

Indexes:

- unique index on `(asset_id, position)`
- index on `asset_id`
- index on `kind`

Notes:

- `metadata_json` is acceptable here because it is secondary detail for a
  finite set of evidence types.
- Do not add a separate collision table in this phase.
- Store conflicting asset IDs for ambiguity evidence inside `metadata_json`.

## Target Package Ownership

### `packages/core`

Keep core types in:

- `packages/core/src/asset-review/asset-review.ts`

Add:

- `accountingBlocked: boolean` to `AssetReviewSummarySchema`

Optional rename candidates:

- `AssetReviewSummary` -> `AssetReviewSnapshot`
- `AssetReviewDecisionInput` -> `AssetReviewOverrideDecision`

Do not do rename churn in the same commit as schema introduction. Stage it
after behavior is green.

### `packages/ingestion`

`packages/ingestion/src/features/asset-review/` should own:

- pure evidence collection
- review outcome policy
- projection rebuilding workflow
- the store port interface

Recommended files:

- `asset-review-compute.ts`
- `asset-review-policy.ts`
- `asset-review-projector.ts`
- `index.ts`

Keep `asset-review-service.ts` only if the new split is too much churn for one
PR. If retained, narrow its responsibility to pure compute logic only.

### `packages/data`

`packages/data` should implement the store and read model:

- `packages/data/src/repositories/asset-review-repository.ts`
- repository tests beside it

### `apps/cli`

CLI should compose and consume the capability. It should not own review
computation logic.

## Phase 0: Correct Current Evidence Semantics First

Do this before adding persistence so we do not freeze incorrect state into the
new tables.

### Files

- `packages/ingestion/src/features/scam-detection/scam-detection-service.ts`
- `packages/ingestion/src/features/process/base-transaction-processor.ts`
- `packages/ingestion/src/features/asset-review/asset-review-service.ts`
- `packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts`
- `packages/ingestion/src/features/scam-detection/__tests__/...`

### Changes

1. Make scam notes target a specific asset.

Add precise note metadata where available:

- `assetId`
- `contractAddress`
- `assetSymbol`

Pseudo-code:

```ts
scamNote = {
  type: 'SCAM_TOKEN',
  severity: 'error',
  message,
  metadata: {
    assetId: movement.assetId ?? undefined,
    contractAddress: movement.contractAddress ?? undefined,
    assetSymbol: movement.asset,
    detectionSource,
  },
};
```

2. Change review evidence collection to use targeted note matching.

Add helper:

```ts
function noteAppliesToAsset(note: TransactionNote, assetId: string, assetSymbol: string): boolean {
  if (note.metadata?.assetId === assetId) return true;
  if (note.metadata?.contractAddress && assetId.endsWith(`:${note.metadata.contractAddress.toLowerCase()}`))
    return true;
  if (note.metadata?.assetSymbol === assetSymbol) return true;
  return false;
}
```

3. Do not let fee/native assets inherit scam evidence unless the note actually
   targets that asset.

### Required tests

- token inflow + ETH fee + scam note on token only -> only token asset gets
  evidence
- multi-asset transaction with one suspicious token -> other asset stays clear
- warning-only note -> asset can still be `needs-review`, but blocking policy is
  not yet asserted here

## Phase 1: Add Persisted Asset Review Tables

### Files

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/asset-review-repository.ts`
- `packages/data/src/repositories/__tests__/asset-review-repository.test.ts`
- `packages/data/src/index.ts`

### Repository API

Start simple:

```ts
interface IAssetReviewRepository {
  replaceAll(rows: {
    states: AssetReviewStateRowInput[];
    evidence: AssetReviewEvidenceRowInput[];
  }): Promise<Result<void, Error>>;

  listAll(): Promise<Result<AssetReviewSummary[], Error>>;

  getByAssetIds(assetIds: string[]): Promise<Result<Map<string, AssetReviewSummary>, Error>>;
}
```

Implementation notes:

- `replaceAll()` should execute in one SQL transaction
- delete from `asset_review_evidence`
- delete from `asset_review_state`
- insert all state rows
- insert all evidence rows

Do not build incremental merge logic in this phase.

Full replacement is simpler and acceptable for now.

## Phase 2: Split Pure Compute From Projection Persistence

### Files

- `packages/ingestion/src/features/asset-review/asset-review-policy.ts`
- `packages/ingestion/src/features/asset-review/asset-review-projector.ts`
- `packages/ingestion/src/features/asset-review/index.ts`
- `packages/ingestion/src/index.ts`

### Pure functions to add

```ts
function collectAssetEvidenceCandidates(...): Map<string, AssetReviewEvidence[]>
function deriveReviewStatus(...): AssetReviewStatus
function deriveAccountingBlocked(...): boolean
function buildWarningSummary(...): string | undefined
function computeEvidenceFingerprint(...): Promise<string>
```

### Projector function

```ts
async function rebuildAssetReviewProjection(params: {
  transactions: UniversalTransactionData[];
  reviewDecisions: ReadonlyMap<string, AssetReviewOverrideDecision>;
  tokenMetadataReader?: AssetReviewTokenMetadataReader;
  referenceResolver?: AssetReviewReferenceResolver;
  store: IAssetReviewStore;
}): Promise<Result<void, Error>>;
```

Pseudo-code:

```ts
const computed = await computeAssetReviewStates(transactions, deps);
return store.replaceAll({
  states: computed.states,
  evidence: computed.evidence,
});
```

### Blocking policy

Implement in `asset-review-policy.ts`, not in accounting.

Rules for `accountingBlocked`:

```ts
const hasAmbiguity = evidence.some((item) => item.kind === 'same-symbol-ambiguity');
const hasResolvableError = evidence.some((item) => item.severity === 'error' && item.kind !== 'same-symbol-ambiguity');

if (hasAmbiguity) return true;
if (reviewStatus === 'needs-review' && hasResolvableError) return true;
return false;
```

This intentionally keeps ambiguity stricter than user confirmation in the first
phase.

## Phase 3: Wire Rebuild Into Processing And Review Commands

### Files

- `packages/ingestion/src/features/process/process-workflow.ts`
- `apps/cli/src/features/shared/asset-review-runtime.ts`
- `apps/cli/src/features/assets/command/assets-handler.ts`

### Processing workflow wiring

After successful processing and before marking `processed-transactions` fresh:

1. load all processed transactions with `includeExcluded: true`
2. read asset review decisions from override store
3. rebuild the asset review projection
4. if rebuild fails, fail the workflow

Pseudo-code in `process-workflow.ts`:

```ts
const txs = await this.ports.transactions.findAll({ includeExcluded: true });
const decisions = await this.ports.assetReviewOverrides.readDecisions();
const rebuild = await this.assetReviewProjector.rebuild({ transactions: txs, reviewDecisions: decisions });
if (rebuild.isErr()) return err(rebuild.error);
```

If the current `ProcessingPorts` shape makes that awkward, add the missing port
methods rather than building this inside CLI-only code.

### Review command wiring

For `confirm` and `clear-review`:

1. append override event
2. rebuild full asset review projection
3. reload the updated state for the selected asset
4. return that state to the caller

Do not do targeted in-place mutation yet.

A full rebuild is simpler and safe for the current phase.

### Exclude/include wiring

Do not rebuild the review projection on `exclude` or `include`.

Reason:

- exclusion remains accounting policy, not review state
- the exclusion badge can keep reading from the override store

## Phase 4: Switch Consumers To Read The Persisted Projection

### Files

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
- `apps/cli/src/features/portfolio/command/portfolio-handler.ts`
- `apps/cli/src/features/shared/asset-review-runtime.ts`
- related test files in the same directories

### Replace current runtime helper

Replace `loadAssetReviewSummaries()` with two narrower helpers:

- `readAssetReviewProjection()`
- `rebuildAssetReviewProjection()`

Suggested shape:

```ts
async function readAssetReviewProjection(
  db: DataContext,
  assetIds?: string[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>>;
```

```ts
async function rebuildAssetReviewProjection(db: DataContext, dataDir: string): Promise<Result<void, Error>>;
```

### Consumer changes

`AssetsHandler.loadSnapshot()`:

- stop calling `loadAssetReviewSummaries(this.dataDir, transactions)`
- read persisted rows from `assetReviewRepository.listAll()`

`CostBasisHandler.execute()`:

- read projected summaries once
- pass them to `CostBasisWorkflow.execute()`

`PortfolioHandler.execute()`:

- read projected summaries once
- pass them to `runCostBasisPipeline()` / `runCanadaAcbWorkflow()`

## Phase 5: Narrow Accounting To Blocking Evidence Only

### Files

- `packages/core/src/asset-review/asset-review.ts`
- `packages/accounting/src/cost-basis/shared/asset-review-preflight.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.test.ts`
- `packages/accounting/src/cost-basis/canada/__tests__/canada-acb-workflow.test.ts`

### Changes

1. Extend `AssetReviewSummary` with `accountingBlocked`.
2. Change `assertNoScopedAssetsRequireReview()` to block only on:
   - summaries where `accountingBlocked === true`
3. Keep ambiguity failure messaging explicit.
4. Add a separate warning-only test.

Pseudo-code:

```ts
const blockedAssets = summaries.filter((summary) => summary.accountingBlocked);
if (blockedAssets.length > 0) return err(formatBlockedAssetsMessage(blockedAssets));
return ok(undefined);
```

### Required tests

- warning-only `needs-review` asset does not block generic pipeline
- warning-only `needs-review` asset does not block Canada pipeline
- unresolved `error` evidence still blocks
- same-symbol ambiguity still blocks even when `reviewStatus === 'reviewed'`

## Phase 6: Make `assets view` Show Real Evidence

### Files

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/assets/view/assets-view-components.tsx`
- `apps/cli/src/features/assets/view/assets-view-state.ts`
- `apps/cli/src/features/assets/view/__tests__/...`

### Changes

Expand `AssetViewItem` to include:

- `evidence: AssetReviewEvidence[]`
- `accountingBlocked: boolean`

Render in the detail panel:

- each evidence item with severity
- same-symbol ambiguity conflict list from `metadata.conflictingAssetIds`
- reference match status
- explicit line:
  - `Accounting: blocked`
  - `Accounting: allowed`
  - independent from `excluded`

Do not flatten this back into one warning string in the TUI.

## Phase 7: Cleanup

### Files

- `apps/cli/src/features/shared/asset-review-runtime.ts`
- `packages/ingestion/src/features/asset-review/asset-review-service.ts`
- exports in `packages/ingestion/src/index.ts`
- exports in `packages/data/src/index.ts`

### Cleanup tasks

- remove any remaining command-time recomputation path
- remove dead helper code that only existed for the in-memory runtime model
- keep one canonical path for:
  - compute
  - persist
  - read

Optional rename pass after behavior is green:

- `buildAssetReviewSummaries` -> `computeAssetReviewStates`
- `loadAssetReviewSummaries` -> `readAssetReviewProjection`
- `AssetViewItem.reviewSummary` -> `warningSummary`

## Test Plan

### Unit tests

- `packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts`
- `packages/ingestion/src/features/asset-review/__tests__/asset-review-projector.test.ts`
- `packages/data/src/repositories/__tests__/asset-review-repository.test.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.test.ts`
- `packages/accounting/src/cost-basis/canada/__tests__/canada-acb-workflow.test.ts`

### CLI tests

- `apps/cli/src/features/assets/command/__tests__/assets-handler.test.ts`
- `apps/cli/src/features/assets/view/__tests__/assets-view-controller.test.ts`
- `apps/cli/src/features/assets/view/__tests__/assets-view-components.test.tsx`
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.test.ts`
- `apps/cli/src/features/portfolio/command/__tests__/portfolio-handler.test.ts`

### Manual verification

Use a dataset with:

- one obvious scam token on EVM with native gas fee
- two same-symbol EVM contracts on one chain
- one warning-only suspicious-airdrop case

Verify:

1. `exitbook assets view --needs-review`
2. `exitbook assets confirm --asset-id ...`
3. `exitbook assets clear-review --asset-id ...`
4. `exitbook assets exclude --asset-id ...`
5. `exitbook cost-basis ...`
6. `exitbook portfolio ...`

Expected behavior:

- ETH/native fee asset is not incorrectly flagged by scam evidence for another
  token
- warning-only review remains visible but does not block accounting
- ambiguity still blocks until the unwanted contract is excluded

## Suggested Commit Order

1. Pure evidence scoping fix + tests
2. DB schema + repository + tests
3. Projector + policy + tests
4. Processing/review command rebuild wiring
5. Switch CLI/accounting reads to projection
6. `assets view` evidence detail improvements
7. Cleanup and rename pass

## Why This Is Still KISS / YAGNI

This plan intentionally avoids:

- a new database file
- a full projection-graph integration
- four new persisted concern tables
- an event-sourced read model beyond the existing override store

It adds only:

- one current-state table
- one evidence table
- one projector workflow

That is the smallest architecture that:

- removes command-time recomputation
- preserves auditability
- fixes the current evidence-scope bug
- lets accounting use an explicit blocking policy

## Decisions And Smells To Watch During Implementation

- Decision: keep override events as the user-audit write side.
- Decision: keep reference cache tables where they are for now.
- Smell: `AssetReviewSummary` currently mixes workflow state and derived policy;
  a later rename to `AssetReviewSnapshot` may clarify this.
- Smell: if `process-workflow.ts` grows too many composition concerns, move
  projector orchestration into a dedicated ingestion workflow rather than
  expanding the class indefinitely.
- Smell: if `assets view` starts needing pagination/search/sorting logic beyond
  the current TUI, introduce a dedicated query object instead of bloating
  `AssetsHandler`.
