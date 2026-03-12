# Balance Projection Foundation Plan

This document defines the next implementation plan after the asset-review read
model slice landed.

It is subordinate to:

- `docs/dev/balance-projection-and-assets-view.md`
- `docs/specs/asset-review.md`

The goal is not to redesign every balance and asset screen in one pass.

The goal is:

- move derived balance state off `Account`
- persist current balance and verification state as first-class SQL rows
- make `balances` a real projection with scoped freshness/reset semantics
- split `balance` into explicit read vs refresh flows
- rebase existing `accounts view`, `balance`, and `assets view` consumers onto
  stored snapshots

## Goals

- Add a dedicated balance snapshot model in `@exitbook/core`.
- Add `balance_snapshots` and `balance_snapshot_assets` to `transactions.db`.
- Stop persisting `lastBalanceCheckAt` and `verificationMetadata` on accounts.
- Add `balances` to the projection graph as a sibling of `asset-review` and
  `links`.
- Use `projection_state.scope_key` for balance-scope freshness instead of
  inventing a second freshness mechanism.
- Make `balance view` read stored snapshots only.
- Make `balance refresh` the only command that fetches live balances.
- Keep the existing `assets view` surface, but switch its current-holdings data
  source to balance snapshots once the projection exists.

## Non-Goals

- Storing balance history.
- Rewriting `portfolio` to depend on balance snapshots in this phase.
- Adding another asset catalog table.
- Generalizing the entire projection runtime around scoped rebuilds before the
  balance slice is green.
- Reworking the current `assets view` controller layout or keyboard model.
- Preserving the current `balance --offline` UX shape.

## Current Blockers

### 1. Balance state still lives on `Account`

Current files:

- `packages/core/src/account/account.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/account-repository.ts`

Current smell:

- `lastBalanceCheckAt` and `verificationMetadata` mix derived read-model state
  into account identity/configuration.

### 2. The balance workflow persists via `accountUpdater`

Current files:

- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/ingestion/src/ports/balance-ports.ts`
- `packages/data/src/adapters/balance-ports-adapter.ts`

Current behavior:

- `BalanceWorkflow.verifyBalance()` calculates balances, fetches live balances,
  compares them, then writes back through
  `persistVerificationResults() -> accountUpdater.updateVerification(...)`.
- Persistence failures are warned and then ignored, which is not acceptable for
  a projection that is supposed to be the source of truth.

### 3. Account read models still read legacy verification metadata

Current files:

- `packages/accounts/src/account-query-utils.ts`
- `packages/accounts/src/account-query.ts`
- `packages/data/src/adapters/account-query-ports-adapter.ts`
- `apps/cli/src/features/accounts/command/accounts-view-utils.ts`
- `apps/cli/src/features/accounts/view/accounts-view-components.tsx`

Current behavior:

- `getVerificationStatus(account)` reads
  `account.verificationMetadata?.last_verification`.
- Account summaries cannot distinguish projection freshness from verification
  outcome because both are flattened into legacy account fields.

### 4. The projection graph has no `balances` node

Current files:

- `packages/core/src/projections/projection-definitions.ts`
- `packages/core/src/projections/projection-graph-utils.ts`
- `apps/cli/src/features/shared/projection-runtime.ts`

Current behavior:

- The graph already includes `processed-transactions`, `asset-review`, and
  `links`.
- Balance state is outside the reset/invalidation lifecycle.

### 5. Current downstream invalidation is global-only

Current files:

- `packages/data/src/adapters/import-ports-adapter.ts`
- `packages/data/src/adapters/processing-ports-adapter.ts`
- `packages/data/src/adapters/processed-transactions-reset-adapter.ts`

Current behavior:

- downstream projections are marked stale with a simple
  `for (const downstream of cascadeInvalidation('processed-transactions'))`
  loop
- that is correct for global projections like `asset-review` and `links`
- it is not correct for `balances`, which must be invalidated by scope, not
  globally

### 6. `assets view` already exists, but current holdings are not snapshot-backed

Current files:

- `apps/cli/src/features/assets/command/assets-view.ts`
- `apps/cli/src/features/assets/command/assets-handler.ts`

Current behavior:

- `AssetsHandler.loadSnapshot()` still loads all transactions and derives
  `knownAssets` from `collectKnownAssets(...)`
- the asset-review projection is already persisted, but current balance,
  account-count, and verification signal are not

## Decision Summary

### 1. Attack the balance projection foundation next

Do not start with more `assets view` UI work.

The next slice is the missing data model and projection lifecycle underneath
`balance`, `accounts view`, and the existing `assets view`.

### 2. Add `balances` as a real projection

Target graph:

```text
processed-transactions --> asset-review
processed-transactions --> links
processed-transactions --> balances
```

`balances` remains read-explicit:

- stale snapshots are still readable
- `balance view` does not auto-refresh
- `balance refresh` is the only live-fetch path

### 3. Use scoped `projection_state` rows

Use:

```text
projection_id = 'balances'
scope_key = 'balance:<scopeAccountId>'
```

The repository and schema already support `scope_key`; this phase is the first
time the product should use it for a real scoped projection.

### 4. Scope ownership belongs to the root account

Balance snapshots are keyed by the top-level scope account.

Rules:

- exchange account: scope is the account itself
- single-address blockchain account: scope is the account itself
- child/xpub-derived account: scope is the root parent account

Implementation rule:

- do not let a child account create its own independent snapshot row
- when a child account is targeted directly, resolve upward to the root scope
  and operate on the root scope snapshot

### 5. Keep the existing `assets view` surface

Do not create a second assets TUI.

The migration path is:

1. land balance snapshots
2. switch the existing assets handler to read current holdings from snapshots
3. keep transaction scanning only for historical counts and alternate symbols

### 6. Remove legacy account fields after consumers switch

This should end as a clean break:

- remove `lastBalanceCheckAt`
- remove `verificationMetadata`
- remove `persistVerificationResults()`
- remove `balance --offline`

Do not leave a long-lived compatibility layer.

## Target Data Model

### Core types

Create:

- `packages/core/src/balance/balance-snapshot.ts`
- `packages/core/src/balance/index.ts`

Export from:

- `packages/core/src/index.ts`

Add schemas/types for:

- `BalanceSnapshot`
- `BalanceSnapshotAsset`
- `BalanceVerificationStatus`
- `BalanceCoverageStatus`
- `BalanceCoverageConfidence`
- `BalanceAssetComparisonStatus`

Recommended fields:

```ts
type BalanceVerificationStatus = 'never-run' | 'match' | 'warning' | 'mismatch' | 'unavailable';

interface BalanceSnapshot {
  scopeAccountId: number;
  calculatedAt?: Date | undefined;
  lastRefreshAt?: Date | undefined;
  verificationStatus: BalanceVerificationStatus;
  coverageStatus?: 'complete' | 'partial' | undefined;
  coverageConfidence?: 'high' | 'medium' | 'low' | undefined;
  requestedAddressCount?: number | undefined;
  successfulAddressCount?: number | undefined;
  failedAddressCount?: number | undefined;
  totalAssetCount?: number | undefined;
  parsedAssetCount?: number | undefined;
  failedAssetCount?: number | undefined;
  matchCount: number;
  warningCount: number;
  mismatchCount: number;
  statusReason?: string | undefined;
  suggestion?: string | undefined;
  lastError?: string | undefined;
}

