# Balance Projection And Assets View

This document defines the target design for moving balance state off
`accounts`, storing the current snapshot as a real projection, and adding an
asset-centric TUI surface that makes include/exclude actions fast and obvious.

The goal is not to preserve the current `balance` command shape.
The goal is:

- make current balances and verification state cheap to read
- stop mutating `accounts` with derived balance data
- avoid JSON blob storage for core balance state
- add an `assets view` that feels like the asset-first sibling of
  `accounts view`
- keep exclusion policy explicit: exclude from accounting, not hide from UI

## Goals

- Persist only the current balance snapshot.
- Do not store historical verification runs.
- Replace account-level balance metadata with a dedicated projection.
- Use SQL rows, not JSON blobs, for current asset balances and comparison data.
- Make `balance view` and `assets view` read stored state by default.
- Make live provider fetches explicit through a refresh command.
- Reuse the existing `projection_state` lifecycle model.
- Add a TUI that lets a user inspect assets and toggle include/exclude quickly.

## Non-Goals

- Storing balance history.
- Introducing a third asset catalog table in this phase.
- Making accounting exclusions come from the balance projection.
- Rewriting portfolio to depend on the balance projection.
- Forcing all asset query logic into a new package in the same phase.

## Current Problems

### 1. Balance state is persisted on `Account`

Today the shared account shape includes:

- `lastBalanceCheckAt`
- `verificationMetadata`

Current source:

- `packages/core/src/account/account.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/repositories/account-repository.ts`

This mixes account identity/configuration with derived read-model state.

### 2. Persisted balance data is only partially consumed

The balance workflow persists both:

- current calculated balances
- last live verification metadata

Current source:

- `packages/ingestion/src/features/balance/balance-workflow.ts`

But read consumers only use a narrow subset:

- `packages/accounts/src/account-query-utils.ts`
- `apps/cli/src/features/accounts/view/accounts-view-components.tsx`

That means:

- `current_balance` is effectively write-only
- warnings and partial coverage are flattened away
- persist failures are logged but not surfaced as product state

### 3. Balance state is outside the projection graph

The current projection graph is:

```text
processed-transactions --> links
```

Current source:

- `packages/core/src/projections/projection-definitions.ts`
- `docs/specs/projection-system.md`

Balances are derived from processed transactions, but they do not participate
in:

- freshness checks
- invalidation
- reset order
- rebuild lifecycle

### 4. Assets are override-only, not view-first

The current `assets` feature only supports:

- `assets exclude`
- `assets include`
- `assets exclusions`

Current source:

- `apps/cli/src/features/assets/command/assets.ts`
- `apps/cli/src/features/assets/command/assets-handler.ts`

There is no:

- `assets view`
- asset TUI
- inline toggle flow
- current holdings asset inventory

### 5. “Known assets” and “current assets” are different concepts

Current asset resolution scans all processed transactions:

- `apps/cli/src/features/assets/command/assets-utils.ts`

That gives “assets ever seen in processed data.”
It does not give:

- current quantity
- which accounts currently hold the asset
- whether the current balance snapshot is stale
- whether the asset is mismatched in the latest verification

## Decision Summary

### 1. Persist only the current snapshot

Do not keep historical balance verification records.

Each top-level account scope has:

- one current snapshot row
- zero or more current asset rows

Refreshing overwrites the current snapshot and replaces its asset rows.

### 2. Use 2 new balance tables

Do not store the current snapshot in JSON.

Add:

- `balance_snapshots`
- `balance_snapshot_assets`

Reuse existing `projection_state` for freshness lifecycle.

### 3. Scope is the top-level account

The balance projection should be keyed by the root account scope, not arbitrary
child accounts.

This matches current balance behavior:

- `apps/cli/src/features/balance/command/balance-handler.ts`
- `packages/ingestion/src/features/balance/balance-workflow.ts`

Rules:

- exchange accounts: scope is the account itself
- single blockchain address accounts: scope is the account itself
- xpub / parent-child chains: scope is the parent account id

Child accounts remain inputs to the parent scope snapshot, not independent
projection targets in bulk verification mode.

### 4. `balances` is a projection that depends on `processed-transactions`

Do not make `balances` depend on `links`.

Balance calculation today is built from processed transactions, import
sessions, exclusion logic, and live providers. It does not require transaction
links.

The target graph is:

```text
processed-transactions --> links
processed-transactions --> balances
```

Not:

```text
processed-transactions --> links --> balances
```

### 5. `balance` becomes explicit read vs refresh

Target command split:

```text
exitbook balance view
exitbook balance refresh
```

Rules:

- `balance view` reads stored snapshots only
- `balance refresh` is the only command that fetches live balances
- `balance view` may show stale state, but it must not auto-refresh
- `balance refresh` should ensure upstream processed transactions are ready
  before writing the new snapshot

### 6. `assets view` is the asset-first sibling of `accounts view`

Think about surfaces this way:

- `accounts view`: account-first inventory
- `assets view`: asset-first inventory
- `balance view`: reconciliation-first account snapshot
- `portfolio`: valuation and P&L

`assets view` should not be a thin wrapper around `assets exclusions`.
It should be a real browsing surface with:

- list
- detail panel
- drill-down
- inline include/exclude toggle

## Data Model

### `balance_snapshots`

One row per top-level account scope.

Suggested schema:

```sql
CREATE TABLE balance_snapshots (
  scope_account_id            INTEGER PRIMARY KEY REFERENCES accounts(id),

  calculated_at              TEXT,
  last_refresh_at            TEXT,

  verification_status        TEXT NOT NULL DEFAULT 'never-run'
                               CHECK (
                                 verification_status IN (
                                   'never-run',
                                   'match',
                                   'warning',
                                   'mismatch',
                                   'unavailable'
                                 )
                               ),

  coverage_status            TEXT
                               CHECK (coverage_status IS NULL OR coverage_status IN ('complete', 'partial')),
  coverage_confidence        TEXT
                               CHECK (
                                 coverage_confidence IS NULL OR coverage_confidence IN ('high', 'medium', 'low')
                               ),

  requested_address_count    INTEGER,
  successful_address_count   INTEGER,
  failed_address_count       INTEGER,
  total_asset_count          INTEGER,
  parsed_asset_count         INTEGER,
  failed_asset_count         INTEGER,

  match_count                INTEGER NOT NULL DEFAULT 0,
  warning_count              INTEGER NOT NULL DEFAULT 0,
  mismatch_count             INTEGER NOT NULL DEFAULT 0,

  status_reason              TEXT,
  suggestion                 TEXT,
  last_error                 TEXT,

  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT
);
```

Notes:

- `calculated_at` = when calculated balances were last rebuilt from processed
  transactions
- `last_refresh_at` = last attempt to fetch live balances and update
  verification state
- `verification_status` is the persisted summary used by account and asset
  views
- `status_reason` is a single persisted explanation string instead of a JSON
  warning array

### `balance_snapshot_assets`

One row per asset inside the current scope snapshot.

Suggested schema:

```sql
CREATE TABLE balance_snapshot_assets (
  scope_account_id           INTEGER NOT NULL REFERENCES balance_snapshots(scope_account_id) ON DELETE CASCADE,
  asset_id                   TEXT NOT NULL,
  asset_symbol               TEXT NOT NULL,

  calculated_balance         TEXT NOT NULL,
  live_balance               TEXT,
  difference                 TEXT,

  comparison_status          TEXT
                               CHECK (
                                 comparison_status IS NULL OR comparison_status IN (
                                   'match',
                                   'warning',
                                   'mismatch',
                                   'unavailable'
                                 )
                               ),

  excluded_from_accounting   INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (scope_account_id, asset_id)
);

CREATE INDEX idx_balance_snapshot_assets_asset_id
  ON balance_snapshot_assets (asset_id);

CREATE INDEX idx_balance_snapshot_assets_symbol
  ON balance_snapshot_assets (asset_symbol);
```

Notes:

- store decimal quantities as text, consistent with the rest of the repo
- `excluded_from_accounting` is a denormalized convenience flag, derived from
  override replay when the snapshot is written
- no history foreign key is needed because the snapshot is current-state only

### What does not stay on `accounts`

Remove:

- `last_balance_check_at`
- `verification_metadata`

From:

- `packages/core/src/account/account.ts`
- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`
- `packages/data/src/repositories/account-repository.ts`
- `packages/accounts/src/account-query-utils.ts`

After this change, `accounts` stores only account identity/configuration.

## Projection Lifecycle

### Projection Id

Add:

```ts
type ProjectionId = 'processed-transactions' | 'links' | 'balances';
```

Update:

- `packages/core/src/projections/projection-definitions.ts`
- `packages/core/src/projections/projection-graph-utils.ts`
- projection graph tests

Target definitions:

```ts
[
  { id: 'processed-transactions', dependsOn: [], owner: 'ingestion' },
  { id: 'links', dependsOn: ['processed-transactions'], owner: 'accounting' },
  { id: 'balances', dependsOn: ['processed-transactions'], owner: 'ingestion' },
];
```

### Freshness And Scope

Use `projection_state.scope_key` for balance scope keys:

```text
balance:<scope_account_id>
```

Example:

- `projection_id = 'balances'`
- `scope_key = 'balance:17'`

This is the first scoped projection in the repo.

Do not generalize the entire projection runtime in one sweep.
Add scoped behavior only where the balance projection needs it.

### Invalidation Rules

When processed transactions are invalidated for a scope, mark the matching
balance scope stale.

Rules:

- import completion that invalidates `processed-transactions` must also mark
  affected balance scopes stale
- processed transaction reset must mark affected balance scopes stale
- successful processing must not auto-refresh balances
- stale balances remain readable until `balance refresh` runs

This preserves the desired behavior:

- stored balances are shown by default
- refresh is explicit

### Reset Rules

Reset `balances` by scope:

1. delete `balance_snapshot_assets` for the scope
2. delete `balance_snapshots` for the scope
3. mark `projection_state('balances', scopeKey)` stale

When resetting `processed-transactions`, reset order becomes:

```text
links
balances
processed-transactions
```

or, if graph utilities keep sibling order deterministic by declaration order,
make that order explicit in tests.

## Command And UX Design

### Target CLI Surface

### Balance

```text
exitbook balance view [--account-id <id>] [--json]
exitbook balance refresh [--account-id <id>] [--source <source>] [--json]
```

Behavior:

- `balance view`
  - reads stored snapshot rows
  - shows stale/fresh state
  - never calls providers
- `balance refresh`
  - ensures processed transactions are ready for the selected scope
  - rebuilds calculated balance rows
  - fetches live balances
  - updates snapshot summary and asset rows

Clean break:

- remove current `--offline` inversion
- remove “verify all by default” as the only mode

### Assets

Keep:

```text
exitbook assets exclude
exitbook assets include
exitbook assets exclusions
```

Add:

```text
exitbook assets view [--all] [--excluded] [--json]
```

Behavior:

- default `assets view` shows current held assets
- `--all` includes zero-balance historical assets seen in processed
  transactions
- `--excluded` filters to accounting-excluded assets

### UX Pattern

Use the same mental model as existing list/detail TUI surfaces:

- top list
- bottom detail panel
- enter drills down
- backspace / esc returns

The strongest existing precedent is `portfolio`:

- list of assets
- detail panel
- history drill-down
- account breakdown

Do not invent a brand new asset interaction pattern.

### `assets view` list row

Each row should show:

- primary symbol
- current quantity across all scopes
- account count
- exclusion state
- verification signal

Example row shape:

```text
> BTC      1.48230000   3 accts   included   verified
  USDC   2500.00000000  2 accts   excluded   warning
  XYZ        0.00000000 1 acct    excluded   historical
```

Suggested row ordering:

1. currently held, non-zero assets
2. excluded assets with current holdings
3. excluded historical zero-balance assets
4. included historical zero-balance assets

Within a bucket:

- absolute quantity descending for held rows
- then symbol

### `assets view` detail panel

The selected asset detail should show:

- full `assetId`
- all seen symbols for the asset id
- current total quantity
- included/excluded state
- affected account list with per-account quantities
- transaction count / movement count from `collectKnownAssets()`
- if verification is mismatched or stale, a short reason

Example detail:

```text
▸ BTC   1.48230000

  Asset ID: blockchain:bitcoin:native
  Status: included · verified
  Accounts: bitcoin (0.48), kraken (1.00)
  Seen in: 124 txs · 201 movements
  Last refresh: 2026-03-10 14:22

  x exclude/include · enter account drill-down
