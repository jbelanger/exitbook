# Cost-Basis Refactor Plan

This document lays out the cost-basis refactor that comes immediately after the
linking-first work.

It is intentionally scoped in three steps:

1. build an accounting-scoped transaction input for cost basis
2. simplify the lot matcher to consume that input instead of linking-era UTXO
   heuristics
3. clean up dead code and leave a clear seam for exclusions

This document expands the brief "Step 2 Overall: Fix Cost-Basis" section in
[`linking-first-refactor-plan.md`](./linking-first-refactor-plan.md). It also
supersedes the cost-basis portion of
[`utxo-consolidation.md`](./utxo-consolidation.md), which assumed a persisted
UTXO consolidation view. The plan here keeps the middle ground we agreed on:

- persist source facts once
- build cost-basis meaning ephemerally
- keep linking and cost basis as separate consumers

## Why This Refactor Exists

The linking refactor cleaned up transfer matching, but the cost-basis engine
still contains linking-era UTXO reconstruction logic:

- `blockchain_internal` links are used as accounting hints
- `internal_only` branches suppress outflows and inflows inside the matcher
- `effectiveAmount` threads UTXO-adjusted quantities through transfer handling
- `findEffectiveSourceLink()` still uses a three-level lookup that exists only
  because the source movement amount and the persisted link amount used to drift

Today that coupling lives in:

- [`packages/accounting/src/cost-basis/lot-matcher.ts`](../../packages/accounting/src/cost-basis/lot-matcher.ts)
- [`packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts`](../../packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts)
- [`packages/accounting/src/cost-basis/lot-fee-utils.ts`](../../packages/accounting/src/cost-basis/lot-fee-utils.ts)
- [`packages/accounting/src/linking/link-index.ts`](../../packages/accounting/src/linking/link-index.ts)

That leaves cost basis depending on how linking happens to describe UTXO
transactions instead of owning its own accounting meaning.

The cost-basis refactor should fix one thing above all:

**cost basis should consume an accounting-scoped transaction view, not infer
meaning from `blockchain_internal` links or linker-specific amount fallbacks.**

## Scope

### In Scope

- introduce an ephemeral accounting-scoped input for cost basis
- move same-hash UTXO reduction rules into cost-basis-owned code
- simplify lot matching to use scoped movements plus confirmed transfer links
- remove `effectiveAmount`, `internal_only`, and the UTXO-only source lookup
  fallback from cost basis
- keep partial-match support for genuine 1:N and N:1 transfer links

### Out of Scope

- redesigning `transactions` or `transaction_movements`
- redesigning transfer link construction or matching strategies
- movement-level accounting exclusions in this phase
- new persisted projection tables for cost basis
- changing balance calculation behavior

## Target End State

After this refactor:

- cost basis builds `AccountingScopedBuildResult` in memory from
  `UniversalTransactionData[]`
- same-hash UTXO interpretation happens before lot matching, not inside it
- scoped fee normalization happens before price validation and lot matching
- price coverage and hard price validation run on the scoped result, not raw
  processed transactions
- `LotMatcher` uses confirmed cross-transaction transfer links plus
  cost-basis-local fee-only internal carryover sidecars
- `LotMatcher` no longer consumes `blockchain_internal` links to discover
  accounting behavior
- transfer source math uses scoped movement amounts directly
- ambiguous same-hash blockchain groups fail closed with a concrete error
  instead of silently falling back to raw per-address rows

The key boundary becomes:

```text
processed transactions
        +
cost-basis accounting scope builder
        ↓
AccountingScopedBuildResult
        +
price validation
        +
confirmed external transfer links
        ↓
LotMatcher
```

## Step 1: Build Accounting-Scoped Transactions

### Goal

Create one explicit place where cost basis derives UTXO accounting meaning
before lot matching starts.

This step replaces the current implicit behavior where the lot matcher learns
about internal change only after it sees `blockchain_internal` links.

### New Shape

Add cost-basis-local input shapes:

```ts
interface AccountingScopedTransaction {
  tx: UniversalTransactionData;
  movements: {
    inflows: AssetMovement[];
    outflows: AssetMovement[];
  };
  fees: FeeMovement[];
}

interface FeeOnlyInternalCarryover {
  assetId: string;
  assetSymbol: Currency;
  fee: FeeMovement;
  retainedQuantity: Decimal;
  sourceTransactionId: number;
  targetTransactionIds: number[];
}

interface AccountingScopedBuildResult {
  transactions: AccountingScopedTransaction[];
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
}
```

