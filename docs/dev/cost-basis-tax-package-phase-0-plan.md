# Cost Basis Tax Package Phase 0 Plan

Status: active plan

This note defines the pre-export refactor we should do before implementing
`cost-basis export --format tax-package`.

The goal is not to build the tax package in this phase.
The goal is to fix the execution seam so the tax-package work does not have to:

- overstuff the normal cost-basis snapshot with export-only fields
- re-run tax logic in a second branch
- depend on `displayReport` for data it was never designed to preserve
- rejoin ad hoc against transactions/accounts/links in every exporter helper

Related notes:

- `docs/dev/cost-basis-tax-package.md`
- `docs/dev/cost-basis-structure-refactor-plan.md`

## Problem To Solve

The current cost-basis artifact is optimized for:

- standard cost-basis viewing
- Canada display reporting
- snapshot reuse for the normal `cost-basis` command

It is not optimized for filing-package export.

Concrete problems:

1. The standard artifact keeps net disposal proceeds, but not the explicit
   gross/expense/net breakdown the tax package contract expects.
2. The workflow artifact keeps enough IDs to rejoin source transactions, but
   not enough source context to make export assembly clean and local.
3. Canada workflow result includes `inputContext`, but snapshot persistence
   drops it. The stored Canada artifact keeps `taxReport` and `displayReport`,
   not the richer event/input layer that explains how those rows were built.
4. `displayReport` is a presentation model for the current chosen display
   currency. It is useful, but it is not the right primary substrate for
   tax-package export.

## Decision

Do a dedicated Phase 0 first.

Use a separate export branch off the shared cost-basis workflow, not a separate
tax engine and not a bloated general-purpose artifact.

That means:

- keep one shared workflow for tax math
- branch into export-specific assembly after tax facts are known
- persist export-specific context only for export snapshots
- keep `displayReport` as an optional presentation artifact, not export truth

## Decision Details

### 1. Do not make the main snapshot carry every tax-package field

The normal `cost-basis` snapshot should stay optimized for the existing command.

Do not add:

- freeform preparer notes
- every package-local ref
- every source-link row
- every account label string
- every export-only enum

to the shared standard and Canada stored artifacts.

### 2. Do not build a second tax engine for export

The export path must not recompute cost basis separately from the main workflow.

The shared workflow remains the source of truth for:

- lot matching
- transfer carryover handling
- jurisdiction tax treatment
- Canada superficial-loss calculations

### 3. Introduce an export-oriented intermediate model

Add a dedicated intermediate model between workflow execution and file rendering.

This model should preserve:

- row-level tax facts
- source rejoin keys
- account/source context needed for labels
- audit facts needed by the package contract

without becoming a final CSV model.

### 4. Keep Canada `displayReport`, but demote it

`displayReport` is still useful for:

- current CLI/view reuse
- cached display-currency totals
- human-facing exploratory output

It is not sufficient as the primary export substrate because it is:

- derived from `taxReport`
- tied to one display currency
- missing the richer Canada event/input context

## Target End State

The export path should look like this:

1. host validates export request
2. host asks artifact service for a shared workflow result
3. export branch builds a `TaxPackageBuildContext`
4. jurisdiction package builder renders files from that context
5. export snapshot persistence stores export-specific context if we choose to
   cache tax-package builds

The important seam is step 3.

## New Shapes To Introduce

These names are suggestions.
The exact names can change, but the shape separation should not.

### Shared Export Input

File:

- `packages/accounting/src/cost-basis/export/tax-package-build-context.ts`

Candidate top-level shape:

```ts
export interface TaxPackageBuildContext {
  artifactRef: {
    calculationId: string;
    scopeKey: string;
    snapshotId?: string | undefined;
  };
  workflowResult: CostBasisWorkflowResult;
  sourceContext: TaxPackageSourceContext;
}

export interface TaxPackageSourceContext {
  transactionsById: Map<number, UniversalTransactionData>;
  accountsById: Map<number, Account>;
  confirmedLinksById: Map<number, TransactionLink>;
}
```

