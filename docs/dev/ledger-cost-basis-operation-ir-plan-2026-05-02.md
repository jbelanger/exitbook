---
status: active-design
---

# Ledger Cost-Basis Operation IR Plan

This plan defines the boundary between ledger-native cost-basis projection and
jurisdiction calculators. It is the current execution source for the next
cost-basis migration slice.

## Problem

The ledger projector now emits calculator-ready facts, blockers, journal
contexts, relationship treatment, fee attachment inputs, and exclusion
fingerprints. Those events are still ledger-shaped. Calculators should not
re-derive cost-basis treatment from `journalKind`, `postingRole`, or
`relationshipKind`, but they also should not receive a lot-matching model that
leaks FIFO/specific-id assumptions into Canada ACB.

The missing layer is a jurisdiction-neutral operation stream:

- acquisition/disposal/carry/fee intent is explicit
- tax asset identity, not raw storage asset id, owns chain partitioning
- relationship carry preserves per-allocation evidence
- fee treatment remains calculator-owned
- blockers have explicit blast-radius semantics
- deterministic ordering and event coverage are testable before calculator
  migration

## Current Surfaces

Relevant current code:

- `packages/accounting/src/cost-basis/ledger/ledger-cost-basis-event-projection.ts`
  emits `LedgerCostBasisInputEvent[]`, projection blockers, excluded postings,
  compact journal contexts, and `exclusionFingerprint`.
- `packages/accounting/src/cost-basis/ledger/ledger-cost-basis-relationship-treatment.ts`
  classifies accepted relationship meaning as `carry_basis` or
  `dispose_and_acquire`.
- `packages/accounting/src/cost-basis/ledger/ledger-cost-basis-fee-attachment.ts`
  classifies only standalone `expense_only` fees without relationships. Every
  other fee context is intentionally `unknown`.
- `packages/accounting/src/cost-basis/model/tax-asset-identity.ts` resolves
  tax identity keys. Exchange assets and blockchain natives use normalized
  symbol identity, blockchain tokens stay strict by default, and validated
  overrides can merge identities.

What is already decided:

- projection stays ledger-owned and read-only
- accepted relationships are accounting truth
- relationship `kind` remains semantic operation, not direct basis truth
- relationship basis treatment is classified in cost-basis code
- fee attachment flows through a classifier and starts conservative
- excluded postings do not produce math operations but must affect input
  fingerprints and reports

What is still missing:

- a typed operation model between projection and calculators
- operation builder tests that prove determinism, event coverage, tax identity
  partitioning, fee annotation, carry closure, and blocker propagation
- calculator adapters that consume operations instead of raw ledger events

## Chosen Model

Add a new operation builder owned by ledger cost-basis code:

- `packages/accounting/src/cost-basis/ledger/ledger-cost-basis-operation-projection.ts`
- tests in
  `packages/accounting/src/cost-basis/ledger/__tests__/ledger-cost-basis-operation-projection.test.ts`
- exports from `packages/accounting/src/cost-basis.ts`

The builder consumes:

```ts
interface BuildLedgerCostBasisOperationsInput {
  projection: LedgerCostBasisEventProjection;
  identityConfig: {
    assetIdentityOverridesByAssetId?: ReadonlyMap<string, string> | undefined;
  };
}
```

The builder returns `Result<LedgerCostBasisOperationProjection, Error>`.
Ordinary ledger/data inconsistencies become operation blockers, not `Err`.
Reserve `Err` for violated function contracts that prevent the builder from
even describing the problem.

The successful value is:

```ts
interface LedgerCostBasisOperationProjection {
  operations: readonly LedgerCostBasisOperation[];
  blockers: readonly LedgerCostBasisOperationBlocker[];
  excludedPostings: readonly LedgerCostBasisExcludedPosting[];
  exclusionFingerprint: string;
}
```

Do not name this layer `Lot*`. Lots are calculator implementation state for
standard FIFO/LIFO/specific-id paths. Canada ACB consumes acquisitions and
dispositions into pools, not lots.

## Operation Shape

Use neutral operation names:

```ts
type LedgerCostBasisOperation =
  | LedgerCostBasisAcquireOperation
  | LedgerCostBasisDisposeOperation
  | LedgerCostBasisCarryOperation
  | LedgerCostBasisFeeOperation;
```

Shared rules:

