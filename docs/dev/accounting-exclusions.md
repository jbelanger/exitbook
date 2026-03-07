# Accounting Exclusions & Asset Review

Follow-up to [projection-system-refactor.md](./projection-system-refactor.md). That doc established the projection lifecycle model. This doc addresses two related gaps:

1. **Balances projection** — persisted calculated vs live balance state, running after processing as a sibling to links
2. **Accounting exclusions** — the escape hatch for spam, dust, and unresolvable assets that block cost-basis

## Problem Statement

Cost-basis and price coverage gates are strict and global:

- `runCostBasisPipeline()` calls `validateTransactionPrices()` which fails if any transaction is missing prices (`packages/accounting/src/cost-basis/cost-basis-pipeline.ts:29`)
- `checkTransactionPriceCoverage()` counts all transactions in the date range without filtering excluded ones (`packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts:36`)

Some assets cannot be priced — spam tokens, dust airdrops, scam NFTs, broken imports, unsupported tokens. The system has no way for the user to say "this asset is not part of my portfolio" and unblock accounting.

### What exists today

The schema already has the fields:

- `transactions.is_spam` (integer, default 0) — `001_initial_schema.ts:135`
- `transactions.excluded_from_accounting` (integer, default 0) — `001_initial_schema.ts:136`
- `idx_transactions_excluded_from_accounting` index — `001_initial_schema.ts:179`

The domain type has matching fields:

- `UniversalTransactionData.isSpam` (boolean, optional) — `universal-transaction.ts:218`
- `UniversalTransactionData.excludedFromAccounting` (boolean, optional) — `universal-transaction.ts:221`

But these fields are only consumed in one place:

- `isSpamOrExcludedTransaction()` in `portfolio-handler.ts:543` — CLI-local, not used by accounting

Neither `validateTransactionPrices`, `checkTransactionPriceCoverage`, nor `runCostBasisPipeline` filters on these fields. The escape hatch exists in storage but is not wired into the gates.

## Design Principles

1. **Projections are rebuildable.** Any projection table can be wiped and fully recomputed. User decisions never live in projection tables as mutable state — they are replayed from the override store.
2. **Override store is the source of truth for user policy.** Exclusion decisions are override events, same pattern as link overrides.
3. **Accounting completeness gate, not review ceremony.** The question is "can accounting run correctly?" not "has the user reviewed everything?"
4. **Strict by default.** Missing prices block cost-basis. Exclusions are the explicit escape hatch.
5. **Asset-level UX, transaction-level persistence.** Users think in assets. The system persists at the transaction level for accounting correctness.
6. **Prerequisite != projection dependency.** Health signals (balance verification) gate consumers operationally, not as graph edges.

## Source-of-Truth Ownership

| Concern                         | Owner                                   | Nature                                                   |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Calculated balances per asset   | `asset_balances` table                  | Derived projection — rebuildable                         |
| Live balances from verification | `asset_balances` table                  | Observed state — cached from last verification           |
| Exclusion decisions             | Override store                          | User policy — event log, latest event wins               |
| Effective exclusion status      | `asset_balances.excluded`               | Materialized from override store during projection build |
| Fast exclusion filtering        | `transactions.excluded_from_accounting` | Denormalized execution cache                             |

The `asset_balances` table is only "hybrid" physically, not in source-of-truth ownership. Every column is either recomputable from transactions or replayable from overrides.

## Projection Graph

### Updated Graph

```text
processed-transactions
       |
       +---> balances   (sibling — asset inventory, review surface)
       |
       +---> links      (sibling — transaction relationships)
                |
                +---> cost-basis (future)
```

`balances` and `links` are sibling projections, both derived from `processed-transactions`. Neither depends on the other.

### Why links does not depend on balances

Linking relates transactions to each other. It is derived from processed transaction data. A balance mismatch does not change the algorithmic inputs to linking — it is a confidence signal about upstream completeness (missing imports). That makes it a readiness/health gate, not a derivation dependency.

Same principle as price enrichment: "helpful prerequisite" != "projection dependency."

### Readiness gates (not graph edges)

Before certain consumers run, the system may check balance health:

- Before linking: optionally warn if balance verification shows mismatches (imports may be incomplete)
- Before cost-basis: check that in-scope assets have price coverage

These are operational checks enforced at the consumer level, not edges in the projection dependency graph.

## Terminology

### Asset Review Status

Each asset (by `assetId`) has an effective review status, derived from override store events:

| Status     | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `included` | In scope for accounting. Implicit default for all assets.                   |
| `excluded` | Out of scope. All transactions for this asset are excluded from accounting. |

