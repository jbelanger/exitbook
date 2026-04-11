# Transactions Balance-Impact Migration Plan

Status: temporary dev plan
Owner: Codex + Joel
Scope: transaction browse surfaces, shared balance math, duplicate balance-style projections

## Goal

Make the transactions list reliable for balance checking by driving it from the same canonical balance-impact semantics used by stored balance calculation.

This is not a cosmetic column rename. The list must become an operator surface that answers:

- what balance was debited
- what balance was credited
- what extra fee balance was consumed separately
- which fees were already embedded in the debited amount and therefore must not be subtracted again

## Non-Negotiable Rules

These rules already exist in code/specs and must stay true after the migration.

1. `grossAmount` is the balance-impact amount for inflows and outflows.
2. `netAmount` is for matching/linking semantics, not balance impact.
3. `fee.settlement === 'on-chain'` means the fee is already embedded in movement balance impact and must not be deducted again.
4. `fee.settlement !== 'on-chain'` means the fee is an additional balance debit.
5. The transactions browse surface, stored balance calculation, portfolio/account breakdown, and diagnostics must all agree on these rules.

Reference sources:

- [packages/ingestion/src/features/balance/balance-utils.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-utils.ts)
- [docs/specs/fees.md](/Users/joel/Dev/exitbook/docs/specs/fees.md)
- [packages/core/src/transaction/movement.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/movement.ts)

## Current Hotspots

These files currently implement balance-style math directly instead of sharing one canonical helper:

- [packages/ingestion/src/features/balance/balance-utils.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-utils.ts)
  `calculateBalances()` / `processTransactionForBalance()`
- [packages/accounting/src/portfolio/portfolio-position-building.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-position-building.ts)
  `buildAccountAssetBalances()`
- [apps/cli/src/features/shared/stored-balance-diagnostics.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-diagnostics.ts)
  `buildStoredBalanceAssetDiagnosticsSummary()`
- [apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts)
  `buildTransactionItems()`
- [apps/cli/src/features/transactions/transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts)
  list-summary projection logic

## Phase Plan

### Phase 0: Lock The Plan

Deliverable:

- this document in `docs/dev`

Commit boundary:

- commit the plan doc alone before more code churn

Reason:

- the migration is cross-cutting and should not proceed as a stack of view-only edits

### Phase 1: Extract Canonical Transaction Balance Impact

Goal:

- define one pure helper that computes transaction-level balance impact once

Target location:

- prefer a pure helper in `packages/core/src/transaction/`

Why `core`:

- the logic is not ingestion-specific
- CLI, accounting, and ingestion all need the same semantics
- putting the helper in `core` avoids another downstream duplicate

Proposed file:

- `packages/core/src/transaction/balance-impact.ts`

Proposed exports:

- `buildTransactionBalanceImpact(tx: Transaction): TransactionBalanceImpact`
- `summarizeBalanceImpactByAsset(...)` only if a second pure helper is clearly useful

Proposed shape:

```ts
interface TransactionBalanceImpactAssetEntry {
  assetId: string;
  assetSymbol: string;
  creditGross: Decimal;
  debitGross: Decimal;
  separateFeeDebit: Decimal;
  embeddedFeeAmount: Decimal;
  netBalanceDelta: Decimal;
}

interface TransactionBalanceImpact {
  assets: TransactionBalanceImpactAssetEntry[];
}
```

Rules inside the helper:

1. iterate inflows
2. `creditGross += inflow.grossAmount`
3. `netBalanceDelta += inflow.grossAmount`
4. iterate outflows
5. `debitGross += outflow.grossAmount`
6. `netBalanceDelta -= outflow.grossAmount`
7. iterate fees
8. if `fee.settlement === 'on-chain'`, record `embeddedFeeAmount += fee.amount` only
9. otherwise record `separateFeeDebit += fee.amount` and `netBalanceDelta -= fee.amount`
10. preserve first-seen asset ordering for deterministic UI summaries

Phase 1 code changes:

- add helper + tests in `packages/core/src/transaction/`
- export the helper from `packages/core/src/transaction/index.ts` and `packages/core/src/index.ts`
- refactor [packages/ingestion/src/features/balance/balance-utils.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-utils.ts) to use it

