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

Anything weaker should be rejected.
