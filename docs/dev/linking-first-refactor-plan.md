# Linking-First Refactor Plan

This document lays out a linking-first refactor that separates transfer
matching from UTXO accounting meaning.

It is intentionally scoped in three steps:

1. fix the linking boundary first
2. fix cost-basis on top of the cleaner boundary
3. fix accounting exclusions after cost-basis has a proper accounting-scoped
   input

The detailed work in this document is for step 1 only. Steps 2 and 3 are
included as short follow-up sections so the sequencing is explicit.

This plan supersedes the linking portion of
[`utxo-consolidation.md`](./utxo-consolidation.md). That older document assumes
linking should read a persisted `utxo_consolidated_movements` view. The plan
here takes the narrower approach: unlink transfer matching from persisted
candidate-building first, then decide separately how cost-basis should consume UTXO
meaning.

## Why This Refactor Exists

The current linking pipeline mixes three different responsibilities inside one
pre-linking layer:

- candidate generation for matching strategies
- internal same-hash ownership inference
- UTXO amount correction and representative-selection

Today that all happens through:

- [`packages/accounting/src/linking/pre-linking/build-link-candidates.ts`](../../packages/accounting/src/linking/pre-linking/build-link-candidates.ts)
- [`packages/accounting/src/linking/pre-linking/internal-transfer-detection.ts`](../../packages/accounting/src/linking/pre-linking/internal-transfer-detection.ts)
- [`packages/accounting/src/linking/pre-linking/utxo-adjustment.ts`](../../packages/accounting/src/linking/pre-linking/utxo-adjustment.ts)
- persisted `linkable_movements` rows written by
  [`packages/data/src/adapters/linking-ports-adapter.ts`](../../packages/data/src/adapters/linking-ports-adapter.ts)

That coupling causes the current failure modes:

- bogus `blockchain_internal` links from same-hash groups that are not real
  wallet-to-wallet transfers
- full-mesh or near-full-mesh reconstruction logic that invents structure
- UTXO outflow corrections that depend on links created one function earlier
- a persisted `linkable_movements` table that behaves like semi-canonical state
  even though it is only useful for one linking run

The linking refactor should fix one thing above all:

**linking should consume ephemeral link candidates, not a persisted,
UTXO-adjusted, trade-filtered shadow table.**

## Scope

### In Scope

- remove `linkable_movements` from the required runtime path for linking
- replace the old materializer with an in-memory candidate builder
- stop using synthetic internal links as the input to UTXO amount correction
- make same-hash blockchain handling conservative and explicit
- keep the strategy layer intact as much as possible

### Out of Scope

- redesigning `transactions` or `transaction_movements`
- redesigning cost-basis lot matching in this phase
- solving movement-level accounting exclusions in this phase
- deciding the final long-term role of `utxo_consolidated_movements`
- eliminating `blockchain_internal` links from the entire system in this phase

## Target End State For Step 1

After the linking refactor:

- `LinkingOrchestrator` loads processed transactions and override events
- an in-memory builder converts transactions to `LinkCandidate[]`
- `StrategyRunner` matches those in-memory candidates directly
- only `transaction_links` are persisted during a links run
- `linkable_movements` is no longer written or read during normal linking
- same-hash blockchain groups are handled by one explicit reducer rather than a
  two-step “invent links, then use those links to adjust amounts” flow

Importantly, this step does **not** promise perfect UTXO accounting meaning.
It only promises a cleaner linking boundary and safer matching behavior.

## Step 1: Remove Persisted Linkable Movements From The Linking Path

### Goal

Keep current linking behavior as close as possible while removing
`linkable_movements` from the hot path. This creates a safe seam before any UTXO
logic changes.

### Why This Comes First

If we change UTXO linking rules and persistence shape in one pass, every test
failure becomes ambiguous. Step 1 should be deliberately boring:

- same inputs
- same `LinkCandidate` shape
- same strategies
- no database writes for pre-linking candidates

That lets step 2 change UTXO behavior in isolation.

### File Changes

#### 1. Update the linking persistence port

File:
[`packages/accounting/src/ports/linking-persistence.ts`](../../packages/accounting/src/ports/linking-persistence.ts)

Change:

- remove `replaceMovements()`
- keep only:
  - `loadTransactions()`
  - `replaceLinks()`
  - `markLinksBuilding()`
  - `markLinksFresh()`
  - `markLinksFailed()`
  - `withTransaction()`

Resulting interface shape:

```ts
export interface ILinkingPersistence {
  loadTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  replaceLinks(links: NewTransactionLink[]): Promise<Result<LinksSaveResult, Error>>;
  markLinksBuilding(): Promise<Result<void, Error>>;
  markLinksFresh(): Promise<Result<void, Error>>;
  markLinksFailed(): Promise<Result<void, Error>>;
  withTransaction<T>(fn: (txStore: ILinkingPersistence) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
```

