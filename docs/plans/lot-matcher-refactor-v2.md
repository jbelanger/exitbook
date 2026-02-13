# Lot Matcher Refactor Plan v2 (Detailed 9/10)

## 1. Objective

Eliminate false `No lot transfers found for link ...` failures caused by asset-group batching, by switching lot matching orchestration to a transaction-level dependency order.

Primary outcome:

- Cross-asset histories like `A -> B` then `B -> A` process correctly when transaction dependencies are acyclic.

Non-goals:

- No changes to matching heuristics in `TransactionLinkingService`
- No schema/migration changes
- No behavior changes to fee math, disposal math, or lot creation formulas

---

## 2. Current Failure Mode

Current control flow in `packages/accounting/src/services/lot-matcher.ts`:

1. Load confirmed links
2. Dependency-aware sort via comparator-style ordering
3. Group transactions by asset (`groupTransactionsByAsset`)
4. Sort asset groups (`sortAssetGroupsByDependency`)
5. Process each asset group in isolation (`matchAsset`)

Where it breaks:

- `processTransferTarget` requires source-side `LotTransfer[]` already created for link ID.
- Asset-group isolation can process a target-side inflow before the source-side outflow transfer generation for certain cross-asset patterns.
- Result is late error in `processTransferTarget`: no transfers for link.

---

## 3. Design Principles

1. Dependency granularity must match domain model:

- Dependencies are `transaction -> transaction`, not `asset -> asset`.

2. Preserve existing business logic:

- Keep `processTransferSource`, `processTransferTarget`, `matchOutflowDisposal`, `buildAcquisitionLotFromInflow` as authoritative math paths.
- Refactor orchestration, not formulas.

3. Maintain deterministic runs:

- Topo order first, then stable tie-break (`datetime ASC`, `id ASC`).

4. Keep architectural rules:

- utils remain pure
- no throw-based control flow for business outcomes
- use `Result<T, Error>` consistently

5. Preserve transaction-level invariant:

- For each tx: outflows are processed before inflows.

---

## 4. Target Architecture

### 4.1 Global transaction pass

Replace per-asset processing with one global loop over sorted transactions:

- Build `sortedTransactions` using tx-level topological sort.
- For each tx:
  1. process outflows
  2. process inflows

### 4.2 Per-asset mutable state (movement-level, not tx-level)

```ts
interface AssetProcessingState {
  assetSymbol: string;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}

const lotStateByAssetId = new Map<string, AssetProcessingState>();
```

Why include `lotTransfers` in state:

- `LotMatchResult.assetResults` expects transfers grouped by asset.
- In the old model that grouping came “for free” per asset pass.
- In global pass we need explicit ownership; transfers belong to source-asset state at creation time.

### 4.3 Transfer lookup index

```ts
const transfersByLinkId = new Map<string, LotTransfer[]>();
```

Rationale:

- `LotTransfer.linkId` is UUID string.
- Avoid repeated `filter` scans over all transfers on every target lookup.

### 4.4 Link consumption semantics

Keep existing `LinkIndex` consumption model unchanged:

- source link consumed when outflow side processed
- target link consumed when inflow side processed
- internal links still consumed and skipped appropriately

---

## 5. File-by-File Change Plan

## 5.1 `packages/accounting/src/services/lot-matcher-utils.ts`

### Add

1. `sortTransactionsByDependency(transactions, links): Result<UniversalTransactionData[], Error>`
2. `findCyclePath(...)` helper (pure)
3. optional small helper:
   - `insertByChronologicalTieBreak(queue, txId, transactionById)`

### Behavior details for `sortTransactionsByDependency`

- Nodes: tx IDs from `transactions`
- Edges: for each link, if both endpoints exist and `source != target`, add `source -> target`
- Kahn queue ordering:
  - `new Date(tx.datetime).getTime()` ascending
  - then tx ID ascending
- Cycle detection:
  - if processed count < node count, unresolved IDs remain
  - return `Err` with message containing unresolved IDs and best-effort cycle path

### Keep for transition (first PR)

- `buildDependencyGraph`
- `sortWithLogicalOrdering`
- `sortAssetGroupsByDependency`

These can be removed in cleanup PR after full migration and passing tests.

## 5.2 `packages/accounting/src/services/lot-matcher.ts`

### Introduce new internal types

```ts
interface AssetProcessingState {
  assetSymbol: string;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}
```

### Add service helpers

1. `getOrInitAssetState(assetId: string, assetSymbol: string, lotStateByAssetId: Map<string, AssetProcessingState>): AssetProcessingState`
2. `recordTransfer(transfer: LotTransfer, sourceAssetId: string, sourceAssetSymbol: string, lotStateByAssetId, transfersByLinkId): void`
3. `processTransactionOutflows(...) => Result<void, Error>`
4. `processTransactionInflows(...) => Promise<Result<void, Error>>`

### Replace orchestration in `match()`

Current:

- `sortTransactionsWithLogicalOrdering` + grouping + per-asset `matchAsset`

Target:

1. load links
2. call `sortTransactionsByDependency`
3. create `LinkIndex`
4. initialize empty `lotStateByAssetId`, `sharedLotTransfers`, `transfersByLinkId`
5. single transaction loop:
   - outflows
   - inflows
6. build `assetResults` from `lotStateByAssetId`
7. compute totals

### Preserve existing methods where possible

- keep `findEffectiveSourceLink`
- keep `findEffectiveTargetLink`
- keep `handleTransferSource`
- update `handleTransferTarget` to accept `transfersForLink: LotTransfer[]` (or map)

Preferred signature change for clarity and purity:

```ts
private async handleTransferTarget(
  tx: UniversalTransactionData,
  inflow: AssetMovement,
  link: TransactionLink,
  transfersForLink: LotTransfer[],
  config: LotMatcherConfig
): Promise<Result<AcquisitionLot, Error>>
```

This avoids leaking index structure into pure helper functions and keeps call sites explicit.

### Remove/retire after migration

- `matchAsset(...)`
- `sortTransactionsWithLogicalOrdering(...)` wrapper

## 5.3 `packages/accounting/src/services/lot-matcher-utils.ts` (`processTransferTarget`)

### Minimal change

Keep function pure and mostly unchanged.

Current lookup:

- `lotTransfers.filter((t) => t.linkId === link.id)`

Target:

- pass pre-filtered transfers array from service:

```ts
processTransferTarget(..., transfersForLink, ...)
```

No behavior change for errors/warnings, except faster lookup.

---

## 6. Detailed Processing Blueprint

## 6.1 Outflow phase (per tx)

For each outflow movement in tx:

1. skip if fiat asset
2. resolve `assetState` by outflow asset ID
3. resolve link via `findEffectiveSourceLink`
4. if `transfer`:
   - call `handleTransferSource(...)`
   - append disposals to `assetState.disposals`
   - replace `assetState.lots` with updated lots
   - record each transfer into:
     - `sharedLotTransfers`
     - `assetState.lotTransfers`
     - `transfersByLinkId`
   - consume source link
5. if `none`:
   - call `matchOutflowDisposal(...)`
   - append disposals / replace lots
6. if `internal_only`:
   - skip (existing behavior)

## 6.2 Inflow phase (per tx)

For each asset group within tx inflows (same logic as current aggregation by asset within tx):

1. skip fiat assets
2. resolve `assetState` by inflow asset ID
3. resolve link via `findEffectiveTargetLink`
4. if `transfer`:
   - aggregate same-asset inflows in tx into one `aggregatedInflow` (existing behavior)
   - `transfersForLink = transfersByLinkId.get(link.id) ?? []`
   - call `handleTransferTarget(..., transfersForLink, ...)`
   - push lot into `assetState.lots`
   - consume target link
5. if `none`:
   - create normal acquisition lots per inflow
6. if `internal_only`:
   - skip (existing behavior)

---

## 7. Testing Plan (Specific)

## 7.1 Unit tests for sort (`lot-matcher-utils.test.ts`)

Add describe block: `sortTransactionsByDependency`

Cases:

1. `returns chronological order when links empty`
2. `enforces source-before-target regardless of timestamp`
3. `breaks ties by tx id when datetime equal`
4. `ignores links not in provided tx set`
5. `returns error with unresolved tx ids on cycle`

Assertions:

- explicit order arrays
- explicit error text contains involved tx IDs

## 7.2 Integration tests (`lot-matcher-transfers.test.ts`)

Add or update scenarios:

1. Cross-asset non-cycle chain (`A->B`, then later `B->A` via different tx nodes) succeeds
2. Transfer target variance/warning behavior unchanged
3. Internal link skip behavior unchanged in mixed-link tx
4. Per-asset result integrity:
   - lots/disposals/transfers appear under correct assetId result

## 7.3 Regression tests (`lot-matcher.test.ts`)

Ensure existing fee and disposal calculations remain same.
Key guard:

- no expected cost-basis numbers change in pre-existing tests unless test fixture relied on previous broken ordering.

## 7.4 Validation commands

Run in sequence:

1. `pnpm vitest run packages/accounting/src/services/__tests__/lot-matcher-utils.test.ts`
2. `pnpm vitest run packages/accounting/src/services/__tests__/lot-matcher-transfers.test.ts`
3. `pnpm vitest run packages/accounting/src/services/__tests__/lot-matcher.test.ts`
4. `pnpm build`

Optional full confidence: 5. `pnpm test`

---

## 8. Risk Register

1. Risk: state mutation bugs while replacing `matchAsset`

- Mitigation: preserve existing helper calls; only move orchestration.

2. Risk: asset result transfer ownership drift

- Mitigation: assign each created transfer to source-asset `assetState.lotTransfers` at record time.

3. Risk: cycle false positives

- Mitigation: only build edges from links where both tx IDs exist in current batch and source != target.

4. Risk: runtime regression

- Mitigation: add indexed lookup by link ID and keep algorithm O(V + E) for sort.

---

## 9. Rollout Strategy

Commit slices:

1. `feat(accounting): add tx dependency topological sort with cycle diagnostics`
2. `refactor(accounting): process lot matcher in global tx order`
3. `perf(accounting): index transfers by link id for target resolution`
4. `test(accounting): add cross-asset dependency and cycle coverage`
5. `chore(accounting): remove obsolete asset-level dependency sort helpers`

Rollback plan:

- Revert commits 2-5 while keeping commit 1 if needed (sort utility is additive and safe).

---

## 10. Acceptance Criteria

Functional:

1. No `No lot transfers found...` error for valid cross-asset, non-cyclic histories.
2. True tx cycles return clear `Err` with tx IDs/path.
3. Existing fee/disposal/cost-basis calculations remain unchanged for baseline tests.
4. `LotMatchResult.assetResults` still correctly grouped by asset.

Non-functional: 5. Deterministic order across repeated runs. 6. No new throw-based business control flow. 7. No silent fallback on cycle or unresolved dependency.

---

## 11. Effort Estimate

- Core implementation: 8-11h
- With hardening and regression confidence: 10-14h

---

## 12. Naming Improvements (planned)

- `assetLotState` -> `lotStateByAssetId`
- `txMap` -> `transactionById`
- `sorted` -> `sortedTransactionIds`