Important detail:

- this should stay local to `packages/accounting/src/cost-basis`
- it is not a shared `core` type
- it is not persisted

The first version can keep the original transaction object nested as `tx`
instead of cloning every top-level field into a new schema. The goal is to make
movement and fee scoping explicit, not invent a second transaction model.

Important invariant:

- `tx` remains immutable source facts only
- `movements` and `fees` become the authoritative accounting view for cost-basis
  math
- if the builder rewrites an outflow amount, it must also rewrite scoped fees so
  `scoped net = scoped gross - scoped on-chain fee` still reconciles

### Builder Entry Point

Add:

- [`packages/accounting/src/cost-basis/build-accounting-scoped-transactions.ts`](../../packages/accounting/src/cost-basis/build-accounting-scoped-transactions.ts)

Primary function:

```ts
export function buildAccountingScopedTransactions(
  transactions: UniversalTransactionData[],
  logger: Logger
): Result<AccountingScopedBuildResult, Error>;
```

### Builder Rules

The builder should group same-hash blockchain transactions by asset using the
same conservative topology rules as the linking reducer, but the output is
different because the concern is different.

#### Rule 0. Group by asset identity, not display symbol

The grouping key must be:

```text
(blockchain, normalizedHash, assetId)
```

Do not group by `assetSymbol`.

If the same normalized hash contains asset identity collisions such as:

- one `assetSymbol` mapped to multiple `assetId`s
- one `assetId` rendered with multiple symbols

return `Err`.

Reason:

- linking can be tolerant here because unmatched candidates are acceptable
- cost basis cannot merge accounting meaning across ambiguous asset identity

#### Rule 1. No same-hash ambiguity

If a same-hash asset group is ambiguous, return `Err`, not `warn + continue`.

Ambiguous means either:

- a participant has both inflow and outflow for the same asset
- multiple pure outflow participants exist while inflows are also present

Reason:

- linking can tolerate unmatched candidates
- cost basis cannot safely tolerate invented accounting meaning

The error should include:

- normalized hash
- blockchain
- asset symbol
- participant transaction ids

#### Rule 2. Clearly internal same-hash group

If a group has exactly one pure outflow participant and one or more pure inflow
participants:

- remove the pure inflow movements from the scoped target transactions
- reduce the source outflow by tracked internal inflows only
- make the source transaction the only scoped owner of the deduped same-asset
  on-chain fee
- remove duplicate same-asset on-chain fee representations from scoped target
  transactions
- keep scoped fees explicit so normal transfer fee policy still applies

That means the scoped source amount should be:

```text
scoped gross outflow = raw outflow gross - tracked internal inflows
scoped net outflow   = scoped gross outflow - deduped on-chain fee
```

This is the critical difference from the old `effectiveAmount` path:

- old behavior netted out change and fee together, then skipped fee handling
- new behavior nets out internal change only, leaving fees explicit for
  jurisdiction rules

This is also the critical difference from reusing `tx.fees` directly:

- raw fees stay as source facts
- scoped fees become the accounting input
- fee validation and transfer fee policy must read scoped fees, not raw fees

#### Rule 3. Pure internal transfer with no external amount

If a clearly internal same-hash group reduces the source outflow down to fee
only or zero external transfer quantity, do not silently drop the fee.

Recommended implementation:

- do not force this through ordinary outflow-only scoping
- emit a cost-basis-local `FeeOnlyInternalCarryover`
- keep the internal target inflows in scoped transactions for this case
- remove the source outflow from scoped movements if no external transfer
  quantity remains
- keep the deduped same-asset fee on the scoped source transaction

Reason:

- disposal jurisdictions still need the fee treated as a fee event
- add-to-basis jurisdictions still need a target-side basis carrier
- neither policy can be represented correctly if the internal inflow disappears
  and no carryover sidecar exists

This is intentionally not a persisted `TransactionLink`.
It is a cost-basis-local carryover primitive owned by the accounting scope
builder.

#### Rule 4. Non-blockchain and non-grouped transactions

Pass through unchanged.

### Suggested Implementation Structure

Use two helpers in the same module or split them if the file gets large:

