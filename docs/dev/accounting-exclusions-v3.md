# Accounting Exclusions v3

This document supersedes:

- [`accounting-exclusions.md`](./accounting-exclusions.md)
- [`accounting-exclusions-v2.md`](./accounting-exclusions-v2.md)

It assumes the accounting-scoped cost-basis boundary defined in
[`cost-basis-accounting-scope.md`](../specs/cost-basis-accounting-scope.md)
has landed.

That refactor changed the right place to solve exclusions.

The old docs were written when cost basis still reasoned about raw processed
transactions and linker-era transfer heuristics. That is no longer the code we
have. Today the accounting boundary is:

```text
transactions
  ↓
buildCostBasisScopedTransactions()
  ↓
scoped price validation / scoped price coverage
  ↓
validated transfer links
  ↓
lot matching
```

The exclusions design must start from that boundary, not from raw transaction
filtering and not from a balances projection.

## Why v3 Exists

The current code now has a much cleaner seam for exclusions:

- [`build-cost-basis-scoped-transactions.ts`](../../packages/accounting/src/cost-basis/build-cost-basis-scoped-transactions.ts)
  builds the accounting-owned scoped view.
- [`transaction-price-coverage-utils.ts`](../../packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts)
  checks price coverage on that scoped view.
- [`cost-basis-utils.ts`](../../packages/accounting/src/cost-basis/cost-basis-utils.ts)
  validates prices on that scoped view.
- [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/cost-basis-pipeline.ts)
  runs the scoped pipeline before lot matching.

That means the next exclusions phase should no longer thread `excludedAssets`
through raw movement validators or make balances the owner of exclusion state.

The right model is now:

```text
baseline whole-transaction exclusion
        +
accounting-scoped builder
        +
accounting exclusion policy
        ↓
pruned accounting-scoped result
        ↓
price coverage / price validation / lot matching
```

## Current Code Reality

### 1. Baseline whole-transaction exclusion already exists

Current persistence already supports whole-transaction exclusion:

- [`001_initial_schema.ts`](../../packages/data/src/migrations/001_initial_schema.ts)
  defines `transactions.excluded_from_accounting`.
- [`universal-transaction.ts`](../../packages/core/src/transaction/universal-transaction.ts)
  exposes `excludedFromAccounting`.
- [`transaction-repository.ts`](../../packages/data/src/repositories/transaction-repository.ts)
  persists:

```text
excluded_from_accounting =
  transaction.excludedFromAccounting ?? transaction.isSpam ?? false
```

and filters excluded rows by default in `findAll()`, `count()`, and
`findNeedingPrices()`.

That baseline behavior is already used by:

- cost basis handler reads via `db.transactions.findAll()`
- portfolio handler reads via `db.transactions.findAll()`
- price coverage data adapter reads via `db.transactions.findAll()`
- linking ports read via `db.transactions.findAll()`

So baseline spam/import exclusions are already a persistence concern, not a
cost-basis concern.

### 2. Accounting meaning now lives at the scoped boundary

The important post-refactor change is that accounting no longer validates prices
or matches lots directly against raw processed movements.

`buildCostBasisScopedTransactions()` now:

- clones raw movements and fees into cost-basis-local scoped shapes
- preserves movement identity with `movementFingerprint` and `rawPosition`
- reduces same-hash blockchain groups before lot matching
- emits `feeOnlyInternalCarryovers` as cost-basis-local sidecars

Then:

- `checkTransactionPriceCoverage()` validates the scoped result
- `validateScopedTransactionPrices()` validates the scoped result
- `runCostBasisPipeline()` rebuilds scoped state after soft missing-price
  exclusion so carryovers stay consistent

This is the key change that makes exclusions easier now than they were in v1 or
v2.

### 3. What is still missing

The code still does **not** support user-controlled mixed-transaction
exclusions.

Missing pieces:

- no override scope for `asset-exclude` / `asset-include`
- no strict replay of exclusion policy from the override store
- no accounting-local `applyAccountingExclusionPolicy()` step
- no scoped pruning of excluded inflows, outflows, fees, or fee-only carryovers
- no way to classify a transaction as "still in scope overall, but only after
  some scoped movements were removed"

