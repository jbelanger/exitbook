# Cost Basis Filing Facts Refactor Plan

Status: active plan

This note replaces `docs/dev/cost-basis-tax-package.md` as the design center
for this refactor.

## Intent

The goal is simple:

- keep the Canada boundary as the model
- make the US path follow the same boundary
- make both the export path and the regular `cost-basis` CLI display path read
  from one accounting-owned facts seam

This is not a plan to turn Exitbook into tax software.

We should own:

- tax facts we actually know
- auditability and source traceability
- readiness and review issues
- a clean accountant-facing package

We should not own:

- guessed downstream filing placement
- tax-return interview logic
- vendor-specific tax-software behavior in core types
- e-file or return assembly behavior

Canada already mostly behaves this way.
The US path is where drift has started.

## Problem Statement

Today the codebase has the right raw ingredients, but the facts seam is split.

Export path:

- `packages/accounting/src/cost-basis/export/canada-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-renderers.ts`

CLI display path:

- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts`

That split is causing two kinds of drift:

1. The US export path is asserting filing-specific output that the current
   artifact does not support safely.
2. The CLI path is recomputing tax/display facts that should come from
   accounting.

## What Is Good Already

Canada is mostly on the right side of the boundary.

The Canada path already emits upstream tax facts such as:

- acquisitions
- dispositions
- transfers
- ACB
- gain/loss
- taxable gain/loss
- superficial-loss effects
- summary totals
- source/audit context

Canada does not depend on a downstream per-row form-bucket concept analogous to
U.S. Form 8949 boxes.

That is the shape we want to preserve.

## What Has Drifted In The US Path

The US path has legitimate jurisdiction-specific needs, but the current code is
too eager about downstream filing placement.

Examples of current drift:

- guessed `form_8949_box`
- `form_8949_adjustment_*` fields treated as core package facts
- generic crypto wash-sale assumptions in the export path
- CLI recomputation of long-term vs short-term and taxable totals

The issue is not that the US is more detailed than Canada.
The issue is that the current US renderer is making claims that are not cleanly
represented in the upstream artifact model.

The safer direction is:

- keep U.S. tax facts we actually know
- emit review/readiness issues when a filing-specific classification is missing
- stop guessing downstream placement in the core package contract

## Boundary To Preserve

The accounting domain should produce filing facts.
Adapters should render those facts for export and CLI.

Accounting-owned facts should include:

- acquisition facts
- disposition facts
- transfer facts
- per-asset totals
- cross-asset totals
- jurisdiction-specific tax-treatment facts
- readiness/review signals through accounting-owned evaluators

Adapters may add:

- CSV column names
- markdown report wording
- package-local row refs such as `DISP-0001`
- account labels and source URLs from source context
- software-specific mappings at the edge

Adapters must not invent:

- unsupported 8949 box placement
- unsupported adjustment codes
- ordinary-crypto wash-sale treatment where the artifact model does not justify
  it

## Target End State

Both output paths should read from one seam:

1. `CostBasisHandler.execute(...)` returns a workflow artifact for normal CLI
   display.
2. `CostBasisHandler.executeArtifactWithContext(...)` returns the same artifact
   plus source context for export.
3. Accounting builds one shared filing-facts result from
   `CostBasisWorkflowResult`.
4. Export builders map filing facts plus readiness plus source context into the
   package files.
5. CLI display builders map the same filing facts into
   `CostBasisPresentationModel`.

The important change is step 3.

## Proposed Seam

Add a shared facts module under:

- `packages/accounting/src/cost-basis/filing-facts/`

Suggested files:

- `packages/accounting/src/cost-basis/filing-facts/filing-facts-types.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/standard-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/canada-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-summary-builder.ts`

Suggested entrypoint:

```ts
export function buildCostBasisFilingFacts(input: {
  artifact: CostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}): Result<CostBasisFilingFacts, Error>;
