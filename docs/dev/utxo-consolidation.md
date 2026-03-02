# UTXO Consolidation Plan

## Problem Statement

The per-address UTXO model (specified in [`utxo-address-model.md`](../specs/utxo-address-model.md)) is architecturally correct for balance calculation — each account sees its own view of a UTXO transaction. However, the linking and cost basis layers need a **logical transfer view** (change netted out, fees deduplicated, multi-input merged). Today this reconstitution happens inside the linking materializer (`utxo-adjustment.ts`) and leaks into the cost basis engine (`effectiveAmount`, three-level source lookup, `isPartialOutflow`), creating complexity spread across multiple modules.

A second problem: the current pipeline processes transactions at import time, when the full account graph may be incomplete. If wallet B is imported after wallet A, wallet A's processed transactions don't know about B's addresses. Cross-wallet UTXO consolidation can only happen in a post-hoc adjustment layer (`utxo-adjustment.ts`), which is fragile and couples the materializer and cost basis engine to UTXO-specific logic.

## Solution

Adopt an **event-sourcing projection model**: imports write raw data only (source of truth), and everything downstream — processed transactions, consolidated movements, links, cost basis — is a projection rebuilt on demand with full context.

UTXO processors (Bitcoin, Cardano) receive sibling account addresses at projection time, enabling correct change classification and cross-wallet consolidation in one pass. They emit a **second output** alongside per-address transactions: `utxo_consolidated_movements`, a table storing the logical transfer view. The linking and cost basis layers read from this table for UTXO chains and from `transactions` directly for everything else.

Non-UTXO sources (exchanges, EVM chains, Solana, etc.) are unaffected — their processed transactions are already clean one-to-one movements.

### Architecture

```
raw_transactions (source of truth — written at import time)
              ↓
        [projection rebuild]  ← triggered when stale
              ↓
UTXO Processors (Bitcoin, Cardano) — with full sibling context
    ├── transactions              (per-address, for balances — unchanged)
    └── utxo_consolidated_movements  (consolidated, for linking/cost-basis — NEW)

Exchange / Account-Based Processors
    └── transactions              (already clean, used for everything)

                         ↓

Materializer (union of both sources)
                         ↓
              LinkableMovement[] (in-memory)
                         ↓
         ┌───────────────┼───────────────┐
         ↓               ↓               ↓
  blockchain_internal   strategies     cost basis
  detection             (matching)     (reads consolidated amounts)
         ↓               ↓
         └──→ transaction_links ←───────┘
```

### Key Principle: Import as Events, Everything Else as Projections

- `import` writes to `raw_transactions` only. It continues to process inline for immediate feedback, but this is an optimization — the processed output is treated as a disposable projection.
- `link` and `cost-basis` commands check projection freshness before running. If stale, they trigger a full reprocess with current account graph context.
- `reprocess` remains available as an explicit command for manual rebuilds.

This solves the ordering problem: importing wallet B after wallet A automatically triggers reprocessing of both wallets with full sibling context on the next `link` or `cost-basis` run.

## Phases

### Phase 1: Projection Freshness and Auto-Reprocess

**Goal:** `link` and `cost-basis` automatically reprocess when projections are stale, ensuring consolidated movements always reflect the full account graph.

#### 1a. Define staleness

A projection is stale when any of these are true:

- A new import session completed since the last projection build (`max(import_sessions.completed_at) > max(projection_built_at)`)
- An account was added or removed since the last projection build
- No projection has ever been built (first run)

Track this with a lightweight `rebuild_metadata` row in the database:

```sql
CREATE TABLE rebuild_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  built_at TEXT NOT NULL,                  -- ISO timestamp of last full projection build
  account_hash TEXT NOT NULL               -- hash of sorted account IDs + identifiers
);
```

#### 1b. `ensureProjections()` prereq

Add a new prereq alongside the existing `ensureLinks()` and `ensurePrices()`:

```typescript
async function ensureProjections(
  db: DataContext,
  registry: AdapterRegistry,
  providerManager: BlockchainProviderManager,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const isStale = await checkProjectionStaleness(db);
  if (!isStale) return ok();

  // Full reprocess: clear derived data, rebuild with current account graph
  await clearDerivedData(db);
  await rebuildProjections(db, registry, providerManager);
  await updateProjectionMetadata(db);
  return ok();
}
```

