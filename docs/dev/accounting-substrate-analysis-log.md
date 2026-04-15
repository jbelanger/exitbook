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

## Pass 4

### Scope

Define the smallest generic accounting-substrate model that could solve the
mixed-event pressure without becoming:

- a Cardano-specific patch table
- a second copy of current processed transactions under a different name
- a vague event log with weaker identity than the current system

This pass is about the leading candidate model, not final adoption.

### Evidence Inspected

- [transaction.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/transaction.ts)
- [movement.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/movement.ts)
- [movement-semantics-and-diagnostics.md](/Users/joel/Dev/exitbook/docs/specs/movement-semantics-and-diagnostics.md)
- [build-cost-basis-scoped-transactions.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/build-cost-basis-scoped-transactions.ts)
- [scoped-transaction-types.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/scoped-transaction-types.ts)
- Pass 1, Pass 2, and Pass 3 findings in this document

### Findings

1. The smallest reusable model is closer to “accounting components” than to a
   second transaction model.
   The core pressure is not that Exitbook lacks another transaction table.
   It is that one processed movement may need to:
   - pass through unchanged
   - split into multiple accounting-relevant parts
   - or be reduced/retained in a grouped accounting view
     A component model expresses that directly. A second transaction-row model
     mostly re-encodes today’s problem at a different layer.

2. The leading candidate is:
   - a canonical accounting component
   - plus exact provenance bindings back to current processed identity

   Minimal sketch:

   ```ts
   type AccountingComponentKind = 'asset_inflow' | 'asset_outflow' | 'fee';

   interface AccountingComponent {
     componentFingerprint: string;
     kind: AccountingComponentKind;
     assetId: string;
     assetSymbol: Currency;
     quantity: Decimal;
     role?: MovementRole | undefined; // asset kinds only
     feeScope?: FeeMovement['scope'] | undefined; // fee only
     feeSettlement?: FeeMovement['settlement'] | undefined; // fee only
     provenanceBindings: AccountingProvenanceBinding[];
   }

   interface AccountingProvenanceBinding {
     txFingerprint: string;
     movementFingerprint: string;
     quantity: Decimal;
   }
   ```

   Semantics:
   - `componentFingerprint` is the canonical accounting identity
   - `provenanceBindings` preserve exact traceability to processed movements
   - one processed movement may back one or more accounting components
   - one accounting component may bind one or more processed movements

3. The candidate can stay generic without inventing a huge new taxonomy.
   It does **not** need event types like:
   - `exchange_deposit`
   - `cardano_staking_withdrawal`
   - `bridge_receipt`
     Those are either link-level relationships or chain-specific descriptions.
     The current generic semantic vocabulary already gives most of what we need:
   - asset inflow/outflow
   - fee
   - movement role
   - fee scope / settlement
     That is a good sign. It means the candidate model can reuse existing shared
     semantics instead of replacing them.

4. A separate “accounting event group” row does not look necessary in the
   minimal model.
   A group layer may become useful later for UX or export context, but it is
   not required to make the accounting substrate canonical.
   The minimal valuable unit is the component, because:
   - accounting math cares about quantities and roles
   - linking cares about exact transferable quantities
   - provenance comes from bindings
     Starting with components only is materially simpler than introducing both:
   - accounting event headers
   - accounting event line items

5. The candidate model can represent the hard cases from earlier passes without
   ad hoc Cardano fields.
   Examples:
   - mixed Cardano target movement:
     - one `asset_inflow` principal component
     - one `asset_inflow` `staking_reward` component
     - both bound to the same processed target movement with exact split
       quantities
   - same-hash grouped internal/external case:
     - source-side `asset_outflow` components with exact retained/external
       quantities
     - one or more `fee` components with exact provenance bindings
   - simple transfer or reward case:
     - a straight 1:1 component bound to one processed movement

6. The most important rejected alternative is “promote the existing
   cost-basis scoped transaction layer as the canonical accounting substrate,”
   whether persisted or not.
   That looks tempting because the scoped build already solves some hard same-
   hash cases.
   It is still the wrong minimal model because:
   - it is too cost-basis-shaped
   - it is still transaction-shaped
   - it carries cost-basis-local constructs like `rebuildDependencyTransactionIds`
     and `FeeOnlyInternalCarryover`
   - it does not define a general new accounting identity
   - it would still need new component-like vocabulary for mixed-scope events,
     which means the component model would end up reappearing inside a heavier
     transaction wrapper anyway
     The scoped build remains valuable evidence, but it should inform the new
     substrate, not become it unchanged.

### Implications

- The current leading candidate is:
  - generic accounting components
  - exact provenance bindings
  - no mandatory event-header/group table in the first iteration
- This candidate is promising because it is small and aligned with current
  semantics:
  - movement roles remain useful
  - fee scope/settlement remain useful
  - processed identity remains useful
- A future substrate change should be rejected if it cannot explain why this
  smaller component model is insufficient.
  That is the current simplicity bar.

### Open Questions From Pass 4

1. How should `componentFingerprint` be derived exactly?
   The leading requirement is:
   - rooted in semantic component material
   - rooted in sorted provenance bindings
   - deterministic across rebuilds

2. Should provenance bindings require quantities on every row, or can some
   cases use an implicit “full movement” binding?

3. Do fees need their own component kind, or is a more unified “entry type +
   role” model actually cleaner after deeper review?

4. If linking eventually consumes accounting components, should component-level
   link identity replace movement-pair identity, or should links stay anchored
   to provenance movements and use components only for quantity semantics?

