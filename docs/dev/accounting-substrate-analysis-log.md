---
last_verified: 2026-04-15
status: active
---

# Accounting Substrate Analysis Log

Owner: Codex + Joel
Primary tracker:

- [accounting-issue-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-implementation-plan.md)

Purpose:

- keep a disciplined record of Phase 0 analysis passes
- separate architectural investigation from the execution tracker
- force each pass to answer concrete questions instead of drifting into loose
  architecture brainstorming

This document is an investigation log.

It is **not** the execution tracker and it is **not** the canonical spec.
When the Phase 0 direction stabilizes, the chosen model should be distilled
into:

- the implementation tracker in `docs/dev`
- canonical specs in `docs/specs`

## Phase 0 Question

Is the current processed transaction substrate the right canonical accounting
substrate for Exitbook long-term, or should a new canonical accounting substrate
exist with the current processed rows demoted to provenance/audit use?

This is not a Cardano-only question.

Cardano exposed the pressure, but the decision must be generic across the
system.

## Current Known Pressure

The current processed row is doing too much at once:

- provenance / import reconstruction
- balance-impact representation
- accounting / transfer representation

That is workable for simple cases.

It becomes awkward for mixed-scope economic events, where one real-world event
contains multiple semantic components that do not align cleanly to one
per-address processed row.

Current example:

- Cardano multi-input xpub transaction
- wallet-scoped staking withdrawal
- per-address processed rows
- downstream compensation through:
  - diagnostics
  - explained residuals
  - grouped transfer correction

## Non-Negotiable Rules

These rules must survive Phase 0 regardless of the chosen outcome:

1. No dual truth for accounting.
   If a second substrate exists, accounting consumers must have one canonical
   accounting source, not a mix.

2. No Cardano-specific substrate design.
   Any new substrate must be generic and justified beyond one chain.

3. No weaker identity model than the current one.
   A new accounting substrate must have strict durable identity, not just row
   ids or mutable display grouping.

4. No free-form notes as machine state.

5. No hidden heuristics replacing explicit semantics.

6. No ambiguous corrective-action ownership.
   Grouped transfer correction, movement-role override, and any future partial
   correction must have one clear substrate target.

7. Provenance must remain explorable.
   A cleaner accounting substrate must not destroy address-level or
   import-level auditability.

## Evaluation Criteria

A stronger accounting substrate must satisfy all of these:

- canonical accounting substrate
- strict durable identity
- typed audited overrides
- no ambiguous correction ownership
- no notes-as-state
- no hidden heuristics
- simpler downstream accounting, not merely an extra layer

## Analysis Method

Each pass should answer one bounded question and record:

- scope
- evidence inspected
- findings
- implications
- open questions created by the pass

Passes should aim to prove or disprove the substrate change, not merely argue
for it.

## Planned Passes

1. Current-state seam inventory
   - Which current consumers read `transactions` / `transaction_movements`?
   - Which are provenance consumers vs accounting consumers vs mixed consumers?

2. Identity and override dependency inventory
   - Which current identity contracts and override flows depend on the current
     processed substrate directly?

3. Minimal generic accounting-substrate model
   - What is the smallest reusable generic model that would solve the mixed
     event problem without becoming a Cardano-specific patch table?

4. Hard-case mapping
   - Can the candidate model represent:
     - Cardano mixed-scope staking withdrawal
     - grouped transfer cases
     - a simpler staking / fee / transfer case
       without ad hoc escape hatches?

5. Migration and blast-radius check
   - Would the candidate actually simplify linking, cost basis, issues, and
     overrides, or just add another layer?

## Pass 1

### Scope

Initial framing pass based on the current Exitbook codebase and a local
comparison to rotki.

### Evidence Inspected

Exitbook:

- [transaction.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/transaction.ts)
- [transaction-and-movement-identity.md](/Users/joel/Dev/exitbook/docs/specs/transaction-and-movement-identity.md)
- [movement-semantics-and-diagnostics.md](/Users/joel/Dev/exitbook/docs/specs/movement-semantics-and-diagnostics.md)
- [utxo-address-model.md](/Users/joel/Dev/exitbook/docs/specs/utxo-address-model.md)
- [transfers-and-tax.md](/Users/joel/Dev/exitbook/docs/specs/transfers-and-tax.md)
- Cardano processor / processor-utils

Rotki:

- [AGENTS.md](/Users/joel/Dev/rotki/AGENTS.md)
- [base.py](/Users/joel/Dev/rotki/rotkehlchen/history/events/structures/base.py)
- [schema.py](/Users/joel/Dev/rotki/rotkehlchen/db/schema.py)
- [history_base_entries.py](/Users/joel/Dev/rotki/rotkehlchen/accounting/history_base_entries.py)
- [accountant.py](/Users/joel/Dev/rotki/rotkehlchen/accounting/accountant.py)
- [processed_event.py](/Users/joel/Dev/rotki/rotkehlchen/accounting/structures/processed_event.py)

