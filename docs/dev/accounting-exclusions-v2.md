# Accounting Exclusions

DO NOT READ -- ARCHIVED

This document defines how accounting exclusions should work in `exitbook`.

The goal is to let users explicitly remove junk assets from accounting without
weakening existing safety behavior, and without coupling exclusion correctness
to unrelated projection work.

## Problem

`exitbook` needs two kinds of exclusion behavior:

1. **Whole-transaction exclusion**
   Some transactions should disappear from normal accounting reads entirely.
   Examples: spam imports, scam tokens, explicitly excluded transactions.
2. **Movement-level exclusion**
   Some transactions must stay in scope overall, but specific movements or fees
   inside them should not block accounting.

The current system already supports the first case in a limited form through
`transactions.excluded_from_accounting`.

The missing capability is the second case.

Example:

- a transaction swaps `SCAMTOKEN -> ETH`
- `SCAMTOKEN` should be excluded from accounting
- `ETH` must remain in scope
- the transaction should not be hidden entirely
- missing prices on `SCAMTOKEN` must not block cost-basis for `ETH`

That requires exclusion-aware accounting at the movement and fee level.

## Goals

1. Preserve current spam/import exclusion safety defaults.
2. Add asset-level user exclusions that work for mixed transactions.
3. Define fee behavior explicitly.
4. Keep accounting rules independent from balances projection freshness.
5. Keep the accounting package pure: policy is passed in, not looked up inside
   low-level functions.
6. Fail closed when effective exclusion state may be stale.

## Non-Goals

- redesigning the `balance` command in this phase
- making balances a prerequisite for cost-basis or portfolio
- transaction-level exclude/include UX in the first implementation
- changing link projection ownership or lifecycle

## Model

### Exclusion layers

#### Whole-transaction exclusion

Use this when the entire transaction should be removed from normal accounting
reads.

Examples:

- processor/importer marked the transaction as spam
- imported transaction was explicitly flagged as excluded
- all accounting-relevant movements and fees belong to excluded assets
- future transaction-level exclude override

This is materialized in `transactions.excluded_from_accounting`.

#### Movement-level exclusion

Use this when the transaction still matters overall, but some movements or fees
do not.

Examples:

- excluded token swapped into included token
- excluded dust asset used as fee alongside an included acquisition
- transaction contains both legitimate and junk assets

Movement-level exclusion only affects accounting gates and cost-basis logic. It
does not hide the transaction if some included economic activity remains.

### Domain shape

The persistence model and the read model must distinguish **baseline exclusion**
from **effective exclusion**.

Recommended shape:

- `excludedFromAccountingBase`
- `excludedFromAccounting`

Phase 1 may keep the existing write-side input field as importer intent for the
baseline decision, but implementation should not continue treating one boolean
as if it means both:

- importer/spam baseline policy
- user-policy-adjusted effective exclusion

If the full domain type split is deferred, that distinction must still be
preserved at the repository/service boundary.

## Source of Truth

### Baseline exclusion

The system needs a durable baseline exclusion state that belongs to ingestion
and imports, not to user override policy.

Recommended schema:

- `transactions.excluded_from_accounting_base`
  - importer/processor-owned baseline exclusion
  - set from explicit imported exclusion or structured spam classification
- `transactions.excluded_from_accounting`
  - effective execution cache used by queries

Why both:

- baseline spam/import exclusions already exist conceptually today
- effective exclusion must also reflect user asset policy
- recomputing a single overloaded column from user policy alone is unsafe

`SCAM_TOKEN` notes alone must not set baseline exclusion. Notes are advisory
metadata, not durable policy. If a processor means "exclude by default", it
must emit a structured decision such as `isSpam`.

### User exclusion policy

User decisions live in the append-only override store.

Required override scopes:

- `asset-exclude`
- `asset-include`

Future scopes:

- `transaction-exclude`
- `transaction-include`

The override store is the source of truth for **user policy**, not for all
exclusion semantics.

Accounting policy replay must be strict. Silent skipping is unacceptable for a
financial read path:

- malformed override log lines must fail replay
- malformed exclusion events must fail replay
- unknown exclusion payloads must fail replay
- sync/readiness must surface the error and block dependent accounting reads

### Effective whole-transaction exclusion

Effective exclusion should be recomputed as:

```text
effectiveExcluded =
  excluded_from_accounting_base
  OR allAccountingMovementsAndFeesExcludedByAssetPolicy
  OR futureTransactionLevelExclude
```

`asset-include` should not defeat baseline spam exclusion. If a specific spam
decision needs to be overridden later, that should be a transaction-level
recovery workflow, not an ordinary include path.

### Effective exclusion cache freshness

`transactions.excluded_from_accounting` is a denormalized execution cache. It
is only valid when exclusion sync state is fresh relative to both:

- processed transaction state
- exclusion override event history

This spec requires a persisted freshness record for accounting exclusions.

Recommended storage:

- a `projection_state` row keyed by `accounting-exclusions`

Required sync metadata:

- `status`: `fresh | stale | syncing | failed`
- `synced_at`
- processed-transactions dependency fingerprint/version
- override replay cursor/checkpoint
- last failure message when status is `failed`

This does **not** make accounting exclusions a balances projection. It reuses
existing freshness machinery for a cache sync operation that must be proven
current before reads rely on it.

## Fee Semantics

Fees are part of accounting scope and must be handled explicitly.

### Included fee

A fee is included when:

- the transaction is in scope, and
- the fee asset is not excluded

Included fees keep current behavior:

- they require price data when current accounting rules require it
- missing price can still block accounting

### Excluded fee

A fee is excluded when its asset is in the excluded asset set.

Excluded fees must be:

- skipped in price coverage
- skipped in price completeness validation
- skipped in fee-to-fiat conversion for cost-basis
- prevented from blocking the transaction

This applies even when the transaction itself remains in scope.

## Cost-Basis Policy

The correct first implementation is:

- keep mixed transactions in scope when included assets remain
- skip excluded movements
- skip excluded fees
- calculate normally from the remaining included movements
- block only when included movements or included fees still lack required data

This avoids inventing synthetic basis rules that are not required for the core
problem.

## Read Path

### Transaction queries

Default repository reads should continue to filter:

```sql
WHERE excluded_from_accounting = false
```

Audit and export flows can continue to opt into `includeExcluded`.

### Readiness gate

Any consumer that relies on default transaction filtering or exclusion-aware
price gates must ensure accounting exclusions are fresh before reading.

Required behavior:

1. check `accounting-exclusions` sync state
2. if stale, run `syncAccountingExclusions()`
3. if sync fails, fail the consumer request
4. never silently proceed with potentially stale effective exclusion state

This applies at minimum to:

- cost-basis
- portfolio
- assets review
- any future command that reads default accounting-scoped transactions

Automatic sync during readiness is the default behavior for normal consumers.
An explicit sync command may still exist for diagnostics or repair workflows,
but routine accounting reads must not require a separate manual sync step.

### Price coverage

`checkTransactionPriceCoverage()` should accept:

```ts
excludedAssets: Set<string>;
```

Behavior:

- whole excluded transactions are already absent from the default read path
- mixed transactions remain visible
- excluded inflows are ignored
- excluded outflows are ignored
- excluded fees are ignored
- only in-scope movements and fees decide whether the transaction is missing
  prices

### Cost-basis validation

The same `excludedAssets` set should be threaded through:

- `validateTransactionPrices()`
- `transactionHasAllPrices()`
- `collectPricedEntities()`
- `assertPriceDataQuality()`
- cost-basis fee conversion paths
- `runCostBasisPipeline()`

The accounting package should not query override state internally. Callers load
the exclusion policy once and pass it in.

## Write Path

### Transaction persistence

At insert time:

```text
excluded_from_accounting_base =
  transaction.excludedFromAccounting ?? transaction.isSpam ?? false

excluded_from_accounting =
  excluded_from_accounting_base
```

This preserves current safety behavior.

Persistence rule:

- `SCAM_TOKEN` notes do not affect `excluded_from_accounting_base`
- `SCAM_TOKEN` notes are advisory review signals that may help the user decide
  whether to exclude an asset later