interface BalanceSnapshotAsset {
  scopeAccountId: number;
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance?: string | undefined;
  difference?: string | undefined;
  comparisonStatus?: 'match' | 'warning' | 'mismatch' | 'unavailable' | undefined;
  excludedFromAccounting: boolean;
}
```

### SQL tables

Update:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Add:

- `balance_snapshots`
- `balance_snapshot_assets`

Recommended table shape:

```sql
CREATE TABLE balance_snapshots (
  scope_account_id          INTEGER PRIMARY KEY REFERENCES accounts(id),
  calculated_at             TEXT,
  last_refresh_at           TEXT,
  verification_status       TEXT NOT NULL,
  coverage_status           TEXT,
  coverage_confidence       TEXT,
  requested_address_count   INTEGER,
  successful_address_count  INTEGER,
  failed_address_count      INTEGER,
  total_asset_count         INTEGER,
  parsed_asset_count        INTEGER,
  failed_asset_count        INTEGER,
  match_count               INTEGER NOT NULL DEFAULT 0,
  warning_count             INTEGER NOT NULL DEFAULT 0,
  mismatch_count            INTEGER NOT NULL DEFAULT 0,
  status_reason             TEXT,
  suggestion                TEXT,
  last_error                TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT
);

CREATE TABLE balance_snapshot_assets (
  scope_account_id          INTEGER NOT NULL REFERENCES balance_snapshots(scope_account_id) ON DELETE CASCADE,
  asset_id                  TEXT NOT NULL,
  asset_symbol              TEXT NOT NULL,
  calculated_balance        TEXT NOT NULL,
  live_balance              TEXT,
  difference                TEXT,
  comparison_status         TEXT,
  excluded_from_accounting  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope_account_id, asset_id)
);
```

Indexes:

- `idx_balance_snapshot_assets_asset_id`
- `idx_balance_snapshot_assets_symbol`

Remove from `accounts`:

- `last_balance_check_at`
- `verification_metadata`

## Package Ownership

### `packages/core`

Owns:

- balance snapshot row types
- `ProjectionId` addition for `balances`

### `packages/data`

Owns:

- schema and migration
- `BalanceSnapshotRepository`
- account-scope resolution helpers used by reset/invalidation
- `buildBalancesFreshnessPorts(...)`
- `buildBalancesResetPorts(...)`
- updated `buildBalancePorts(...)`

### `packages/ingestion`

Owns:

- balance workflow orchestration
- scope resolution for a requested account
- snapshot rebuild / refresh behavior

### `packages/accounts`

Owns:

- account summary mapping from snapshot-backed balance status to
  `AccountSummary`

### `apps/cli`

Owns:

- command split into `balance view` and `balance refresh`
- balance/accounts/assets read-side composition
- projection reset orchestration in clear/reprocess flows

## Implementation Plan

### Step 1: Add balance snapshot types and projection id

Files:

- `packages/core/src/balance/balance-snapshot.ts`
- `packages/core/src/balance/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/projections/projection-definitions.ts`
- `packages/core/src/projections/__tests__/projection-graph-utils.test.ts`

Changes:

1. Add the new balance snapshot schemas/types.
2. Extend `ProjectionId` with `'balances'`.
3. Add `{ id: 'balances', dependsOn: ['processed-transactions'], owner: 'ingestion' }`.
4. Update projection graph tests to assert:
   - `cascadeInvalidation('processed-transactions')` includes `balances`
   - `resetPlan('processed-transactions')` includes `balances`

Do not update CLI runtime consumers yet.

### Step 2: Add balance snapshot tables and repository

Files:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/balance-snapshot-repository.ts`
- `packages/data/src/repositories/__tests__/balance-snapshot-repository.test.ts`
- `packages/data/src/repositories/index.ts`
- `packages/data/src/data-context.ts`
- `packages/data/src/index.ts`

Repository API:

```ts
interface IBalanceSnapshotRepository {
  findSnapshot(scopeAccountId: number): Promise<Result<BalanceSnapshot | undefined, Error>>;
  findSnapshots(scopeAccountIds?: number[]): Promise<Result<BalanceSnapshot[], Error>>;
  findAssetsByScope(scopeAccountIds?: number[]): Promise<Result<BalanceSnapshotAsset[], Error>>;
  findAssetsGroupedByAssetId(scopeAccountIds?: number[]): Promise<Result<Map<string, BalanceSnapshotAsset[]>, Error>>;
  replaceSnapshot(params: { snapshot: BalanceSnapshot; assets: BalanceSnapshotAsset[] }): Promise<Result<void, Error>>;
  deleteByScopeAccountIds(scopeAccountIds?: number[]): Promise<Result<number, Error>>;
}
```

