---
last_verified: 2026-04-15
status: active
---

# Accounting Substrate Analysis Log

Owner: Codex + Joel
Primary tracker:

- [accounting-issue-implementation-plan.md](/Users/joel/Dev/exitbook/docs/dev/accounting-issue-implementation-plan.md)
  Accepted decision:

- [canonical-accounting-layer-decision.md](/Users/joel/Dev/exitbook/docs/dev/canonical-accounting-layer-decision.md)

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

Are the current processed transactions the right canonical accounting layer for
Exitbook long-term, or should a new canonical accounting layer exist with the
current processed rows demoted to provenance/audit use?

This is not a Cardano-only question.

Cardano exposed the pressure, but the decision must be generic across the
system.

## Working Vocabulary

Use this language in the rest of Phase 0 unless a more abstract term is needed
for precision:

- `processed transactions`
  - the current persisted per-address / per-account processed transaction and
    movement layer
- `canonical accounting layer`
  - the one read path all accounting consumers should use
- `accounting entries`
  - the smallest planned units inside the canonical accounting layer
- `provenance bindings`
  - exact bindings from accounting entries back to `txFingerprint` and
    `movementFingerprint`

Reserved language:

- `substrate`
  - allowed when discussing the abstract architectural question
  - not preferred for day-to-day model naming
- `journal`
  - reserved for a future stage only if the model grows into a fuller
    ledger-style entry system with clearer journal semantics

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
  - `buildAccountingScopedTransactions(...)`

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
     - `buildAccountingScopedTransactions(...)` inside linking
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
- [build-accounting-scoped-transactions.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/build-accounting-scoped-transactions.ts)
- [accounting-scoped-types.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/accounting-scoped-types.ts)
- Pass 1, Pass 2, and Pass 3 findings in this document

### Findings

1. The smallest reusable model is closer to “accounting entries” than to a
   second transaction model.
   The core pressure is not that Exitbook lacks another transaction table.
   It is that one processed movement may need to:
   - pass through unchanged
   - split into multiple accounting-relevant parts
   - or be reduced/retained in a grouped accounting view
     An entry model expresses that directly. A second transaction-row model
     mostly re-encodes today’s problem at a different layer.

