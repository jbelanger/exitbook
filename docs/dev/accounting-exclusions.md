# Accounting Exclusions & Asset Review

> Archived. Superseded by
> [`accounting-exclusions-v3.md`](./accounting-exclusions-v3.md).

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

| Column               | Source                                            | Rebuild behavior                                |
| -------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `calculated_balance` | `calculateBalances()` from processed transactions | Recomputed deterministically                    |
| `live_balance`       | Last balance verification run                     | Re-verifiable observed cache; nulled on rebuild |
| `balance_status`     | Comparison during verification                    | Re-verifiable observed cache; nulled on rebuild |
| `excluded`           | Override store replay                             | Replayed deterministically from override events |
| `exclusion_reason`   | Override store replay                             | Replayed deterministically from override events |
| `excluded_at`        | Override store replay                             | Replayed deterministically from override events |

The table is safe to wipe and rebuild. Policy columns are deterministically replayed from the override store. Verification columns (`live_balance`, `balance_status`, `last_verified_at`) are observational cache — a rebuild nulls them, and re-verification produces a new observation rather than the same state. This is acceptable: the projection contract is rebuildability, not bitwise reproducibility of cached observations.

### Override Store: Asset Exclusion Events

Asset exclusion is **portfolio-wide** — keyed by `assetId` alone, not `(accountId, assetId)`. When a user excludes SCAMTOKEN, it is excluded from every account where it appears. This is the right default: spam tokens are spam everywhere. Per-account exclusion adds complexity with no real benefit in v1 (transaction-level overrides in Phase 6 cover edge cases where the same `assetId` is legitimate in one context and junk in another).

Asset exclusion events in the override store, keyed by `payload.asset_id`:

```ts
interface AssetExcludeEvent {
  scope: 'asset-exclude';
  payload: {
    type: 'asset_exclude';
    asset_id: string;
  };
  reason?: string;
  created_at: string; // ISO 8601
}

interface AssetIncludeEvent {
  scope: 'asset-include';
  payload: {
    type: 'asset_include';
    asset_id: string;
  };
  reason?: string;
  created_at: string;
}
```

Latest event per `payload.asset_id` wins. This follows the same pattern as link override events.

#### Required schema changes in `@exitbook/core`

The current override store schema (`packages/core/src/override/override.ts`) only accepts `'price' | 'fx' | 'link' | 'unlink'` scopes and enforces scope↔payload pairing via `SCOPE_TO_PAYLOAD_TYPE`. New events will be rejected on both write (`appendImpl` validates with `safeParse`) and read (`readAll` skips invalid events) unless the schema is extended. Changes needed:

1. **Extend `ScopeSchema`:** Add `'asset-exclude'` and `'asset-include'` to the enum:

   ```ts
   export const ScopeSchema = z.enum(['price', 'fx', 'link', 'unlink', 'asset-exclude', 'asset-include']);
   ```

2. **Add payload schemas:**

   ```ts
   export const AssetExcludePayloadSchema = z.object({
     type: z.literal('asset_exclude'),
     asset_id: z.string().min(1, 'Asset ID must not be empty'),
   });

   export const AssetIncludePayloadSchema = z.object({
     type: z.literal('asset_include'),
     asset_id: z.string().min(1, 'Asset ID must not be empty'),
   });
   ```

3. **Extend `OverridePayloadSchema`** discriminated union with both new payload schemas.

4. **Extend `SCOPE_TO_PAYLOAD_TYPE`:**

   ```ts
   'asset-exclude': 'asset_exclude',
   'asset-include': 'asset_include',
   ```

5. **Add `OverrideStore.readByAssetExclusion()`** convenience method that returns latest-event-wins per `assetId` from `asset-exclude` and `asset-include` scoped events.

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

**Atomicity requirement:** Steps 1–3 must execute within a single database transaction. Between reset and rebuild, `transactions.excluded_from_accounting = 0` means previously-excluded transactions are visible to any consumer that queries with the default filter (`WHERE excluded_from_accounting = false` in `transaction-repository.ts:534`). Consumers that depend on exclusion state (cost-basis, portfolio) must check balances projection freshness before reading — if `balances` is stale, they should refuse to run rather than silently operating on unfiltered data.