Implementation rules:

- `replaceSnapshot(...)` must run in one DB transaction
- delete old asset rows before inserting new ones
- then upsert the summary row
- store decimal quantities as text
- do not denormalize asset-review state into these tables

### Step 3: Replace legacy balance write ports with snapshot store ports

Files:

- `packages/ingestion/src/ports/balance-ports.ts`
- `packages/ingestion/src/ports/index.ts`
- `packages/data/src/adapters/balance-ports-adapter.ts`
- `packages/data/src/index.ts`

Changes:

1. Keep lookup-style ports for:
   - account lookup
   - import session lookup
   - transaction source
2. Remove `IBalanceAccountUpdater`.
3. Add a new store port, for example:

```ts
interface IBalanceSnapshotStore {
  replaceSnapshot(params: { snapshot: BalanceSnapshot; assets: BalanceSnapshotAsset[] }): Promise<Result<void, Error>>;
}
```

4. Update `buildBalancePorts(db)` to wire that store port through the new
   repository instead of `db.accounts.update(...)`.

### Step 4: Add scoped freshness and reset adapters for `balances`

Files:

- `packages/ingestion/src/ports/balance-projection-freshness.ts`
- `packages/ingestion/src/ports/balance-projection-reset.ts`
- `packages/data/src/adapters/balances-freshness-adapter.ts`
- `packages/data/src/adapters/balances-reset-adapter.ts`
- `packages/data/src/adapters/__tests__/balances-freshness-adapter.test.ts`
- `packages/data/src/adapters/__tests__/balances-reset-adapter.test.ts`
- `packages/data/src/index.ts`

Recommended interfaces:

```ts
interface IBalancesFreshness {
  checkFreshness(
    scopeAccountId: number
  ): Promise<Result<{ status: ProjectionStatus; reason?: string | undefined }, Error>>;
}

interface IBalancesReset {
  countResetImpact(accountIds?: number[]): Promise<Result<{ scopes: number; assetRows: number }, Error>>;
  reset(accountIds?: number[]): Promise<Result<{ scopes: number; assetRows: number }, Error>>;
}
```

Implementation details:

- `checkFreshness(scopeAccountId)` should read
  `projection_state.get('balances', toBalanceScopeKey(scopeAccountId))`
- if no state row exists and no snapshot exists, return stale / never built
- if snapshot exists but the scope row is stale or failed, report that status
- `reset(accountIds)` should:
  - resolve account IDs to affected scope account IDs
  - delete snapshot rows for those scopes
  - mark those scope keys stale

Add a small shared helper in `packages/data/src/adapters/`:

- `resolveBalanceScopeAccountIds(db, accountIds?: number[]): Promise<Result<number[] | undefined, Error>>`

Rules:

- if `accountIds` is undefined, full reset deletes all snapshot rows
- if a child account is included, resolve to its root scope account
- dedupe scope IDs before deleting

### Step 5: Introduce scoped downstream invalidation for `balances`

Files:

- `packages/data/src/adapters/import-ports-adapter.ts`
- `packages/ingestion/src/ports/import-ports.ts`
- `packages/data/src/adapters/processed-transactions-reset-adapter.ts`
- `packages/ingestion/src/ports/processing-ports.ts`
- `packages/data/src/adapters/processing-ports-adapter.ts`

Add a shared invalidation helper, for example:

- `packages/data/src/adapters/projection-invalidation-utils.ts`

Pseudo-code:

```ts
async function markDownstreamStale(params: {
  db: DataContext;
  from: ProjectionId;
  accountIds?: number[] | undefined;
  reason: string;
}) {
  for (const downstream of cascadeInvalidation(params.from)) {
    if (downstream === 'balances') {
      const scopeIds = yield * (await resolveBalanceScopeAccountIds(params.db, params.accountIds));
      for (const scopeId of scopeIds ?? []) {
        yield * (await params.db.projectionState.markStale('balances', params.reason, `balance:${scopeId}`));
      }
      continue;
    }

    yield * (await params.db.projectionState.markStale(downstream, params.reason));
  }
}
```