- processors may emit `SCAM_TOKEN` without `isSpam` when they mean "possibly
  spam, needs review" rather than "exclude by default"

### Asset policy sync

When asset exclusion policy changes:

1. append override event
2. replay latest asset policy
3. recompute effective transaction exclusion
4. persist changed `excluded_from_accounting` values

This should be handled by a focused sync operation, not by rebuilding an
unrelated projection.

### Freshness and failure semantics

Asset exclude/include flows cross two persistence boundaries:

- append-only override log
- SQLite execution cache

They are not atomically writable together, so the recovery contract must be
explicit.

Required behavior:

1. append override event
2. mark `accounting-exclusions` sync state stale
3. run `syncAccountingExclusions()`
4. mark state fresh only after the database cache update succeeds

If step 1 succeeds and sync fails:

- return an error to the caller
- leave sync state as `failed` or `stale`
- block dependent accounting reads until a later sync succeeds

Recovery rule:

- sync is idempotent and always recomputes from the full override history plus
  current transactions
- the cache is never treated as authoritative on its own

Database-side atomicity requirement:

- updating `transactions.excluded_from_accounting`
- updating sync metadata/checkpoint

must happen in one database transaction so readers never observe a "fresh"
checkpoint paired with partially updated exclusion rows.

## Recommended Service Shape

### Read port

```ts
export interface IAccountingExclusionData {
  loadExcludedAssetIds(): Promise<Result<Set<string>, Error>>;
}
```

Implementation:

- read override events from `OverrideStore`
- replay latest event per `asset_id`
- return the effective excluded asset set

### Readiness port

```ts
export interface IAccountingExclusionSyncState {
  ensureFresh(): Promise<Result<void, Error>>;
}
```

Responsibility:

- prove effective exclusion cache freshness before accounting reads depend on it
- run sync when stale
- fail closed when sync cannot be completed

### Sync operation

Add a dedicated sync operation:

```ts
syncAccountingExclusions(): Promise<Result<void, Error>>
```

Responsibilities:

- load excluded asset ids
- load transactions with `includeExcluded: true`
- determine which transactions are fully excluded by asset policy
- combine that result with `excluded_from_accounting_base`
- update `excluded_from_accounting` only where needed
- update sync checkpoint/metadata in the same database transaction
- return an error without marking the cache fresh if replay or persistence fails

This is an accounting policy synchronization step. It is not a projection
rebuild.

Ownership:

- the accounting capability owns exclusion replay and `syncAccountingExclusions`
- the host/CLI owns readiness orchestration and decides when to call
  `ensureFresh()` for a command

## Assets Review

`exitbook assets review` should be built from exclusion policy and transaction
aggregates, not from balances projection.

Minimal v1 review surface:

- one row per `assetId`
- transaction count
- count of transactions with missing in-scope prices
- current inclusion/exclusion status
- optional reason and timestamp from latest override event

This is enough to let the user unblock accounting correctly.

## Relationship to Balances

Balances are a separate concern.

If a future `asset_balances` table is added, it may:

- materialize exclusion state for UX
- enrich `assets review`
- show calculated versus live holdings

It must not:

- become the source of truth for accounting exclusion policy
- be required to determine whether cost-basis can run
- gate accounting correctness on balances freshness

Exclusions solve an accounting policy problem. Balances solve an inventory and
verification problem.

## Implementation Order

### Phase 1: Separate baseline from effective exclusion

1. Add `transactions.excluded_from_accounting_base` to
   `001_initial_schema.ts`.
2. Update transaction persistence to populate both baseline and effective
   columns.
3. Extend override schemas with `asset-exclude` and `asset-include`.
4. Add override replay utility for effective excluded asset ids.
5. Add persisted sync state for `accounting-exclusions`.

### Phase 2: Make accounting exclusion-aware

1. Add shared helpers for movement and fee exclusion checks.
2. Update `transactionHasAllPrices()`.
3. Update `validateTransactionPrices()`.
4. Update `collectPricedEntities()`.
5. Update `assertPriceDataQuality()`.
6. Update fee conversion helpers to skip excluded fees.
7. Thread `excludedAssets` through price coverage and cost-basis entry points.

