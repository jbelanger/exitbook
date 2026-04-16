---
last_verified: 2026-04-15
status: canonical
---

# Canonical Accounting Layer Specification

Defines Exitbook's canonical accounting layer.

The canonical accounting layer exists so all accounting consumers read one
shared accounting model while `processed transactions` remain the provenance
and audit model.

## Quick Reference

| Concept                      | Key Rule                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `processed transactions`     | Remain the provenance and audit layer                                                             |
| `canonical accounting layer` | Becomes the one read path for accounting consumers                                                |
| `accounting entry`           | Smallest canonical accounting unit                                                                |
| `accounting-layer build`     | Narrow read model: entries plus deterministic build metadata needed by accounting consumers       |
| `provenance binding`         | Exact binding from an accounting entry back to one processed movement                             |
| `entryFingerprint`           | Deterministic canonical identity for one accounting entry                                         |
| initial correction boundary  | User notes and movement-role overrides remain attached to processed transactions                  |
| initial linking boundary     | Linking reads accounting-entry quantities, but durable link identity stays movement-anchored      |
| initial pricing boundary     | Provenance-side enrichment stays on processed transactions; accounting readiness moves to entries |

## Goals

- one canonical accounting read path
- exact traceability back to processed identity
- generic support for mixed-scope accounting events
- simpler downstream accounting in cost basis, linking, portfolio, and issues
- no weakening of current replay and override discipline

## Non-Goals

- replacing processed transactions as the browse and audit model
- introducing a full journal / ledger model now
- inventing chain-specific accounting entry kinds
- making free-form notes part of machine state
- allowing long-lived dual truth between processed movements and accounting
  entries
- requiring an entry-group or accounting-document layer in the first iteration

## Canonical Vocabulary

- `processed transactions`
  - the current persisted per-address / per-account processed transaction and
    movement layer
- `canonical accounting layer`
  - the one read path all accounting consumers should use
- `accounting entries`
  - the smallest canonical accounting units
- `provenance bindings`
  - exact bindings from accounting entries back to `txFingerprint` and
    `movementFingerprint`

Reserved:

- `journal`
  - do not use yet
  - reserve for a later stage only if the model earns fuller ledger-style
    semantics

## Ownership And Boundaries

- `@exitbook/accounting` owns the accounting-entry model, accounting-layer
  build model, and accounting-owned reader ports
- `@exitbook/data` owns persistence and repository implementations
- `apps/cli` owns browse surfaces, rendering, and command wiring
- `processed transactions` remain the canonical provenance roots for:
  - `txFingerprint`
  - `movementFingerprint`
  - transaction browse
  - import debugging
  - provenance-targeted corrections
- the `canonical accounting layer` becomes authoritative for:
  - cost basis
  - portfolio accounting quantities
  - accounting-side price completeness and readiness
  - accounting-facing issue families
  - transfer quantity semantics used by linking

## Minimal Canonical Model

```ts
type AccountingEntryKind = 'asset_inflow' | 'asset_outflow' | 'fee';

interface AccountingEntry {
  entryFingerprint: string;
  kind: AccountingEntryKind;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  provenanceBindings: readonly AccountingProvenanceBinding[];
}

interface AssetAccountingEntry extends AccountingEntry {
  kind: 'asset_inflow' | 'asset_outflow';
  role: MovementRole;
}

interface FeeAccountingEntry extends AccountingEntry {
  kind: 'fee';
  feeScope: FeeMovement['scope'];
  feeSettlement: FeeMovement['settlement'];
}

interface AccountingProvenanceBinding {
  txFingerprint: string;
  movementFingerprint: string;
  quantity: Decimal;
}
```

## Initial Accounting-Layer Build Result

The first canonical accounting reader returns a narrow build result, not only a
flat `AccountingEntry[]`.