Required interface changes:

- `ImportPorts.invalidateProjections(reason)` ->
  `invalidateProjections(accountIds, reason)`
- `ProcessingPorts.markProcessedTransactionsFresh()` ->
  `markProcessedTransactionsFresh(accountIds)`

Call-site updates:

- import workflow should pass the imported account ID
- processing workflow should pass the set of account IDs it just rebuilt
- reset adapters should use the same helper logic for downstream stale marks

This is the most important architectural constraint in the whole plan:

- `asset-review` and `links` stay global
- `balances` must not be invalidated only through a global row

### Step 6: Refactor `BalanceWorkflow` into explicit rebuild and refresh paths

Files:

- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/ingestion/src/features/balance/__tests__/balance-workflow.test.ts`

Refactor goals:

1. Replace `verifyBalance(params)` with explicit methods:
   - `rebuildCalculatedSnapshot(params)`
   - `refreshVerification(params)`
2. Replace `resolveAccountScope(account)` with something like
   `loadBalanceScopeContext(accountId)`.
3. Remove `persistVerificationResults()`.
4. Add `persistSnapshot(snapshot, assets)` using the new store port.

Recommended scope helper shape:

```ts
interface BalanceScopeContext {
  requestedAccount: Account;
  scopeAccount: Account;
  memberAccounts: Account[];
}
```

Recommended algorithm:

```ts
if (requestedAccount.parentAccountId) {
  const scopeAccount = yield * (await findById(requestedAccount.parentAccountId));
  const siblings = yield * (await findChildAccounts(scopeAccount.id));
  return { requestedAccount, scopeAccount, memberAccounts: [scopeAccount, ...siblings] };
}