#### 2. Update the data adapter

File:
[`packages/data/src/adapters/linking-ports-adapter.ts`](../../packages/data/src/adapters/linking-ports-adapter.ts)

Change:

- delete the `replaceMovements()` implementation
- stop depending on `db.linkableMovements`
- keep the transaction wrapper for link replacement only

Pseudo-code:

```ts
export function buildLinkingPorts(db: DataContext): ILinkingPersistence {
  return {
    loadTransactions: () => db.transactions.findAll(),
    replaceLinks: (...) => ...,
    markLinksBuilding: () => db.projectionState.markBuilding('links'),
    markLinksFresh: () => db.projectionState.markFresh('links', null),
    markLinksFailed: () => db.projectionState.markFailed('links'),
    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb))),
  };
}
```

#### 3. Update the orchestrator to use in-memory IDs for both dry-run and live mode

File:
[`packages/accounting/src/linking/linking-orchestrator.ts`](../../packages/accounting/src/linking/linking-orchestrator.ts)

Current behavior:

- dry-run assigns in-memory IDs
- live mode persists `linkable_movements`, reads them back with DB-assigned IDs,
  then matches

New behavior:

- both dry-run and live mode use the same in-memory ID assignment path
- only links are persisted in live mode

Pseudo-code:

```ts
const candidateBuildResult = buildLinkCandidates(transactions, logger);
if (candidateBuildResult.isErr()) return err(candidateBuildResult.error);

const matchResult = this.runMatching(
  candidateBuildResult.value.candidates,
  candidateBuildResult.value.internalLinks,
  params,
  overrides,
  transactions,
  txById
);
if (matchResult.isErr()) return err(matchResult.error);

if (!params.dryRun) {
  return this.store.withTransaction(async (txStore) => {
    const saveResult = await txStore.replaceLinks(linksToSave);
    if (saveResult.isErr()) return err(saveResult.error);

    const freshResult = await txStore.markLinksFresh();
    if (freshResult.isErr()) return err(freshResult.error);

    return ok(...);
  });
}
```

Important detail:

- candidate IDs can be assigned inside `buildLinkCandidates()`
- do not change strategy semantics in this step

#### 4. Keep the table for one step, but stop using it

Do **not** delete the `linkable_movements` table in step 1.

Files that stay unchanged in step 1:

- [`packages/data/src/repositories/linkable-movement-repository.ts`](../../packages/data/src/repositories/linkable-movement-repository.ts)
- [`packages/data/src/database-schema.ts`](../../packages/data/src/database-schema.ts)
- [`packages/data/src/migrations/001_initial_schema.ts`](../../packages/data/src/migrations/001_initial_schema.ts)

Reason:

- this keeps the runtime change small
- rollback is easy
- step 3 can delete the dead code once step 2 stabilizes

### Tests To Add Or Update

Files:

- [`packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts`](../../packages/accounting/src/linking/__tests__/linking-orchestrator.test.ts)
- [`apps/cli/src/features/shared/__tests__/projection-runtime.test.ts`](../../apps/cli/src/features/shared/__tests__/projection-runtime.test.ts)

Add assertions that:

- live mode no longer calls `replaceMovements()`
- live mode still persists links atomically
- `markLinksFresh()` still happens only after link persistence succeeds
- dry-run and live mode use the same candidate count before matching

### Exit Criteria

Step 1 is done when:

- a links run produces the same links as before on the current test corpus
- no runtime path requires `linkable_movements`
- only `transaction_links` are mutated during linking

## Step 2: Replace The Materializer With A Conservative Linking Reducer

### Goal

Fix the actual linking problem without dragging cost-basis semantics into the
solution.

The core change in this step is:

**stop deriving UTXO source amount corrections from synthetic internal links.**

Instead, compute same-hash blockchain facts once, then derive two outputs from
those facts:

- conservative `blockchain_internal` links
- conservative link candidates

### Design Rule

Same-hash blockchain handling should be **loss-averse**:

- prefer skipping ambiguous groups over inventing bogus ownership edges
- prefer unmatched candidates over false confirmed links
- log warnings when the current transaction model cannot express a case safely

### New Internal Shape

Add a reducer-only shape inside
[`packages/accounting/src/linking/pre-linking/`](../../packages/accounting/src/linking/pre-linking):