Example still unsupported as a first-class policy:

- `SCAMTOKEN -> ETH`
- `SCAMTOKEN` excluded by user policy
- `ETH` remains included
- transaction stays in scope overall
- `SCAMTOKEN` movements and fees do not require prices

That is exactly the case the scoped boundary was created to support next.

### 4. Override storage is better, but exclusion replay still needs its own contract

Current override infrastructure only supports:

- `price`
- `fx`
- `link`
- `unlink`

See [`override.ts`](../../packages/core/src/override/override.ts).

Also, [`override-store.ts`](../../packages/data/src/overrides/override-store.ts)
is now durable SQLite storage, but that does not by itself define the exclusion
replay contract.

For accounting exclusions, we still need an explicit policy replay surface:

- only exclusion scopes participate
- latest event per `asset_id` wins
- malformed exclusion payloads or invalid scope/type pairings return `Err`
- accounting does not consume broad "all overrides" behavior by accident

The main problem is no longer file fragility. The main problem is that asset
exclusion replay still does not exist as a first-class domain contract.

## v3 Design

### Two exclusion layers

### Layer 1: baseline whole-transaction exclusion

Keep baseline whole-transaction exclusion where it already belongs:

- importer/processor explicit exclusion
- structured spam classification
- existing `transactions.excluded_from_accounting` filtering

This is owned by persistence and repository defaults.

This layer should continue to remove entire transactions from:

- linking
- price enrichment candidate reads
- cost-basis transaction reads
- portfolio transaction reads

### Layer 2: accounting exclusion policy on the scoped result

Add a second layer for mixed transactions:

- user excludes one or more `assetId`s
- transaction still stays in scope if included economic activity remains
- excluded movements, excluded fees, and excluded carryovers are removed **after
  scoped build and before price validation**

This second layer belongs in accounting, not in linking and not in balances.

### Scoped application point

The post-refactor boundary should be:

```text
transactions from repository
  ↓
buildCostBasisScopedTransactions()
  ↓
applyAccountingExclusionPolicy()
  ↓
validateScopedTransactionPrices()
  ↓
validateScopedTransferLinks()
  ↓
LotMatcher
```

Important rule:

- exclusions belong in the accounting-scoped builder phase or immediately after
  it
- exclusions do not belong in linking
- the lot matcher should never receive raw excluded-asset movements and decide
  policy for itself

### Recommended shapes

Add accounting-local shapes in `packages/accounting/src/cost-basis`:

```ts
export interface AccountingExclusionPolicy {
  excludedAssetIds: Set<string>;
}

export interface AccountingExclusionApplyResult {
  scopedBuildResult: AccountingScopedBuildResult;
  fullyExcludedTransactionIds: Set<number>;
  partiallyExcludedTransactionIds: Set<number>;
}

export function applyAccountingExclusionPolicy(
  scopedBuildResult: AccountingScopedBuildResult,
  policy: AccountingExclusionPolicy,
  logger: Logger
): Result<AccountingExclusionApplyResult, Error>;
```

Recommended file:

- `packages/accounting/src/cost-basis/apply-accounting-exclusion-policy.ts`

This should stay local to accounting just like
`buildCostBasisScopedTransactions()`.

### Scoped exclusion rules

`applyAccountingExclusionPolicy()` should:

1. remove scoped inflows whose `assetId` is excluded
2. remove scoped outflows whose `assetId` is excluded
3. remove scoped fees whose `assetId` is excluded
4. remove `feeOnlyInternalCarryovers` whose `assetId` is excluded
5. drop transactions that have no remaining scoped inflows, outflows, or fees
6. record whether each dropped transaction became fully excluded because of
   policy
7. record mixed transactions where some scoped activity was removed but included
   scoped activity remains
8. return `Err` if pruning would leave dangling included-asset state that cannot
   be reconciled

Important detail:

- effective exclusion by asset policy must be evaluated from the **scoped**
  accounting view, not by scanning raw processed movements