```ts
function groupSameHashTransactionsForCostBasis(...)
function applySameHashScoping(...)
function buildFeeOnlyInternalCarryovers(...)
```

Do not call the linking reducer directly from cost basis. The topology rules can
match, but cost basis should own its own output contract.

### Pseudo-Code

```ts
const groups = groupSameHashTransactionsForCostBasis(transactions);
const scopedByTxId = new Map<number, AccountingScopedTransaction>();
const feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[] = [];

for (const tx of transactions) {
  scopedByTxId.set(tx.id, {
    tx,
    movements: {
      inflows: [...(tx.movements.inflows ?? [])],
      outflows: [...(tx.movements.outflows ?? [])],
    },
    fees: [...tx.fees],
  });
}

for (const group of groups) {
  const decision = reduceSameHashGroupForCostBasis(group);
  if (decision.isErr()) return err(decision.error);

  applyDecisionToScopedTransactions(scopedByTxId, feeOnlyInternalCarryovers, decision.value);
}

return ok({
  transactions: [...scopedByTxId.values()],
  feeOnlyInternalCarryovers,
});
```

### Tests To Add

Add:

- [`packages/accounting/src/cost-basis/__tests__/build-accounting-scoped-transactions.test.ts`](../../packages/accounting/src/cost-basis/__tests__/build-accounting-scoped-transactions.test.ts)

Cases:

- clear same-hash internal change reduces source outflow and removes tracked
  inflow
- scoped fee normalization makes source outflow net/gross reconcile after
  same-hash reduction
- same-symbol different-assetId same-hash group returns `Err`
- pure internal same-hash fee-only transfer emits a
  `FeeOnlyInternalCarryover`
- ambiguous mixed inflow/outflow same-hash group returns `Err`
- ambiguous multiple-outflow same-hash group returns `Err`
- non-blockchain transactions pass through unchanged

### Exit Criteria

Step 1 is done when:

- cost basis has one explicit builder for UTXO accounting meaning
- scoped fees are part of that accounting meaning, not an implicit read from
  raw `tx.fees`
- no cost-basis behavior depends on consuming `blockchain_internal` links first
- ambiguous same-hash groups are rejected before lot matching

## Step 2: Simplify The Lot Matcher

### Goal

Make downstream cost-basis consumers operate on the scoped boundary, then make
lot matching consume scoped movements plus confirmed external transfer links,
with no linker-era UTXO heuristics.

### File Changes

Update:

- [`packages/accounting/src/cost-basis/cost-basis-pipeline.ts`](../../packages/accounting/src/cost-basis/cost-basis-pipeline.ts)
- [`packages/accounting/src/cost-basis/cost-basis-utils.ts`](../../packages/accounting/src/cost-basis/cost-basis-utils.ts)
- [`packages/accounting/src/cost-basis/cost-basis-validation-utils.ts`](../../packages/accounting/src/cost-basis/cost-basis-validation-utils.ts)
- [`packages/accounting/src/cost-basis/cost-basis-calculator.ts`](../../packages/accounting/src/cost-basis/cost-basis-calculator.ts)
- [`packages/accounting/src/cost-basis/lot-creation-utils.ts`](../../packages/accounting/src/cost-basis/lot-creation-utils.ts)
- [`packages/accounting/src/cost-basis/lot-fee-utils.ts`](../../packages/accounting/src/cost-basis/lot-fee-utils.ts)
- [`packages/accounting/src/cost-basis/lot-matcher.ts`](../../packages/accounting/src/cost-basis/lot-matcher.ts)
- [`packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts`](../../packages/accounting/src/cost-basis/lot-transfer-processing-utils.ts)
- [`packages/accounting/src/cost-basis/internal-carryover-processing-utils.ts`](../../packages/accounting/src/cost-basis/internal-carryover-processing-utils.ts)
- [`packages/accounting/src/linking/link-index.ts`](../../packages/accounting/src/linking/link-index.ts)

### 1. Build scoped input before any downstream validation

In the pipeline/calculator path, build accounting-scoped transactions first.
Every downstream gate that decides whether cost basis can run should read the
scoped result, not raw processed transactions.

That means:

- replace raw `validateTransactionPrices()` usage with a scoped equivalent
- replace raw `assertPriceDataQuality()` usage with a scoped equivalent
- either remove matcher-local price preflight or switch it to scoped input
  only