This is not a rendered package model.
It is the minimum stable seam for package assembly.

### Export-Oriented Row Facts

File:

- `packages/accounting/src/cost-basis/export/tax-package-row-facts.ts`

Purpose:

- define pure intermediate row shapes that are richer than final CSV columns
- preserve facts the package needs before jurisdiction builders flatten them

Examples:

- `StandardDispositionExportFact`
- `StandardTransferExportFact`
- `CanadaDispositionExportFact`
- `CanadaTransferExportFact`

Each fact should include:

- tax facts
- source transaction ids
- source/target account ids when relevant
- raw fee/gross/net breakdown where applicable
- grouping keys for deterministic package-local refs

Do not put final CSV headings in these types.

## Required Port Changes

### Widen the Cost-Basis Context Port

Current file:

- `packages/accounting/src/ports/cost-basis-persistence.ts`

Current problem:

- `ICostBasisContextReader.loadCostBasisContext()` returns only transactions and
  confirmed links

Phase 0 change:

- add accounts to `CostBasisContext`

Target shape:

```ts
export interface CostBasisContext {
  transactions: UniversalTransactionData[];
  confirmedLinks: TransactionLink[];
  accounts: Account[];
}
```

Implementation update:

- `packages/data/src/adapters/cost-basis-ports-adapter.ts`

Pseudo-code:

```ts
const transactions = yield * (await db.transactions.findAll());
const confirmedLinks = yield * (await db.transactionLinks.findAll('confirmed'));
const accounts = yield * (await db.accounts.findAll());

return { transactions, confirmedLinks, accounts };
```

Reason:

- tax-package export needs account/source labeling and clean source-link
  assembly
- this is cleaner than making exporter code query repositories directly

## Standard Workflow Changes

### Preserve Disposal Proceeds Breakdown

Current files:

- `packages/accounting/src/cost-basis/model/schemas.ts`
- `packages/accounting/src/cost-basis/standard/lots/lot-disposal-utils.ts`
- `packages/accounting/src/cost-basis/standard/calculation/gain-loss-utils.ts`

Current problem:

- the standard disposal row stores net proceeds, but not explicit
  `gross_proceeds` and `selling_expenses`

Phase 0 change:

- extend `LotDisposalSchema`
- compute and persist gross/expense/net facts at disposal creation time

Suggested fields:

```ts
grossProceeds: DecimalSchema,
sellingExpenses: DecimalSchema,
netProceeds: DecimalSchema,
lossDisallowed: z.boolean().optional(),
disallowedLossAmount: DecimalSchema.optional(),
```

Detailed edit:

1. In `calculateNetProceeds(...)`, return all three values:

```ts
{
  grossProceeds,
  sellingExpenses: feeAmount,
  netProceeds,
  proceedsPerUnit,
}
```

2. In `matchOutflowDisposal(...)`, thread those values into the disposal request
   or attach them after lot matching.

3. In the strategy output mapping, persist row-level gross/expense/net values on
   each matched disposal row.

4. In `calculateGainLoss(...)`, persist wash-sale facts back onto the disposal:

```ts
disposal.lossDisallowed = lossDisallowed;
disposal.disallowedLossAmount = lossDisallowed ? disposal.gainLoss.abs() : undefined;
```

This gives the later US export branch a real substrate for:

- `proceeds_gross`
- `selling_expenses`
- `net_proceeds`
- `form_8949_adjustment_code`
- `form_8949_adjustment_amount`

without recomputing tax logic in export code.

### Keep Transfer Facts Rich Enough For Export

Current file:

- `packages/accounting/src/cost-basis/model/schemas.ts`

Current state:

- `LotTransfer` already preserves:
  - `sourceLotId`
  - `sourceTransactionId`
  - `targetTransactionId`
  - provenance kind
  - same-asset fee carryover metadata

Phase 0 action:

- do not add final export enums here
- do add any missing stable facts needed to derive later export statuses if
  tests show they are missing

Examples to consider only if needed:

- `sourceAccountId`
- `targetAccountId`
- explicit matched/one-sided state

Default rule:

- prefer deriving transfer export labels from source transactions and link
  presence before adding new transfer schema fields

## Canada Workflow Changes

### Stop Treating `displayReport` As The Required Snapshot Layer

Current files:

- `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.ts`
- `packages/accounting/src/cost-basis/artifacts/artifact-storage.ts`

Current problem:

- Canada snapshot persistence requires `displayReport`
- the richer `inputContext` is dropped on persistence

Phase 0 change:

- make `displayReport` optional for persistence
- persist export-relevant Canada context instead

Recommended new persisted payload:

- `taxReport`
- `inputContext`
- optionally `displayReport`

Do not persist only `displayReport`.

Concrete file changes:

1. `packages/accounting/src/cost-basis/artifacts/artifact-storage.ts`
   - extend `StoredCanadaCostBasisArtifactSchema`
   - add a stored `inputContext`
   - make `displayReport` optional
2. `toStoredCanadaArtifact(...)`
   - store `inputContext` from `CanadaCostBasisWorkflowResult`
3. `fromStoredCanadaArtifact(...)`
   - restore `inputContext`
4. remove `requireCanadaDisplayReport(...)` from snapshot persistence path

Why this matters:

- `inputContext.inputEvents` contains Canada valuation and fee-adjustment facts
  that `taxReport` flattens away
- later export work may need:
  - valuation source
  - FX-to-CAD rate
  - proceeds reduction details
  - transfer-event provenance

### Fix The Inclusion Rate Seam In Code

Current file:

- `packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-report-builder.ts`

Current problem:

- `CANADA_CAPITAL_GAINS_INCLUSION_RATE` is still hardcoded to `0.5`

Phase 0 action:

- move inclusion rate resolution behind a function or policy seam
- keep today’s behavior if necessary, but do not hardcode it in the report
  builder

Example:

```ts
function resolveCanadaInclusionRate(calculation: CanadaCostBasisCalculation): Decimal;
```

Even if v1 still returns `0.5`, Phase 0 should remove the hardcoded report
builder constant so export code does not depend on a hidden assumption.

## Export Branch Entry Point

Add a dedicated service that builds export context without rendering files yet.

File:

- `packages/accounting/src/cost-basis/export/tax-package-context-builder.ts`

Candidate API:

```ts
export function buildTaxPackageBuildContext(params: {
  artifact: CostBasisWorkflowResult;
  sourceContext: CostBasisContext;
  scopeKey: string;
  snapshotId?: string | undefined;
}): Result<TaxPackageBuildContext, Error>;
```

Responsibilities:

- build fast lookup maps
- validate required rejoin coverage
- reject missing transaction/account/link references loudly
- provide one stable seam for later package builders

Non-responsibilities:

- package readiness classification
- CSV rendering
- Markdown report rendering

## Snapshot Strategy

Do not overload the normal cost-basis snapshot for tax-package reuse.

Recommended Phase 0 direction:

- keep existing standard/canada snapshots for `cost-basis`
- add export-specific snapshot support later under the export path only if
  needed

That means Phase 0 should make export assembly possible without first deciding
the final export snapshot format.

## File-Level Execution Plan

### PR 1. Widen Context + Preserve Standard Disposal Facts

Files:

- `packages/accounting/src/ports/cost-basis-persistence.ts`
- `packages/data/src/adapters/cost-basis-ports-adapter.ts`
- `packages/accounting/src/cost-basis/model/schemas.ts`
- `packages/accounting/src/cost-basis/standard/lots/lot-disposal-utils.ts`
- `packages/accounting/src/cost-basis/standard/strategies/lot-sorting-utils.ts`
- `packages/accounting/src/cost-basis/standard/calculation/gain-loss-utils.ts`
- affected tests under `packages/accounting/src/cost-basis/standard/**/__tests__/`