- quantities are positive
- operation kind encodes direction
- ordering is deterministic:
  `timestamp`, `sourceActivityFingerprint`, `journalFingerprint`,
  `relationshipStableKey` when present, `postingFingerprint`, `operationId`
- every source event is consumed exactly once by an operation or blocker
- raw `assetId` remains audit data, not the default chain key
- account ownership is audit data, not part of the chain key

### Tax Asset Chain Keys

Every asset-chain key must come from `resolveTaxAssetIdentity(...)`.

Do not partition by raw `assetId`. That would split exchange BTC, native BTC,
and explicitly overridden identities that are supposed to share tax state.

Fiat assets are not tax-asset chains. If the current projector emits a fiat
posting as a cost-basis event before a separate consideration/proceeds model
exists, the operation builder must emit a blocker instead of silently creating a
chain or dropping the event. The current event projector does not exclude fiat
postings, so this is required fail-closed behavior for the operation boundary.

Single-posting operations use one `chainKey`:

```ts
interface LedgerCostBasisOperationRelationshipContext {
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  relationshipBasisTreatment: LedgerCostBasisRelationshipBasisTreatment;
  relationshipAllocationId: number;
}

interface LedgerCostBasisAcquireOperation {
  kind: 'acquire';
  operationId: string;
  chainKey: string;
  sourceEventId: string;
  postingFingerprint: string;
  postingRole: AccountingPostingRole;
  ownerAccountId: number;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  relationshipContext?: LedgerCostBasisOperationRelationshipContext | undefined;
}
```

`DisposeOperation` has the same chain-key and audit fields. Relationship
context is present when an acquire/dispose operation came from an accepted
`dispose_and_acquire` relationship, so calculators can explain the operation
without re-reading raw ledger events.

Projection events do not currently include `ownerAccountId`; add it before the
operation builder as a passive ledger field. This keeps projection read-only
while letting operation audit trails explain account provenance without making
account ownership part of tax identity.

### Carry Operations

Carry is relationship-level, not two independent posting operations.

```ts
interface LedgerCostBasisCarryOperation {
  kind: 'carry';
  operationId: string;
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  relationshipBasisTreatment: 'carry_basis';
  inputEventIds: readonly string[];
  sourceLegs: readonly LedgerCostBasisCarryLeg[];
  targetLegs: readonly LedgerCostBasisCarryLeg[];
}

interface LedgerCostBasisCarryLeg {
  allocationId: number;
  sourceEventId: string;
  chainKey: string;
  postingFingerprint: string;
  ownerAccountId: number;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
}
```

Do not collapse carry legs into totals. A multi-source or multi-target
relationship needs the per-allocation audit trail for basis flow and future
review.

When source and target legs resolve to different tax identities, the carry
operation is explicitly cross-chain. The calculator must carry basis out of the
source chain and into the target chain according to the accepted relationship.

Relationships classified as `dispose_and_acquire` do not produce carry
operations. Their source events become disposal operations and target events
become acquisition operations.

### Fee Operations

Fees are operations, but not `ApplyFee` operations.

```ts
interface LedgerCostBasisFeeOperation {
  kind: 'fee';
  operationId: string;
  chainKey: string;
  sourceEventId: string;
  postingFingerprint: string;
  postingRole: 'fee' | 'protocol_overhead';
  ownerAccountId: number;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  settlement: AccountingSettlement;
  attachment: LedgerCostBasisFeeAttachment;
}
```

`settlement` is required because the event projector blocks fee and
`protocol_overhead` postings that lack settlement. If a future projection change
lets a missing-settlement fee event through, the operation builder must emit an
operation blocker instead of fabricating settlement.

The operation preserves fee facts and the classifier output. It does not decide
whether a jurisdiction capitalizes the fee, nets it against proceeds, expenses
it, or consumes the fee asset as a taxable disposal. Those are calculator rules.

An unknown fee attachment is not a principal-asset blocker. It belongs to the
fee asset chain, and only becomes a calculation blocker when a calculator needs
the attachment resolved to continue.

## Blocker Shape

Operation blockers wrap projection blockers and calculator-prep blockers with
explicit propagation:

```ts
type LedgerCostBasisOperationBlockerPropagation = 'op-only' | 'after-fence';

interface LedgerCostBasisOperationBlocker {
  blockerId: string;
  reason: string;
  propagation: LedgerCostBasisOperationBlockerPropagation;
  affectedChainKeys: readonly string[];
  inputEventIds: readonly string[];
  sourceProjectionBlocker?: LedgerCostBasisProjectionBlocker | undefined;
  message: string;
}
```

Propagation meaning:

- `op-only`: this operation is excluded or unresolved, but later operations on
  the same chain are not automatically suspect
- `after-fence`: this point changes chain state or ordering enough that later
  chain results are suspect until the blocker is resolved

Initial mapping:

- missing or invalid relationship allocation: `after-fence` for all resolvable
  allocation chain keys
- relationship residual: `after-fence` for the residual posting chain
- unsupported protocol posting: `after-fence` for the posting chain
- missing fee/protocol-overhead settlement: `after-fence` for the fee asset
  chain
- zero-quantity posting: `op-only`
- unknown fee attachment: no operation-projection blocker; calculator emits a
  fee-asset blocker only if the fee cannot be processed

## Invariants Before Calculator Wiring

Add focused unit tests before adapting either calculator:

1. Determinism: identical projection plus identity config produces byte-identical
   operation JSON after stable serialization.
2. Event coverage: every projected event is consumed exactly once by an
   operation or operation blocker. Single-posting operations expose
   `sourceEventId`; carry operations and operation blockers expose
   `inputEventIds`.
3. Positive quantities: all operations and carry legs have positive quantities.
4. Tax identity chain key: exchange and blockchain-native assets resolve to
   symbol identity, blockchain non-native tokens resolve to asset id, and
   explicit overrides merge chains.
5. Carry closure: each carry operation has at least one source leg and one
   target leg, and preserves source/target allocation ids and quantities.
6. Treatment mutation: changing relationship treatment from `carry_basis` to
   `dispose_and_acquire` changes the operation shape from carry to
   dispose/acquire.
7. Fee annotation: fee operations preserve classifier output and do not apply
   jurisdiction semantics.
8. Fee attachment isolation: unknown fee attachment does not create a blocker on
   a principal asset chain.
9. Exclusion lineage: `excludedPostings` and `exclusionFingerprint` pass through
   unchanged.
10. Blocker chain isolation: a blocker for chain A does not change operations
    for unrelated chain B.
11. Missing-price tolerance: missing acquisition price is represented on the
    acquire operation by absent `priceAtTxTime` and does not by itself fence the
    chain.
12. Protocol carry preservation: protocol deposit/refund postings connected by a
    `carry_basis` relationship produce carry operations, not acquire/dispose
    operations.
13. Fee chain attribution: a fee operation's `chainKey` is the fee asset's tax
    identity, never the principal asset's identity.

A single curated snapshot can cover a mixed fixture, but it is supporting
evidence. The invariant tests above are the load-bearing checks.

## Implementation Order

1. Add `ownerAccountId` to `LedgerCostBasisInputEvent` and event projection
   tests. This is a passive field add to projection, not a projection-side
   treatment decision.
2. Add operation projection types and builder shell.
3. Resolve chain keys with `resolveTaxAssetIdentity(...)`; fail with operation
   blockers, not thrown errors, when identity cannot resolve.
4. Map acquisition, disposal, and fee events into operations.
5. Group carryover-in/out events by `relationshipStableKey` into one
   `CarryOperation`.
6. Map projection blockers into operation blockers with explicit propagation.
7. Add the invariant tests above.
8. Only after the operation boundary is green, adapt the standard calculator
   first. Canada follows once the neutral operation model proves stable.

## Deferred Decisions

Do not decide these in the IR slice:

- persistence shape for explicit fee attachment overrides
- jurisdiction-specific fee capitalization/netting/disposal rules
- whether relationship basis treatment becomes persisted override data
- broad consumer migration or CLI UX changes

The IR must make those decisions easy to add later by centralizing the boundary,
not by guessing their final schema now.

## Current Smells To Watch

- `LedgerCostBasisFeeAttachment.attached_to_posting.rule` is currently `string`.
  Keep it until the first real attachment rule lands, then narrow it to a named
  rule union.
- Projection events currently lack `ownerAccountId`; adding it is audit-only but
  should happen before operation projection.
- Cross-chain carry is correct but will make chain-scoped blockers more subtle.
  Tests must cover blocker isolation and carry propagation before calculator
  migration.