```ts
interface AccountingLayerBuildResult {
  accountingTransactionViews: readonly AccountingTransactionView[];
  processedTransactions: readonly Transaction[];
  entries: readonly AccountingEntry[];
  derivationDependencies: readonly AccountingDerivationDependency[];
  internalTransferCarryovers: readonly InternalTransferCarryover[];
}

interface AccountingTransactionView {
  processedTransaction: Transaction;
  inflows: readonly AccountingAssetEntryView[];
  outflows: readonly AccountingAssetEntryView[];
  fees: readonly AccountingFeeEntryView[];
}

interface AccountingAssetEntryView {
  entryFingerprint: string;
  movementFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  grossQuantity: Decimal;
  netQuantity?: Decimal;
  role: MovementRole;
  priceAtTxTime?: PriceAtTxTime;
}

interface AccountingFeeEntryView {
  entryFingerprint: string;
  movementFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  feeScope: FeeMovement['scope'];
  feeSettlement: FeeMovement['settlement'];
  priceAtTxTime?: PriceAtTxTime;
}

interface AccountingDerivationDependency {
  ownerTxFingerprint: string;
  supportingTxFingerprint: string;
  reason: 'same_hash_internal_scoping';
}

interface InternalTransferCarryover {
  sourceEntryFingerprint: string;
  targetBindings: readonly InternalTransferCarryoverTargetBinding[];
  feeEntryFingerprint?: string;
}

interface InternalTransferCarryoverTargetBinding {
  quantity: Decimal;
  targetEntryFingerprint: string;
}
```

Semantics:

- `processedTransactions` preserve direct access to processed transaction
  metadata and provenance context without duplicating that metadata on every
  entry
- `accountingTransactionViews` are deterministic accounting-owned grouped views
  for consumers that still reason in transaction order
- `derivationDependencies` are deterministic build metadata that record which
  processed transactions influenced another transaction's accounting shape
- `internalTransferCarryovers` capture deterministic same-asset internal
  transfer relations that are real accounting meaning, not cost-basis-only
  warnings
- this build result is intentionally narrow
- do not add consumer-policy helpers such as
  `rebuildDependencyTransactionIds` directly to `AccountingEntry`

Semantics:

- `asset_inflow` and `asset_outflow` entries carry a `role` using the existing
  `MovementRole` vocabulary
- `fee` entries do not carry `role`; they use `feeScope` and
  `feeSettlement`
- one processed movement may back one or more accounting entries
- one accounting entry may bind one or more processed movements
- every accounting entry must carry at least one provenance binding

## Identity Contract

`entryFingerprint` is the canonical identity for one accounting entry.

Rules:

- `entryFingerprint` must be deterministic across rebuilds when the entry's
  semantic facts and sorted provenance bindings are unchanged
- `entryFingerprint` must not depend on database row ids
- `entryFingerprint` must not depend on prices, notes, diagnostics, or display
  metadata
- `entryFingerprint` must be derived from:
  - `kind`
  - `assetId`
  - `quantity.toFixed()`
  - `role`, when present
  - `feeScope`, when present
  - `feeSettlement`, when present
  - sorted provenance-binding material
- provenance-binding material must include:
  - `txFingerprint`
  - `movementFingerprint`
  - `quantity.toFixed()`

Canonical binding sort order:

1. `movementFingerprint`
2. `txFingerprint`
3. bound quantity string

Implications:

- one unchanged economic entry must rebuild to the same `entryFingerprint`
- changed split quantities or changed bound movements correctly produce a new
  `entryFingerprint`
- `entryFingerprint` is the accounting-layer counterpart to
  `movementFingerprint`, not a replacement for it

## Provenance-Binding Contract

Every accounting entry must carry explicit provenance bindings.

Rules:

- every binding must point to one persisted processed movement by full
  `movementFingerprint`
- every binding must also carry the parent `txFingerprint`
- every binding must carry an explicit quantity
- bindings must never rely on implicit “full movement” semantics
- the sum of binding quantities for one accounting entry must equal the entry
  quantity exactly
- a binding must never point to a movement of a different `assetId`
- bindings are exact traceability data, not fuzzy hints

This contract preserves Exitbook's current identity rigor while allowing one
processed movement to be:

- passed through unchanged
- split into multiple accounting entries
- or combined with other movements into one accounting entry

## Behavioral Rules

### Generic Entry Model

The canonical accounting layer must stay generic.

Allowed first-class entry kinds are:

- `asset_inflow`
- `asset_outflow`
- `fee`