Called before `ensureLinks()` in the `cost-basis` command prereq chain, and before linking in the `links run` command.

#### 1c. Reprocess with sibling context

`buildAddressContext()` in `RawDataProcessingService` already populates `userAddresses` from sibling accounts sharing the same `sourceName` and `userId`. Today, UTXO processors ignore `userAddresses` (per the spec). After this change:

- UTXO processors use `userAddresses` to classify outputs as **sibling** (going to another known address in the wallet group) vs **external**.
- Sibling outputs are treated as change for consolidation purposes — they don't produce consolidated movement rows because the sibling account's processor handles the inflow.
- The per-address `transactions` output is unchanged (balances still correct).

Update `AddressContext` to also include parent account context for xpub hierarchies:

```typescript
interface AddressContext {
  primaryAddress: string;
  userAddresses: string[]; // existing — all user addresses on this blockchain
  siblingAddresses?: string[]; // NEW — addresses under same parent account (xpub children)
}
```

`buildAddressContext()` populates `siblingAddresses` by querying accounts with matching `parent_account_id`. The UTXO processor uses `siblingAddresses` (narrower, more precise) when available, falling back to `userAddresses`.

#### 1d. Verification

- Verify that `ensureProjections()` correctly detects staleness after import
- Verify that reprocessing produces identical `transactions` output (balances unchanged)
- Verify that `link` and `cost-basis` commands trigger reprocess when needed and skip when fresh

### Phase 2: New Table and Processor Output

**Goal:** UTXO processors emit consolidated movements during processing, using sibling context for correct cross-wallet classification.

#### 2a. Create `utxo_consolidated_movements` table

Add to `001_initial_schema.ts`:

```typescript
await db.schema
  .createTable('utxo_consolidated_movements')
  .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
  .addColumn('transaction_id', 'integer', (col) => col.notNull().references('transactions.id').onDelete('cascade'))
  .addColumn('account_id', 'integer', (col) => col.notNull().references('accounts.id').onDelete('cascade'))
  .addColumn('source_name', 'text', (col) => col.notNull())
  .addColumn('asset_symbol', 'text', (col) => col.notNull())
  .addColumn('direction', 'text', (col) => col.notNull().check(sql`direction IN ('in', 'out')`))
  .addColumn('amount', 'text', (col) => col.notNull())
  .addColumn('gross_amount', 'text')
  .addColumn('fee_amount', 'text')
  .addColumn('fee_asset_symbol', 'text')
  .addColumn('timestamp', 'text', (col) => col.notNull())
  .addColumn('blockchain_tx_hash', 'text', (col) => col.notNull())
  .addColumn('from_address', 'text')
  .addColumn('to_address', 'text')
  .addColumn('consolidated_from', 'text') // JSON array of raw tx IDs
  .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
  .execute();

await db.schema
  .createIndex('idx_utxo_consolidated_account')
  .on('utxo_consolidated_movements')
  .column('account_id')
  .execute();
await db.schema
  .createIndex('idx_utxo_consolidated_tx_hash')
  .on('utxo_consolidated_movements')
  .column('blockchain_tx_hash')
  .execute();
await db.schema
  .createIndex('idx_utxo_consolidated_tx_id')
  .on('utxo_consolidated_movements')
  .column('transaction_id')
  .execute();
```

#### 2b. Add repository

```typescript
class UtxoConsolidatedMovementRepository {
  createBatch(movements: NewUtxoConsolidatedMovement[]): Promise<Result<number, Error>>;
  findAll(): Promise<Result<UtxoConsolidatedMovement[], Error>>;
  deleteByAccountId(accountId: number): Promise<Result<number, Error>>;
  deleteAll(): Promise<Result<number, Error>>;
}
```

#### 2c. Bitcoin processor emits consolidated movements

The processor already computes `grossAmount` (inputs minus change) and `netAmount` (gross minus fee). With sibling context, it can now distinguish:

- **External output:** destination not in `siblingAddresses` or `primaryAddress` → emit consolidated outflow
- **Sibling output:** destination is a sibling address → skip (sibling's processor handles the inflow)
- **Change output:** destination is `primaryAddress` → already netted out in per-address calculation

After writing the per-address processed transaction, the processor also writes `utxo_consolidated_movements` rows.

For a transaction where address A sends 1.5 BTC, gets 0.7 BTC change, pays 0.0001 fee, sends to external address:

| Field                | Value                                             |
| -------------------- | ------------------------------------------------- |
| `direction`          | `out`                                             |
| `amount`             | `0.7999` (net external — what the recipient sees) |
| `gross_amount`       | `0.8001` (inputs minus change, includes fee)      |
| `fee_amount`         | `0.0001`                                          |
| `blockchain_tx_hash` | `abc123`                                          |
| `to_address`         | external destination                              |

For a receive of 0.5 BTC:

| Field          | Value                         |
| -------------- | ----------------------------- |
| `direction`    | `in`                          |
| `amount`       | `0.5`                         |
| `gross_amount` | `0.5`                         |
| `fee_amount`   | `null` (recipient didn't pay) |

For a transaction where A sends to sibling address B (both under same xpub):

| Behavior | No consolidated row emitted — B's processor handles the inflow |
| -------- | -------------------------------------------------------------- |

#### 2d. Cardano processor emits consolidated movements

Same pattern, per-asset. A single Cardano transaction moving ADA and a native token produces two consolidated movement rows (one per asset).

#### 2e. ClearService includes consolidated movements

`ClearService.execute({ includeRaw: false })` must also delete `utxo_consolidated_movements` for the scope (they're rebuilt during reprocess).

#### 2f. Verification

- Run processor tests: per-address transactions unchanged
- Run balance tests: unchanged (balances still use `transactions`)
- New integration test: verify consolidated movements match expected logical transfers
- Compare consolidated output against current `utxo-adjustment.ts` output for parity
- Multi-wallet test: import wallet A, then wallet B → reprocess → verify consolidated movements correctly classify cross-wallet outputs

### Phase 3: Materializer Reads from Consolidated Table

**Goal:** Replace the UTXO adjustment logic in the materializer with reads from `utxo_consolidated_movements`.

#### 3a. New materializer function

```typescript
function materializeForLinking(
  transactions: UniversalTransactionData[],
  utxoConsolidated: UtxoConsolidatedMovement[]
): LinkableMovement[] {
  // Build set of transaction IDs covered by consolidated movements
  const utxoTxIds = new Set(utxoConsolidated.map((m) => m.transactionId));

  // Also build set of tx IDs that are non-representative members of
  // multi-input consolidations (they're folded into the representative)
  const consolidatedChildTxIds = new Set<number>();
  for (const m of utxoConsolidated) {
    if (m.consolidatedFrom) {
      for (const childId of m.consolidatedFrom) {
        if (childId !== m.transactionId) {
          consolidatedChildTxIds.add(childId);
        }
      }
    }
  }

  const movements: LinkableMovement[] = [];

  // UTXO chains: use consolidated view
  for (const m of utxoConsolidated) {
    movements.push(projectConsolidatedToLinkable(m));
  }

  // Non-UTXO chains: project directly from transactions
  for (const tx of transactions) {
    if (utxoTxIds.has(tx.id)) continue;
    if (consolidatedChildTxIds.has(tx.id)) continue;

    const excluded = isStructuralTrade(tx);
    for (const inflow of tx.movements.inflows ?? []) {
      movements.push(projectMovementToLinkable(tx, inflow, 'in', excluded));
    }
    for (const outflow of tx.movements.outflows ?? []) {
      movements.push(projectMovementToLinkable(tx, outflow, 'out', excluded));
    }
  }

  return movements;
}
```

#### 3b. `blockchain_internal` detection operates on consolidated movements

Internal transfer detection still finds same-hash-different-account overlaps, but now it reads from the consolidated movements (for UTXO chains) rather than raw per-address transactions. The logic is the same — just a cleaner input. Cross-wallet transfers between sibling addresses are already excluded from consolidated movements by the processor, so internal detection only fires for genuinely separate wallets sharing a tx hash.

#### 3c. Delete UTXO adjustment code

- Delete `utxo-adjustment.ts` (~256 lines)
- Remove `OutflowGrouping` type and all references
- Remove `buildInternalOutflowAdjustments()` call from materializer
- Remove UTXO-specific branching in materializer (`isNonRepresentativeGroupMember`, `findUtxoGroupId`)

#### 3d. Verification

- Run full linking test suite
- Compare link output before/after for a real dataset with UTXO transactions
- Verify `blockchain_internal` links are identical

### Phase 4: Cost Basis Engine Simplification

**Goal:** Remove all UTXO-specific code paths from the cost basis engine.

#### 4a. Remove `effectiveAmount` parameter from `processTransferSource`

Today:

```typescript
export function processTransferSource(
  tx,
  outflow,
  link,
  lots,
  strategy,
  calculationId,
  jurisdiction,
  varianceTolerance?,
  effectiveAmount? // ← UTXO-specific, remove
);
```

After: the function always uses `outflow.grossAmount` or the link's `sourceAmount`. The consolidated amount is already correct because it came from `utxo_consolidated_movements`.

#### 4b. Simplify `findEffectiveSourceLink` in `LotMatcher`

Today: three-level lookup with internal link consumption and `isPartialOutflow` tracking.

```typescript
// Current: try netAmount, then grossAmount, then any-by-source
let link = linkIndex.findBySource(txId, assetSymbol, lookupAmount);
if (!link) link = linkIndex.findBySource(txId, assetSymbol, grossAmount);
if (!link) link = linkIndex.findAnyBySource(txId, assetSymbol);
```

After: single lookup. The link's `sourceAmount` matches the consolidated movement amount.

```typescript
const link = linkIndex.findBySource(txId, assetSymbol, amount);
```

#### 4c. Remove `findAnyBySource` from `LinkIndex`

This fallback method exists solely for UTXO adjusted amounts. Delete it.

Note: `sourceByTxAssetMap` and `findAllBySource()` must survive — they're used for non-UTXO partial match (1:N split) scenarios.

#### 4d. Remove `isPartialOutflow` from `SourceLinkResult`

The `findEffectiveSourceLink` return type simplifies:

```typescript
// Before
type SourceLinkResult =
  | { type: 'transfer'; links: TransactionLink[]; isPartialOutflow: boolean }
  | { type: 'internal_only' }
  | { type: 'none' };

// After
type SourceLinkResult = { type: 'transfer'; links: TransactionLink[] } | { type: 'internal_only' } | { type: 'none' };
```

#### 4e. Remove UTXO branch in `processTransferSource`

Today there's a branch:

```typescript
const isPartialOutflow = effectiveAmount !== undefined;

if (isPartialOutflow) {
  cryptoFee = { amount: parseDecimal('0'), feeType: 'none' };
} else {
  // normal fee extraction
}

const transferDisposalQuantity = isPartialOutflow
  ? effectiveAmount
  : calculateTransferDisposalAmount(...).transferDisposalQuantity;
```

After: one code path. Fee extraction always runs normally. The amounts are already correct from consolidation.

#### 4f. Verification

- Run full cost basis test suite
- Run lot matcher tests with UTXO transfer scenarios
- Compare gain/loss output before/after for dataset with UTXO transfers
- Verify lot transfers have correct inherited cost basis

### Phase 5: Linking Orchestrator Cleanup

**Goal:** Remove the `linkable_movements` table dependency from the orchestrator.

#### 5a. Orchestrator changes

The orchestrator no longer materializes or persists `linkable_movements`. Instead:

```typescript
async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
  // 1. Load transactions
  const transactions = await this.transactionRepository.findAll();

  // 2. Load UTXO consolidated movements
  const utxoMovements = await this.utxoConsolidatedRepo.findAll();

  // 3. Clear existing links (unless dry run)
  if (!params.dryRun) await this.clearExistingLinks();

  // 4. Materialize in-memory (union of both sources)
  const movements = materializeForLinking(transactions, utxoMovements);

  // 5. Detect blockchain_internal
  const internalLinks = detectInternalBlockchainTransfers(movements);

  // 6. Assign in-memory IDs
  const movementsWithIds = movements.map((m, i) => ({ ...m, id: i + 1 }));

  // 7. Run strategies
  const runner = new StrategyRunner(defaultStrategies(), logger, config);
  const result = runner.run(movementsWithIds);

  // 8. Combine internal + strategy links
  const allLinks = [...internalLinks, ...result.links];

  // 9. Apply overrides, save
  // ...
}
```

#### 5b. Remove `LinkableMovementRepository`

- Delete repository interface and implementation
- Remove from `DataContext`
- Remove constructor parameter from orchestrator
- Remove `persistLinkableMovements()`, `clearLinkableMovements()`, `assignInMemoryIds()`

#### 5c. Drop `linkable_movements` table

Remove from `001_initial_schema.ts`. The `utxo_consolidated_movements` table replaces its purpose for UTXO chains. Non-UTXO chains never needed it.

#### 5d. Verification

- Run full linking test suite
- Run orchestrator integration tests
- Verify dry-run mode still works (no DB dependency for movements)

## Code Deletion Summary

| File / Component                                       | Lines (approx)                              | Action                    |
| ------------------------------------------------------ | ------------------------------------------- | ------------------------- |
| `utxo-adjustment.ts`                                   | ~256                                        | Delete entirely           |
| `OutflowGrouping` type + references                    | ~30 scattered                               | Delete                    |
| `effectiveAmount` parameter threading                  | ~50 across lot-matcher, transfer-processing | Delete                    |
| `isPartialOutflow` in `LotMatcher`                     | ~40                                         | Delete                    |
| `findAnyBySource` in `LinkIndex`                       | ~15                                         | Delete                    |
| Three-level source lookup in `findEffectiveSourceLink` | ~15                                         | Simplify to single lookup |
| UTXO branches in `processTransferSource`               | ~20                                         | Delete                    |
| `LinkableMovementRepository` interface + impl          | ~134                                        | Delete                    |
| `persistLinkableMovements` / `clearLinkableMovements`  | ~25                                         | Delete                    |
| `linkable_movements` table + schema                    | ~30                                         | Drop table                |
| **Total removed**                                      | **~615 lines**                              |                           |

## New Code Summary

| Component                                       | Lines (approx) | Description                                          |
| ----------------------------------------------- | -------------- | ---------------------------------------------------- |
| `rebuild_metadata` table + staleness check      | ~50            | Singleton row, hash comparison                       |
| `ensureProjections()` prereq                    | ~60            | Staleness detection + auto-reprocess trigger         |
| `utxo_consolidated_movements` table + migration | ~30            | New table in `001_initial_schema.ts`                 |
| `UtxoConsolidatedMovementRepository`            | ~80            | CRUD for new table                                   |
| `siblingAddresses` in `AddressContext`          | ~15            | Parent account lookup in `buildAddressContext()`     |
| Bitcoin processor: emit consolidated rows       | ~40            | Write extra output with sibling-aware classification |
| Cardano processor: emit consolidated rows       | ~40            | Write extra output with sibling-aware classification |
| `materializeForLinking()` function              | ~50            | Union of consolidated + non-UTXO transactions        |
| **Total added**                                 | **~365 lines** |                                                      |

**Net reduction: ~250 lines**, with UTXO complexity fully contained in processors and the cross-wallet ordering problem eliminated.

## Edge Cases

| Edge Case                                               | How It's Handled                                                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change output identification**                        | Processor knows — output to `primaryAddress` = change. Already netted out in per-address calculation.                                                                      |
| **Sibling output (xpub child)**                         | Processor checks `siblingAddresses`. Output to sibling = no consolidated row emitted. Sibling's processor handles the inflow independently.                                |
| **Multiple change outputs** (privacy wallets)           | Processor sums all outputs back to `primaryAddress` as change. Single consolidated outflow for external amount.                                                            |
| **No change output** (full sweep)                       | Consolidated amount = gross outflow - fee. No special case needed.                                                                                                         |
| **Multi-input from same wallet**                        | Processor sees all inputs for `primaryAddress`. Single consolidated outflow with `consolidated_from` tracking raw tx IDs.                                                  |
| **Multi-input from different wallets** (CoinJoin)       | Each wallet's processor independently consolidates its own inputs. No cross-account merging. `blockchain_internal` detection links them post-hoc if wallets are unrelated. |
| **Fee deduplication**                                   | Processor writes one `fee_amount` per consolidated movement. No downstream dedup needed.                                                                                   |
| **Fee in different asset** (EVM gas on ERC-20 transfer) | Not a UTXO concern — EVM processors don't write to this table.                                                                                                             |
| **Multi-asset Cardano tx**                              | Cardano processor emits one consolidated row per asset per direction. ADA and native tokens are separate rows.                                                             |
| **Batched sends** (multiple external recipients)        | Processor emits one consolidated outflow per external destination. Multiple rows for same `blockchain_tx_hash`.                                                            |
| **Self-transfer** (all outputs back to self/siblings)   | All outputs go to `primaryAddress` or `siblingAddresses`. No consolidated row emitted (no external transfer occurred).                                                     |
| **New wallet import**                                   | Import completes → projection marked stale → next `link`/`cost-basis` run triggers full reprocess with updated account graph. All wallets get correct sibling context.     |
| **Re-import / re-process**                              | Projection staleness detected automatically. Full clear + rebuild of derived data including `utxo_consolidated_movements`.                                                 |
| **Non-positive adjusted amount** (fee > transfer)       | Processor detects and skips emitting a consolidated movement.                                                                                                              |
| **Account-based chains** (EVM, Solana)                  | Not affected. No rows in `utxo_consolidated_movements`. Materializer reads directly from `transactions`.                                                                   |
| **Exchange transactions**                               | Not affected. No rows in `utxo_consolidated_movements`. Materializer reads directly from `transactions`.                                                                   |
| **No parent account** (standalone address import)       | `siblingAddresses` is empty. Processor falls back to `userAddresses` for cross-wallet classification, same as today's `buildAddressContext()` behavior.                    |
| **Large portfolio reprocess latency**                   | `rebuild_metadata` hash check avoids unnecessary rebuilds. Only triggers when account graph or raw data actually changed.                                                  |

## Migration Strategy

1. **Phase 1 ships first.** Projection freshness tracking is additive — no behavioral change. `ensureProjections()` can be wired in as a no-op initially, then enabled. The `siblingAddresses` context extension is backward-compatible (UTXO processors can ignore it until Phase 2).

2. **Phase 2 is additive.** Processors emit consolidated movements alongside existing per-address transactions. No downstream behavior changes. Validate with integration tests comparing against `utxo-adjustment.ts` output.

3. **Phase 3 is the swap.** Materializer switches from computing UTXO adjustments to reading pre-computed consolidated movements. This is the risk point — linking output must be identical before/after. Run comparison tests on real data.

4. **Phase 4 can be incremental.** Each `effectiveAmount` removal in the cost basis engine is independently testable. The lot matcher simplifications can land as separate PRs.

5. **Phase 5 is cleanup.** Drop the `linkable_movements` table and repository once nothing references them.

Each phase is independently deployable and reversible. If Phase 3 comparison tests show discrepancies, keep running both paths in parallel until resolved.

## Testing Strategy

### Parity Tests (Critical)

For each phase transition, run the full pipeline on a real dataset and compare:

- **Phase 2 → existing:** `utxo_consolidated_movements` output vs. current `utxo-adjustment.ts` output. Must be identical amounts for every UTXO transaction.
- **Phase 3 → existing:** Linking output (`transaction_links`) must be identical before/after materializer change.
- **Phase 4 → existing:** Cost basis output (lots, disposals, gain/loss) must be identical before/after lot matcher simplification.

### Unit Tests

- Projection freshness: verify staleness detection for new imports, account additions, no-change scenarios.
- Processor tests: verify consolidated output for single-input, multi-input, change, sibling-output, no-change, self-transfer, multi-asset, batched send scenarios.
- Materializer tests: verify union logic correctly skips UTXO tx IDs, includes non-UTXO, handles `consolidatedFrom` child exclusion.
- Lot matcher tests: verify transfer processing works without `effectiveAmount` when amounts are pre-consolidated.

### Integration Tests

- End-to-end: import Bitcoin wallet → process → link → cost basis. Compare results against known-good baseline.
- Multi-wallet ordering: import wallet A → link → import wallet B → link again. Verify that the second `link` run triggers reprocess and produces correct cross-wallet consolidated movements.
- Xpub hierarchy: import xpub with derived addresses → verify sibling outputs are classified correctly and no duplicate consolidated movements appear.

## Spec Updates Required

After implementation, update [`utxo-address-model.md`](../specs/utxo-address-model.md):

- Remove the invariant "Processors analyze only `primaryAddress`; `derivedAddresses`/`userAddresses` are ignored for UTXO chains" — UTXO processors now use `siblingAddresses` for consolidation.
- Add section on `utxo_consolidated_movements` as a projection artifact.
- Document the projection freshness model and auto-reprocess behavior.
