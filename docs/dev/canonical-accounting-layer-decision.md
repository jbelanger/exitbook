---
last_verified: 2026-04-15
status: accepted
---

# Canonical Accounting Layer Decision

Owner: Codex + Joel
Evidence:

- [accounting-substrate-analysis-log.md](/Users/joel/Dev/exitbook/docs/dev/accounting-substrate-analysis-log.md)
- [accounting-issue-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-implementation-plan.md)
  Canonical spec:

- [canonical-accounting-layer.md](/Users/joel/Dev/exitbook/docs/specs/canonical-accounting-layer.md)

## Decision

Exitbook will introduce a new **canonical accounting layer**.

The boundary is:

- `processed transactions` remain the provenance / audit layer
- the new `canonical accounting layer` becomes the one accounting read path
- the units in that layer are `accounting entries`
- every accounting entry must carry exact `provenance bindings` back to
  `txFingerprint` / `movementFingerprint`

This is the accepted Phase 0 direction.

## Why

The current processed rows are doing too much at once:

- provenance / import reconstruction
- balance impact
- accounting / transfer meaning

That works for simple cases.

It breaks down on mixed-scope events such as the Cardano staking case, where
one real economic event spans multiple per-address processed rows. The current
system compensates for that pressure in several downstream places. That is the
core smell Phase 0 was investigating.

The accepted direction is the smallest generic model that:

- removes downstream reconstruction burden materially
- preserves current identity rigor
- preserves exact override / correction behavior
- does not overfit to Cardano

## Canonical Vocabulary

Use this language going forward:

- `processed transactions`
  - current persisted per-address / per-account processed layer
- `canonical accounting layer`
  - the one read path all accounting consumers should use
- `accounting entries`
  - the smallest units inside the canonical accounting layer
- `provenance bindings`
  - exact bindings from accounting entries back to `txFingerprint` and
    `movementFingerprint`

Reserved:

- `journal`
  - do not use yet
  - reserve it for a future stage only if the model earns fuller
    ledger-style semantics

## Authoritative Boundaries

### Processed Transactions Remain Authoritative For

- import reconstruction
- provenance / audit browsing
- `transactions` CLI surfaces
- canonical roots of `txFingerprint` and `movementFingerprint`
- provenance-targeted corrections such as:
  - transaction user notes
  - movement-role overrides

### Canonical Accounting Layer Becomes Authoritative For

- cost basis
- portfolio accounting quantities
- accounting-side price completeness / readiness
- accounting-facing issue families
- transfer quantity semantics used by linking

### Initial Exceptions

- provenance-side price enrichment remains on processed transactions initially
- durable link identity remains movement-anchored initially, even after linking
  starts reading accounting-entry quantities

Those exceptions are deliberate migration boundaries, not permanent dual truth.

## Rejected Alternatives

### 1. Keep Processed Transactions As The Canonical Accounting Layer

Rejected because it keeps hardening the current scope mismatch.

This would preserve the exact pressure that produced:

- explained residual compensation
- grouped transfer correction
- cost-basis-only same-hash accounting reconstruction

### 2. Promote The Existing Cost-Basis Scoped Transaction Layer Unchanged

Rejected whether persisted or ephemeral.

Reasons:

- it is too cost-basis-shaped
- it is still transaction-shaped
- it carries cost-basis-local constructs like:
  - `rebuildDependencyTransactionIds`
  - `FeeOnlyInternalCarryover`
- it does not define a clean generic accounting identity
- once generalized for mixed-scope events, entry-like primitives would reappear
  inside it anyway

The scoped build remains useful evidence and migration aid, but not the chosen
canonical model.

### 3. Create An `accounting-v2` Package

Rejected.

Reasons:

- it would institutionalize migration smell
- it would encourage parallel truth and duplicated types
- it would make the final architecture feel like a migrated system instead of a
  clean one

The new layer should land inside the existing `@exitbook/accounting` package,
behind clear ports and capability seams.

### 4. Avoid Deeper Refactor Because The Rewrite Is Large

Rejected.

Refactor cost is not a valid reason to keep a weaker model in place.

If a deeper rewrite or a gradual capability extraction produces a cleaner final
architecture, that is acceptable and preferred over preserving current shapes
for convenience.

The only constraint is architectural cleanliness:

- no migration-shaped public architecture
- no long-lived dual package truth
- no package extraction unless the capability boundary is already real
- no “temporary” package split that merely relocates old debt

## Implementation Shape

This decision does **not** create a parallel public architecture.

Implementation should follow these rules:

- keep the work inside the existing `@exitbook/accounting` package
- introduce the new layer behind clear accounting-owned reader ports
- migrate capabilities by seam, not by public `v2` namespaces
- allow temporary shadowing only for validation during migration
- do not leave long-lived dual read paths in the final design
- if a capability boundary becomes strong enough, gradual extraction into a
  separate package is allowed, but only when the extracted package can own a
  clean stable responsibility

The end state should look like one clean accounting system, not a migrated
system that permanently exposes both old and new models.

## Non-Negotiable Rules

The chosen direction is accepted only with these rules:

1. No dual truth for accounting.
2. No Cardano-specific accounting-entry model.
3. No weaker identity model than the current `txFingerprint` /
   `movementFingerprint` contracts.
4. No free-form notes as machine state.
5. No hidden heuristics replacing explicit semantics.
6. No fuzzy remapping for current durable corrections.
7. Provenance remains explorable.

## Migration Order

The initial migration order is:

1. Introduce one accounting-owned reader seam for the canonical accounting layer.
2. Migrate cost basis first.
3. Migrate linking and gap analysis second.
   During this stage, durable link identity stays movement-anchored while link
   quantity semantics move onto accounting entries.
4. Migrate portfolio third.
5. Migrate issue producers after their owning accounting readers stabilize.

Pricing remains explicitly split during the first migration stages:

- provenance-side enrichment stays on processed transactions
- accounting-side completeness / readiness moves with accounting readers

## Future Evolution

This decision does **not** commit Exitbook to a full journal/ledger model now.

It does keep that path open cleanly.

If later phases earn a fuller ledger-style model, the expected evolution is:

- first: accounting entries + provenance bindings
- later, if warranted:
  - entry groups / accounting documents
  - richer journal-style semantics
  - more classical accounting vocabulary

That should be additive evolution, not a conceptual rewrite.

## Immediate Follow-Up

Immediate follow-up status:

1. The first accounting-owned reader seam is now defined.
   It returns a narrow accounting-layer build result instead of only
   `AccountingEntry[]`.
2. The next step is the first proving migration slice for cost basis against
   that build result.
