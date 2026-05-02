---
status: active-design
---

# Standard Ledger Operation Engine Plan

This is the execution plan for migrating the non-Canada cost-basis calculator
from the legacy accounting model to the ledger operation IR.

## Problem

The ledger operation IR is now in place:

- `acquire`, `dispose`, `carry`, and `fee` operations are explicit
- chain keys use `resolveTaxAssetIdentity(...)`
- carry operations preserve accepted relationship allocation legs
- fee operations preserve classifier output without applying tax treatment
- projection and operation blockers have explicit propagation

The remaining standard calculator path still runs through
`AccountingTransactionView`, `TransactionLink`, internal carryover sidecars, and
`LotMatcher`. Feeding operations into a synthetic `AccountingTransactionView`
would recreate the old model as a compatibility adapter. Do not do that.

## Current Surfaces

Use:

- `packages/accounting/src/cost-basis/ledger/ledger-cost-basis-operation-projection.ts`
  as the calculator input boundary.
- `packages/accounting/src/cost-basis/standard/strategies/**` for FIFO/LIFO lot
  ordering.
- `packages/accounting/src/cost-basis/standard/calculation/gain-loss-utils.ts`
  for existing gain/loss aggregation where the output shape still matches.

Do not build new standard work on:

- `packages/accounting/src/accounting-model/**`
- `packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts`
- movement-fingerprint transfer validation
- transaction annotations as accounting truth

## Chosen Shape

Add a new operation-native standard engine:

- `packages/accounting/src/cost-basis/standard/operation-engine/`
- tests under
  `packages/accounting/src/cost-basis/standard/operation-engine/__tests__/`

The engine consumes:

```ts
interface RunStandardLedgerOperationEngineInput {
  calculationId: string;
  operationProjection: LedgerCostBasisOperationProjection;
  strategy: ICostBasisStrategy;
}
```

The first engine result should be operation-native, not a fake legacy
transaction result:

```ts
interface StandardLedgerOperationEngineResult {
  lots: readonly StandardLedgerLot[];
  disposals: readonly StandardLedgerDisposal[];
  carries: readonly StandardLedgerCarry[];
  blockers: readonly StandardLedgerCalculationBlocker[];
}
```

Do not force this directly into `AcquisitionLot`, `LotDisposal`, or
`LotTransfer` while those types still require `transactionId` fields. Ledger
provenance is source activity, journal, posting, relationship, operation, and
event identity. If downstream consumers need the legacy shapes temporarily,
write an explicit adapter later and name the provenance loss.

## Decisions

### Cross-Chain Carry Lot Selection

Cross-chain carry must relieve source lots using the configured standard lot
selection strategy.

Reason:

- FIFO/LIFO define which tax lots leave the source chain when a quantity leaves
  that chain.
- A hidden acquisition-order carry rule would make carry behavior diverge from
  disposal behavior and would leak an unconfigured method into the engine.
- Specific-id is not implemented today; when it is implemented, carry must use
  the same selected-lot mechanism as disposals.
- If an unsupported strategy reaches the engine, the affected chain must block
  loudly instead of silently falling back to FIFO.

Implementation rule:

- introduce a small lot-selection helper that returns lot slices
  (`lotId`, `quantity`, `costBasisPerUnit`, `acquisitionDate`, provenance)
  without creating `LotDisposal`
- use that helper for both taxable disposal and non-taxable carry paths
- do not call a method named `matchDisposal` to implement carry

Same-chain carry does not change tax lot state when source and target
quantities balance per `chainKey`, because `chainKey` is already taxpayer-wide
and account is audit data only. It may produce carry audit records later, but it
must not close and reopen lots in the same chain. A carry relationship whose
source and target chain sets match but whose per-chain quantities do not balance
must block rather than silently mutate the same chain.

Cross-chain carry opens target-chain lots from the selected source lot slices.
The target lots inherit source cost basis and acquisition date. The carry
operation date remains carry provenance, not the tax acquisition date.
Carry audit slices must name source quantity and target quantity separately
because asset migrations can change units. For multi-source/multi-target carry,
the invariant is total basis conservation across the relationship, not raw
source per-unit basis preservation when source and target units differ.

### Unknown Fee Attachment

Unknown fee attachment is an `op-only` calculation blocker on the fee asset
chain only.

Rules:

- unknown fee attachment never blocks a principal asset chain
- known standalone fees may be handled only after the standard fee rule is
  implemented explicitly
- until then, fee operations can produce fee-chain blockers without changing
  acquire/dispose/carry math for unrelated chains
- jurisdiction fee policy does not enter the operation engine API until fee math
  is implemented

Do not silently expense, capitalize, net, or dispose fee assets from the IR
classifier alone.

### Missing Price Across Carry

Missing-price acquisitions are allowed to open lots with unresolved basis state.

Rules:

- an unresolved-basis lot can carry across chains
- the target carried lot preserves the unresolved basis marker and original lot
  provenance
- the calculation fences the affected chain only when a disposal needs to
  consume unresolved basis
- carrying an unresolved lot is not itself an error

This keeps missing opening basis localized to the chain that eventually needs
the lot for realized gain/loss.

### Output Shape

The operation engine should use operation-native output shapes first.

The existing standard output types are report-facing and still reference legacy
`transactionId` fields. Reusing them inside the operation engine would force
ledger source-activity/posting provenance into misleading transaction fields.

Migration path:

1. Build and test operation-native results.
2. Add a thin workflow adapter only where a current consumer still requires old
   report shapes.
3. Replace report/export/view consumers with ledger provenance.
4. Delete the legacy `LotMatcher` path after no consumer references it.

## Initial Invariants

Add invariant tests before wiring the workflow:

1. Quantity conservation per chain:
   `acquire + carryIn - dispose - carryOut == open quantity + fenced quantity`.
2. Cross-chain basis conservation:
   basis removed from selected source lots equals basis added to target lots.
3. Multi-source/multi-target carry preserves total basis across all target lots.
4. Configured strategy controls cross-chain carry lot relief.
5. Same-chain carry leaves lot state byte-identical only when per-chain
   quantities balance.
6. Same-chain quantity mismatch blocks instead of closing and reopening lots.
7. Unknown fee attachment produces an `op-only` blocker on the fee asset chain
   and does not alter principal-chain state.
8. An after-fence blocker on chain A leaves chain B byte-identical.
9. Missing-price acquisition does not block until consumed by a disposal.
10. Missing-price carry preserves unresolved basis across source and target
    chains.
11. Operation input coverage: every operation is processed into state, audit
    carry, fee blocker, or calculation blocker.

## Implementation Order

1. Add operation-native result and blocker types under
   `standard/operation-engine/`.
2. Add lot-selection helper shared by disposal and carry code.
3. Implement acquire/dispose for priced lots.
4. Add unresolved-basis lot state and disposal-time fencing.
5. Implement same-chain and cross-chain carry.
6. Add fee operation blockers; do not add fee tax math yet.
7. Add a ledger-native operation pipeline that composes event projection,
   operation projection, strategy selection, and engine execution.
8. Wire a non-Canada workflow path only after the operation engine invariants
   are green.

## Smells To Watch

- The current standard lot/output model uses `transactionId` names. Do not
  assign source activity ids to those fields without renaming or isolating the
  adapter.
- The existing strategy interface is disposal-shaped. If carry code starts
  passing fake zero-proceeds disposals to select lots, stop and extract lot
  selection first.
- A same-chain carry that mutates lots is likely wrong because account ownership
  is not part of the tax chain key.