That is a direct consequence of the cost-basis refactor. Same-hash blockchain
reduction and fee-only carryover generation already changed what counts as
accounting-relevant activity. Any later effective exclusion cache must use the
same scoped interpretation or it will drift from the actual accounting path.

### Fee semantics

Fees follow the same rule as movements.

Included fee:

- transaction remains in scope
- fee asset is not excluded
- fee still participates in price validation and cost-basis math

Excluded fee:

- fee asset is excluded by policy
- fee is removed from the scoped result before price validation
- fee does not block cost basis
- fee does not participate in fee conversion or carryover logic

### Override source of truth

User exclusion policy should live in the override store, but not through the
current permissive replay path.

Required new scopes in [`override.ts`](../../packages/core/src/override/override.ts):

- `asset-exclude`
- `asset-include`

Required payloads:

```ts
type AssetExcludePayload = {
  type: 'asset_exclude';
  asset_id: string;
};

type AssetIncludePayload = {
  type: 'asset_include';
  asset_id: string;
};
```

Required rule:

- accounting exclusion replay must be strict
- malformed exclusion payloads or invalid scope/type pairing must return `Err`
- do not reuse broad all-override reads where exclusion replay semantics are
  still implicit

Recommended implementation:

- add a focused strict replay helper in `packages/data/src/overrides`
- latest event per `asset_id` wins
- replay result is `excludedAssetIds: Set<string>`

## What changes now vs later

### What should change in the next exclusions phase

The next phase should solve the mixed-transaction problem directly in the
scoped accounting path:

- add override scopes for asset include/exclude
- add strict exclusion replay
- apply exclusion policy after scoped build
- make scoped price coverage and scoped price validation consume the pruned
  result
- make cost basis consume only the pruned scoped result

### What should not be step zero anymore

The next phase should **not** begin by introducing a balances projection or by
threading exclusion checks through raw validators.

Those were reasonable earlier guesses, but the refactor changed the best seam.

## Consumer impact

### Price coverage

Update [`transaction-price-coverage-utils.ts`](../../packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts)
so it becomes:

```text
load transactions
  → buildCostBasisScopedTransactions()
  → applyAccountingExclusionPolicy()
  → scopedTransactionHasAllPrices()
```

The coverage count should be based on the pruned scoped transaction set, not on
raw transactions.

### Cost basis

Update [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/cost-basis-pipeline.ts)
so it becomes:

```text
buildCostBasisScopedTransactions()
  → applyAccountingExclusionPolicy()
  → validateScopedTransactionPrices()
  → missing price policy
  → validateScopedTransferLinks()
  → lot matching
```

Important distinction:

- `missingPricePolicy: 'exclude'` is a portfolio soft-failure mode for missing
  prices
- it is **not** the accounting exclusions feature

Do not conflate "transaction excluded because prices are missing in soft mode"
with "transaction or movement excluded by accounting policy."

### Portfolio

Portfolio currently uses two separate paths:

- holdings are built from `calculateBalances(transactionsUpToAsOf)`
- open lots come from `runCostBasisPipeline(..., { missingPricePolicy: 'exclude' })`

That means movement-level accounting exclusions in cost basis alone are not
enough to make portfolio inventory fully exclusion-aware.

If user asset exclusions are introduced, portfolio needs one of:

1. exclusion-aware holdings calculation for raw balances, or
2. a later effective whole-transaction cache plus additional movement-level
   inventory filtering where mixed transactions remain visible

This is a real follow-up, not something the doc should hand-wave away.

### Price enrichment

Current enrichment candidate loading uses
[`findNeedingPrices()`](../../packages/data/src/repositories/transaction-repository.ts),
which scans raw movements and fees of non-excluded transactions.

That is still safe if exclusions are applied only in price coverage and cost
basis, but it may over-fetch prices for movements that would later be pruned by
accounting exclusion policy.

Initial recommendation:

- correctness first: make coverage and cost basis exclusion-aware
- accept temporary over-fetch in enrichment if needed
- optimize enrichment later if it becomes noisy or expensive

### Balance verification

Current balance verification already has special handling for excluded
transactions in
[`balance-workflow.ts`](../../packages/ingestion/src/features/balance/balance-workflow.ts).