const children = yield * (await findChildAccounts(requestedAccount.id));
return { requestedAccount, scopeAccount: requestedAccount, memberAccounts: [requestedAccount, ...children] };
```

Behavior:

- `rebuildCalculatedSnapshot(...)`
  - loads all transactions for the scope
  - computes calculated balances
  - replays exclusion state
  - writes a snapshot with `verificationStatus = 'never-run'` or the last known
    non-live state for the first pass
- `refreshVerification(...)`
  - ensures the calculated snapshot exists first
  - fetches live balances
  - compares calculated vs live
  - writes live comparison fields and summary counts
  - returns the verification result for CLI rendering

Critical rule:

- snapshot persistence failures must fail the workflow
- do not log-and-continue after a failed write

### Step 7: Keep the generic projection runtime global; do not force `balances` into it

Files:

- `apps/cli/src/features/shared/projection-runtime.ts`
- `apps/cli/src/features/clear/command/clear-handler.ts`
- `apps/cli/src/features/shared/__tests__/projection-runtime.test.ts`

Changes:

1. Update `resetSingleProjection(...)` to handle `balances` through
   `buildBalancesResetPorts(db)`.
2. Update tests around `resetPlan('processed-transactions')`.
3. Do not add `balances` to `buildConsumerProjectionPlan(...)`.
4. Do not try to implement a fake global `buildBalancesRuntime(...)`.

Reason:

- `ensureConsumerInputsReady(...)` is for global consumer prerequisites
- `balances` is scope-specific and live-provider dependent
- `balance refresh` should orchestrate its own scope refresh directly

### Step 8: Switch account queries to snapshot-backed summaries

Files:

- `packages/accounts/src/ports/account-query-ports.ts`
- `packages/data/src/adapters/account-query-ports-adapter.ts`
- `packages/accounts/src/account-query-utils.ts`
- `packages/accounts/src/account-query.ts`
- `packages/accounts/src/__tests__/account-query-utils.test.ts`
- `packages/accounts/src/__tests__/account-query.test.ts`
- `apps/cli/src/features/accounts/command/accounts-view-utils.ts`
- `apps/cli/src/features/accounts/view/accounts-view-state.ts`
- `apps/cli/src/features/accounts/view/accounts-view-components.tsx`

Port change:

```ts
interface IAccountQueryBalanceSnapshotReader {
  findSnapshots(scopeAccountIds: number[]): Promise<Result<Map<number, BalanceSnapshot>, Error>>;
}
```

Mapping rules:

- determine each account row’s scope account ID
- load snapshots by scope ID in one batch
- derive:
  - `balanceProjectionStatus`
  - `verificationStatus`
  - `lastCalculatedAt`
  - `lastRefreshAt`

Implementation rule:

- replace `getVerificationStatus(account)` with a summary helper that reads
  snapshot data instead of account metadata
- child account rows should display the parent scope snapshot summary, not an
  invented child-specific verification state

### Step 9: Split `balance` into `view` and `refresh`

Files:

- `apps/cli/src/features/balance/command/balance.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`
- `apps/cli/src/features/shared/schemas.ts`
- `apps/cli/src/features/balance/view/*`

Changes:

- replace:

```text
exitbook balance [--offline]
```

- with:

```text
exitbook balance view [--account-id <id>] [--json]
exitbook balance refresh [--account-id <id>] [--api-key ...] [--json]
```

Handler restructuring:

- keep shared rendering/state builders in `view/`
- rename or replace:
  - `executeOffline(...)` -> `viewSnapshots(...)`
  - `executeSingle(...)` -> `refreshSingleScope(...)`
  - `executeAll(...)` -> `refreshAllScopes(...)`

Behavior:

- `balance view`
  - loads snapshots from the repository
  - shows stale/fresh metadata
  - never hits providers
- `balance refresh`
  - resolves selected scopes
  - ensures processed transactions are fresh enough for those scopes
  - runs the balance workflow refresh path

Do not preserve the `--offline` inversion.

### Step 10: Rebase the existing `assets view` on snapshots

Files:

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/assets/command/assets-view.ts`
- `apps/cli/src/features/assets/view/assets-view-components.tsx`
- `apps/cli/src/features/assets/view/__tests__/*`

Current `loadSnapshot()` problem:

- it uses transactions as the source for both historical knowledge and current
  holdings

Target split:

1. use `balance_snapshot_assets` for:
   - current quantity
   - per-scope verification status
   - account count
2. use `balance_snapshots` for:
   - last refresh
   - stale/fresh status
3. keep `collectKnownAssets(transactions)` only for:
   - transaction count
   - movement count
   - alternate symbols
4. keep asset-review projection for:
   - `reviewStatus`
   - `warningSummary`
   - `accountingBlocked`

Recommended `AssetsHandler.loadSnapshot()` flow:

```ts
const snapshotRows = yield* await db.balanceSnapshots.findSnapshots();
const snapshotAssets = yield* await db.balanceSnapshots.findAssetsByScope();
const transactions = yield* await db.transactions.findAll({ includeExcluded: true });
const knownAssets = collectKnownAssets(transactions);
const reviewSummaries = yield* await readAssetReviewProjection(...);
const excludedAssetIds = yield* await readExcludedAssetIds(...);
```

Do not reintroduce ad hoc current-balance derivation here.

### Step 11: Remove legacy account balance metadata and dead code

Files:

- `packages/core/src/account/account.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/account-repository.ts`
- `packages/data/src/repositories/__tests__/account-repository.test.ts`
- `packages/ingestion/src/ports/balance-ports.ts`
- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/accounts/src/account-query-utils.ts`
- docs under `docs/specs/`

Cleanup tasks:

- remove `VerificationMetadataSchema`
- remove `BalanceVerificationSchema` from `account.ts`
- remove repository update code for legacy account balance fields
- remove old account repository tests that assert those fields
- update spec docs that still mention account-stored verification metadata

## Testing Plan

### Repository and adapter tests

Add:

- `packages/data/src/repositories/__tests__/balance-snapshot-repository.test.ts`
- `packages/data/src/adapters/__tests__/balances-freshness-adapter.test.ts`
- `packages/data/src/adapters/__tests__/balances-reset-adapter.test.ts`

Test cases:

- replacing a snapshot overwrites old asset rows
- deleting one scope does not delete another
- a child account resolves to the parent scope on reset
- no global `balances/__global__` shortcut is used for scoped resets

### Projection lifecycle tests

Update:

- `packages/core/src/projections/__tests__/projection-graph-utils.test.ts`
- `apps/cli/src/features/shared/__tests__/projection-runtime.test.ts`
- `packages/data/src/adapters/__tests__/import-ports-adapter.test.ts`
- `packages/data/src/adapters/__tests__/processed-transactions-reset-adapter.test.ts`

Test cases:

- processed-transactions invalidation marks `asset-review` and `links` stale
  globally
- processed-transactions invalidation marks `balances` stale per affected scope
- `resetPlan('processed-transactions')` includes `balances`

### Balance workflow tests

Update:

- `packages/ingestion/src/features/balance/__tests__/balance-workflow.test.ts`

Test cases:

- calculated snapshot write without live refresh
- `match`
- `warning`
- `mismatch`
- `unavailable`
- child-account request resolves to parent scope
- persistence failure fails the workflow

### Read-side consumer tests

Update:

- `packages/accounts/src/__tests__/account-query-utils.test.ts`
- `packages/accounts/src/__tests__/account-query.test.ts`
- `apps/cli/src/features/assets/command/__tests__/assets-handler.test.ts`
- `apps/cli/src/features/assets/view/__tests__/assets-view-components.test.tsx`
- `apps/cli/src/features/balance/command/__tests__/balance-utils.test.ts`

Test cases:

- account rows show snapshot-backed verification summaries
- `assets view` current quantity comes from snapshot rows, not tx scan
- `balance view` reads stored snapshots only
- stale snapshots remain viewable

## Suggested Commit Order

1. Core types + projection id + graph tests
2. Schema + repository + repository tests
3. Balance ports refactor + scoped freshness/reset adapters
4. Scoped downstream invalidation changes in import/process/reset paths
5. Balance workflow refactor to snapshot rebuild/refresh
6. Account query migration
7. `balance` CLI split into `view` and `refresh`
8. `assets view` rebased on snapshots
9. Legacy account-field cleanup + spec doc updates

## Open Questions

### 1. Should `balance refresh --account-id <child>` refresh only that child or the parent scope?

Recommendation:

- refresh the parent scope
- annotate the UI/output with the requested child account and the owning scope
  account when helpful

Reason:

- one scope should own one snapshot
- duplicating child-specific snapshot rows would break the model immediately

### 2. Should `balance view` auto-rebuild calculated balances if the snapshot is missing?

Recommendation:

- no
- show missing/stale projection state and direct the user to `balance refresh`

Reason:

- the design goal is explicit read vs refresh, not hidden rebuilds

## Decisions & Smells

- Decision: keep `balances` as a scoped projection, but do not force the global
  CLI projection runtime to pretend it is global.
- Decision: treat current `assets view` as an existing consumer to migrate, not
  a net-new UI feature.
- Smell: current downstream invalidation helpers are too coarse for mixed global
  and scoped projections; centralize that logic before more projections arrive.
- Smell: `resolveAccountScope` is too vague a name for the new parent/child
  ownership rules. Prefer something like `loadBalanceScopeContext`.
- Smell: `executeOffline` and `--offline` encode the old command mental model.
  After the split, the names should reflect `view` vs `refresh`.

## Rename Suggestions

- `resolveAccountScope` -> `loadBalanceScopeContext`
- `persistVerificationResults` -> remove; replace with `replaceSnapshot`
- `executeOffline` -> `viewSnapshots`
- `BalanceVerificationResult` -> keep for live refresh output only; do not use
  it as the persisted row model