```ts
interface SameHashParticipant {
  txId: number;
  accountId: number;
  assetId: string;
  assetSymbol: string;
  inflowAmount: Decimal;
  outflowAmount: Decimal;
  onChainFeeAmount: Decimal;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
}

interface SameHashAssetGroup {
  normalizedHash: string;
  blockchain: string;
  assetId: string;
  assetSymbol: string;
  participants: SameHashParticipant[];
}
```

### New File Layout

Keep the current directory but split responsibilities:

- `packages/accounting/src/linking/pre-linking/build-link-candidates.ts`
- `packages/accounting/src/linking/pre-linking/group-same-hash-transactions.ts`
- `packages/accounting/src/linking/pre-linking/reduce-blockchain-groups.ts`
- keep `internal-transfer-detection.ts` only if its logic still makes sense after
  the split; otherwise delete it and move the remaining rules into
  `reduce-blockchain-groups.ts`
- delete `utxo-adjustment.ts` once the new reducer reaches parity

### Concrete Algorithm

#### 2a. Build generic candidates first

File:
`packages/accounting/src/linking/pre-linking/build-link-candidates.ts`

Responsibility:

- iterate transactions
- normalize tx hash
- detect structural trades
- create a `LinkCandidate` per inflow/outflow
- do **not** apply UTXO group skipping or amount patching yet

Pseudo-code:

```ts
for (const tx of transactions) {
  const excluded = isStructuralTrade(tx);
  const normalizedHash = normalizeHash(tx);

  for (const inflow of tx.movements.inflows ?? []) {
    candidates.push(createCandidate(tx, inflow, 'in', excluded, normalizedHash));
  }

  for (const outflow of tx.movements.outflows ?? []) {
    candidates.push(createCandidate(tx, outflow, 'out', excluded, normalizedHash));
  }
}
```

This gives a clean pre-UTXO baseline.

#### 2b. Group only blockchain candidates by hash + asset

File:
`packages/accounting/src/linking/pre-linking/group-same-hash-transactions.ts`

Responsibility:

- collect blockchain transactions only
- group them by normalized hash
- within each hash, group by asset symbol or asset id
- summarize each transaction into `SameHashParticipant`

Pseudo-code:

```ts
for (const tx of transactions) {
  if (tx.sourceType !== 'blockchain') continue;
  if (!tx.blockchain?.transaction_hash) continue;

  const hash = normalizeTransactionHash(tx.blockchain.transaction_hash);

  for (const asset participation inside tx) {
    append participant to group[hash][assetKey];
  }
}
```

#### 2c. Reduce same-hash groups conservatively

File:
`packages/accounting/src/linking/pre-linking/reduce-blockchain-groups.ts`

Responsibility:

- decide whether a hash group is:
  - clearly external
  - clearly internal
  - ambiguous
- generate `blockchain_internal` links only in the clearly internal case
- reduce source candidate amounts only in the clearly internal case
- never create outflow-to-outflow synthetic links

Rules for the first safe version:

1. If the group has only outflow participants for an asset:
   - emit no internal links
   - emit no special reduction
   - keep the original outflow candidates unchanged

2. If the group has exactly one pure outflow participant and one or more pure
   inflow participants for the same asset:
   - emit `blockchain_internal` links from the pure outflow tx to each pure
     inflow tx
   - reduce the outflow candidate amount by:
     - total tracked inflows for that asset in the same hash group
     - the deduplicated on-chain fee for that asset

3. If the group has more than one outflow participant **and** one or more
   inflow participants:
   - treat as ambiguous in step 2
   - emit no synthetic internal links
   - do not collapse to a representative transaction
   - log a warning with hash, asset, tx IDs, and account IDs

4. If the group has mixed inflow/outflow on the same participant transaction:
   - treat as ambiguous in step 2
   - log and skip special handling

The explicit trade-off is:

- fewer false positives
- possibly more unmatched blockchain candidates
- much simpler reasoning

That is acceptable for linking. Ambiguous unmatched candidates are preferable to
wrong confirmed links.

### Replace The Current Two-Step Dependency

Current dependency chain:

1. detect internal links
2. use those links to build connected components
3. use connected components to compute outflow corrections
4. skip non-representative members

New dependency chain:

1. group same-hash blockchain facts once
2. derive internal links from those facts
3. derive candidate reductions from those facts

This is the key architectural simplification.

### Orchestrator Integration

Update
[`packages/accounting/src/linking/linking-orchestrator.ts`](../../packages/accounting/src/linking/linking-orchestrator.ts)
to call the new builder:

```ts
const candidateResult = buildLinkCandidates(transactions, logger);
if (candidateResult.isErr()) return err(candidateResult.error);

const { candidates, internalLinks } = candidateResult.value;
```

The rest of the orchestrator can stay structurally the same.

### Tests To Add

Add new targeted tests under
[`packages/accounting/src/linking/__tests__/`](../../packages/accounting/src/linking/__tests__):