Deliverables:

- accounts available in cost-basis context
- standard disposals preserve gross/expense/net facts
- standard disposals preserve loss-disallowance facts

### PR 2. Persist Canada Input Context, Demote Display Report

Files:

- `packages/accounting/src/cost-basis/workflow/workflow-result-types.ts`
- `packages/accounting/src/cost-basis/artifacts/artifact-storage.ts`
- `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.ts`
- affected artifact-storage and Canada workflow tests

Deliverables:

- stored Canada artifact includes `inputContext`
- `displayReport` no longer gates snapshot persistence
- restored Canada snapshots preserve the richer event/input layer

### PR 3. Introduce Export Context Builder Seam

Files:

- `packages/accounting/src/cost-basis/export/tax-package-build-context.ts`
- `packages/accounting/src/cost-basis/export/tax-package-row-facts.ts`
- `packages/accounting/src/cost-basis/export/tax-package-context-builder.ts`
- tests under `packages/accounting/src/cost-basis/export/__tests__/`

Deliverables:

- export branch can build a stable context from shared workflow result +
  widened source context
- no rendering yet
- no CLI wiring yet

### PR 4. Canada Inclusion Rate Seam

Files:

- `packages/accounting/src/cost-basis/jurisdictions/canada/tax/canada-tax-report-builder.ts`
- Canada tax report tests

Deliverables:

- no hardcoded inclusion-rate constant in report assembly
- explicit inclusion-rate function seam for report/export use

## Test Plan

### Standard Workflow Tests

Add or update tests for:

- disposal rows preserve gross proceeds
- disposal rows preserve selling expenses
- disposal rows preserve net proceeds
- wash-sale disallowed rows preserve adjustment amount facts

Suggested files:

- `packages/accounting/src/cost-basis/standard/lots/__tests__/lot-matcher-utils.test.ts`
- `packages/accounting/src/cost-basis/standard/calculation/__tests__/standard-calculator.test.ts`
- `packages/accounting/src/cost-basis/standard/calculation/__tests__/gain-loss-utils-jurisdictions.test.ts`

### Canada Artifact Tests

Add or update tests for:

- stored Canada snapshot round-trips `inputContext`
- stored Canada snapshot does not require `displayReport`
- stored Canada snapshot still round-trips `taxReport`

Suggested file:

- `packages/accounting/src/cost-basis/artifacts/__tests__/artifact-storage.test.ts`

### Export Context Builder Tests

Add tests for:

- missing transaction rejoin fails
- missing account rejoin fails
- missing confirmed link rejoin fails when a referenced link is required
- standard and Canada build contexts both produce deterministic lookup maps

## Risks To Watch

### 1. Snapshot Size Growth

Persisting Canada `inputContext` will increase snapshot size.

That is acceptable in development if it prevents exporter logic from depending
on the wrong layer.

Do not optimize this prematurely.

### 2. Overfitting Shared Schemas To Export

The standard lot/disposal/transfer schemas are shared cost-basis artifacts.

Only add fields there when they are true domain facts already computed by the
workflow.

Do not add:

- final CSV headings
- package-local refs
- preparer display strings

### 3. Export Branch Drift

The export context builder must adapt shared workflow results.
It must not quietly fork tax math.

If export code starts recalculating gains, lot depletion, or superficial-loss
logic, stop and move that logic back into the shared workflow.

## Out Of Scope For Phase 0

- CLI `cost-basis export` command wiring
- readiness gate implementation
- package-local ref generation
- CSV rendering
- Markdown report rendering
- export snapshot cache policy
- accountant-facing file naming

## Success Criteria

Phase 0 is complete when:

1. the shared workflow artifacts preserve the tax facts the package truly needs
2. Canada snapshots retain the richer context that future export work depends on
3. export work has a dedicated branch/seam and does not depend on
   `displayReport`
4. the later tax-package implementation can proceed without widening the normal
   snapshot again for every missing field
