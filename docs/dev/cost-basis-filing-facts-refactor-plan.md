# Cost Basis Filing Facts Refactor Plan

Status: active plan

This note defines the refactor needed before we expand the US tax-package work
or keep layering more display behavior onto the current cost-basis command.

The goal is to keep the Canada boundary as the template:

- emit tax facts we actually know
- emit audit context and readiness issues
- avoid guessed downstream filing placement
- let accountants or tax software handle return-prep workflows

This plan covers both:

- the filing export path
- the regular `cost-basis` CLI display path

This superseeds the work done in:

- `docs/dev/cost-basis-tax-package.md`

## Boundary To Keep

The accounting domain should produce filing facts.
It should not become tax return software.

That means the domain should own:

- acquisition, disposition, and transfer facts
- jurisdiction-specific tax treatment facts
- per-asset and cross-asset filing summaries
- readiness and review issues
- deterministic fact identifiers already present in the workflow

The domain should not own:

- guessed Form 8949 placement when source facts do not support it
- software-vendor import quirks as core package fields
- package-local row refs such as `DISP-0001` or `LOT-0001`
- tax return interview logic
- e-file packaging or downstream return assembly

Canada already mostly stays on the correct side of this line.
The US path should converge on the same boundary.

## Why This Refactor Is Needed

Today we have the right raw ingredients, but the seam is split across two
different consumers:

1. Export builders derive filing rows inside `packages/accounting/src/cost-basis/export/`.
2. CLI display derives summary and timeline rows inside:
   - `apps/cli/src/features/cost-basis/command/cost-basis.ts`
   - `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts`

This creates three risks:

1. The US export path can drift into downstream filing assertions that are not
   backed by workflow facts.
2. The CLI display path can duplicate tax interpretation logic that should stay
   in accounting.
3. Canada and US can diverge structurally even when they should share the same
   "facts first, presentation later" boundary.

### Live Bug That Proves The Boundary

We already have a bug caused by independent re-derivation:

- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts` treats
  `holdingPeriodDays > 365` as long-term
- `packages/accounting/src/cost-basis/jurisdictions/us/rules.ts` treats
  `holdingPeriodDays >= 365` as long-term

That means a 365-day disposal can show as short-term in the CLI while the
domain and export path treat it as long-term.

Both are also wrong at a deeper level: the U.S. long-term rule is
"more than one year" using calendar dates, not a fixed day-count
threshold. A 365-day holding period that spans a leap year is not the
same as one that does not. The domain rule should use calendar-date
comparison (see "Canonical Tax Treatment Normalization" below), and the
filing-facts layer should eliminate the re-derivation class of bug by
making both consumers read one canonical tax-treatment result.

### No New Workflow Prerequisite

There is no new workflow prerequisite for this refactor.

The standard workflow result already carries the raw ingredients needed for a
shared filing-facts builder, including:

- `holdingPeriodDays`
- `taxTreatmentCategory`
- `lossDisallowed`
- `disallowedLossAmount`
- `grossProceeds`
- `sellingExpenses`
- `netProceeds`
- `totalCostBasis`
- `gainLoss`
- `lotId`
- `disposalTransactionId`

`AcquisitionLot` and `LotTransfer` similarly already carry the inputs needed for
fact construction.

Canada already has a similar shape through `CanadaTaxReport`.

The problem is not missing workflow facts.
The problem is that export and CLI consumers derive from those facts
independently.

## Decision

Introduce one shared filing-facts layer inside accounting and make both export
and CLI presentation read from it.

The shared layer should:

- start from `CostBasisWorkflowResult`
- produce fact-level rows and summaries
- stay independent from CSV column names, markdown wording, and TUI widgets
- stay independent from source-label resolution unless a consumer explicitly
  needs labels

The export path and CLI path should become thin adapters:

- export adapter: filing facts -> package files
- CLI adapter: filing facts -> `CostBasisPresentationModel`
- source-context adapter: transaction/account/link labels when a consumer
  actually needs them

## Canada And US Responsibilities

### Canada

Canada already mostly follows the intended boundary.
It emits facts such as:

- proceeds
- ACB
- gain/loss
- taxable gain/loss
- superficial-loss effects
- transfer carryover values

Do not add Canada-only downstream tax-software fields just to mirror the US.

### US

The US path should emit facts such as:

- `tax_treatment`
- `date_acquired`
- `date_disposed`
- `holding_period_days`
- `proceeds_gross`
- `selling_expenses`
- `net_proceeds`
- `cost_basis`
- `gain_loss`
- lot linkage

The US core package should stop guessing downstream filing-placement fields that
the workflow artifact does not yet support reliably.

That means the refactor should remove or demote from the core package contract:

- `form_8949_box`
- `form_8949_adjustment_code`
- `form_8949_adjustment_amount`
- generic ordinary-crypto wash-sale assumptions in the US export path

If we later support software-specific imports that require extra placement
fields, those should be edge adapters built on top of the shared facts layer.

## Facts Versus Adapter Responsibilities

### What Moves Into The Shared Facts Layer

The shared facts layer should own:

- per-asset grouping
- per-asset totals
- cross-asset totals
- short-term/long-term asset summaries
- canonical tax-treatment normalization
- taxable gain/loss facts
- holding-period summary stats

These are currently split across export helpers and CLI display code.

### What Stays In Adapters

The shared facts layer should not own:

- `form_8949_box`
- `form_8949_adjustment_code`
- `form_8949_adjustment_amount`
- `disposition_group`
- package-local row refs such as `DISP-0001`
- account labels resolved from account ids
- source URLs or source-link file layout

These remain export-only or software-only concerns built on top of the shared
facts.

## Target End State

The target flow should look like this:

1. The export host calls `CostBasisHandler.executeArtifactWithContext(...)`
   because package rendering needs source labels and source-link tracing.
2. The regular `cost-basis` host uses the lightest artifact path that satisfies
   its display needs.
3. Accounting builds one shared `CostBasisFilingFacts` result from:
   - `CostBasisWorkflowResult`
   - optional artifact metadata such as `scopeKey` or `snapshotId`
4. Export builders map those facts plus source context into package files.
5. CLI display builders map those facts into `CostBasisPresentationModel`.
6. Optional software adapters map those facts into vendor-specific import
   formats outside the core package contract.

The important seam is step 3.

## Proposed Shape

These names are suggestions.
The exact names can change, but the layering should not.

### Shared Filing Facts Types

Create a dedicated domain module, likely under:

- `packages/accounting/src/cost-basis/filing-facts/`

Recommended files:

- `packages/accounting/src/cost-basis/filing-facts/filing-facts-types.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/standard-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/canada-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-summary-builder.ts`

Candidate top-level shape:

```ts
export interface CostBasisFilingFacts {
  context: {
    calculationId: string;
    jurisdiction: string;
    method: string;
    taxYear: number;
    taxCurrency: string;
    scopeKey?: string | undefined;
    snapshotId?: string | undefined;
  };
  assets: readonly FilingAssetSummary[];
  acquisitions: readonly FilingAcquisitionFact[];
  dispositions: readonly FilingDispositionFact[];
  transfers: readonly FilingTransferFact[];
}

export interface FilingAssetSummary {
  asset: string;
  assetId?: string | undefined;
  disposalCount: number;
  lotCount: number;
  transferCount: number;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  shortTermGainLoss?: Decimal | undefined;
  shortTermCount?: number | undefined;
  longTermGainLoss?: Decimal | undefined;
  longTermCount?: number | undefined;
  holdingPeriodStats?:
    | {
        avg: number;
        min: number;
        max: number;
      }
    | undefined;
}
```

The facts should be domain facts, not export columns.

### Shared Builder Signature

Candidate function:

```ts
export function buildCostBasisFilingFacts(input: {
  artifact: CostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}): Result<CostBasisFilingFacts, Error>;