### Phase 3: Sync effective transaction exclusion

1. Add `syncAccountingExclusions()`.
2. Recompute `transactions.excluded_from_accounting` from:
   - `excluded_from_accounting_base`
   - full transaction asset/fee exclusion by policy
3. Persist sync checkpoint/metadata atomically with cache updates.
4. Add readiness gate so consumers ensure exclusion freshness before reads.
5. Run sync after:
   - reprocess
   - asset exclude/include commands
   - future transaction-level exclusion changes

### Phase 4: Add review UX

1. Add `exitbook assets review`.
2. Build the view from transaction aggregates plus override replay.
3. Add balances enrichment later only if it improves UX.

## Locked Decisions

1. Freshness state reuses the existing `projection_state` table.
   `accounting-exclusions` is derived state with the same operational needs as
   other freshness-tracked caches, so it should not introduce a parallel
   freshness system unless `projection_state` proves structurally incapable of
   storing the required checkpoint metadata.
2. Override replay is strict for the entire override log.
   Any malformed line in `overrides.jsonl` blocks replay. In a financial system,
   a partially trusted event log is not trustworthy enough to derive accounting
   policy. Repair/diagnostic tooling is preferable to silent skipping.
3. Cost-basis and portfolio auto-run `syncAccountingExclusions()` during
   readiness when exclusion state is stale.
   They then fail closed if sync cannot complete. Manual sync remains optional
   for diagnostics, not a prerequisite for routine accounting commands.
4. `SCAM_TOKEN` notes remain advisory and do not feed baseline exclusion on
   their own.
   Baseline exclusion must come from structured importer/processor decisions
   such as `isSpam` or explicit imported exclusion.
5. `syncAccountingExclusions()` is owned by the accounting capability.
   The host composes readiness checks and invokes capability-owned sync through
   `ensureFresh()` or equivalent orchestration.
6. Future transaction-level include must not defeat baseline spam through the
   ordinary include path.
   Baseline spam remains non-overridable until a dedicated recovery workflow is
   explicitly designed.

## Naming

Prefer:

- `excluded_from_accounting_base`
- `excluded_from_accounting`
- `excluded asset set`
- `syncAccountingExclusions`
- `movement-level exclusion`

Avoid:

- making balances sound like the owner of exclusion policy
- treating asset include/exclude as a replacement for spam detection
- introducing synthetic cost-basis rules before they are required

## Future Follow-ups

Items worth addressing in separate passes after core exclusions land.

### Balance CLI split

Split the current `balance` command, which currently uses `--offline`, into
subcommands:

- `balance view`
  - reads cached balance state if and when a balances projection exists
  - instant
  - no network
- `balance verify`
  - fetches live balances
  - compares them with calculated balances
  - writes verification results back

This is a UX improvement adjacent to exclusions, not part of exclusion
correctness.

### Live-only synthetic rows

If balance verification later writes into a balances projection, it should
upsert rows for assets present on-chain or on an exchange but absent from
transactions:

- `calculated_balance = '0'`
- `balance_status = 'mismatch'`

These rows should be deleted on projection rebuild and recreated on the next
verification run. They are a strong signal for incomplete imports.

### Exclusion disclosure in reporting

- cost-basis and portfolio output should disclose exclusion counts, for example:
  `"3 transactions excluded from accounting"`
- `transactions view --show-excluded` for auditability
- `assets review` should show previously excluded assets with reason and
  timestamp

If exclusion-source reporting is later added, output can distinguish between
baseline/system exclusions and explicit user exclusions.

### Improved cost-basis error messages

When cost-basis is blocked by missing prices, differentiate between:

- assets that need exclusion review:
  `"Run 'exitbook assets review' to review 3 assets with missing prices"`
- included assets that need pricing:
  `"Run 'exitbook prices enrich' to fetch prices for 2 included assets"`

### Mixed-transaction warning logging

When a transaction contains both excluded and included asset movements, log a
warning with:

- transaction ID
- included assets
- excluded assets

Silent mixed-transaction handling is not acceptable in a financial system.