Do not introduce chain-specific or venue-specific entry kinds such as:

- `cardano_staking_withdrawal`
- `exchange_deposit`
- `bridge_receipt`

Those concepts belong either in:

- shared `role` vocabulary
- linking relationships
- or higher-level grouping later, if the model earns it

### Relationship To Processed Transactions

`processed transactions` remain authoritative for provenance and audit.

The canonical accounting layer is derived from processed transactions plus
deterministic accounting semantics that should affect accounting meaning.

Required behavior:

- accounting consumers must not reconstruct their own alternative accounting
  quantities from raw processed movements once accounting entries exist
- provenance and browse consumers may continue to read processed transactions
  directly
- processed transaction identity remains the root for replay and traceability
- processors provide the deterministic processed facts needed to derive the
  canonical accounting layer
- processors do **not** own higher-order accounting relations such as
  derivation dependencies or internal-transfer carryovers

### Initial Correction Boundary

The initial correction boundary is intentionally narrow:

- transaction user notes remain provenance-only
- movement-role overrides remain attached to processed movements
- accounting-entry derivation must read the current effective processed
  semantics, including persisted movement-role overrides
- future accounting-layer corrections, if needed, must be typed and explicit
  instead of overloading provenance-layer corrections

### Initial Linking Boundary

Linking migrates in two steps:

- transfer quantity semantics move onto accounting entries
- durable link identity remains anchored to processed movement identity
  initially

That means:

- link validation and transfer eligibility should use accounting-entry quantities
- persisted link identity must continue to resolve exact source and target
  movements during the first migration stage
- movement-anchored link identity is an explicit migration boundary, not a
  reason to let linking keep its own separate accounting math

Current migration status:

- canonical transfer-link validation now reads `accountingTransactionViews`
- `validateScopedTransferLinks(...)` remains as a compatibility adapter for
  transaction-shaped cost-basis consumers that still operate on scoped
  transactions
- the next real consumer migration should happen where the accounting-layer
  build result is already available, rather than rebuilding it only to validate
  links

### Initial Pricing Boundary

Pricing remains explicitly split during the first migration stages:

- provenance-side enrichment stays on processed transactions
- accounting-side completeness and readiness move onto accounting entries

This is an explicit migration boundary, not permission for permanent dual truth.

Current migration status:

- accounting-side price completeness / rebuild subset selection now reads the
  accounting-layer build result
- cost-basis lot matching and scoped calculation still read the scoped
  transaction build
- the canonical accounting layer now includes `accountingTransactionViews` as
  the replacement grouped transaction view for future transaction-shaped
  consumers

## First Reader Boundary

The first accounting-owned reader seam should return the accounting-layer build
result, not only `AccountingEntry[]`.

Why:

- cost basis still needs direct access to processed transaction metadata
- same-hash accounting reconstruction introduces deterministic derivation
  dependencies between processed transactions
- pure internal same-hash transfers introduce deterministic internal-transfer
  carryovers that are accounting meaning, not just cost-basis-local warnings
- lot matching and Canada tax projection still need an accounting-owned grouped
  transaction view

This is the accepted narrow expansion beyond the smaller
`accounting-entry-plus-provenance-binding` baseline.

## Future Evolution

This specification does **not** commit Exitbook to full journal semantics now.

It does keep that path open cleanly.

If later phases earn a fuller ledger-style model, the expected evolution is:

- first: accounting entries + provenance bindings
- later, if warranted:
  - entry groups or accounting documents
  - richer journal-style semantics
  - more classical accounting vocabulary

That future evolution must be additive. It must not require abandoning the core
contracts defined here.

## Invariants

- `processed transactions` remain the provenance and audit model.
- the `canonical accounting layer` is the one accounting read path.
- `entryFingerprint` is the canonical identity for one accounting entry.
- `movementFingerprint` remains the canonical identity for one processed
  movement.
- every accounting entry has at least one explicit provenance binding.
- binding quantities reconcile exactly to entry quantity.
- no chain-specific entry kinds appear in the first canonical model.
- no accounting consumer is allowed to treat processed movements and accounting
  entries as parallel optional truths.