### Findings

1. Exitbook’s current processed transaction layer is doing both provenance work
   and accounting work.

2. The Cardano staking case is not primarily a missing-data problem.
   It is a scope mismatch:
   - wallet-scoped staking withdrawal
   - per-address processed rows

3. Rotki does use a typed canonical event layer for accounting.
   Accounting reads `history_events`, not the underlying fetched transaction
   rows.

4. Rotki is **not** a template to copy directly.
   It is stronger than Exitbook on canonical accounting-event shape, but weaker
   on identity rigor and mutation cleanliness.

5. The right design question is not “provenance or accounting?”
   The more useful framing is:
   - who owns reconstruction: writer or reader?

6. If Exitbook adds a new accounting substrate, accounting consumers must use
   it consistently.
   A mixed model where some accounting consumers still read the current
   processed rows would be worse than the current design.

### Implications

- A new accounting substrate is architecturally legitimate.
- It is not automatically a simplification.
- The only acceptable version is one where:
  - current processed rows become provenance/audit rows
  - the new substrate becomes the canonical accounting input

### Open Questions From Pass 1

1. Which current accounting consumers are pure accounting consumers and could
   move cleanly?

2. Which current consumers are mixed and would need a sharper split first?

3. What should the identity root of a new accounting substrate be?
   Reuse current `txFingerprint` / `movementFingerprint`, derive a new identity,
   or introduce a bridged identity model?

4. What is the smallest generic accounting component model that is not just
   “the Cardano fix table”?

## Pass 2

### Scope

Inventory the current consumers of `transactions` / `transaction_movements`
and classify them as:

- provenance / browse consumers
- accounting consumers
- mixed consumers

The purpose of this pass is to test whether a future accounting-substrate split
would be localized enough to be viable, or already too diffuse to stay clean.

### Evidence Inspected

- [cost-basis-persistence.ts](/Users/joel/Dev/exitbook/packages/accounting/src/ports/cost-basis-persistence.ts)
- [cost-basis-ports.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/cost-basis-ports.ts)
- [portfolio-handler.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-handler.ts)
- [linking-orchestrator.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/orchestration/linking-orchestrator.ts)
- [build-linkable-movements.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/pre-linking/build-linkable-movements.ts)
- [pricing-ports.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/pricing-ports.ts)
- [price-inference-service.ts](/Users/joel/Dev/exitbook/packages/accounting/src/price-enrichment/orchestration/price-inference-service.ts)
- [price-normalization-service.ts](/Users/joel/Dev/exitbook/packages/accounting/src/price-enrichment/orchestration/price-normalization-service.ts)
- [issues-source-data.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/issues-source-data.ts)
- [cost-basis-issue-materializer.ts](/Users/joel/Dev/exitbook/packages/accounting/src/issues/cost-basis-issue-materializer.ts)
- [asset-review-projection-data-ports.ts](/Users/joel/Dev/exitbook/packages/data/src/projections/asset-review-projection-data-ports.ts)
- [transactions-read-support.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/command/transactions-read-support.ts)
- [transaction-view-projection.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/transactions/transaction-view-projection.ts)
- [prices-view-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/prices/command/prices-view-handler.ts)
- [cost-basis-accounting-scope.md](/Users/joel/Dev/exitbook/docs/specs/cost-basis-accounting-scope.md)
- repo-wide usage scan for:
  - `db.transactions.findAll(...)`
  - `loadCostBasisContext()`
  - `loadPricingContext()`
  - `buildCostBasisScopedTransactions(...)`

### Findings

1. Exitbook already has a de facto shared accounting seam built on processed
   transactions.
   The strongest evidence is the current data/accounting ports:
   - `CostBasisContext = { transactions, confirmedLinks, accounts }`
   - `PricingContext = { transactions, confirmedLinks }`
     These are not incidental storage reads. They are capability-facing domain
     seams that multiple accounting workflows already depend on.

2. Strong accounting consumers already read the current processed substrate
   directly or through narrow accounting ports.
   Current examples:
   - cost basis:
     - `buildCostBasisPorts(...).loadCostBasisContext()`
     - `run-standard-cost-basis.ts`
     - `canada-acb-workflow.ts`
   - linking:
     - `LinkingOrchestrator.loadTransactions()`
     - `buildLinkableMovements(...)`
     - `buildCostBasisScopedTransactions(...)` inside linking
   - portfolio:
     - `PortfolioHandler.loadPortfolioExecutionInputs()`
     - `calculateHoldings(...)`
     - cost-basis workflow reuse
   - pricing:
     - `buildPricingPorts(...).loadPricingContext()`
     - `PriceInferenceService`
     - `PriceNormalizationService`
   - cost-basis issue materialization:
     - `materializeCostBasisAccountingIssueScopeSnapshot(...)`