Phase 1 tests:

- inflow only
- outflow only
- `balance` fee in same asset as outflow
- `balance` fee in different asset from movement
- `on-chain` fee in same asset as outflow
- mixed trade with one fee asset and two movement assets
- `external` fee behavior should stay aligned with existing `calculateBalances()` semantics unless intentionally changed

Commit boundary:

- helper extraction complete
- balance calculation migrated
- focused tests green

### Phase 2: Move Transactions Browse To Balance-Impact Terms

Goal:

- replace browse-list summary semantics with canonical balance-impact semantics

Preferred list columns:

- `DEBIT`
- `CREDIT`
- `FEES`

Why not keep `SENT` / `RECEIVED`:

- `DEBIT` / `CREDIT` are clearer for balance reconciliation
- they avoid ambiguity when on-chain fees are embedded in the debited amount

Target files:

- [apps/cli/src/features/transactions/transactions-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transactions-view-model.ts)
- [apps/cli/src/features/transactions/transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts)
- [apps/cli/src/features/transactions/view/transactions-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-static-renderer.ts)
- [apps/cli/src/features/transactions/view/transactions-view-components.tsx](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-view-components.tsx)
- [docs/specs/cli/transactions/transactions-view-spec.md](/Users/joel/Dev/exitbook/docs/specs/cli/transactions/transactions-view-spec.md)

Projection design:

- do not store only formatted strings if the view is likely to evolve again
- prefer structured fields on `TransactionViewItem`, then format in renderer

Implementation note from Phase 2:

- the browse view kept `debitSummary` / `creditSummary` / `feeSummary` strings on `TransactionViewItem`
- reason: the view model already exposes full `inflows` / `outflows` / `fees` detail for JSON and detail rendering, so adding parallel balance-impact arrays here would duplicate transaction detail rather than clarify it

Preferred browse-view model direction:

```ts
type TransactionBalanceSummaryItem = {
  assetId: string;
  assetSymbol: string;
  amount: string;
};

debits: TransactionBalanceSummaryItem[];
credits: TransactionBalanceSummaryItem[];
separateFees: TransactionBalanceSummaryItem[];
embeddedFees: TransactionBalanceSummaryItem[]; // detail-only or JSON-only if useful
```

Phase 2 renderer rules:

1. `DEBIT` summarizes `debitGross`
2. `CREDIT` summarizes `creditGross`
3. `FEES` summarizes `separateFeeDebit` only
4. embedded fees do not appear in `FEES`
5. multi-asset sides join entries with `+`
6. empty side renders `—`

Phase 2 detail rules:

- existing inflow/outflow/fee sections remain
- optionally add a small `Balance impact` block only if it adds clarity and does not duplicate too much detail

Phase 2 tests:

- static list trade row with debit/credit/fee
- deposit with only credit
- withdrawal with embedded on-chain fee and empty fee column
- account-based transfer with separate network fee
- JSON list includes the new balance-impact fields

Commit boundary:

- transaction browse surfaces migrated
- transaction browse spec rewritten
- focused transactions tests green

### Phase 3: Remove Remaining Duplicate Balance Logic

Goal:

- stop maintaining multiple subtly different implementations

Target files:

- [packages/accounting/src/portfolio/portfolio-position-building.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-position-building.ts)
- [apps/cli/src/features/shared/stored-balance-diagnostics.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-diagnostics.ts)
- [apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts)

Specific work:

1. refactor `buildAccountAssetBalances()` to derive per-asset balance effects from the shared helper
2. refactor `buildStoredBalanceAssetDiagnosticsSummary()` to derive totals from the shared helper instead of hand-rolled loops
3. fix `buildTransactionItems()` to stop subtracting `on-chain` fees twice
4. search again for remaining balance-style loops over `inflows/outflows/fees`

Verification:

- portfolio/account breakdown unchanged for current-correct cases
- portfolio history reflects correct asset-direction and amount when on-chain fees exist
- diagnostics totals reconcile with stored balance logic

Commit boundary:

- duplicate balance logic removed or intentionally documented
- remaining focused tests green

## Verification Checklist

For every phase:

- run targeted tests for touched packages only
- typecheck the touched package(s) if unrelated repo-wide failures block full build
- if an unrelated pre-existing failure blocks verification, record it explicitly in commit notes and this doc