```

This keeps source-context loading out of the core builder.
The CLI can build filing facts without loading source context.
The export adapter can still load source context when it needs labels or
traceability.

### Canonical Tax Treatment Normalization

The filing-facts module should own one canonical normalization function for
standard-workflow tax treatment.

Requirements:

1. Use `taxTreatmentCategory` when it is already present and valid.
2. Fall back to the jurisdiction rule when older stored artifacts do not carry
   the field.
3. Match jurisdiction rules exactly for the fallback case.

For the current US path, that means the fallback must use calendar-date
comparison, not a fixed day-count threshold:

```ts
// "More than one year" is calendar-based per IRS rules.
// The disposal date must be strictly after the one-year anniversary of
// the acquisition date. A fixed 365-day threshold is wrong because it
// does not account for leap years.
const anniversary = new Date(acquisitionDate);
anniversary.setFullYear(anniversary.getFullYear() + 1);
return disposalDate > anniversary ? 'long_term' : 'short_term';
```

This requires changing `classifyGain` to accept acquisition and disposal
dates rather than a day count. `holdingPeriodDays` remains a useful
display value but must not be used for classification.

This logic should move out of export-specific helpers and should not be
duplicated in the CLI display path.

### Facts Should Carry IDs, Not Labels

When account or transaction identity needs to survive into the facts layer, keep
ids, not resolved strings.

Examples:

- `acquisitionTransactionId`
- `disposalTransactionId`
- `acquisitionAccountId`
- `disposalAccountId`
- `sourceAccountId`
- `targetAccountId`

The export adapter resolves labels from source context.
The CLI adapter can ignore them unless the TUI later needs labels.

### Naming Cleanup To Do During The Refactor

Current names that will become misleading if this layer is shared beyond export:

- `TaxPackageBuildContext`
- `TaxPackageRowFact`
- `StandardDispositionExportFact`
- `StandardTransferExportFact`

Recommended direction:

- `CostBasisFilingContext`
- `CostBasisFilingFact`
- `LotMatchedDispositionFact`
- `LotCarryoverTransferFact`

We should avoid keeping export-only names for a layer that feeds both export and
CLI display.

## Detailed Work Plan

### Phase 1. Extract A Shared Filing-Facts Layer

Goal:

- move fact derivation into accounting
- make the module shared by export and CLI
- keep behavior unchanged where possible

Files to add:

- `packages/accounting/src/cost-basis/filing-facts/filing-facts-types.ts`
- `packages/accounting/src/cost-basis/filing-facts/filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/standard-filing-facts-builder.ts`
- `packages/accounting/src/cost-basis/filing-facts/canada-filing-facts-builder.ts`

Files to update:

- `packages/accounting/src/cost-basis/export/tax-package-row-facts.ts`
- `packages/accounting/src/index.ts`

Step order:

1. Move the fact interfaces out of export-specific naming.
2. Split row-fact creation into:
   - standard lot-matched facts
   - Canada pooled facts
3. Build per-asset summary facts in accounting rather than in the CLI.
4. Add canonical tax-treatment normalization in the shared facts module.
5. Export the new builder from `packages/accounting/src/index.ts`.

Pseudo-code:

```ts
export function buildCostBasisFilingFacts(input: BuildCostBasisFilingFactsInput) {
  if (input.artifact.kind === 'standard-workflow') {
    return buildStandardFilingFacts(input);
  }

  return buildCanadaFilingFacts(input);
}
```

Acceptance criteria:

- per-asset totals come from the shared facts layer
- short-term/long-term asset summaries come from canonical `taxTreatment`
  normalization, not ad hoc CLI thresholds
- no new workflow fields are required for the refactor
- existing tests still pass after adapter rewiring

### Phase 2. Rewire Tax-Package Export To Consume Shared Facts

Goal:

- keep package rendering in `cost-basis/export`
- remove speculative US contract fields
- keep Canada output behavior aligned with the current fact-based package

Files to update:

- `packages/accounting/src/cost-basis/export/tax-package-exporter.ts`
- `packages/accounting/src/cost-basis/export/canada-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-renderers.ts`
- `packages/accounting/src/cost-basis/export/tax-package-types.ts`
- `docs/dev/cost-basis-tax-package.md`

Step order:

1. Change export builders to accept shared filing facts instead of rebuilding
   row facts locally.
2. Keep `tax_treatment`, lot refs, dates, and money columns in the US package.
3. Keep source/account label resolution in the export adapter layer using
   `sourceContext`; do not move label strings into filing facts.
4. Keep package-local refs and export grouping in the export adapter layer.
5. Remove `form_8949_box` and `form_8949_adjustment_*` from the core package
   contract.
6. Remove ordinary-crypto wash-sale assumptions from the US export path.
7. Update package report copy so it says what the package is:
   a fact package for preparer input, not direct tax-return assembly.

Pseudo-code:

```ts
const filingFacts = buildCostBasisFilingFacts({
  artifact: context.workflowResult,
  scopeKey: context.artifactRef.scopeKey,
  snapshotId: context.artifactRef.snapshotId,
});