3. Cost basis already documents the current processed movements as the
   authoritative accounting input after in-memory reshaping.
   The canonical statement today is in
   [cost-basis-accounting-scope.md](/Users/joel/Dev/exitbook/docs/specs/cost-basis-accounting-scope.md):
   - scoped `movements` and `fees` are the authoritative accounting input for
     cost basis
   - the scoped build is derived in memory from processed transactions
     So the current accounting substrate is not merely “whatever happens to be in
     the DB.” It is an explicit model choice already embedded in the specs.

4. Provenance / browse consumers are real and still valuable, but they are a
   different family.
   Current examples:
   - `transaction-view-projection.ts`
   - `transactions-read-support.ts`
   - account/detail browse helpers
   - price browse surfaces
     These consumers want per-transaction and per-movement visibility, balance
     impact, diagnostics, and auditability. They do not need a canonical
     accounting substrate as their primary object.

5. Several consumers are mixed and would need an explicit decision if a new
   accounting substrate were introduced.
   Current examples:
   - profile issue sourcing:
     - link gaps are produced from processed transactions plus links
   - asset review projection:
     - reads processed transactions, but supports accounting readiness
   - balance / review diagnostics:
     - balance impact is a browse concern, but often informs accounting repair
       These consumers are the most likely source of dual-truth drift if the
       boundary is not explicit.

6. The current blast radius is wide, but not shapeless.
   The repo-wide scan shows many direct `db.transactions.findAll(...)` callers,
   but the core accounting pressure is clustered around a small number of
   capability seams:
   - cost-basis context
   - pricing context
   - linking transaction load
   - profile issue source loading
     That means a substrate change would still be large, but it is not “touch
     every command equally.” The accounting-heavy paths are already somewhat
     centralized.

### Implications

- A future accounting-substrate change would be a real architecture change, not
  just an extra table.
- The highest-value migration point is not the raw repository layer by itself.
  It is the existing accounting context ports and accounting-owned loaders that
  currently expose `Transaction[] + confirmedLinks[]`.
- Provenance/browse consumers can likely stay on the current processed rows
  with much less disruption than accounting consumers.
- Mixed consumers must be resolved deliberately:
  - either they become accounting-substrate consumers
  - or they stay provenance-side by design
    Leaving them half on each side would violate the Phase 0 rules.

### Open Questions From Pass 2

1. Which mixed consumers should be treated as accounting consumers in the long
   term?

2. If a new accounting substrate exists, should profile issue families such as
   link gaps move onto it, or remain explicitly provenance/review-side?

3. Should a future accounting substrate replace the current shared contexts with
   one new shared accounting context, or with narrower per-capability ports?

4. Is price enrichment fundamentally an accounting consumer, or should part of
   it remain provenance-side even if cost basis, linking, and portfolio move?

5. What identity bridge would let accounting consumers stop reading raw
   processed movements without weakening `txFingerprint` /
   `movementFingerprint`-level traceability?

## Pass 3

### Scope

Inventory the current identity contracts and durable user-correction flows that
depend directly on the processed transaction substrate.

The purpose of this pass is to answer a narrower question than Pass 2:

- if a new canonical accounting substrate exists, can Exitbook preserve its
  current replay and correction discipline
- or would the change force fuzzy remapping and weaker override guarantees

### Evidence Inspected

- [transaction-and-movement-identity.md](/Users/joel/Dev/exitbook/docs/specs/transaction-and-movement-identity.md)
- [override-event-store-and-replay.md](/Users/joel/Dev/exitbook/docs/specs/override-event-store-and-replay.md)
- [override.ts](/Users/joel/Dev/exitbook/packages/core/src/override/override.ts)
- [transaction-link.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/transaction-link.ts)
- [override-store.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/override-store.ts)
- [override-replay.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/orchestration/override-replay.ts)
- [transaction-movement-role-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/transaction-movement-role-replay.ts)
- [transaction-user-note-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/transaction-user-note-replay.ts)
- [link-gap-resolution-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/link-gap-resolution-replay.ts)
- [asset-review-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/asset-review-replay.ts)
- [asset-exclusion-replay.ts](/Users/joel/Dev/exitbook/packages/data/src/overrides/asset-exclusion-replay.ts)
- [transaction-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-repository.ts)
- [transaction-materialization-support.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-materialization-support.ts)
- [transaction-link-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/transaction-link-repository.ts)
- [accounting-issue-repository.ts](/Users/joel/Dev/exitbook/packages/data/src/repositories/accounting-issue-repository.ts)

