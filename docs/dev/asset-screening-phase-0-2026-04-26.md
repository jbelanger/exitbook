---
last_verified: 2026-04-26
status: complete
---

# Asset Screening Phase 0

This is the phase-0 tracker for moving spam/scam handling out of ad hoc balance
and processing paths and into an ingestion-owned asset-screening boundary.

## Problem

Live balance verification currently fetches every provider-returned token
balance, then enriches/converts balances, then filters known spam assets later
inside balance comparison. Large public wallets can have thousands of spam token
balances. That makes `accounts refresh` and the future `accounts reconcile
--refresh-live` pay the cost of parsing and enriching assets the user does not
intend to reconcile.

## Current Surfaces

- `packages/ingestion/src/features/balance/balance-fetch-utils.ts`
  fetches native and token balances.
- `packages/ingestion/src/features/balance/balance-workflow.ts`
  calculates local balances, fetches live balances, then filters spam/excluded
  assets.
- `packages/ingestion/src/features/scam-detection/**`
  emits transaction diagnostics during processing.
- `packages/ingestion/src/features/asset-review/**`
  builds asset review summaries from transactions, token metadata, and
  reference lookup.
- `packages/data/src/repositories/asset-review-repository.ts`
  persists review summaries and accounting-blocked state.
- `packages/blockchain-providers/src/contracts/provider-runtime.ts`
  already allows `getAddressTokenBalances` to receive `contractAddresses`.

## Already True

- Imported/calculated balances give us a small set of assets expected in a
  reconciliation scope.
- Excluded transactions identify spam assets that should not appear in balance
  comparisons.
- Asset review summaries can mark an asset as accounting-blocked.
- Provider runtimes can request token balances for a selected contract list
  where the provider supports it.
- Token asset ids can be built from chain plus contract before metadata
  enrichment.

## Chosen Model

Create an ingestion-owned `asset-screening` feature that answers whether an
asset belongs in a reference balance query.

Phase 0 uses a tracked-reference policy:

1. Start from calculated balance asset ids.
2. Add non-spam excluded-transaction adjustment asset ids so adjusted live
   comparisons still work.
3. Suppress known spam/excluded and accounting-blocked token assets.
4. Pass the remaining token contract refs into live token balance fetches.
5. Screen any returned token balance before metadata enrichment.

This deliberately separates two jobs:

- **reconciliation** verifies assets already in the accounting scope
- **asset discovery** finds unknown live tokens and can be a separate explicit
  mode later

## Phase 0 Implementation

Files:

- `packages/ingestion/src/features/asset-screening/asset-screening-policy.ts`
- `packages/ingestion/src/features/asset-screening/index.ts`
- `packages/ingestion/src/asset-screening.ts`
- `packages/ingestion/src/features/balance/balance-fetch-utils.ts`
- `packages/ingestion/src/features/balance/balance-workflow.ts`
- `packages/ingestion/src/ports/balance-ports.ts`
- `apps/cli/src/features/balances/shared/build-balance-workflow-ports.ts`

Steps:

1. Add an asset-screening policy type and tracked-reference policy builder.
2. Extend balance ports with asset-review lookup by profile id and asset ids.
3. Build screening input before live balance fetch.
4. Pass token contract allowlists to `getAddressTokenBalances`.
5. Screen returned token balances before metadata enrichment.
6. Keep default raw fetch helpers unscoped when no screening policy is supplied.

Acceptance:

- A live balance refresh with one tracked token requests that token contract
  instead of all wallet token balances.
- Known spam token assets are not requested or enriched.
- Non-spam excluded adjustment assets still remain eligible for live
  verification.
- Existing calculated-only and native-only balance behavior is preserved.

## Deferred

- User-facing `accounts reconcile --discover-reference-assets`.
- Provider-level spam flags from token-balance endpoints where available.
- Separating stable token identity from mutable provider/review annotations.
- Moving legacy transaction scam diagnostics fully into rebuildable projections.

## Result

Phase 0 landed:

- `asset-screening` exists as an ingestion feature.
- Balance refresh builds a tracked-reference screening policy before live token
  fetch.
- Provider token balance calls receive screened token contract allowlists.
- Returned token balances are screened before metadata enrichment.
- Asset review accounting-blocked assets and excluded spam transaction assets
  are suppressed from live balance comparison by default.

## Phase 1 Boundary

Processor-v2 now stays out of the legacy diagnostic path:

- Legacy `TransactionDraft` processors may still receive the old scam detector.
- `createLedgerProcessor` receives a detector-free factory context.
- Processor-v2 implementations materialize ledger facts only.
- Asset screening and review policy remain post-processing ingestion
  projections.

The remaining migration is to retire the legacy diagnostic path once consumers
read screening/review state from projections instead of transaction diagnostics.