"Asset" here means a unique `assetId` (e.g. `blockchain:ethereum:0xscam...`), not a display symbol. Two different tokens with symbol `USDC` on different chains have different `assetId`s and are reviewed independently.

There is no `unreviewed` status. Assets are included by default. Exclusion is an explicit action.

### Accounting Exclusion

A transaction-level flag (`excludedFromAccounting`) that removes a transaction from accounting gates. Derived from asset-level override events, not set directly by users on transactions (future: transaction-level overrides may add that).

## Cost-Basis Gate Rules

The gate is based on **accounting completeness** after exclusions are applied:

| Price status   | Exclusion status     | Behavior                                           |
| -------------- | -------------------- | -------------------------------------------------- |
| Missing prices | `excluded`           | **Skip.** Not in scope.                            |
| Missing prices | `included` (default) | **Block.** Point user to `exitbook assets review`. |
| Fully priced   | `excluded`           | **Skip.** Not in scope.                            |
| Fully priced   | `included`           | **Allow.**                                         |

Key insight: price coverage is computed only for in-scope assets/transactions after overrides are applied.

## Data Model

### Balances Projection Table: `asset_balances`

```sql
CREATE TABLE asset_balances (
  account_id           INTEGER NOT NULL,
  asset_id             TEXT NOT NULL,
  asset_symbol         TEXT NOT NULL,
  calculated_balance   TEXT NOT NULL,
  live_balance         TEXT,
  balance_status       TEXT CHECK(balance_status IN ('match', 'warning', 'mismatch')),
  excluded             INTEGER NOT NULL DEFAULT 0,
  exclusion_reason     TEXT,
  excluded_at          TEXT,
  last_calculated_at   TEXT NOT NULL,
  last_verified_at     TEXT,
  PRIMARY KEY (account_id, asset_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

Column ownership:

| Column               | Source                                            | Rebuildable?              |
| -------------------- | ------------------------------------------------- | ------------------------- |
| `calculated_balance` | `calculateBalances()` from processed transactions | Yes — recompute           |
| `live_balance`       | Last balance verification run                     | Yes — re-verify (or null) |
| `balance_status`     | Comparison during verification                    | Yes — recompute           |
| `excluded`           | Override store replay                             | Yes — replay events       |
| `exclusion_reason`   | Override store replay                             | Yes — replay events       |
| `excluded_at`        | Override store replay                             | Yes — replay events       |

Every column is deterministically reproducible. The table is safe to wipe and rebuild.

### Override Store: Asset Exclusion Events

Asset exclusion events in the override store, keyed by `assetId`:

```ts
interface AssetExcludeEvent {
  scope: 'asset-exclude';
  assetId: string;
  reason: string;
  timestamp: string; // ISO 8601
}

interface AssetIncludeEvent {
  scope: 'asset-include';
  assetId: string;
  timestamp: string;
}
```

Latest event per `assetId` wins. This follows the same pattern as link override events.

### Denormalized Cache: `transactions.excluded_from_accounting`

The existing `excluded_from_accounting` column on `transactions` is maintained as a denormalized execution cache for fast filtering in cost-basis. Updated when:

- Asset exclusion overrides change (bulk-update affected transactions)
- Balances projection rebuilds (re-derive from override store)

This avoids expensive joins during cost-basis runs — accounting just filters on an indexed column it already has.

## Balances Projection Lifecycle

### Build

1. Load all processed transactions grouped by account
2. Run `calculateBalances()` per account (existing pure function in `@exitbook/ingestion`)
3. Load asset exclusion events from override store
4. Replay exclusion events: latest event per `assetId` determines `excluded` status
5. Upsert rows into `asset_balances` (preserving `live_balance`/`balance_status`/`last_verified_at` from previous verification if row exists)
6. Bulk-update `transactions.excluded_from_accounting` from effective exclusion state
7. Mark `balances` projection fresh

### Reset

1. Delete all rows from `asset_balances`
2. Reset `transactions.excluded_from_accounting` to 0
3. Mark `balances` projection stale

### Invalidation

- `processed-transactions` rebuild → invalidate `balances` (cascade)
- Asset override store changes → invalidate `balances`

### Verification (live balance update)

When `exitbook balance verify` runs for an account:

1. Fetch live balances from provider
2. Compare with `asset_balances.calculated_balance`
3. Update `live_balance`, `balance_status`, `last_verified_at` on matching rows

This is a write-back to the projection, not a rebuild. It updates observed state columns only.

## Asset Review Workflow

### Primary command: `exitbook assets review`

Interactive checklist powered by `asset_balances`:

```
Assets with complete price coverage (42):
  BTC, ETH, SOL, ...                              [all included]