- `build-link-candidates.test.ts`
- `reduce-blockchain-groups.test.ts`

Required scenarios:

1. Single-wallet external send on UTXO chain
   - no internal links
   - outflow candidate remains present

2. Multi-input external co-spend across tracked wallets
   - no internal links
   - no full-mesh linking
   - warning emitted if the group is ambiguous

3. Clear wallet-to-wallet internal transfer on same hash
   - internal links produced
   - source candidate reduced only by tracked inflow + deduped fee

4. Multi-outflow plus tracked inflow ambiguous group
   - no synthetic links
   - no representative collapse
   - warning emitted

5. Account-model blockchain transfer with shared hash
   - behavior unchanged from current valid internal-transfer cases

6. Structural trade on non-UTXO chain
   - still excluded from strategy matching

### Exit Criteria

Step 2 is done when:

- bogus same-hash internal links from ambiguous UTXO groups no longer appear
- `utxo-adjustment.ts` is gone
- candidate generation no longer depends on connected-component reconstruction
- matching tests still pass for exchange and account-model blockchains

## Step 3: Delete Dead Linking Artifacts

This step is cleanup only. Do it after steps 1 and 2 are stable.

### Files To Remove

- [`packages/data/src/repositories/linkable-movement-repository.ts`](../../packages/data/src/repositories/linkable-movement-repository.ts)
- `linkableMovements` wiring from
  [`packages/data/src/data-context.ts`](../../packages/data/src/data-context.ts)
- related exports from
  [`packages/data/src/index.ts`](../../packages/data/src/index.ts)
- `linkable_movements` table from
  [`packages/data/src/database-schema.ts`](../../packages/data/src/database-schema.ts)
- `linkable_movements` creation from
  [`packages/data/src/migrations/001_initial_schema.ts`](../../packages/data/src/migrations/001_initial_schema.ts)

### Final Vocabulary

After the runtime is stable:

- use `LinkCandidate` for the ephemeral linking input type
- use `buildLinkCandidates()` for the pre-linking builder entry point

Do not keep the old persistence-oriented names once the refactor is complete.

### Exit Criteria

Step 3 is done when:

- no code path references `linkable_movements`
- no repository or migration code exists for that table
- tests and docs use the new linking-only vocabulary

## What Comes Immediately After Linking

These are intentionally brief. They are here to lock sequencing, not to expand
scope for this document.

### Step 2 Overall: Fix Cost-Basis

Cost-basis should not keep inferring accounting meaning from linking-side
artifacts such as:

- `blockchain_internal` links
- `internal_only` branches
- `effectiveAmount`
- partial outflow heuristics

Follow-up work should introduce a separate accounting reducer for UTXO meaning,
then update:

- [`packages/accounting/src/cost-basis/lot-matcher.ts`](../../packages/accounting/src/cost-basis/lot-matcher.ts)
- [`packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts`](../../packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts)
- [`packages/accounting/src/cost-basis/lot-fee-utils.ts`](../../packages/accounting/src/cost-basis/lot-fee-utils.ts)

High-level idea:

- linking owns transfer candidates
- cost-basis owns accounting meaning
- neither should depend on the other’s intermediate representation

### Step 3 Overall: Fix Exclusions

After cost-basis has a proper accounting-scoped input, exclusions become a
cleaner problem:

- baseline transaction-level spam/import exclusion stays on `transactions`
- effective accounting exclusion becomes accounting-owned policy
- asset and fee exclusion is applied when building accounting-scoped movements,
  not inside linking

This work should build on
[`accounting-exclusions-v2.md`](./accounting-exclusions-v2.md), but with one
important constraint:

- exclusions must operate on accounting-scoped data
- they must not leak into linking candidate generation except for baseline
  whole-transaction filters that the repository already enforces

## Recommended Implementation Order

For one developer working locally, follow this order exactly:

1. complete step 1 with parity tests
2. run `pnpm test` for linking-related packages
3. complete step 2 with new UTXO ambiguity tests
4. run `pnpm test` again
5. complete step 3 cleanup
6. update docs that still describe persisted link candidates as a required
   runtime artifact

Do not start cost-basis or exclusions before step 2 is merged or otherwise
stable. Linking needs its own clean boundary first.

## Decisions And Smells

- Main decision: linking will use ephemeral candidates, not persisted
  pre-linking rows.
- Main smell being removed: the pre-linking builder currently acts like both a cache
  and a domain reducer.
- Secondary smell being reduced: UTXO amount correction currently depends on
  synthetic links created earlier in the same pipeline.
- Final naming: use `LinkCandidate` consistently once the runtime refactor is
  stable.