The exclusions phase should not have to reopen these files later.

### 2. Build scoped input before matching

In the calculator path, build accounting-scoped transactions before calling the
matcher.

Pseudo-code:

```ts
const scopedResult = buildAccountingScopedTransactions(transactions, logger);
if (scopedResult.isErr()) return err(scopedResult.error);

const priceGateResult = validateScopedTransactionPrices(scopedResult.value, config.currency);
if (priceGateResult.isErr()) return err(priceGateResult.error);

const externalConfirmedLinks = confirmedLinks.filter(
  (link) => link.confidenceScore.gte(0.95) && link.linkType !== 'blockchain_internal'
);

return matcher.match(scopedResult.value, externalConfirmedLinks, config);
```

### 3. Keep `blockchain_internal` out of cost-basis matching

Cost basis should not use internal same-hash links as an accounting side
channel.

Inside `LotMatcher.match()`:

- accept already-filtered external links or defensively re-filter them
- do not consume or skip internal links because they should no longer be
  present

This means:

- dependency ordering only sees real transfer links
- internal same-hash behavior comes from scoped transactions plus
  fee-only carryover sidecars, not link consumption

### 4. Remove `internal_only`

Delete:

- `SourceLinkResult.type === 'internal_only'`
- `TargetLinkResult.type === 'internal_only'`
- the skip branches that exist only for internal-link consumption

New result shapes:

```ts
type SourceLinkResult = { links: TransactionLink[]; type: 'transfer' } | { type: 'none' };
type TargetLinkResult = { links: TransactionLink[]; type: 'transfer' } | { type: 'none' };
```

### 5. Remove `effectiveAmount`

Delete the UTXO-specific parameter from `processTransferSource()`.

Recommended replacement:

- if a source link is a genuine partial match (`metadata.partialMatch === true`)
  use `link.sourceAmount` as the linked source quantity
- otherwise use the scoped outflow's `netAmount ?? grossAmount`

If a parameter is still needed, rename it to `linkedSourceAmount`. Do not keep
the name `effectiveAmount`; it hides two unrelated concerns.

### 6. Simplify source link lookup

`findEffectiveSourceLink()` should stop:

- consuming `blockchain_internal` links
- trying raw net amount, then raw gross amount, then `findAnyBySource()`

Replace it with:

1. exact lookup using the scoped outflow amount
2. if no exact link exists, and all source links for `(txId, asset)` are
   partial matches, return them all
3. otherwise return `none`

This preserves genuine 1:N split handling without keeping the UTXO fallback.

### 7. Simplify target lookup

`findEffectiveTargetLink()` should:

- stop consuming internal links
- keep partial-match aggregation for genuine N:1 cases

### 8. Add a dedicated fee-only internal carryover path

`LotMatcher` should process `feeOnlyInternalCarryovers` from the scoped build
result with a dedicated helper. Do not try to smuggle this case back through
persisted `TransactionLink`s.

Recommended shape:

```ts
matcher.match(scoped: AccountingScopedBuildResult, externalLinks: TransactionLink[], config)
```

Recommended helper:

```ts
function processFeeOnlyInternalCarryover(...)
```

Behavior:

- reuse dependency ordering by adding source → target edges for carryovers
- source side identifies the lots backing `retainedQuantity`
- disposal jurisdictions create explicit fee disposals
- add-to-basis jurisdictions create target carryover lots with inherited basis
  plus capitalized fee
- if carryover targets are missing or price data is incomplete, return `Err`
  rather than warning and continuing

### Tests To Add Or Update

Update:

- [`packages/accounting/src/cost-basis/__tests__/cost-basis-calculator.test.ts`](../../packages/accounting/src/cost-basis/__tests__/cost-basis-calculator.test.ts)
- [`packages/accounting/src/cost-basis/__tests__/cost-basis-pipeline.test.ts`](../../packages/accounting/src/cost-basis/__tests__/cost-basis-pipeline.test.ts)
- [`packages/accounting/src/cost-basis/__tests__/lot-matcher.test.ts`](../../packages/accounting/src/cost-basis/__tests__/lot-matcher.test.ts)
- [`packages/accounting/src/cost-basis/__tests__/lot-matcher-transfers.test.ts`](../../packages/accounting/src/cost-basis/__tests__/lot-matcher-transfers.test.ts)
- [`packages/accounting/src/linking/__tests__/link-index.test.ts`](../../packages/accounting/src/linking/__tests__/link-index.test.ts)