switch (jurisdiction) {
  case 'CA':
    return buildCanadaTaxPackageFromFacts(filingFacts, readiness, sourceContext);
  case 'US':
    return buildUsTaxPackageFromFacts(filingFacts, readiness, sourceContext);
}
```

Acceptance criteria:

- Canada package still emits the same core facts
- US package emits only supported facts
- no US export field implies downstream form placement without explicit source
  support
- account labels and source-link rows are still deterministic

### Phase 3. Rewire The Regular CLI Display To Consume Shared Facts

Goal:

- keep the TUI and JSON shapes stable where practical
- remove tax derivation logic from the CLI
- make export and display read from the same domain facts

Files to update:

- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-state.ts`

Step order:

1. Build shared filing facts once in the command layer from the workflow
   artifact.
2. Replace `buildPresentationModel(costBasisResult)` with something like:

```ts
const filingFacts = buildCostBasisFilingFacts({ artifact: costBasisResult });
const presentation = buildPresentationModelFromFilingFacts(filingFacts);
```

3. Keep `cost-basis-view-utils.ts` focused on:
   - formatting
   - sorting
   - TUI item mapping
4. Remove duplicated domain logic such as:
   - jurisdiction-based taxable-gain recalculation
   - short-term/long-term recomputation from raw workflow rows
   - cross-asset summary recomputation from view items
5. Keep `sourceContext` optional for CLI display. If the TUI later needs labels,
   resolve them in the CLI adapter rather than by making the filing-facts layer
   depend on source-context loading.

Acceptance criteria:

- CLI display and export show the same totals for the same calculation
- the CLI does not need separate US and Canada tax-logic branches for core facts
- the CLI does not re-classify US long-term vs short-term from
  `holdingPeriodDays > 365`
- presentation helpers contain formatting logic, not tax rules

### Phase 4. Add An Adapter Slot For Downstream Tax Software Formats

Goal:

- keep future software-import work possible
- keep it out of the core package contract

Files to add later if needed:

- `packages/accounting/src/cost-basis/export/software-adapters/`
- `packages/accounting/src/cost-basis/export/software-adapters/<vendor>-adapter.ts`

Rules:

- software adapters consume shared filing facts
- software adapters may add vendor-required columns
- software adapters must not redefine the core accounting facts
- software adapters may remain unsupported until explicit source facts exist

This phase is intentionally not required for the first refactor.

## Testing Plan

Add or update tests in these areas:

- `packages/accounting/src/cost-basis/filing-facts/__tests__/`
- `packages/accounting/src/cost-basis/export/__tests__/`
- `apps/cli/src/features/cost-basis/view/cost-basis-view-utils.test.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis-export.test.ts`

Required assertions:

- Canada and US asset totals match between export facts and CLI display
- US export no longer emits guessed 8949 fields
- the canonical tax-treatment fallback treats 365 days as long-term for US
- older stored artifacts without `taxTreatmentCategory` still normalize
  correctly
- Canada output remains fact-first and unchanged in intent
- blocked/review/ready behavior still works after the refactor
- source/account labels remain deterministic in export adapters

## Recommended PR Breakdown

### PR 1

Shared filing-facts extraction.

Scope:

- new accounting module
- rename or replace export-scoped fact interfaces
- canonical tax-treatment normalization
- tests for fact builders

### PR 2

Export package migration.

Scope:

- export builders consume filing facts
- US contract cleanup
- docs update

### PR 3

CLI display migration.

Scope:

- `cost-basis` command uses shared filing facts
- presentation model builder rewrite
- view tests update

### PR 4

Optional software-adapter groundwork.

Scope:

- only if a real accountant-import target is chosen
- keep adapters separate from the core package contract

## Decisions To Preserve

- Canada remains the reference boundary for "facts, not return-prep logic".
- Export and CLI should share one accounting-owned facts seam.
- The core package contract should not guess downstream filing placement.
- Source-context loading should remain adapter-level, not a hard dependency of
  the filing-facts builder.
- Software-specific import support belongs at the edge, not in the core.