### Invalidation

- `processed-transactions` rebuild → invalidate `balances` (cascade)
- Asset override store changes → invalidate `balances`

### Verification (live balance update)

When balance verification runs for an account:

1. Fetch live balances from provider
2. Compare with `asset_balances.calculated_balance` using `compareBalances()` (which unions calculated and live asset IDs — a live-only asset is a first-class mismatch)
3. Update `live_balance`, `balance_status`, `last_verified_at` on existing rows
4. **Upsert synthetic rows for live-only assets** — assets present on-chain/exchange but absent from transactions. These get `calculated_balance = '0'`, the live balance, `balance_status = 'mismatch'`, and no exclusion state. This preserves the "present live, absent in transactions" signal that is one of the most important indicators of incomplete imports.

This is a write-back to the projection, not a rebuild. It updates observed state columns only. Synthetic live-only rows are deleted on projection rebuild (they have no transaction basis) and re-created on the next verification run.

## Asset Review Workflow

### Primary command: `exitbook assets review`

Interactive checklist powered by `asset_balances`. Since exclusion is portfolio-wide, the review surface **aggregates by `assetId` across all accounts** — each asset appears once regardless of how many accounts hold it. Transaction counts and price coverage are summed across accounts.

```
Assets with complete price coverage (42):
  BTC, ETH, SOL, ...                              [all included]

Assets with missing prices (3):
  SCAMTOKEN    12 txs across 2 accounts, 0% priced   [ ] exclude
  DUSTCOIN      2 txs, 50% priced                     [ ] exclude
  WEIRDNFT      1 tx,  0% priced                      [ ] exclude

Previously excluded assets (1):
  OLDSPAM       3 txs, excluded on 2026-01-15         [excluded]
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

### The mixed-transaction problem

The escape hatch must handle mixed transactions — transactions where an excluded asset appears alongside included assets (e.g., a swap of SCAMTOKEN -> ETH). These transactions stay in scope for accounting (the ETH side matters), but the excluded-asset movements must not block price gates.

The current price-checking functions operate at the transaction level:

- `transactionHasAllPrices()` iterates all movements and returns false if any lack prices
- `collectPricedEntities()` collects all movements for validation
- `checkTransactionPriceCoverage()` counts transactions, not movements

If SCAMTOKEN is excluded but the swap transaction stays in scope (correct for ETH), the SCAMTOKEN movements still fail price checks, blocking cost-basis despite the exclusion. Skipping whole excluded transactions is insufficient.

### Solution: movement-level exclusion awareness in price gates

Price coverage and validation functions accept a set of excluded asset IDs. Movements for excluded assets are skipped during price checks — the transaction itself stays in scope, but only in-scope movements require prices.

The excluded asset set is derived from `asset_balances.excluded` (which is materialized from override store events). It is passed through as a parameter, not looked up internally by the price functions.

### Data flow: where the excluded asset set comes from

The `excludedAssets: Set<string>` must be loaded in the **projection-readiness path**, not in individual handlers. Today, `ensureConsumerInputsReady()` in `apps/cli/src/features/shared/projection-runtime.ts` already runs price coverage checks for `cost-basis` and `portfolio` targets before handlers execute (line 314). That is the correct integration point — exclusion state must be available there, not threaded from handlers.

The flow:

1. **Data port:** Add `IExclusionData` port to `@exitbook/accounting`:

```ts
export interface IExclusionData {
  loadExcludedAssetIds(): Promise<Result<Set<string>, Error>>;
}
```

2. **Data adapter:** Implement in `@exitbook/data` — reads `asset_id` from `asset_balances WHERE excluded = 1`.

3. **Projection-readiness integration:** `ensureConsumerInputsReady()` gains two responsibilities for `cost-basis`/`portfolio` targets:
   - **Balances freshness gate:** Before checking price coverage, verify the `balances` projection is fresh. If stale, rebuild it (which replays exclusion overrides and updates `transactions.excluded_from_accounting`). This ensures exclusion state is current before any downstream check.
   - **Excluded asset loading:** Load `excludedAssets` via `IExclusionData` and pass it to `ensureTransactionPricesReady()` → `checkTransactionPriceCoverage(data, config, excludedAssets)`.

   Updated flow in `ensureConsumerInputsReady`:

   ```ts
   // After projection rebuilds, before price coverage:
   if (target === 'cost-basis' || target === 'portfolio') {
     // 1. Ensure balances projection is fresh (includes exclusion state)
     const balancesFreshness = await registry['balances'].checkFreshness();
     if (balancesFreshness.isErr()) return err(balancesFreshness.error);
     if (balancesFreshness.value.status !== 'fresh') {
       const rebuild = await registry['balances'].rebuild();
       if (rebuild.isErr()) return err(rebuild.error);
     }

     // 2. Load excluded assets from fresh balances projection
     const excludedResult = await exclusionData.loadExcludedAssetIds();
     if (excludedResult.isErr()) return err(excludedResult.error);

     // 3. Price coverage check with exclusion awareness
     if (priceConfig) {
       const pricesResult = await ensureTransactionPricesReady(deps, priceConfig, excludedResult.value);
       if (pricesResult.isErr()) return err(pricesResult.error);
     }
   }
   ```

4. **Handler-level threading:** Handlers (`cost-basis-handler`, `portfolio-handler`) also need `excludedAssets` for `runCostBasisPipeline()`. They load it independently via `IExclusionData` (cheap — reads from already-fresh projection). This is a second read, not a second source of truth.

5. **Pure functions** (`transactionHasAllPrices`, `collectPricedEntities`, `validateTransactionPrices`) receive the set as a parameter — no port access, no I/O.

This keeps the pure functions pure, puts the freshness gate where it belongs (projection runtime), and makes the data dependency explicit at every call site.

### 1. Shared predicates

Location: `packages/accounting/src/cost-basis/accounting-exclusion-utils.ts`

```ts
/** Transaction-level: is this entire transaction excluded? */
export function isExcludedFromAccounting(tx: UniversalTransactionData): boolean {
  return tx.excludedFromAccounting === true;
}