Add assertions that:

- raw-price validation no longer blocks transactions for movements/fees removed
  by the accounting scope builder
- lot matching no longer depends on `blockchain_internal` links being present
- clear same-hash UTXO source reductions match external transfer links exactly
- partial-match 1:N and N:1 behavior still works
- fee handling still works for:
  - transfer fee disposal jurisdictions
  - add-to-basis jurisdictions
  - fee-only internal same-hash carryover scenarios
- dependency ordering honors fee-only internal carryover source → target edges

### Exit Criteria

Step 2 is done when:

- price coverage and hard price validation both consume the scoped boundary
- `lot-matcher.ts` contains no `internal_only` or `effectiveAmount`
- `LotMatcher` does not consume `blockchain_internal` links
- `LinkIndex.findAnyBySource()` is no longer required by cost basis
- transfer tests still pass for ordinary exchange/blockchain transfers,
  partial links, and fee-only internal carryovers

## Step 3: Cleanup And Exclusions Seam

### Goal

Delete the dead UTXO-specific matcher scaffolding and make the next exclusions
phase build on the new accounting-scoped boundary.

### File Changes

Delete or simplify:

- UTXO-specific comments in
  [`packages/accounting/src/cost-basis/lot-matcher.ts`](../../packages/accounting/src/cost-basis/lot-matcher.ts)
- `findAnyBySource()` in
  [`packages/accounting/src/linking/link-index.ts`](../../packages/accounting/src/linking/link-index.ts)
  if no remaining caller needs it
- stale specs that still say cost basis consumes `blockchain_internal` links:
  - [`docs/specs/lot-matcher-transaction-dependency-ordering.md`](../specs/lot-matcher-transaction-dependency-ordering.md)
  - [`docs/specs/transfers-and-tax.md`](../specs/transfers-and-tax.md)

### Exclusion Seam To Preserve

Do not solve exclusions in this document, but preserve this boundary:

```text
processed transactions
        +
accounting scope builder
        +
exclusion policy
        ↓
accounting-scoped build result
```

That means the new builder should be designed so a later phase can add:

- movement removal
- asset-level exclusion
- fee exclusion

without reopening the lot matcher again.

### Exit Criteria

Step 3 is done when:

- the cost-basis path has no linker-era UTXO heuristics left
- the next exclusions phase can attach to the accounting-scoped builder
- specs and tests describe the new boundary accurately

## What Comes Immediately After Cost Basis

After this refactor, exclusions become much more straightforward.

The next phase should:

- keep baseline transaction-level spam/import exclusion where it already belongs
- apply accounting exclusions when building accounting-scoped transactions
- let price coverage and lot matching operate only on the scoped build result

That follow-up should build on
[`accounting-exclusions-v2.md`](./accounting-exclusions-v2.md), but with one
important rule:

- exclusions belong in the accounting-scoped builder or immediately after it
- they do not belong in linking

## Recommended Implementation Order

For one developer working locally, follow this order:

1. implement the accounting-scoped transaction builder and its tests
2. move price validation to the scoped boundary in pipeline + calculator code
3. wire the builder into the lot-matcher path
4. simplify `LotMatcher` and `processTransferSource()`
5. add fee-only internal carryover processing
6. remove `LinkIndex.findAnyBySource()` if it is now unused
7. update specs and docs
8. only then start the exclusions phase

## Decisions And Smells

- Main smell: cost basis still depends on linking artifacts to understand UTXO
  accounting meaning.
- Recommended boundary: `AccountingScopedTransaction` should live in
  `packages/accounting/src/cost-basis`, not `core`.
- Recommended extension: scoped fees belong in the same local boundary as
  scoped movements; raw `tx.fees` should not remain the accounting truth once
  scoping begins.
- Recommended failure mode: same-hash grouping should key by `assetId`, not
  `assetSymbol`, and asset identity collisions should fail closed.
- Naming issue: `effectiveAmount` hides both "partial link quantity" and
  "UTXO-reduced quantity"; if any parameter survives, rename it to
  `linkedSourceAmount`.
- Recommended design: fee-only internal same-hash groups should use a
  cost-basis-local carryover sidecar, not a fake disposal-only outflow and not
  a persisted internal link.
