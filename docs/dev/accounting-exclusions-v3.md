# Accounting Exclusions v3

This document supersedes:

- [`accounting-exclusions.md`](./accounting-exclusions.md)
- [`accounting-exclusions-v2.md`](./accounting-exclusions-v2.md)

This is now a current-state guide, not a future implementation plan. It
describes what the code does today and where the unfinished exclusion work still
belongs.

It assumes the scoped accounting boundary in
[`cost-basis-accounting-scope.md`](../specs/cost-basis-accounting-scope.md).

## Snapshot

- The only implemented accounting exclusion today is whole-transaction
  exclusion via `transactions.excluded_from_accounting`.
- That flag is decided at persistence time and applied by repository default
  reads.
- Mixed-transaction or asset-level exclusions do not exist yet.
- The correct seam for future mixed exclusions is still the accounting-scoped
  build result produced by
  [`build-cost-basis-scoped-transactions.ts`](../../packages/accounting/src/cost-basis/matching/build-cost-basis-scoped-transactions.ts).

## Current Model

### 1. Baseline exclusion is a persistence concern

The implemented exclusion primitive is:

- schema column:
  [`transactions.excluded_from_accounting`](../../packages/data/src/migrations/001_initial_schema.ts)
- domain field:
  [`UniversalTransactionData.excludedFromAccounting`](../../packages/core/src/transaction/universal-transaction.ts)
- repository write rule:
  [`transaction-repository.ts`](../../packages/data/src/repositories/transaction-repository.ts)

Current write behavior is:

```text
excluded_from_accounting =
  transaction.excludedFromAccounting ?? transaction.isSpam ?? false
```

Important details:

- `isSpam: true` auto-excludes by default.
- `excludedFromAccounting: false` explicitly prevents that auto-exclusion on
  write.
- repository reads materialize exclusion as `true | undefined`, not a strict
  `true | false` round-trip.

### 2. Repository defaults already enforce it

Current default repository behavior:

- `findAll()` excludes `excluded_from_accounting = true`
- `count()` excludes `excluded_from_accounting = true`
- `findNeedingPrices()` excludes `excluded_from_accounting = true`

That means baseline exclusions already affect downstream consumers before
accounting logic starts.

### 3. These consumers inherit the baseline filter automatically

These paths all read transactions through default repository reads:

- cost basis CLI:
  [`cost-basis-handler.ts`](../../apps/cli/src/features/cost-basis/command/cost-basis-handler.ts)
- cost basis persistence adapter:
  [`cost-basis-ports-adapter.ts`](../../packages/data/src/adapters/cost-basis-ports-adapter.ts)
- portfolio:
  [`portfolio-handler.ts`](../../apps/cli/src/features/portfolio/portfolio-handler.ts)
- price coverage:
  [`transaction-price-coverage-adapter.ts`](../../packages/data/src/adapters/transaction-price-coverage-adapter.ts)
- price enrichment persistence:
  [`pricing-ports-adapter.ts`](../../packages/data/src/adapters/pricing-ports-adapter.ts)
- linking:
  [`linking-ports-adapter.ts`](../../packages/data/src/adapters/linking-ports-adapter.ts)

So today:

- excluded transactions do not reach linking
- excluded transactions do not reach price coverage
- excluded transactions do not reach cost basis
- excluded transactions do not reach price-enrichment candidate discovery
- excluded transactions do not reach portfolio holdings/cost-basis inputs

### 4. Some surfaces intentionally opt in to excluded rows

These paths explicitly pass `includeExcluded: true` because they are
observability or operator surfaces, not accounting filters:

- transactions view:
  [`transactions-view.ts`](../../apps/cli/src/features/transactions/transactions-view.ts)
- transactions export:
  [`transactions-export-handler.ts`](../../apps/cli/src/features/transactions/transactions-export-handler.ts)
- balance verification's excluded-asset handling:
  [`balance-workflow.ts`](../../packages/ingestion/src/features/balance/balance-workflow.ts)

This is why excluded transactions are still visible in transaction tooling even
though accounting consumers skip them by default.

### 5. Override storage is durable, but not for exclusions

The override store is now durable SQLite storage in
[`override-store.ts`](../../packages/data/src/overrides/override-store.ts), but
its schema still only supports:

- `price`
- `fx`
- `link`
- `unlink`

That schema lives in
[`override.ts`](../../packages/core/src/override/override.ts).

So the current state is:

- override durability is solved
- link override replay is implemented
- asset exclusion replay does not exist yet

## Current Accounting Boundary

The refactor described in
[`cost-basis-accounting-scope.md`](../specs/cost-basis-accounting-scope.md)
landed. Cost basis no longer reasons directly about raw movements at the
matcher boundary.

### Generic cost basis and non-CA portfolio flow

Current generic pipeline:

```text
repository findAll()
  ↓
buildCostBasisScopedTransactions()
  ↓
validateScopedTransactionPrices()
  ↓
if missingPricePolicy === 'exclude':
  rebuild scoped state from price-complete raw transactions
  ↓
validateScopedTransferLinks()
  ↓
lot matching
```

Relevant code:

- scoped builder:
  [`build-cost-basis-scoped-transactions.ts`](../../packages/accounting/src/cost-basis/matching/build-cost-basis-scoped-transactions.ts)