Assets with missing prices (3):
  SCAMTOKEN    12 txs, 0% priced                   [ ] exclude
  DUSTCOIN      2 txs, 50% priced                  [ ] exclude
  WEIRDNFT      1 tx,  0% priced                   [ ] exclude

Previously excluded assets (1):
  OLDSPAM       3 txs, excluded on 2026-01-15      [excluded]
```

When the user excludes an asset:

1. Write `asset-exclude` event to override store
2. Rebuild balances projection (replays all exclusion overrides)
3. `excluded_from_accounting` on qualifying transactions updated as part of rebuild

When the user re-includes an asset:

1. Write `asset-include` event to override store
2. Rebuild balances projection
3. `excluded_from_accounting` reset on affected transactions

### Multi-asset transaction handling

When applying exclusion to transactions:

- Mark `excludedFromAccounting = true` on transactions where **all** movements (inflows + outflows + fees) belong to excluded assets
- Do **not** mark transactions where the excluded asset appears alongside included assets (e.g., a swap of SCAMTOKEN -> ETH still matters for ETH accounting)
- Log a warning for these mixed transactions so the user can review them individually later

### Secondary command (future): `exitbook transactions exclude`

For edge cases where asset-level exclusion is too coarse:

- Same asset appears in both legitimate and junk transactions
- User wants to exclude only certain airdrops/rebases/reward dust for an otherwise real asset
- Imported data contains bad transactions for a real asset like ETH or USDC

```
exitbook transactions exclude --tx-id 123 --reason "duplicate airdrop"
exitbook transactions include --tx-id 123
```

This is not part of the first implementation.

## Integration Points

### 1. Shared domain predicate

Location: `packages/accounting/src/cost-basis/cost-basis-utils.ts` (or a new `accounting-exclusion-utils.ts`)

```ts
export function isExcludedFromAccounting(tx: UniversalTransactionData): boolean {
  return tx.excludedFromAccounting === true;
}
```

Single source of truth for all gates. Reads the denormalized cache on transactions.

### 2. `checkTransactionPriceCoverage()`

Location: `packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts`

Current code counts all transactions. Change to skip excluded:

```ts
for (const tx of filtered) {
  if (isExcludedFromAccounting(tx)) continue; // <-- add this
  const hasPrices = yield * transactionHasAllPrices(tx);
  if (!hasPrices) {
    missingCount++;
  }
}
```

### 3. `runCostBasisPipeline()`

Location: `packages/accounting/src/cost-basis/cost-basis-pipeline.ts`

Filter excluded transactions before validation:

```ts
const inScopeTransactions = transactions.filter((tx) => !isExcludedFromAccounting(tx));
const validationResult = validateTransactionPrices(inScopeTransactions, config.currency);
```

### 4. `validateTransactionPrices()`

Location: `packages/accounting/src/cost-basis/cost-basis-utils.ts`

No change needed if the caller pre-filters. But for defense-in-depth, it could also skip excluded transactions internally.

### 5. Portfolio reporting

Location: `apps/cli/src/features/portfolio/portfolio-handler.ts`

Replace the local `isSpamOrExcludedTransaction()` with the shared predicate. Disclose exclusion counts in output:

```
Cost Basis Summary (2025 tax year)
  ...
  3 transactions excluded from accounting by user