2. The leading candidate is:
   - a canonical accounting entry
   - plus exact provenance bindings back to current processed identity

   Minimal sketch:

   ```ts
   type AccountingEntryKind = 'asset_inflow' | 'asset_outflow' | 'fee';

   interface AccountingEntry {
     entryFingerprint: string;
     kind: AccountingEntryKind;
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
   - `entryFingerprint` is the canonical accounting identity
   - `provenanceBindings` preserve exact traceability to processed movements
   - one processed movement may back one or more accounting entries
   - one accounting entry may bind one or more processed movements

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
   The minimal valuable unit is the entry, because:
   - accounting math cares about quantities and roles
   - linking cares about exact transferable quantities
   - provenance comes from bindings
     Starting with entries only is materially simpler than introducing both:
   - accounting document headers
   - accounting entry groups

5. The candidate model can represent the hard cases from earlier passes without
   ad hoc Cardano fields.
   Examples:
   - mixed Cardano target movement:
     - one `asset_inflow` principal entry
     - one `asset_inflow` `staking_reward` entry
     - both bound to the same processed target movement with exact split
       quantities
   - same-hash grouped internal/external case:
     - source-side `asset_outflow` entries with exact retained/external
       quantities
     - one or more `fee` entries with exact provenance bindings
   - simple transfer or reward case:
     - a straight 1:1 entry bound to one processed movement

6. The most important rejected alternative is “promote the existing
   cost-basis scoped transaction layer as the canonical accounting substrate,”
   whether persisted or not.
   That looks tempting because the scoped build already solves some hard same-
   hash cases.
   It is still the wrong minimal model because:
   - it is too cost-basis-shaped
   - it is still transaction-shaped
   - it carries cost-basis-local constructs like `rebuildDependencyTransactionIds`
     and `InternalTransferCarryoverDraft`
   - it does not define a general new accounting identity
   - it would still need new entry-like vocabulary for mixed-scope events,
     which means the entry model would end up reappearing inside a heavier
     transaction wrapper anyway
     The scoped build remains valuable evidence, but it should inform the new
     substrate, not become it unchanged.

### Implications

- The current leading candidate is:
  - generic accounting entries
  - exact provenance bindings
  - no mandatory event-header/group table in the first iteration
- This candidate is promising because it is small and aligned with current
  semantics:
  - movement roles remain useful
  - fee scope/settlement remain useful
  - processed identity remains useful
- A future substrate change should be rejected if it cannot explain why this
  smaller entry model is insufficient.
  That is the current simplicity bar.

### Open Questions From Pass 4

1. How should `entryFingerprint` be derived exactly?
   The leading requirement is:
   - rooted in semantic entry material
   - rooted in sorted provenance bindings
   - deterministic across rebuilds

2. Should provenance bindings require quantities on every row, or can some
   cases use an implicit “full movement” binding?

3. Do fees need their own entry kind, or is a more unified “entry type +
   role” model actually cleaner after deeper review?

4. If linking eventually consumes accounting entries, should entry-level
   link identity replace movement-pair identity, or should links stay anchored
   to provenance movements and use entries only for quantity semantics?

5. Is there any generic hard case that requires an explicit entry-group
   layer in Phase 0, or can that remain deferred safely?

## Pass 5

### Scope

Test whether the current leading candidate:

- generic accounting entries
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
   - carry cost-basis-local artifacts like `InternalTransferCarryoverDraft`
     That work exists because processed rows are not yet the right accounting
     substrate.
     If canonical accounting entries existed, the cost-basis seam could read
     the already-reconstructed accounting quantities directly instead of owning so
     much reconstruction itself.

2. The candidate would simplify portfolio materially if portfolio joins the
   accounting substrate boundary.
   Today portfolio inherits the same mixed-scope problems as cost basis because
   it reads `Transaction[]` and then reuses cost-basis context/workflows.
   A canonical accounting layer would let portfolio read:
   - principal quantities
   - reward quantities
   - fees
     directly, instead of depending on processed-row compensation paths like the
     Cardano residual work.

3. The candidate would simplify issue generation if issue families are split
   honestly.
   The likely result would be:
   - accounting-facing issue families read accounting entries
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
   - keep link identity anchored to provenance movements and use entries for
     quantities only
   - or move link identity fully onto accounting entries
     The first option is less pure, but much lower risk and likely the better
     migration path.

5. Pricing is the least cleanly resolved capability.
   The entry model would help accounting-price requirements because it would
   make “which quantities still need prices for accounting?” much clearer.
   But some current pricing work still looks provenance-side:
   - reading all processed transactions
   - deriving or normalizing movement prices before accounting
     So the likely clean split is:
   - provenance-side price enrichment may still operate on processed rows
   - accounting-side price completeness / readiness should operate on
     accounting entries
     This is not fatal, but it means pricing should not be oversold as fully
     simplified by the substrate change.

6. The candidate does not look like “just another layer” if the boundary is
   enforced strictly.
   It would become unnecessary structure only if:
   - accounting kept reading processed rows in some places
   - entries were added as an optional side path
   - or linking/cost basis kept their current reconstruction logic anyway
     If those mistakes are avoided, the candidate does appear to remove real
     downstream reconstruction burden rather than merely moving it.

7. The main remaining risk is not the model itself. It is migration discipline.
   The model now looks strong enough.
   The harder practical questions are:
   - how to migrate cost basis, portfolio, linking, and issues in a clean order
   - how to keep one canonical accounting reader during the transition
   - how to preserve current exact override behavior while introducing
     entry-level accounting reads

### Implications

- The current leading candidate passes the “extra layer without simplification”
  check conditionally.
- That means Phase 0 should not stop at “interesting idea.”
  It is now reasonable to advance toward a short decision document and a staged
  migration plan.
- The best current migration lean is:
  1. keep processed rows as provenance/audit
  2. introduce canonical accounting entries with exact provenance bindings
  3. migrate accounting readers capability-first
  4. keep pricing split explicit instead of pretending it is all one seam
  5. keep correction/override identity exact from day one

### Open Questions From Pass 5

1. Should linking Phase 1 of any migration keep durable link identity anchored
   to provenance movements while switching quantity semantics to entries?

2. Which capability should migrate first after the substrate is introduced:
   cost basis, portfolio, linking, or issues?

3. Can pricing be split cleanly into:
   - provenance-side enrichment
   - accounting-side completeness / readiness
     without creating a confusing hybrid boundary?

4. Is there any capability not yet reviewed that would still force a dual-truth
   accounting model even if the major seams migrate cleanly?

5. Should Phase 0 now end in a provisional “go” for the entry model, or is
   one more focused migration-sequencing pass needed before that decision is
   honest?

## Pass 6

### Scope

Define the cleanest migration order if Exitbook chooses the current leading
direction:

- generic accounting entries
- exact provenance bindings

This pass is intentionally about sequencing and runtime discipline, not about
adding new substrate theory.

### Evidence Inspected

- Pass 1 through Pass 5 in this document
- [cost-basis-persistence.ts](/Users/joel/Dev/exitbook/packages/accounting/src/ports/cost-basis-persistence.ts)
- [pricing-persistence.ts](/Users/joel/Dev/exitbook/packages/accounting/src/ports/pricing-persistence.ts)
- [linking-ports.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/linking-ports.ts)
- [issues-source-data.ts](/Users/joel/Dev/exitbook/packages/data/src/accounting/issues-source-data.ts)
- [cost-basis-issue-materializer.ts](/Users/joel/Dev/exitbook/packages/accounting/src/issues/cost-basis-issue-materializer.ts)
- [portfolio-handler.ts](/Users/joel/Dev/exitbook/packages/accounting/src/portfolio/portfolio-handler.ts)

### Findings

1. A clean migration needs one new accounting-owned read seam before consumer
   migration starts.
   The likely shape is an accounting-owned reader port for canonical accounting
   entries, rather than every capability building its own entry view from
   raw processed transactions.
   Without that seam, migration would repeat the exact fragmentation Phase 0 is
   trying to remove.

2. Shadow parity is acceptable during migration; mixed shipped runtime truth is
   not.
   There is an important distinction:
   - acceptable:
     - build new substrate in parallel
     - compare outputs in tests or diagnostics
     - switch one capability at a time
   - not acceptable:
     - let one shipped accounting path read processed rows while another shipped
       path reads entries for the same business question without that being a
       deliberate migration phase boundary
       This is the practical version of the no-dual-truth rule.

3. Cost basis is the best first consumer.
   Reasons:
   - it already owns the heaviest reconstruction burden
   - it already has the strongest accounting-owned seam
   - it already proves the mixed-event pressure most clearly
   - it can reuse the current scoped-build test corpus as migration evidence
     This makes cost basis the best place to prove the substrate without first
     tangling with link-identity migration.

4. Linking should migrate second, but with link identity kept movement-anchored
   in the first stage.
   Reasons:
   - linking gains real value from principal-only entry quantities
   - but link identity is currently one of Exitbook’s strongest exactness
     contracts
   - changing both quantity semantics and durable link identity at the same time
     would be unnecessary risk
     So the clean first migration is:
   - link quantities from entries
   - durable link identity still anchored to provenance movements

5. Portfolio should migrate after cost basis and linking.
   Reasons:
   - it depends on both cost-basis context and transfer interpretation
   - it is currently downstream of exactly the ambiguity the new substrate is
     meant to remove
   - moving it before cost basis/linking would force temporary compensating
     logic anyway

6. Issues should migrate after the underlying accounting readers stabilize.
   Reasons:
   - profile issue families are mixed
   - scoped cost-basis issue families are downstream of cost basis
   - issue UX should reflect the stable owning accounting model, not participate
     in substrate experimentation
     So issues are better as a later consumer of the new substrate, not the
     proving ground for it.

7. Pricing should be split explicitly across the migration.
   Current best lean:
   - provenance-side price enrichment remains on processed rows
   - accounting-side price completeness and readiness move with cost basis and
     later accounting consumers
     That avoids pretending pricing is one uniform concern when it is not.

### Implications

- The clean current migration order is:
  1. introduce the accounting-entry reader seam
  2. migrate cost basis first
  3. migrate linking / gap analysis second, with movement-anchored link
     identity preserved initially
  4. migrate portfolio third
  5. migrate issue producers after their owning accounting readers stabilize
- This is now specific enough to support a short decision doc.
- Phase 0 no longer looks blocked on more open-ended discovery. The remaining
  work is decision articulation, not more substrate hunting.

### Open Questions From Pass 6

1. What should the new accounting-owned reader port be called, if Phase 0 ends
   in a “go” decision?

2. Should gap analysis migrate with linking, or immediately after it as a
   separate step?

3. Is there any compelling reason to move portfolio before linking once the
   canonical accounting layer exists?

4. Does any current issue family need to remain explicitly provenance-side even
   after the accounting consumers migrate?

## Pass 7

### Scope

Decide whether the current working language and minimal model:

- canonical accounting layer
- accounting entries
- provenance bindings

leave Exitbook an easy path toward a fuller ledger/journal style later without
doing the conceptual work twice.

### Evidence Inspected

- Pass 4 through Pass 6 in this document
- [movement.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/movement.ts)
- [transaction.ts](/Users/joel/Dev/exitbook/packages/core/src/transaction/transaction.ts)
- local comparison notes from the earlier rotki review

### Findings

1. `Accounting entry` is a better unit name than `accounting component`.
   Reasons:
   - it is easier for accounting-minded readers to reason about
   - it still fits the current minimal model honestly
   - it does not force premature full-ledger semantics

2. `Journal` is still too early for the first clean version.
   Reasons:
   - it implies a fuller accounting model than we are introducing in Phase 0
   - it suggests clearer debit/credit or document/journal semantics than the
     current proposal actually needs
   - using it too early would push design toward the word instead of letting
     the model earn the word

3. The current entry model can evolve into a fuller ledger style later without
   major conceptual churn.
   The clean evolution path would be:
   - first: canonical accounting layer of entries + provenance bindings
   - later, if earned:
     - entry groups / accounting documents
     - stronger journal-style semantics
     - possibly more classical ledger vocabulary
       That is an additive evolution, not a conceptual rewrite.

4. This means we do not need to overbuild now to avoid rework later.
   What matters is getting the first layer right:
   - one canonical accounting read path
   - stable entry identity
   - exact provenance bindings
   - clear override ownership
     If those are right, future journal-style enrichment stays feasible.

### Implications

- The current working vocabulary is strong enough to proceed:
  - `processed transactions`
  - `canonical accounting layer`
  - `accounting entries`
  - `provenance bindings`
- `Journal` should remain reserved language until the model actually gains
  richer ledger semantics.
- Phase 0 does not need more naming debate before the short decision doc.

### Open Questions From Pass 7

1. Should the future canonical spec use `accounting entry` everywhere from day
   one, or allow a short transitional note that older Phase 0 analysis used the
   word `component`?

2. If the layer later gains richer grouping beyond the new transaction view,
   should that concept be called `entry group`, `accounting document`, or
   `journal document`?

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
  - able to justify a larger model only if the minimal accounting-entry model
    fails

Current Phase 0 lean after Pass 5:

- a generic accounting-entry layer with exact provenance bindings now looks
  strong enough to treat as the leading architectural direction
- the remaining uncertainty is mainly migration order and the exact linking /
  pricing boundary, not whether the minimal model is conceptually viable

Current Phase 0 lean after Pass 6:

- the leading direction is:
  - generic accounting entries
  - exact provenance bindings
  - cost basis first as the proving migration
  - linking next, with movement-anchored link identity initially preserved
- any alternative should now have to beat this on both simplicity and
  migration discipline

Current Phase 0 lean after Pass 7:

- the current language is now good enough to standardize
- the model can still evolve later toward fuller ledger/journal semantics if it
  earns that complexity
- that direction is now recorded in:
  - [canonical-accounting-layer-decision.md](/Users/joel/Dev/exitbook/docs/dev/canonical-accounting-layer-decision.md)
- the next step is the canonical spec for the canonical accounting layer, not
  more open-ended terminology analysis

## Pass 9

### Scope

Decide whether the canonical accounting layer needs an explicit
accounting-owned grouped transaction view before more transaction-shaped
consumers can migrate cleanly.

### Evidence Inspected

- [build-accounting-layer-from-transactions.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/build-accounting-layer-from-transactions.ts)
- [lot-fee-utils.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/lots/lot-fee-utils.ts)
- [lot-matcher.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts)
- [canada-tax-event-projection.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-projection.ts)
- [canada-tax-event-stage-shared.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-stage-shared.ts)

### Findings

1. The missing concept was real.
   Transaction-shaped accounting consumers need one accounting-owned grouped
   view with:
   - processed transaction metadata
   - grouped inflow / outflow / fee entries
   - entry fingerprints on those grouped items
   - gross / net quantities and price context preserved per grouped item

2. Bare `entries + processedTransactions` was still too low-level.
   Consumers like lot matching and Canada event projection would otherwise have
   to rebuild transaction grouping and movement context themselves from
   provenance bindings.

3. A grouped transaction view is enough for the current stage without
   overcommitting to fuller journal/document semantics.
   The canonical layer now carries:
   - `accountingTransactionViews`
     This is narrower than a journal/document model and cleaner than keeping
     cost-basis-local scoped transactions as the long-term grouped view.

### Implications

- The canonical accounting layer is no longer just:
  - entries
  - derivation dependencies
  - internal-transfer carryovers
- It now also includes an accounting-owned grouped transaction view.
- The next migration slice should test whether `accountingTransactionViews`
  are enough for the first transaction-shaped consumer migration.

### Open Questions From Pass 9

1. Can transfer-link validation move onto `accountingTransactionViews`
   cleanly before lot matching itself migrates?

2. Does lot matching need any further canonical relation beyond:
   - `accountingTransactionViews`
   - `internalTransferCarryovers`
   - movement-anchored transfer links

Anything weaker should be rejected.

## Pass 10

### Scope

Test whether transfer-link validation can move onto
`accountingTransactionViews` cleanly, while preserving movement-anchored link
identity and without forcing a premature lot-matching migration.

### Evidence Inspected

- [validated-transfer-links.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/validated-transfer-links.ts)
- [validated-scoped-transfer-links.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/validated-scoped-transfer-links.ts)
- [validated-transfer-links.test.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/__tests__/validated-transfer-links.test.ts)
- [validated-scoped-transfer-links.test.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/__tests__/validated-scoped-transfer-links.test.ts)

### Findings

1. Transfer-link validation does move cleanly onto
   `accountingTransactionViews`.
   The validator only needed:
   - grouped inflow / outflow views
   - processed transaction metadata
   - movement-anchored identity
   - diagnostics for the explained-residual exception

2. This is a good canonical-layer seam.
   The validation logic no longer needs to live in a cost-basis-local module.
   A thin scoped adapter is enough for existing transaction-shaped consumers.

3. The next consumer migration should not rebuild the canonical accounting
   layer solely to call the new validator.
   That would harden redundant reconstruction instead of reducing it.

### Implications

- The canonical accounting layer is now strong enough for:
  - price completeness
  - rebuild dependency selection
  - transfer-link validation
- Lot matching and Canada tax projection remain the next real transaction-shaped
  migrations.
- The next migration should happen where the accounting-layer build result is
  already in hand, or should move that build earlier once for the workflow.

### Open Questions From Pass 10

1. Should the next real consumer migration be:
   - standard lot matching
   - Canada ACB workflow input building
   - or transfer-proposal confirmability

2. Does lot matching need any further canonical relation beyond:
   - `accountingTransactionViews`
   - `internalTransferCarryovers`
   - movement-anchored validated transfer links

## Pass 11

### Scope

Assess whether Canada tax input building is the next clean consumer migration
after transfer-link validation, or whether its remaining dependency shape still
needs one more canonical-layer step first.

### Evidence Inspected

- [canada-tax-context-builder.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-context-builder.ts)
- [canada-tax-event-projection.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-projection.ts)
- [canada-tax-event-fee-adjustments.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-fee-adjustments.ts)
- [canada-tax-event-carryover.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-carryover.ts)
- [canada-tax-event-stage-shared.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-stage-shared.ts)

### Findings

1. Canada event projection itself is close to the canonical accounting layer.
   It mainly needs:
   - grouped inflow / outflow transaction views
   - processed transaction metadata
   - movement-anchored validated transfer links

2. Canada fee and carryover handling are the real remaining blockers.
   They still depend on:
   - `InternalTransferCarryoverDraft`
   - source / target transaction-pair fee collection
   - direct scoped movement indexes

3. The canonical layer is not obviously wrong here, but the migration boundary
   is not yet settled.
   `InternalTransferCarryovers` are already more canonical than
   `InternalTransferCarryoverDraft`, but the Canada pipeline still expects a more
   transaction-pair-shaped carryover contract.

### Implications

- Canada tax is not yet a clean “just switch the input type” migration.
- The next good slice is likely one of:
  - enrich the canonical carryover/read seam enough for Canada fee semantics
  - or choose a different consumer migration before Canada

### Open Questions From Pass 11

1. Should the canonical accounting layer gain a carryover resolver/index that
   maps `InternalTransferCarryovers` back to transaction-view and movement-view
   refs?

2. Is Canada still the best next migration, or does lot matching become
   simpler first now that transfer-link validation is canonical?

## Pass 12

### Scope

Decide whether Phase 0 should remain an in-package refactor inside
`@exitbook/accounting`, or whether the cleanliness bar now favors gradual
capability extraction into separate packages as the rewrite proceeds.

### Evidence Inspected

- [architecture-package-contract.md](/Users/joel/Dev/exitbook/docs/architecture/architecture-package-contract.md)
- current `packages/accounting/src` capability layout
- [canonical-accounting-layer-decision.md](/Users/joel/Dev/exitbook/docs/dev/canonical-accounting-layer-decision.md)

### Findings

1. A clean package extraction is allowed by the architecture contract.
   The codebase is already a capability-first modular monolith, so a stronger
   capability boundary may become its own package later without violating the
   architecture.

2. A package split is not automatically cleaner than an in-package refactor.
   Extraction is only justified when a capability can own:
   - a stable responsibility
   - a small public surface
   - clear ports
   - fewer cross-feature backreferences than it has today

3. The current canonical accounting-layer rewrite does not yet force a package
   split.
   The cleanest immediate path is still:
   - one package
   - stronger internal boundaries
   - gradual consumer migration

4. The standing rule should be explicit:
   if a capability boundary becomes real enough, we should extract it instead
   of preserving a muddy package just to avoid refactor churn.

### Implications

- We should not create `accounting-v2` or any parallel migration package.
- We also should not protect the current `@exitbook/accounting` package shape
  if a real capability boundary later deserves extraction.
- The cleanliness test is architectural, not based on rewrite effort.

### Open Questions From Pass 12

1. Does the canonical accounting layer eventually become its own package, or
   does it remain an internal slice inside `@exitbook/accounting` after the
   cost-basis/linking migrations settle?

2. If package extraction happens later, which capability is most likely to earn
   it first:
   - canonical accounting layer
   - cost basis
   - linking

## Pass 13

### Scope

Test whether the canonical accounting layer can provide a shared carryover
resolution seam strong enough to support later Canada and lot-matching
migrations without reintroducing `InternalTransferCarryoverDraft` as a public
consumer contract.

### Evidence Inspected

- [accounting-layer-resolution.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/accounting-layer-resolution.ts)
- [accounting-layer-reader.test.ts](/Users/joel/Dev/exitbook/packages/accounting/src/accounting-layer/__tests__/accounting-layer-reader.test.ts)
- [canada-tax-event-carryover.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-carryover.ts)
- [lot-matcher.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts)

### Findings

1. The canonical carryover model already had enough identity.
   The missing piece was a shared resolver from:
   - `entryFingerprint`
   - `movementFingerprint`
     back to:
   - processed transaction refs
   - accounting transaction-view refs

2. Synthetic carryover source entries are the important special case.
   They are real accounting entries, but their backing source movement does not
   survive inside `accountingTransactionViews`.
   The correct resolution is:
   - source side resolves to processed-transaction movement refs
   - target side resolves to accounting transaction-view refs

3. That split is honest and generic.
   It does not recreate the old scoped-build model.
   It simply acknowledges that the canonical accounting layer still sits on top
   of processed transactions for provenance.

### Implications

- Canada and lot matching no longer need to invent their own carryover
  resolution logic.
- The next migration question is narrower:
  - which consumer should adopt the canonical carryover resolver first
  - not whether the canonical layer is expressive enough in principle

### Open Questions From Pass 13

1. Should Canada be the first consumer to adopt the canonical carryover
   resolver, or is lot matching now the cleaner proving migration?

2. Does the canonical accounting layer need one more shared fee-collection seam
   for transaction-pair fee allocation, or is the current resolver enough?

## Pass 8

### Scope

Assess whether the current canonical accounting-layer build result is already
strong enough to migrate lot matching and scoped cost-basis calculation, or
whether the next migration slice still needs one more explicit model concept.

### Evidence Inspected

- [price-completeness.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/workflow/price-completeness.ts)
- [run-standard-cost-basis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/calculation/run-standard-cost-basis.ts)
- [lot-matcher.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts)
- [validated-scoped-transfer-links.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/validated-scoped-transfer-links.ts)
- [canada-acb-workflow.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/workflow/canada-acb-workflow.ts)
- [canada-tax-context-builder.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-context-builder.ts)
- [canada-tax-event-carryover.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-event-carryover.ts)

### Findings

1. The canonical accounting layer is already strong enough for pricing
   readiness, but not yet for lot matching.
   Price completeness only needed:
   - entry quantities
   - provenance bindings
   - deterministic derivation dependencies
     That migration landed cleanly.

2. Lot matching is still heavily transaction-shaped.
   Current consumers depend on:
   - grouped inflow / outflow / fee collections per scoped transaction
   - movement-anchored confirmed-link validation
   - transaction dependency sorting
   - same-hash carryover target resolution by target movement fingerprint
   - cross-transaction fee collection using source / target transaction pairs

3. The current accounting-layer build result does not yet give one canonical
   way to group entries back into an accounting-owned transaction view.
   If we force lot matching onto bare `entries + processedTransactions`, the
   consumer would have to rebuild that grouping itself from provenance bindings.
   That would reintroduce reader-side reconstruction drift.

4. This is a real model gap, not just implementation inconvenience.
   The missing concept is not “more carryover data.”
   The missing concept is a canonical, accounting-owned grouping/view boundary
   for entry-level consumers that still reason in transaction order.

### Implications

- Price completeness was the right first proving migration.
- The next migration slice should **not** force lot matching directly onto the
  current bare build result.
- The next clean decision is whether the canonical accounting layer now earns:
  - `accounting entry groups`
  - or another narrowly named accounting-owned transaction view
- A cost-basis-local adapter is still possible, but it would carry migration
  smell unless it is treated as a short-lived bridge with explicit boundaries.

### Open Questions From Pass 8

1. Is the right next concept `accounting entry groups`, or is there a narrower
   view that supports lot matching without becoming a premature journal/document
   model?

2. Should validated transfer links keep resolving against movement fingerprints
   only during the next stage, or should they gain an accounting-entry-facing
   validation path before lot matching migrates?

3. Can Canada tax event projection share the same next-layer grouping/view, or
   would it immediately push toward a fuller journal/document model?

## Pass 14

### Scope

Verify whether the canonical accounting layer is now strong enough to replace
the standard lot-matching and standard cost-basis runtime path without
reintroducing scoped transaction math inside the consumer.

### Evidence Inspected

- [lot-matcher.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/matching/lot-matcher.ts)
- [internal-carryover-processing-utils.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/lots/internal-carryover-processing-utils.ts)
- [standard-calculator.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/calculation/standard-calculator.ts)
- [run-standard-cost-basis.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/calculation/run-standard-cost-basis.ts)
- [price-validation.ts](/Users/joel/Dev/exitbook/packages/accounting/src/cost-basis/standard/validation/price-validation.ts)

### Findings

1. The canonical accounting layer is now strong enough for the standard
   cost-basis runtime path.
   The missing pieces from earlier passes are now present:
   - grouped `accountingTransactionViews`
   - canonical validated transfer links
   - canonical internal-transfer carryover resolution

2. The clean migration did not require a matcher-local shadow model.
   Lot matching, carryover processing, and the standard calculator can now read
   the canonical accounting layer directly instead of rebuilding scoped
   transaction semantics inside the consumer.

3. Zero-quantity asset rows were the last real boundary leak.
   Once the canonical accounting layer dropped zero-quantity asset entries
   alongside zero-quantity fees, the runtime path matched the old effective
   behavior without carrying pointless accounting entries forward.

4. The remaining Phase 0 pressure is now narrower.
   The main remaining old-shape seams are:
   - proposal/confirmability paths that still read scoped transactions
   - the public/spec naming debt around `InternalTransferCarryoverDraft`

### Implications

- Phase 0 is past the “can this support a real consumer?” threshold.
- The canonical accounting layer is now the real accounting read path for:
  - pricing completeness
  - Canada tax projection
  - standard lot matching
  - standard cost-basis calculation
- The next cleanup should target the remaining scoped compatibility seams, not
  invent another intermediate accounting model.

### Open Questions From Pass 14

1. Which remaining scoped compatibility seam should migrate next after the
   standard runtime path:
   - transfer proposal confirmability
   - accounting exclusions
   - another smaller transaction-shaped helper

2. When should `InternalTransferCarryoverDraft` finally be renamed at the builder/spec
   boundary so the canonical language stays uniform end-to-end?

## Pass 15

### Scope

Test whether the remaining transfer-proposal confirmability and manual-link
validation seam can move cleanly onto the canonical accounting layer without
keeping `AccountingScopedTransaction[]` alive as a runtime truth for linking.

### Evidence Inspected

- [transfer-proposal-confirmability.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/shared/transfer-proposal-confirmability.ts)
- [strategy-runner.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/matching/strategy-runner.ts)
- [linking-orchestrator.ts](/Users/joel/Dev/exitbook/packages/accounting/src/linking/orchestration/linking-orchestrator.ts)
- [link-confirmation-shared.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/link-confirmation-shared.ts)
- [links-create-grouped-handler.ts](/Users/joel/Dev/exitbook/apps/cli/src/features/links/command/create/links-create-grouped-handler.ts)

### Findings

1. Transfer-proposal confirmability did not need scoped transactions.
   It only needed canonical transfer-validation transaction views.

2. Its old location under `cost-basis/standard/matching` was ownership drift.
   The logic is a linking concern validated against the canonical accounting
   layer.

3. Linking strategy execution can now build the canonical accounting layer once
   and carry those transaction views through confirmability filtering directly.

4. CLI manual link confirmation and proposal review can do the same.
   They no longer need to rebuild cost-basis scoped transactions only to ask a
   confirmability question.

5. This migration also justified a real public capability boundary:
   `@exitbook/accounting/accounting-layer`.
   Keeping canonical accounting-layer builders and validators under the
   `cost-basis` barrel would have preserved the wrong ownership model.

6. The grouped-link persistence path had a real style bug.
   It was throwing inside `executeInTransaction(...)` even though the callback
   already speaks `Result`.
   That was removable immediately with `resultDoAsync(...)`.

### Implications

- The canonical accounting layer is now the real transfer-quantity truth for:
  - cost basis
  - Canada tax input
  - transfer-link validation
  - transfer-proposal confirmability
  - linking strategy execution
  - CLI manual link confirmation/review
- `buildAccountingScopedTransactions(...)` and its draft types now live under
  `accounting-layer/`, so cost basis no longer owns the canonical layer's
  immediate implementation substrate
- `applyAccountingExclusionPolicy(...)`,
  `assertNoScopedAssetsRequireReview(...)`, and `AccountingExclusionPolicy`
  ownership now also live under `accounting-layer/`, so price-enrichment, CLI
  runtimes, and cost-basis consumers no longer need `cost-basis` as a type
  barrel for draft-layer helpers
- The remaining scoped runtime seams are now narrower and more obviously
  compatibility-only.

### Open Questions From Pass 15

1. When should `buildAccountingScopedTransactions(...)` stop being the internal
   implementation substrate beneath `buildAccountingLayerFromTransactions(...)`?
2. Should `AccountingScopedBuildResult` and `AccountingScopedTransaction`
   remain explicit intermediate draft types, or collapse behind a narrower
   internal seam once more consumers migrate?