### Findings

1. Exitbook’s current correction model is already identity-rigorous.
   The canonical processed identities are:
   - `txFingerprint` for processed transactions
   - `movementFingerprint` for processed movements
     They are intentionally stable across price enrichment, diagnostics, user
     notes, and movement-role changes. That stability is doing real work today.

2. The most important durable user corrections are keyed directly to processed
   identity, not to row ids.
   Current examples:
   - transaction user notes:
     - `transaction_user_note_override`
     - keyed by `tx_fingerprint`
   - movement-role overrides:
     - `transaction_movement_role_override`
     - keyed by `movement_fingerprint`
   - link-gap resolution:
     - keyed by `tx_fingerprint + asset_id + direction`
   - manual link confirmation / rejection:
     - keyed by a resolved link fingerprint built from:
       - `sourceMovementFingerprint`
       - `targetMovementFingerprint`
       - `sourceAssetId`
       - `targetAssetId`
     - while also carrying `source_fingerprint` / `target_fingerprint` for
       transaction resolution

3. Link identity is stricter than a plain transaction-pair model.
   The durable link override path does **not** just say “these two transactions
   are linked.”
   It says:
   - these exact source and target movements
   - for these exact asset ids
   - with these exact amounts
     This is a strong property. It is one of Exitbook’s current architectural
     strengths.

4. Current replay/materialization assumes processed identity survives rebuilds
   and can be reattached exactly.
   Replay today works because:
   - processed transactions rebuild with stable `txFingerprint`
   - processed movements rebuild with stable `movementFingerprint`
   - override streams can then be replayed deterministically
   - repository materialization writes back into processed projections such as:
     - `transactions.user_notes_json`
     - `transaction_movements.movement_role_override`
       This is not incidental implementation detail. It is the current durability
       contract.

5. Not every mutable workflow is substrate-bound.
   Some current mutable/read-write flows are already orthogonal to processed
   movement identity:
   - asset exclusion:
     - keyed by `asset_id`
   - asset review:
     - keyed by `asset_id` plus `evidence_fingerprint`
   - accounting issue acknowledgement:
     - keyed by `scopeKey + issueKey`
       This matters because a new accounting substrate would not have to “move
       every mutable thing.” The hard dependencies are the corrections that target
       processed transaction and movement identity directly.

6. A new accounting substrate would only stay strong if it has an explicit
   identity bridge to current processed identity.
   Without that bridge, the current correction model would regress badly:
   - manual links would need fuzzy rematching
   - movement-role overrides would need ad hoc retargeting
   - user-note replay would become ambiguous
   - orphaned override materialization would lose its exactness
     So the relevant design bar is not just “new substrate has ids.”
     It is:
   - new substrate identity must either be rooted in current processed identity
   - or define an equally deterministic bridge from current processed identity

### Implications

- A future accounting-substrate split is not blocked by all existing mutable
  state.
  It is blocked specifically by the correction families that are anchored to
  `txFingerprint`, `movementFingerprint`, and resolved movement-pair identity.
- The strongest candidate direction is **not** to abandon current processed
  identity.
  It is to preserve current processed identity as a provenance anchor and let
  any new accounting substrate derive or reference its own canonical rows from
  that anchor.
- Link overrides are the hardest identity dependency.
  Any candidate model that cannot express “this exact economic relation maps
  back to these exact persisted movements” should be rejected early.
- Movement-role override now has a sharper architectural meaning:
  it is a correction on the processed provenance movement layer.
  If a new accounting substrate exists, we will need an explicit decision on
  whether that remains a provenance-layer correction, gains an accounting-layer
  counterpart, or is replaced by a different correction vocabulary.

### Open Questions From Pass 3

1. If a new canonical accounting substrate exists, what should its own durable
   identity root be?
   - derived directly from `txFingerprint` / `movementFingerprint`
   - or independently canonical with a required bridge back to them

2. Which current correction families should stay attached to the provenance
   layer even if accounting moves?

3. Which correction families would need new accounting-layer identities or
   equivalents?

4. Can link identity stay movement-anchored while accounting consumes a
   different substrate, or would links need their own accounting-layer target?

5. Can a new substrate preserve orphaned override materialization and exact
   replay without duplicating override logic across two parallel identity
   systems?

## Current Working Position

Current recommendation:

- pause further corrective-action expansion after the already-shipped commands
- perform the remaining Phase 0 analysis passes
- only proceed with a substrate change if the result is:
  - generic
  - identity-rigorous
  - materially simplifying for linking, cost basis, issues, and overrides
  - implemented by replacing the current accounting seams, not by adding a
    second optional side path
  - explicit about how current tx/movement/link corrections survive without
    fuzzy remapping

Anything weaker should be rejected.