/** Build excluded asset set from balances projection for movement-level filtering */
export function buildExcludedAssetSet(assetBalances: { assetId: string; excluded: boolean }[]): Set<string> {
  return new Set(assetBalances.filter((a) => a.excluded).map((a) => a.assetId));
}

/** Movement-level: should this movement's asset be skipped in price gates? */
export function isExcludedAsset(assetId: string, excludedAssets: Set<string>): boolean {
  return excludedAssets.has(assetId);
}
```

### 2. `transactionHasAllPrices()`

Location: `packages/accounting/src/cost-basis/cost-basis-utils.ts`

Add optional `excludedAssets` parameter. When provided, skip movements for excluded assets:

```ts
export function transactionHasAllPrices(
  tx: UniversalTransactionData,
  excludedAssets?: Set<string>
): Result<boolean, Error> {
  for (const inflow of tx.movements.inflows ?? []) {
    if (excludedAssets?.has(inflow.assetId)) continue;
    const hasPriceResult = movementHasPrice(inflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  for (const outflow of tx.movements.outflows ?? []) {
    if (excludedAssets?.has(outflow.assetId)) continue;
    const hasPriceResult = movementHasPrice(outflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  return ok(true);
}
```

Backward compatible: callers that don't pass `excludedAssets` get existing behavior.

### 3. `collectPricedEntities()`

Location: `packages/accounting/src/cost-basis/cost-basis-validation-utils.ts`

Same pattern — add optional `excludedAssets` parameter, skip movements for excluded assets:

```ts
export function collectPricedEntities(
  transactions: UniversalTransactionData[],
  excludedAssets?: Set<string>
): PricedEntity[] {
  // ... existing logic, adding at the start of each movement loop:
  // if (excludedAssets?.has(movement.assetId)) continue;
}
```

### 4. `checkTransactionPriceCoverage()`

Location: `packages/accounting/src/cost-basis/transaction-price-coverage-utils.ts`

Two layers of filtering — skip whole excluded transactions, and pass excluded assets for movement-level filtering:

```ts
for (const tx of filtered) {
  if (isExcludedFromAccounting(tx)) continue;
  const hasPrices = yield * transactionHasAllPrices(tx, excludedAssets);
  if (!hasPrices) {
    missingCount++;
  }
}
```

### 5. `runCostBasisPipeline()`

Location: `packages/accounting/src/cost-basis/cost-basis-pipeline.ts`

Filter whole excluded transactions, pass excluded assets to validation, **and forward to `calculateCostBasisFromValidatedTransactions`:**

```ts
const inScopeTransactions = transactions.filter((tx) => !isExcludedFromAccounting(tx));
const validationResult = validateTransactionPrices(inScopeTransactions, config.currency, excludedAssets);
// ...
const costBasisResult = await calculateCostBasisFromValidatedTransactions(
  validTransactions,
  config,
  rules,
  lotMatcher,
  confirmedLinks,
  excludedAssets
);
```

### 5a. `assertPriceDataQuality()` — defense-in-depth update

Location: `packages/accounting/src/cost-basis/cost-basis-validation-utils.ts`

`calculateCostBasisFromValidatedTransactions()` calls `assertPriceDataQuality(transactions)` as a defense-in-depth check (`cost-basis-calculator.ts:77`). This function calls `collectPricedEntities(transactions)` which iterates all movements unconditionally. **Without changes, mixed transactions with excluded-asset movements will fail this hard gate even after passing the soft gate above.**

Update `assertPriceDataQuality` to accept and forward `excludedAssets`:

```ts
export function assertPriceDataQuality(
  transactions: UniversalTransactionData[],
  excludedAssets?: Set<string>
): Result<void, Error> {
  const entities = collectPricedEntities(transactions, excludedAssets);
  // ... rest unchanged
}
```

And update `calculateCostBasisFromValidatedTransactions` to accept and forward it:

```ts
export async function calculateCostBasisFromValidatedTransactions(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  rules: IJurisdictionRules,
  lotMatcher: LotMatcher,
  confirmedLinks: TransactionLink[] = [],
  excludedAssets?: Set<string>
): Promise<Result<CostBasisSummary, Error>> {
  // ...
  const validationResult = assertPriceDataQuality(transactions, excludedAssets);
  // ...
}
```

The full chain is: `runCostBasisPipeline(excludedAssets)` → `calculateCostBasisFromValidatedTransactions(excludedAssets)` → `assertPriceDataQuality(excludedAssets)` → `collectPricedEntities(excludedAssets)`.

### 6. Cost-basis for mixed transactions

When cost-basis processes a mixed transaction (e.g., SCAMTOKEN -> ETH swap), the excluded-asset movements lack prices. The cost-basis calculator needs a policy for this.

**Decision: zero-cost acquisition (Option A).**

Treat the included-asset inflow as acquired at zero cost. For a SCAMTOKEN -> ETH swap where SCAMTOKEN is excluded:

- The ETH inflow is recorded with a cost basis of zero
- The SCAMTOKEN outflow is ignored (no disposal event for an excluded asset)
- This is conservative for tax purposes — it overstates gains, which is the safer direction

Why not skip entirely (Option B): skipping the excluded side means the ETH inflow has no acquisition event at all, which creates a different problem — the ETH appears in the portfolio with no cost basis history. Zero-cost acquisition is explicit and auditable.

**Implementation in Phase 2:** The cost-basis calculator needs explicit changes to support this. Today, `buildAcquisitionLotFromInflow()` in `lot-creation-utils.ts` requires `inflow.priceAtTxTime` to compute basis, and `LotMatcher` assumes priced movements before matching. For zero-cost acquisition of excluded-asset mixed transactions:

- Filter excluded-asset movements before they reach the lot creation and matching paths
- When an inflow's corresponding outflow was excluded (no valued counterpart), create the acquisition lot with an explicit zero cost basis
- **Log a warning** for every zero-cost acquisition created this way: `logger.warn({ txId, assetSymbol, excludedAsset }, 'Acquired at zero cost basis — counterpart asset excluded from accounting')`. This is a financial system; silent basis invention is not acceptable.
- This is a deliberate code change in the calculator/matcher, not something that falls out of existing behavior

### 7. Portfolio reporting

Location: `apps/cli/src/features/portfolio/portfolio-handler.ts`

Replace the local `isSpamOrExcludedTransaction()` with the shared predicate. Disclose exclusion counts in output:

```
Cost Basis Summary (2025 tax year)
  ...
  3 transactions excluded from accounting by user
```

### 8. Cost-basis error messages

When cost-basis is blocked by missing prices, the error message should differentiate:

- **Assets with missing prices** -> "Run `exitbook assets review` to review 3 assets with missing prices"
- **Included assets with missing prices** -> "Run `exitbook prices enrich` to fetch prices for 2 included assets, or reconsider their review status with `exitbook assets review`"

### 9. Balance CLI command

The existing `balance` command (currently a single command with `--offline` flag) becomes a consumer of the `balances` projection. **Command surface change:** split into subcommands to match the projection model:

- **`balance view`** (replaces `balance --offline`): reads directly from `asset_balances` — instant, no recalculation. Shows live-only synthetic rows when present.
- **`balance verify`** (replaces `balance` without `--offline`): fetches live balances, compares with projected calculated balances, writes results back to `asset_balances` (including synthetic rows for live-only assets).

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

### Phase 2: Exclusion gates and override integration

Wire exclusion awareness into accounting gates and connect to override store in the same phase. No intermediate manual-DB-edit workflow.

1. Add shared predicates (`isExcludedFromAccounting`, `buildExcludedAssetSet`, `isExcludedAsset`) to `@exitbook/accounting`
2. Add movement-level `excludedAssets` parameter to `transactionHasAllPrices()`, `collectPricedEntities()`
3. Update `checkTransactionPriceCoverage()` to skip excluded transactions and excluded-asset movements
4. Update `runCostBasisPipeline()` to filter excluded transactions and pass excluded assets to validation and calculator (full chain: `runCostBasisPipeline` → `calculateCostBasisFromValidatedTransactions` → `assertPriceDataQuality` → `collectPricedEntities`)
5. Replace `isSpamOrExcludedTransaction()` in portfolio-handler with shared predicate
6. Extend override store schema: add `'asset-exclude'` / `'asset-include'` to `ScopeSchema`, add payload schemas, extend `OverridePayloadSchema` union, update `SCOPE_TO_PAYLOAD_TYPE`
7. Extend balances projection build to replay exclusion overrides
8. Add `excluded`/`exclusion_reason`/`excluded_at` population during build
9. Add bulk-update of `transactions.excluded_from_accounting` during build
10. Wire override store changes to invalidate `balances` projection
11. Wire `ensureConsumerInputsReady()` in projection-runtime: add balances freshness check + excluded-asset loading before price coverage for `cost-basis`/`portfolio` targets
12. Update cost-basis error messages to mention `assets review`

### Phase 3: Asset review CLI command

1. Build `exitbook assets review` command:
   - Read asset inventory from `asset_balances`
   - Check price coverage per asset
   - Present interactive checklist
2. On exclusion: write event to override store, rebuild balances projection
3. On inclusion: write event to override store, rebuild balances projection

### Phase 4: Balance CLI integration

Command surface change: split `balance` (with `--offline` flag) into subcommands.

1. Add `balance view` subcommand — reads from `asset_balances` projection (replaces `balance --offline`). Shows live-only synthetic rows when present.
2. Add `balance verify` subcommand — fetches live balances, compares with projected calculated balances, writes back to `asset_balances` including synthetic rows for live-only assets (replaces `balance` default mode)
3. Add balance health as optional readiness gate for consumers

### Phase 5: Disclosure and reporting

1. Add exclusion counts to cost-basis output
2. Add exclusion summary to portfolio output
3. Add `--show-excluded` flag to `transactions view` for auditability
4. `assets review` shows previously-excluded assets with reason and timestamp

### Phase 6 (future): Transaction-level overrides

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
- Per-account exclusion rules (exclusion is portfolio-wide by `assetId`; transaction-level overrides cover per-context edge cases)
- Transaction-level overrides (Phase 6, future)
- Persisted cost-basis projection (covered by projection-system-refactor.md)
- Balance verification as a mandatory gate (opt-in readiness check only)