5. Is there any generic hard case that requires an explicit component-group
   layer in Phase 0, or can that remain deferred safely?

## Pass 5

### Scope

Test whether the current leading candidate:

- generic accounting components
- exact provenance bindings

would actually simplify the accounting system enough to warrant adoption.

This is the blast-radius and payoff check. If the candidate only relocates
complexity, it should be rejected here.

### Evidence Inspected

- Pass 1 through Pass 4 in this document
- [cost-basis-accounting-scope.md](/Users/joel/Dev/exitbook/docs/specs/cost-basis-accounting-scope.md)
- [linking-orchestrator.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/orchestration/linking-orchestrator.ts)
- [build-linkable-movements.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/pre-linking/build-linkable-movements.ts)
- [portfolio-handler.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-handler.ts)
- [price-inference-service.ts](/Users/joel/Dev/exitbook/packages/accounting/src/price-enrichment/orchestration/price-inference-service.ts)
- [issues-source-data.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/issues-source-data.ts)
- [cost-basis-issue-materializer.ts](/Users/joel/Dev/exitbook/packages/accounting/src/issues/cost-basis-issue-materializer.ts)
- [override-event-store-and-replay.md](/Users/joel/Dev/exitbook/docs/specs/override-event-store-and-replay.md)

### Findings

1. The candidate would simplify cost basis materially.
   Today cost basis must:
   - build a special scoped accounting view in memory
   - perform same-hash reductions there
   - carry cost-basis-local artifacts like `FeeOnlyInternalCarryover`
     That work exists because processed rows are not yet the right accounting
     substrate.
     If canonical accounting components existed, the cost-basis seam could read
     the already-reconstructed accounting quantities directly instead of owning so
     much reconstruction itself.

2. The candidate would simplify portfolio materially if portfolio joins the
   accounting substrate boundary.
   Today portfolio inherits the same mixed-scope problems as cost basis because
   it reads `Transaction[]` and then reuses cost-basis context/workflows.
   A canonical component substrate would let portfolio read:
   - principal quantities
   - reward quantities
   - fees
     directly, instead of depending on processed-row compensation paths like the
     Cardano residual work.

3. The candidate would simplify issue generation if issue families are split
   honestly.
   The likely result would be:
   - accounting-facing issue families read accounting components
   - provenance/review-facing issue families keep reading processed rows
     That is cleaner than today’s mixed situation where profile issues and
     cost-basis issues both start from the processed transaction substrate but
     reshape it differently.

4. The candidate would simplify linking only partially unless the boundary is
   chosen carefully.
   It would clearly help with transfer quantity semantics:
   - principal-only transfer candidates become explicit
   - non-principal residuals stop leaking into linker compensation paths
     But linking still has one important design fork:
   - keep link identity anchored to provenance movements and use components for
     quantities only
   - or move link identity fully onto accounting components
     The first option is less pure, but much lower risk and likely the better
     migration path.

5. Pricing is the least cleanly resolved capability.
   The component model would help accounting-price requirements because it would
   make “which quantities still need prices for accounting?” much clearer.
   But some current pricing work still looks provenance-side:
   - reading all processed transactions
   - deriving or normalizing movement prices before accounting
     So the likely clean split is:
   - provenance-side price enrichment may still operate on processed rows
   - accounting-side price completeness / readiness should operate on
     accounting components
     This is not fatal, but it means pricing should not be oversold as fully
     simplified by the substrate change.

6. The candidate does not look like “just another layer” if the boundary is
   enforced strictly.
   It would become unnecessary structure only if:
   - accounting kept reading processed rows in some places
   - components were added as an optional side path
   - or linking/cost basis kept their current reconstruction logic anyway
     If those mistakes are avoided, the candidate does appear to remove real
     downstream reconstruction burden rather than merely moving it.

7. The main remaining risk is not the model itself. It is migration discipline.
   The model now looks strong enough.
   The harder practical questions are:
   - how to migrate cost basis, portfolio, linking, and issues in a clean order
   - how to keep one canonical accounting reader during the transition
   - how to preserve current exact override behavior while introducing
     component-level accounting reads

### Implications

- The current leading candidate passes the “extra layer without simplification”
  check conditionally.
- That means Phase 0 should not stop at “interesting idea.”
  It is now reasonable to advance toward a short decision document and a staged
  migration plan.
- The best current migration lean is:
  1. keep processed rows as provenance/audit
  2. introduce canonical accounting components with exact provenance bindings
  3. migrate accounting readers capability-first
  4. keep pricing split explicit instead of pretending it is all one seam
  5. keep correction/override identity exact from day one

### Open Questions From Pass 5

1. Should linking Phase 1 of any migration keep durable link identity anchored
   to provenance movements while switching quantity semantics to components?

2. Which capability should migrate first after the substrate is introduced:
   cost basis, portfolio, linking, or issues?

3. Can pricing be split cleanly into:
   - provenance-side enrichment
   - accounting-side completeness / readiness
     without creating a confusing hybrid boundary?

4. Is there any capability not yet reviewed that would still force a dual-truth
   accounting model even if the major seams migrate cleanly?

5. Should Phase 0 now end in a provisional “go” for the component model, or is
   one more focused migration-sequencing pass needed before that decision is
   honest?

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
  - able to justify a larger model only if the minimal component model fails

Current Phase 0 lean after Pass 5:

- a generic component-plus-provenance-binding substrate now looks strong enough
  to treat as the leading architectural direction
- the remaining uncertainty is mainly migration order and the exact linking /
  pricing boundary, not whether the minimal model is conceptually viable

Anything weaker should be rejected.