```

This builder should:

- start from `CostBasisWorkflowResult`
- stay independent from source-label resolution
- stay independent from CSV column names
- stay independent from CLI-specific formatting

### Minimum Facts The Shared Layer Must Cover

For standard workflow artifacts, the shared facts should cover at least:

- asset identity
- acquisition date
- disposal date
- transaction ids
- lot linkage
- proceeds
- selling expenses
- net proceeds
- cost basis
- gain/loss
- taxable gain/loss
- holding-period information
- tax-treatment classification
- transfer linkage and carryover basis

For Canada workflow artifacts, the shared facts should cover at least:

- tax property grouping
- acquisition facts
- disposition facts
- transfer facts
- ACB facts
- gain/loss facts
- taxable gain/loss facts
- superficial-loss effects already present in the tax report

This note intentionally does not fully freeze every field name up front.
The important requirement is one shared accounting seam, not a speculative type
explosion in the plan doc.

### Currency Rule

The filing-facts layer should be canonical in tax currency.

That means:

- standard workflow facts use the workflow artifact monetary values
- Canada workflow facts use the tax-report monetary values
- export consumes those facts directly
- CLI may optionally join the existing converted display overlays from:
  - `CostBasisReport`
  - `CanadaDisplayCostBasisReport`

Display-currency conversion is an adapter concern, not a responsibility of the
core filing-facts builder.

## The One Domain Fix Included In This Refactor

This refactor also includes one correctness fix:

- U.S. holding-period classification should be canonicalized once in accounting
- CLI and export should both read that result

Today the code re-derives this differently:

- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts`
- `packages/accounting/src/cost-basis/jurisdictions/us/rules.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-renderers.ts`

The desired rule is calendar-date based, not a hardcoded day threshold.

Implementation detail:

- if the cleanest fix is to change `IJurisdictionRules` / `USRules`, do that
- if the cleaner short-term fix is to normalize only inside the filing-facts
  builder, do that first

The important part is one canonical result, not where the exact helper lives.

## Relationship To Existing Export Types

`packages/accounting/src/cost-basis/export/tax-package-row-facts.ts` should not
become the permanent shared seam.

Target end state:

- export builders consume `CostBasisFilingFacts`
- export renderers map filing facts to CSV rows
- export-only grouping fields and package-local refs remain export-local

During migration, `tax-package-row-facts.ts` may either:

- become a temporary export-local shim, or
- be deleted once export builders consume filing facts directly

What we should avoid is creating two durable shared fact models.

## Work Plan

### Phase 1. Build The Shared Filing-Facts Seam

Goal:

- move fact derivation into accounting
- keep the seam shared by export and CLI
- keep behavior unchanged where possible outside the U.S. classification fix

Files to add:

- `packages/accounting/src/cost-basis/filing-facts/filing-facts-types.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/standard-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/canada-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-summary-builder.ts`

Files to update:

- `packages/accounting/src/index.ts`
- `packages/accounting/src/cost-basis/export/tax-package-row-facts.ts`
- `packages/accounting/src/cost-basis/jurisdictions/us/rules.ts`
- `packages/accounting/src/cost-basis/jurisdictions/jurisdiction-rules.ts`
- `packages/accounting/src/cost-basis/standard/calculation/gain-loss-utils.ts`

Step order:

1. Add `buildCostBasisFilingFacts(...)` and the shared types.
2. Build standard facts from:
   - `summary`
   - `lots`
   - `disposals`
   - `lotTransfers`
3. Build Canada facts from:
   - `calculation`
   - `taxReport`
4. Build shared per-asset and cross-asset summaries in accounting.
5. Canonicalize U.S. tax-treatment normalization once in accounting.
6. Export the new builder from `packages/accounting/src/index.ts`.

Acceptance criteria:

- per-asset totals come from the shared facts layer
- Canada and standard workflow artifacts both map into one shared seam
- no new workflow fields are required for the first pass
- export and CLI can both consume the result

### Phase 2. Rewire The Export Path

Goal:

- keep package rendering in `cost-basis/export`
- remove speculative U.S. contract fields from the core package boundary
- leave Canada substantively unchanged

Files to update:

- `packages/accounting/src/cost-basis/export/tax-package-exporter.ts`
- `packages/accounting/src/cost-basis/export/canada-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-renderers.ts`
- `packages/accounting/src/cost-basis/export/tax-package-types.ts`
- `docs/dev/cost-basis-tax-package.md`

Step order:

1. Build filing facts before package rendering.
2. Change the jurisdiction builders to consume filing facts instead of
   rebuilding core row facts locally.
3. Keep source/account label resolution in the export adapter layer.
4. Keep package-local refs and grouping in the export adapter layer.
5. Remove or demote from the core U.S. package contract:
   - `form_8949_box`
   - `form_8949_adjustment_code`
   - `form_8949_adjustment_amount`
6. Remove generic ordinary-crypto wash-sale assumptions from the U.S. export
   path.
7. Keep the package framed as filing support for a preparer, not direct
   return-prep software.

Acceptance criteria:

- Canada package still emits the same kind of facts it emits today
- U.S. package emits supported facts, not guessed downstream placement
- source-link and account-label behavior remains deterministic

### Phase 3. Rewire The CLI Display Path

Goal:

- remove tax derivation logic from the CLI
- make CLI and export read the same accounting facts
- keep the existing TUI/JSON shapes stable where practical

Files to update:

- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-state.ts`

Step order:

1. Build shared filing facts once in `buildPresentationModel(...)`.
2. Replace direct aggregation from raw workflow rows with mapping from filing
   facts.
3. Keep `cost-basis-view-utils.ts` focused on:
   - formatting
   - sorting
   - view-model mapping
4. Remove duplicated domain logic from the CLI, especially:
   - `buildAssetCostBasisItems(...)` summary derivation
   - `buildCanadaAssetCostBasisItems(...)` summary derivation
   - `computeTaxableAmount(...)`
   - `computeSummaryTotals(...)`
   - ad hoc U.S. long-term vs short-term recomputation
5. Keep display-currency overlay behavior in the CLI adapter only.

Acceptance criteria:

- CLI and export agree on the same underlying fact totals in tax currency
- the CLI no longer owns tax-logic branches for core facts
- the Canada CLI path also reads shared facts rather than re-aggregating from
  `CanadaTaxReport`
- presentation helpers contain formatting logic, not tax rules

### Phase 4. Optional Software Adapters

Only do this if we later choose a real target.

Possible path:

- `packages/accounting/src/cost-basis/export/software-adapters/`

Rules:

- software adapters consume filing facts
- software adapters stay out of the core package contract
- unsupported filing-specific fields should stay absent or review-required until
  we actually model the needed facts

## Testing Plan

Add or update tests in:

- `packages/accounting/src/cost-basis/filing-facts/__tests__/`
- `packages/accounting/src/cost-basis/export/__tests__/`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.test.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis-export.test.ts`

Required assertions:

- Canada and U.S. asset totals match between filing facts and CLI presentation
  when compared in the same currency
- export and CLI read the same canonical U.S. tax-treatment result
- the U.S. path no longer emits guessed 8949 placement as a core fact
- the U.S. path no longer applies generic ordinary-crypto wash-sale behavior
- older stored artifacts without `taxTreatmentCategory` still normalize
  correctly
- Canada output remains fact-first and unchanged in intent
- display-currency CLI rendering still matches the existing converted reports
  when a display overlay is present

## PR Breakdown

### PR 1

Shared filing-facts seam.

Scope:

- new accounting module
- canonical U.S. tax-treatment normalization
- tests for fact builders

### PR 2

Export migration.

Scope:

- export builders consume filing facts
- U.S. contract cleanup
- docs update

### PR 3

CLI migration.

Scope:

- `cost-basis` command uses filing facts
- presentation model rewrite
- view tests update

### PR 4

Optional software-adapter groundwork.

Only if a real import/export target is selected.

## Decisions To Preserve

- Canada remains the reference boundary for facts, not return-prep logic.
- U.S. should move toward the Canada boundary, not away from it.
- Export and CLI should share one accounting-owned facts seam.
- Source-context loading remains adapter-level.
- Software-specific behavior belongs at the edge, not in the core model.