```

### `assets view` keyboard actions

Use:

- `x` toggle include/exclude for selected asset
- `enter` drill into per-account holdings for the selected asset
- `tab` cycle filters: held / all / excluded / mismatched / stale
- `s` cycle sorting if needed later
- `q` / `esc` quit or go back

The important part is not the exact keys.
The important part is:

- selection lives in a list
- action is inline on the selected row
- the user does not have to leave the TUI to include/exclude

### Where `assets view` gets its data

Do not add a third persistent asset table in this phase.

Build the asset view read model by combining:

1. `balance_snapshot_assets`
   - current quantity per scope
   - current comparison status per scope
2. `balance_snapshots`
   - snapshot freshness and summary state
3. override replay
   - included/excluded state
4. `collectKnownAssets(transactions)`
   - transaction count
   - movement count
   - alternate symbols

This produces one read model with:

- current holdings
- historical asset knowledge
- exclusion policy
- verification signal

without introducing another stored projection.

## Implementation Plan

This plan is intentionally explicit.
Each step names the target files and the concrete changes.

### Step 1: Add balance projection domain types in `@exitbook/core`

Create:

- `packages/core/src/balance/balance-snapshot.ts`
- `packages/core/src/balance/index.ts`

Export from:

- `packages/core/src/index.ts`

Add schemas/types for:

- `BalanceSnapshot`
- `BalanceSnapshotAsset`
- `BalanceVerificationStatus`
- `BalanceAssetComparisonStatus`

Do not reuse `VerificationMetadata`.
That type should be removed as part of the clean break.

Suggested naming:

- `BalanceSnapshot`
- `BalanceSnapshotAsset`
- `BalanceVerificationStatus`

Avoid names like:

- `VerificationMetadata`
- `current_balance`
- `last_verification`

Those names describe nested JSON, not first-class rows.

### Step 2: Add 2 new tables and remove account balance columns

Update:

- `packages/data/src/database-schema.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Add:

- `BalanceSnapshotsTable`
- `BalanceSnapshotAssetsTable`

Remove:

- `accounts.last_balance_check_at`
- `accounts.verification_metadata`

Because the repo uses a single dev migration file, make the change directly in
`001_initial_schema.ts`.

### Step 3: Add a balance snapshot repository in `@exitbook/data`

Create:

- `packages/data/src/repositories/balance-snapshot-repository.ts`

Update:

- `packages/data/src/repositories/index.ts`
- `packages/data/src/data-context.ts`
- `packages/data/src/index.ts`

Repository responsibilities:

- `findSnapshot(scopeAccountId)`
- `findSnapshots(scopeAccountIds?)`
- `replaceSnapshot(scopeAccountId, snapshot, assets)`
- `deleteSnapshots(scopeAccountIds?)`
- `findAssetsByScope(scopeAccountIds?)`
- `findAssetsGroupedByAssetId(scopeAccountIds?)`

Implementation rule:

- replace summary row + asset rows in one transaction

Pseudo-code:

```ts
tx.deleteFrom('balance_snapshot_assets').where('scope_account_id', '=', scopeAccountId);
tx.deleteFrom('balance_snapshots').where('scope_account_id', '=', scopeAccountId);
tx.insertInto('balance_snapshots').values(snapshotRow);
tx.insertInto('balance_snapshot_assets').values(assetRows);
```

### Step 4: Add balance projection ports in `@exitbook/ingestion`

Create ports under:

- `packages/ingestion/src/ports/balance-projection-freshness.ts`
- `packages/ingestion/src/ports/balance-projection-reset.ts`
- `packages/ingestion/src/ports/balance-projection-store.ts`

Update:

- `packages/ingestion/src/ports/index.ts`

Keep ownership in `ingestion` because the current balance workflow already
lives there.

Port responsibilities:

- freshness check for a scope
- reset for a scope
- snapshot read/write for the workflow

### Step 5: Add data adapters for the new ports

Create:

- `packages/data/src/adapters/balance-projection-freshness-adapter.ts`
- `packages/data/src/adapters/balance-projection-reset-adapter.ts`
- `packages/data/src/adapters/balance-projection-store-adapter.ts`

Update:

- `packages/data/src/index.ts`

Freshness adapter rules:

- read `projection_state('balances', scopeKey)`
- if no row exists but no snapshot row exists, return stale / never built
- if upstream `processed-transactions` changed for that scope, return stale

Reset adapter rules:

- delete snapshot summary and asset rows for the requested scope
- mark `balances` stale for that scope

### Step 6: Refactor the balance workflow into explicit rebuild and refresh paths

Current file:

- `packages/ingestion/src/features/balance/balance-workflow.ts`

Refactor it to expose 2 explicit flows:

- `rebuildCalculatedSnapshot(scopeAccountId)`
- `refreshVerification(scopeAccountId, credentials?)`

Recommended internal split:

- `loadScope(scopeAccountId)`
- `calculateBalancesFromTransactions(scope)`
- `fetchLiveBalances(scope, credentials?)`
- `buildSnapshotSummary(...)`
- `buildSnapshotAssets(...)`
- `persistSnapshot(...)`

Behavior:

- rebuild writes calculated balances even if no live refresh runs
- refresh updates summary and asset rows with live fields
- refresh must not silently ignore persistence errors

Do not keep the current behavior where verification persistence can fail and
the command still pretends success.

### Step 7: Integrate `balances` into projection definitions and reset flow

Update:

- `packages/core/src/projections/projection-definitions.ts`
- `packages/core/src/projections/projection-graph-utils.ts`
- `packages/core/src/projections/__tests__/*`
- `apps/cli/src/features/shared/projection-runtime.ts`
- `apps/cli/src/features/clear/command/clear-handler.ts`

Changes:

- add `balances` projection id
- add reset support for `balances`
- add a `balances` runtime only if needed for explicit refresh orchestration

Do not make `balance view` auto-call `ensureConsumerInputsReady(...)`.
That would reintroduce implicit rebuild behavior.

### Step 8: Replace account-query verification fields with balance snapshot summaries

Update:

- `packages/accounts/src/ports/account-query-ports.ts`
- `packages/data/src/adapters/account-query-ports-adapter.ts`
- `packages/accounts/src/account-query-utils.ts`
- `packages/accounts/src/account-query.ts`
- `apps/cli/src/features/accounts/command/accounts-view-utils.ts`
- `apps/cli/src/features/accounts/view/accounts-view-components.tsx`

Add summary fields to the account read model such as:

- `balanceProjectionStatus`
- `verificationStatus`
- `lastCalculatedAt`
- `lastRefreshAt`

Parent rows should use the parent scope snapshot.
Child rows should not claim independent verification unless that child is
opened directly and explicitly queried as its own scope.

### Step 9: Split the `balance` CLI into view and refresh

Create or reorganize under:

- `apps/cli/src/features/balance/command/balance.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`
- `apps/cli/src/features/balance/command/balance-handler.ts`
- `apps/cli/src/features/shared/schemas.ts`

Changes:

- `balance view`
  - load stored snapshot rows
  - render account list and asset drill-down from stored data
- `balance refresh`
  - resolve selected scopes
  - ensure processed transactions are ready
  - refresh snapshots
  - show verification progress in TUI

Keep the current balance TUI parts that still fit:

- list/detail layout
- asset drill-down structure

But change the data source from transient verification results to stored
snapshot rows.

### Step 10: Add `assets view`

Create:

- `apps/cli/src/features/assets/command/assets-view.ts`
- `apps/cli/src/features/assets/command/assets-view-handler.ts`
- `apps/cli/src/features/assets/command/assets-view-utils.ts`
- `apps/cli/src/features/assets/view/assets-view-components.tsx`
- `apps/cli/src/features/assets/view/assets-view-controller.ts`
- `apps/cli/src/features/assets/view/assets-view-state.ts`
- `apps/cli/src/features/assets/view/assets-view-utils.ts`

Update:

- `apps/cli/src/features/assets/command/assets.ts`
- `apps/cli/src/features/shared/schemas.ts`

Handler responsibilities:

1. load stored current asset rows from `balance_snapshot_assets`
2. load snapshot summaries from `balance_snapshots`
3. load excluded asset ids from override replay
4. load known historical asset stats with `collectKnownAssets(...)`
5. build `AssetViewItem[]`

Suggested `AssetViewItem` shape:

```ts
interface AssetViewItem {
  assetId: string;
  assetSymbols: string[];
  primarySymbol: string;
  currentQuantity: string;
  isHeld: boolean;
  excludedFromAccounting: boolean;
  accountCount: number;
  transactionCount: number;
  movementCount: number;
  verificationStatus: 'match' | 'warning' | 'mismatch' | 'unavailable' | 'stale' | 'historical';
  perAccount: {
    accountId: number;
    sourceName: string;
    accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
    quantity: string;
    verificationStatus: string;
  }[];
}
```

The TUI controller should support:

- navigation
- drill-down
- inline toggle with `x`
- filter cycling

### Step 11: Keep `assets exclude/include/exclusions`, but wire the TUI toggle to them

Current files:

- `apps/cli/src/features/assets/command/assets-handler.ts`
- `apps/cli/src/features/assets/command/assets-exclude.ts`
- `apps/cli/src/features/assets/command/assets-include.ts`
- `apps/cli/src/features/assets/command/assets-exclusions.ts`

Do not delete these commands.
They remain useful for:

- scripting
- JSON mode
- non-interactive workflows

But the TUI should call the same handler methods directly so the behavior stays
consistent.

### Step 12: Remove old account balance metadata completely

After the new snapshot-backed views work, remove all remaining references to:

- `lastBalanceCheckAt`
- `verificationMetadata`
- `getVerificationStatus(account: Account)` based on account metadata

Search targets to clean:

- `packages/accounts`
- `apps/cli/src/features/accounts`
- `packages/data/src/repositories/__tests__`
- `packages/ingestion/src/features/balance/__tests__`

This should be a clean break, not a compatibility layer.

## Testing Plan

### Data And Projection Tests

Add or update tests for:

- `packages/data/src/repositories/balance-snapshot-repository.test.ts`
- `packages/core/src/projections/__tests__/projection-graph-utils.test.ts`
- `packages/data/src/adapters/balance-projection-freshness-adapter.test.ts`
- `packages/data/src/adapters/balance-projection-reset-adapter.test.ts`

Test cases:

- replace snapshot overwrites old asset rows
- reset deletes both tables
- per-scope freshness works independently
- processed-transactions invalidation marks balances stale

### Balance Workflow Tests

Update:

- `packages/ingestion/src/features/balance/__tests__/balance-workflow.test.ts`

Replace expectations that assert account updates with expectations that assert
snapshot row writes.

Add coverage for:

- `match`
- `warning`
- `mismatch`
- `unavailable`
- scoped parent-child account behavior

### Account View Tests

Update:

- `packages/accounts/src/__tests__/account-query-utils.test.ts`
- `packages/accounts/src/__tests__/account-query.test.ts`
- `apps/cli/src/features/accounts/view/__tests__/*`

Assert:

- account summaries read snapshot-backed verification fields
- parents and children display the intended scope semantics

### Assets View Tests

Add:

- `apps/cli/src/features/assets/command/__tests__/assets-view-handler.test.ts`
- `apps/cli/src/features/assets/view/__tests__/assets-view-controller.test.ts`
- `apps/cli/src/features/assets/view/__tests__/assets-view-components.test.tsx`

Test:

- held vs historical rows
- excluded toggle behavior
- ambiguity handling for symbol lookups stays intact
- drill-down account list

### Documentation Follow-Up

After implementation, update:

- `docs/specs/projection-system.md`
- `docs/specs/accounts-and-imports.md`
- any balance command help text

This `docs/dev` document is the implementation guide, not the final canonical
spec.

## Open Questions

### 1. Should `assets view` default to held-only or all-seen?

Recommendation:

- default to held-only
- add filter/toggle for all-seen

Reason:

- the default screen should answer “what do I currently have?”
- historical zero-balance assets are still useful, but secondary

### 2. Should `excluded_from_accounting` be stored on asset rows?

Recommendation:

- yes, denormalize it on snapshot asset rows for easy SQL/UI filtering
- continue treating override replay as the source of truth

Reason:

- it simplifies `balance view` and `assets view`
- it does not replace override policy ownership

### 3. Should `assets view` live in a new package?

Recommendation:

- no, not in this phase

Reason:

- current asset workflows are still CLI-local
- the feature is still small enough to stay inside `apps/cli/src/features/assets`
- extract later only if the read model grows into a reusable capability

## Decisions And Smells

- `VerificationMetadata` is the wrong abstraction. It encodes a nested JSON
  shape instead of a durable read model.
- `lastBalanceCheckAt` is too vague. If a name survives in the new model,
  prefer `lastRefreshAt`.
- The current `assets` feature is action-first, not view-first. That is why it
  feels incomplete in TUI terms.
- The repo already has a strong asset browsing precedent in `portfolio`; adding
  a completely different `assets view` interaction model would be a UX smell.
- Child account rows currently risk implying verification semantics that really
  belong to the parent balance scope.

## Rename Suggestions

- `VerificationMetadata` -> remove; replace with row types
  `BalanceSnapshot` / `BalanceSnapshotAsset`
- `lastBalanceCheckAt` -> `lastRefreshAt`
- `assets exclusions` -> keep for CLI compatibility, but present the TUI
  action as `excluded from accounting`
- `balance --offline` -> replace with `balance view`