- pipeline:
  [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts)
- calculator:
  [`cost-basis-calculator.ts`](../../packages/accounting/src/cost-basis/orchestration/cost-basis-calculator.ts)

### Canada ACB flow

Canada does not use `runCostBasisPipeline()`. It has its own scoped workflow:

```text
repository findAll()
  ↓
buildCostBasisScopedTransactions()
  ↓
validateScopedTransferLinks()
  ↓
buildCanadaTaxInputContext()
  ↓
ACB engine
```

Relevant code:

- workflow:
  [`canada-acb-workflow.ts`](../../packages/accounting/src/cost-basis/canada/canada-acb-workflow.ts)

This matters because any future mixed exclusion policy must be wired into the
Canada path too, not only the generic pipeline.

### Price coverage flow

Current price coverage logic is:

```text
repository findAll()
  ↓
filterTransactionsByDateRange()
  ↓
buildCostBasisScopedTransactions()
  ↓
scopedTransactionHasAllPrices()
```

Relevant code:

- coverage orchestration:
  [`transaction-price-coverage-utils.ts`](../../packages/accounting/src/cost-basis/orchestration/transaction-price-coverage-utils.ts)
- scoped price predicates:
  [`cost-basis-utils.ts`](../../packages/accounting/src/cost-basis/shared/cost-basis-utils.ts)

This is already scoped-accounting aware, but only after baseline
whole-transaction exclusion has happened.

## What Is Not Implemented

The unfinished part is still mixed-transaction, asset-level exclusion.

These pieces do not exist in the current code:

- no override scopes for `asset-exclude` / `asset-include`
- no asset exclusion payloads in
  [`override.ts`](../../packages/core/src/override/override.ts)
- no strict asset-exclusion replay helper in
  [`override-store.ts`](../../packages/data/src/overrides/override-store.ts)
- no accounting-local `applyAccountingExclusionPolicy(...)`
- no scoped pruning of inflows, outflows, fees, or
  `feeOnlyInternalCarryovers`
- no handling for "transaction remains in scope after excluded movements were
  removed"

Still unsupported example:

- user wants to exclude `SCAMTOKEN`
- transaction is `SCAMTOKEN -> ETH`
- `ETH` should remain in accounting
- `SCAMTOKEN` legs and fees should stop blocking prices

That behavior is still absent.

## What Older Docs Proposed But The Code Still Does Not Have

The following ideas remain unimplemented:

- no `asset_balances` projection
- no `assets review` command
- no exclusion freshness graph or rebuild flow
- no derived effective exclusion cache split such as
  `excluded_from_accounting_base` vs `excluded_from_accounting`

Current balance verification is still on-demand workflow logic, not a balances
projection. It:

- calculates balances from the default non-excluded transaction set
- separately loads excluded transactions with `includeExcluded: true`
- subtracts excluded inflow amounts from live balances
- removes scam asset IDs from comparison

That behavior is compatible with today's whole-transaction exclusion model. It
is not a mixed-transaction exclusion system.

## Terminology Pitfalls In Current Code

### `missingPricePolicy: 'exclude'` is not accounting exclusion

In [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts),
`missingPricePolicy: 'exclude'` means:

- drop raw transactions that fail scoped price validation
- rebuild the scoped set from the surviving raw transactions
- continue for best-effort portfolio-style reporting

It does not mean:

- user policy replay
- asset-level accounting exclusion
- partial scoped pruning inside a mixed transaction

### Linking's `excluded` flag is not `excludedFromAccounting`

In
[`build-linkable-movements.ts`](../../packages/accounting/src/linking/pre-linking/build-linkable-movements.ts),
`LinkableMovement.excluded` means "excluded from linking because this looks like
a structural trade."

It does not mean "excluded from accounting."

That naming overlap is easy to misread when revisiting this area.

## If We Resume The Feature

The next implementation should start from the scoped accounting seam that
already exists.

Do this:

1. Extend
   [`override.ts`](../../packages/core/src/override/override.ts) with
   `asset-exclude` / `asset-include` plus payload schemas.
2. Add a strict replay helper in
   [`packages/data/src/overrides/`](../../packages/data/src/overrides/) that
   returns `excludedAssetIds: Set<string>`.
3. Add accounting-local policy application immediately after
   `buildCostBasisScopedTransactions()`.
4. Wire that policy into
   [`transaction-price-coverage-utils.ts`](../../packages/accounting/src/cost-basis/orchestration/transaction-price-coverage-utils.ts),
   [`cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts),
   and
   [`canada-acb-workflow.ts`](../../packages/accounting/src/cost-basis/canada/canada-acb-workflow.ts).

Do not start with:

- a balances projection
- repository-level mixed-asset filtering
- linking-local exclusion logic
- another cache layer before scoped policy exists

## Locked Decisions

These are the current code-aligned decisions:

1. Whole-transaction exclusion stays in persistence.
2. Mixed-transaction exclusion, when implemented, belongs in accounting after
   scoped build.
3. The source of truth for future user policy should be the override store, not
   balances or linking state.
4. `missingPricePolicy: 'exclude'` remains a separate soft-failure path.
5. Canada and generic cost basis must both consume the same exclusion policy at
   the scoped boundary.