```

### 6. Cost-basis error messages

When cost-basis is blocked by missing prices, the error message should differentiate:

- **Assets with missing prices** -> "Run `exitbook assets review` to review 3 assets with missing prices"
- **Included assets with missing prices** -> "Run `exitbook prices enrich` to fetch prices for 2 included assets, or reconsider their review status with `exitbook assets review`"

### 7. Balance CLI command

The existing `balance` command becomes a consumer of the `balances` projection:

- **Offline mode** (`balance view`): reads directly from `asset_balances` — instant, no recalculation
- **Online mode** (`balance verify`): fetches live balances, compares with projected calculated balances, writes results back to `asset_balances`

## Why Asset-Only Exclusion Is Too Coarse

The primary UX is asset-level, but the persistence must be transaction-level because:

1. **Multi-asset transactions.** A single transaction can have movements in multiple assets. Excluding asset X should not exclude the ETH fee movement on the same transaction.
2. **Legitimate + junk for same asset.** A real asset like USDC can appear in both legitimate trades and spam airdrop transactions.
3. **Symbol collisions.** Different tokens share display symbols. Exclusion keys off `assetId`, not `assetSymbol`, but the transaction-level flag allows per-transaction precision when needed.
4. **Future transaction-level overrides.** Users may need to include a specific transaction for an otherwise-excluded asset, or exclude a specific transaction for an otherwise-included asset.

## Implementation Order

### Phase 1: Balances projection

1. Add `asset_balances` table to `001_initial_schema.ts`
2. Add `balances` to projection definitions in `@exitbook/core` (`ProjectionId`, `PROJECTION_DEFINITIONS`)
3. Add `IBalancesFreshness` and `IBalancesReset` contracts to `@exitbook/ingestion`
4. Implement balances projection build: `calculateBalances()` per account -> persist to `asset_balances`
5. Add balances runtime to `ProjectionRuntime` registry in CLI
6. Wire invalidation: `processed-transactions` rebuild cascades to `balances`

### Phase 2: Wire existing fields into gates

No new exclusion logic yet. Just use `excludedFromAccounting` that already exists.

1. Add `isExcludedFromAccounting()` predicate to `@exitbook/accounting`
2. Update `checkTransactionPriceCoverage()` to skip excluded transactions
3. Update `runCostBasisPipeline()` to filter excluded transactions before validation
4. Replace `isSpamOrExcludedTransaction()` in portfolio-handler with shared predicate
5. Update cost-basis error messages to mention `assets review`

After this phase, manually setting `excluded_from_accounting = 1` in the database will unblock cost-basis. The UX is not there yet, but the gates work.

### Phase 3: Exclusion override events and projection integration

1. Define asset exclusion/inclusion event types for override store
2. Extend balances projection build to replay exclusion overrides
3. Add `excluded`/`exclusion_reason`/`excluded_at` population during build
4. Add bulk-update of `transactions.excluded_from_accounting` during build
5. Wire override store changes to invalidate `balances` projection

### Phase 4: Asset review CLI command

1. Build `exitbook assets review` command:
   - Read asset inventory from `asset_balances`
   - Check price coverage per asset
   - Present interactive checklist
2. On exclusion: write event to override store, rebuild balances projection
3. On inclusion: write event to override store, rebuild balances projection

### Phase 5: Balance CLI integration

1. Refactor `balance view` (offline) to read from `asset_balances` projection
2. Refactor `balance verify` (online) to write live balances back to `asset_balances`
3. Add balance health as optional readiness gate for consumers

### Phase 6: Disclosure and reporting

1. Add exclusion counts to cost-basis output
2. Add exclusion summary to portfolio output
3. Add `--show-excluded` flag to `transactions view` for auditability
4. `assets review` shows previously-excluded assets with reason and timestamp

### Phase 7 (future): Transaction-level overrides

1. `exitbook transactions exclude --tx-id 123 --reason "..."`
2. `exitbook transactions include --tx-id 123`
3. Transaction-level overrides take precedence over asset-level decisions
4. `assets review` shows when an asset has transaction-level overrides

## Relationship to Projection System

`balances` is a first-class projection with the same lifecycle as `processed-transactions` and `links`:

- Has a `projection_state` row
- Has freshness, reset, and rebuild contracts
- Is invalidated when upstream (`processed-transactions`) rebuilds
- Is also invalidated when override store exclusion events change

The key difference from other projections: `balances` consumes two inputs:

1. Processed transaction data (structural dependency — graph edge)
2. Override store exclusion events (policy input — replayed during build)

This is analogous to `links` consuming both processed transactions and link override events.

### What balances is NOT

- Not a dependency of `links` (siblings, not parent-child)
- Not a health gate by default (consumers opt in to checking balance verification status)
- Not a substitute for price coverage checks (separate prerequisite)

## Naming Conventions

| Prefer                    | Avoid                  |
| ------------------------- | ---------------------- |
| "exclude from accounting" | "mark as spam"         |
| "asset review"            | "spam filter"          |
| "included" / "excluded"   | "clean" / "dirty"      |
| "review status"           | "spam status"          |
| "materialized exclusion"  | "user-owned exclusion" |

The core model uses "accounting exclusion" because it covers spam, dust, junk rewards, broken imports, unsupported assets, and user-confirmed ignores — all with one concept.

`isSpam` remains as a processor-set hint (automated detection). `excludedFromAccounting` is the effective flag that gates use, materialized from override store events.

## Out of Scope

- Automatic spam detection improvements (separate concern)
- Bulk import of exclusion lists
- Per-account exclusion rules
- Transaction-level overrides (Phase 7, future)
- Persisted cost-basis projection (covered by projection-system-refactor.md)
- Balance verification as a mandatory gate (opt-in readiness check only)