Targeted verification commands to use during migration:

- `pnpm vitest run packages/core/src/transaction/__tests__/...`
- `pnpm vitest run packages/ingestion/src/features/balance/__tests__/...`
- `pnpm vitest run apps/cli/src/features/transactions/...`
- `pnpm vitest run apps/cli/src/features/portfolio/...`

Current unrelated verification blocker already present in repo:

- `pnpm --filter @exitbook/ingestion exec tsc --noEmit` fails on [packages/ingestion/src/sources/blockchains/solana/**tests**/processor.test.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/solana/__tests__/processor.test.ts) line 171 with `TS2532: Object is possibly 'undefined'.`
- `pnpm --filter exitbook-cli exec tsc --noEmit` fails on [apps/cli/src/features/assets/command/**tests**/asset-command-services.test.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/assets/command/__tests__/asset-command-services.test.ts) line 5 with `TS2305: Module '"@exitbook/core"' has no exported member 'Result'.`

## Smells Encountered Already

These are not permission to leave debt behind. They are here so we can deliberately clean them or explicitly defer them.

### Cross-Cutting Smells

1. Duplicate balance math already exists in multiple packages.
   Files:
   - [packages/ingestion/src/features/balance/balance-utils.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/balance/balance-utils.ts)
   - [packages/accounting/src/portfolio/portfolio-position-building.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-position-building.ts)
   - [apps/cli/src/features/shared/stored-balance-diagnostics.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/shared/stored-balance-diagnostics.ts)
   - [apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts)
   - [apps/cli/src/features/transactions/transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts)

2. Portfolio history currently subtracts all fees, including `on-chain` fees, which can double-count balance impact.
   File:
   - [apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts)

3. `external` fee behavior is implicit in current balance code rather than called out in one canonical helper.
   Risk:
   - a future refactor could accidentally exclude it from balance effect in one consumer but not another

4. [packages/core/src/index.ts](/Users/joel/Dev/exitbook/packages/core/src/index.ts) is a hand-maintained root barrel.
   Risk:
   - adding a new transaction export in `packages/core/src/transaction/index.ts` does not automatically make it available from `@exitbook/core`
   - this already caused one runtime failure during Phase 1 when `buildTransactionBalanceImpact` existed locally but was missing from the root export list

### Naming Smells

1. `primaryAsset`, `primaryAmount`, and `primaryDirection` in [transactions-view-model.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transactions-view-model.ts) are now list-unrelated legacy detail fields.
   Better names if retained:
   - `primaryMovementAsset`
   - `primaryMovementAmount`
   - `primaryMovementDirection`

2. `buildBalanceImpactSummary()` in [transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts) currently mixes asset ordering, zero filtering, and final string formatting.
   Better split if reuse grows:
   - `orderBalanceImpactAssetsForDisplay()`
   - `formatBalanceImpactSummary()`

### Phase 2 Smells

1. Static detail still centers the legacy `Primary` line even though the browse list is now balance-oriented.
   File:
   - [apps/cli/src/features/transactions/view/transactions-static-renderer.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/view/transactions-static-renderer.ts)
     Risk:
   - list and detail now speak slightly different semantic dialects
     Follow-up:
   - decide whether detail should add explicit `Debit` / `Credit` / `Fees` summary lines or rename `Primary` to `Primary movement`

### Phase 3 Smells

1. `computeTransactionFiatValue()` in [portfolio-history-utils.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/portfolio/shared/portfolio-history-utils.ts) still owns the rule for excluding `on-chain` fees from fiat weighting.
   Risk:
   - balance delta semantics are now shared, but balance-aware fiat weighting is still local to the portfolio history surface
     Follow-up:
   - if another surface needs the same valuation semantics, extract a shared helper instead of copying this rule again

## Exit Criteria

We are done when all of the following are true:

1. one canonical helper defines transaction balance impact
2. stored balance calculation consumes that helper
3. transactions browse list consumes that helper
4. portfolio/account/diagnostic balance-style projections no longer drift from the helper
5. the CLI spec for transactions describes debit/credit/fee semantics in balance terms
6. no known fee-settlement double-counting remains in touched code