That path:

- loads transactions with `includeExcluded: true`
- subtracts excluded inflow amounts from live balances
- filters scam assets from comparison

This is still compatible with baseline whole-transaction exclusion. It is not a
replacement for movement-level accounting exclusions.

## Effective whole-transaction cache is a follow-up

v2 assumed the next exclusions phase should immediately add a derived effective
transaction exclusion cache plus freshness tracking.

That is no longer the best first step.

The best first step now is:

- get scoped exclusion policy working in price coverage and cost basis
- prove mixed-transaction behavior is correct
- only then decide whether repository-level consumers need an effective cache

If a later phase does introduce effective whole-transaction caching from user
asset policy, then it should:

1. split baseline from effective exclusion:
   - `excluded_from_accounting_base`
   - `excluded_from_accounting`
2. compute effective exclusion from the **scoped** view, not raw movements
3. treat baseline spam/import exclusion as non-overridable by ordinary
   `asset-include`
4. add freshness tracking only when there is actually derived exclusion state to
   prove fresh

In other words: keep the schema split and freshness ideas from v2 as a later
phase, but do not make them the prerequisite for solving the main accounting
problem.

## Implementation Order

### Phase 1: add exclusion policy replay

1. Extend [`override.ts`](../../packages/core/src/override/override.ts) with
   `asset-exclude` and `asset-include`.
2. Add payload schemas and scope-to-payload mapping.
3. Add a strict exclusion replay helper under
   [`packages/data/src/overrides/`](../../packages/data/src/overrides/).
4. Return `excludedAssetIds: Set<string>`.

### Phase 2: add scoped exclusion application

1. Add
   `packages/accounting/src/cost-basis/apply-accounting-exclusion-policy.ts`.
2. Add focused tests under
   [`packages/accounting/src/cost-basis/__tests__/`](../../packages/accounting/src/cost-basis/__tests__/)
   for:
   - fully excluded transaction
   - mixed transaction
   - excluded fee
   - excluded fee-only carryover
   - same-hash scoped groups after pruning
   - dangling-state failure

### Phase 3: wire accounting consumers

1. Update
   [`transaction-price-coverage-utils.ts`](../../packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts).
2. Update
   [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/cost-basis-pipeline.ts).
3. Update CLI composition so cost-basis and portfolio load exclusion policy once
   and pass it into accounting.
4. Keep accounting pure: accounting accepts policy, it does not read the
   override store itself.

### Phase 4: tighten reporting and warnings

1. Warn on mixed transactions where excluded and included scoped activity
   coexist.
2. Surface counts of fully excluded and partially excluded transactions where
   useful.
3. Keep output terminology precise:
   - baseline excluded
   - policy excluded
   - missing-price soft excluded

### Phase 5: only then evaluate cache/freshness work

1. Decide whether any repository-level consumers need user-policy-driven whole
   transaction filtering.
2. If yes, add baseline/effective split and derived cache sync.
3. If no, keep exclusion policy ephemeral in the accounting path.

## Locked decisions

1. The authoritative boundary for movement-level exclusions is the
   accounting-scoped build result.
2. Baseline whole-transaction spam/import exclusion stays in persistence.
3. Linking does not gain movement-level exclusion logic.
4. Balances do not become the source of truth for accounting exclusions.
5. Accounting exclusion replay must fail closed; permissive skip-invalid replay
   is not acceptable here.
6. `missingPricePolicy: 'exclude'` remains separate from accounting exclusion
   policy.

## Naming

Prefer:

- `AccountingExclusionPolicy`
- `applyAccountingExclusionPolicy`
- `excludedAssetIds`
- `fullyExcludedTransactionIds`
- `partiallyExcludedTransactionIds`
- `baseline exclusion`
- `policy exclusion`

Avoid:

- `reviewed assets`
- `effective excluded asset set` when the code really means user policy
- `exclude transaction` for the portfolio soft missing-price path

## Non-Goals

- redesigning linking
- introducing balances as a prerequisite for accounting
- solving every portfolio inventory concern in the same patch as cost-basis
  exclusions
- redesigning price enrichment before the scoped exclusion path works
