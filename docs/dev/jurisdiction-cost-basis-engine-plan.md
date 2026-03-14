# Jurisdiction Cost Basis Refactor Plan

Status: ready to implement

## Why This Exists

The immediate problem is not that `packages/accounting` lacks an engine
interface.

The immediate problem is:

- `CostBasisWorkflow` already owns jurisdiction dispatch in accounting
- `portfolio` bypasses that workflow for the generic path
- `portfolio` duplicates part of the Canada orchestration
- failure snapshot persistence has no shared home

We should fix those seams first.

Do not add a registry/engine abstraction yet just because we may eventually
have more jurisdiction-specific workflows.

## Current Facts To Preserve

### 1. Canada is legitimately different

Canada does not just have a different post-processing step.
It uses different core accounting primitives:

- ACB workflow
- superficial loss adjustments
- tax report + display report generation

This is not a smell by itself.
We should not force Canada to look like the lot-based generic pipeline.

### 2. `CostBasisWorkflow` is already the accounting-owned dispatcher

Today
`packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
already does the important jurisdiction branch:

- `CA` -> Canada workflow
- everything else -> generic pipeline

That is already the right ownership boundary.
The problem is that not all consumers go through it.

### 3. Portfolio and command need different policies

`cost-basis` and `portfolio` are not the same consumer:

- `cost-basis` should fail closed
- `portfolio` should be best-effort where possible

That policy difference is real.
It should be expressed explicitly instead of forcing each consumer to rebuild
its own execution path.

## Goals

- Make `CostBasisWorkflow` consumable by both `cost-basis` and `portfolio`.
- Remove direct generic pipeline calls from `PortfolioHandler`.
- Extract the duplicated Canada calculation core so portfolio and workflow share
  the same Canada math.
- Add shared accounting-owned failure snapshot persistence (net-new).
- Keep the current accounting-owned jurisdiction branch in one place.
- Defer `IJurisdictionCostBasisEngine` until a real third custom jurisdiction
  forces it.

## Non-Goals

- Introduce a registry or plugin system now.
- Replace the existing `if (jurisdiction === 'CA')` with extra abstraction.
- Force Canada and generic jurisdictions into one internal result shape beyond
  what already exists.
- Move portfolio position shaping into accounting.
- Couple portfolio to artifact caching/reuse.

## The Real Gaps To Fix

### 1. `missingPricePolicy` is hardcoded too low

In
`packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`,
the generic path hardcodes:

```ts
missingPricePolicy: 'error';
```

That makes the workflow unsuitable for `portfolio`, which wants
best-effort `'exclude'`.

### 2. Canada orchestration is duplicated

`PortfolioHandler.buildCanadaPortfolioCostBasis()` duplicates the Canada core
calculation sequence that already exists in `CostBasisWorkflow`.

That duplication is the real refactor target.

### 3. Canada pool snapshot semantics differ by consumer

This difference must be made explicit.

The `cost-basis` command wants pool state at report end.
Portfolio wants pool state through the portfolio `asOf` horizon.

This means we cannot just say "share the Canada workflow" without parameterizing
the pool snapshot strategy.

### 4. Workflow results lack execution metadata

`CostBasisWorkflow` currently discards pipeline metadata
(`missingPricesCount`, `rebuildTransactions`) that portfolio needs for its
missing-price warnings.

The workflow must surface execution metadata so portfolio can build warnings
without bypassing the workflow to get raw pipeline results.

### 5. No shared failure snapshot persistence exists

Neither `CostBasisArtifactService` nor `PortfolioHandler` currently persists
failure snapshots. This is a net-new capability that both consumers need, and
it should live in accounting as a separate concern from artifact caching/reuse.

## Key Design Decisions

### 1. Portfolio does not depend on artifact caching/reuse

Portfolio calculates fresh each time (spot prices change, `asOf` varies).
Caching is a `cost-basis` command concern.
Portfolio only needs shared workflow execution plus failure snapshot persistence.

### 2. Failure snapshot persistence is a separate accounting capability

`CostBasisArtifactService` keeps handling success-cache reuse for `cost-basis`.
A separate accounting-owned failure persister is used by both consumers.
This avoids coupling portfolio to the full artifact service.

### 3. Workflow results include execution metadata

Both generic and Canada paths return execution metadata:

```ts
interface CostBasisExecutionMeta {
  missingPricesCount: number;
  retainedTransactionIds: number[];
}
```

Generic workflow result becomes:

```ts
interface GenericCostBasisWorkflowResult {
  kind: 'generic-pipeline';
  summary: CostBasisSummary;
  report?: CostBasisReport | undefined;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
  executionMeta: CostBasisExecutionMeta;
}
```

Canada workflow result includes the same `executionMeta` field.

This gives portfolio enough to build warnings without leaking raw transaction
arrays through the workflow boundary.

### 4. Canada extraction owns missing-price policy

`runCanadaCostBasisCalculation(...)` accepts `missingPricePolicy` and handles
price-coverage filtering internally (parallel to how `runCostBasisPipeline`
handles it for the generic path).

Without this, portfolio would still import `getCostBasisRebuildTransactions`
and pre-filter before calling the Canada extraction, leaving a seam the
refactor was supposed to close.

## Recommended Direction

### Keep `CostBasisWorkflow` as the dispatcher

Do not replace it with:

- `JurisdictionCostBasisEngineRegistry`
- `IJurisdictionCostBasisEngine`
- extra dispatcher classes

yet.

The current accounting-owned branch is sufficient for two paths:

- Canada
- generic

### Make `CostBasisWorkflow` configurable enough for both consumers

Add an explicit workflow execution option:

```ts
interface CostBasisWorkflowExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
}
```

Then:

- `cost-basis` passes `'error'`
- `portfolio` passes `'exclude'`

That removes the main reason `portfolio` bypasses the workflow today.

### Extract shared Canada core calculation

Do not keep the Canada orchestration duplicated in:

- `CostBasisWorkflow`
- `PortfolioHandler`

Extract the shared Canada core into `packages/accounting/src/cost-basis/canada/`
as a Canada-owned function.

Suggested file:

- `packages/accounting/src/cost-basis/canada/run-canada-cost-basis-calculation.ts`

Suggested shape:

```ts
interface RunCanadaCostBasisCalculationParams {
  input: CostBasisInput;
  transactions: UniversalTransactionData[];
  confirmedLinks: TransactionLink[];
  fxRateProvider: IFxRateProvider;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
  poolSnapshotStrategy: 'report-end' | 'full-input-range';
}
```

The function should own:

1. Missing-price filtering (via `getCostBasisRebuildTransactions` or equivalent)
2. Canada ACB workflow
3. Superficial loss engine
4. Adjusted ACB engine pass
5. Pool snapshot pass according to `poolSnapshotStrategy`
6. Tax report generation
7. Display report generation

And return `CanadaCostBasisWorkflowResult` including `executionMeta`.

## Target Architecture

### `cost-basis` path

`apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
should continue to use accounting orchestration and artifact persistence.

Flow:

1. CLI ensures upstream inputs are ready.
2. CLI constructs accounting workflow/service.
3. Accounting workflow dispatches by jurisdiction.
4. `CostBasisArtifactService` persists success snapshots (cache/reuse).
5. Shared failure persister handles failures.

### `portfolio` path

`apps/cli/src/features/portfolio/command/portfolio-handler.ts`
should stop calling `runCostBasisPipeline(...)` directly for the generic path.

Flow:

1. Portfolio handler gathers host inputs.
2. Portfolio calls shared accounting workflow with `missingPricePolicy: 'exclude'`.
3. Accounting workflow dispatches by jurisdiction.
4. Portfolio reads `executionMeta` to build missing-price warnings.
5. Portfolio converts workflow result into positions.
6. Shared failure persister handles failures.

Portfolio should still own:

- portfolio position building
- closed-position aggregation
- portfolio warning text (using `executionMeta`)

Portfolio should not own:

- jurisdiction dispatch
- generic pipeline execution
- missing-price filtering for Canada
- failure snapshot persistence

## Concrete Plan

### Phase 1: Make workflow usable for portfolio generic path

1. Add `missingPricePolicy` to `CostBasisWorkflow.execute(...)` via
   `CostBasisWorkflowExecutionOptions`.
2. Thread that value into the generic path instead of hardcoding `'error'`.
3. Add `CostBasisExecutionMeta` to `GenericCostBasisWorkflowResult`.
4. Propagate `missingPricesCount` and `retainedTransactionIds` from
   `runCostBasisPipeline` through the workflow into the result.
5. Update the `cost-basis` command to pass `'error'`.
6. Update portfolio generic path to call `CostBasisWorkflow` instead of
   `runCostBasisPipeline(...)`.
7. Update portfolio to read `executionMeta` for its missing-price warning.

Note: after this phase, portfolio still has its own Canada path. That is a
transitional state — portfolio temporarily imports both `CostBasisWorkflow` and
Canada accounting internals. Phase 2 resolves this.

Result:

- generic jurisdiction dispatch leaves CLI
- portfolio gets warning metadata through the workflow
- no engine abstraction required

### Phase 2: Extract shared Canada core

1. Create `runCanadaCostBasisCalculation(...)` in
   `packages/accounting/src/cost-basis/canada/run-canada-cost-basis-calculation.ts`.
2. Include `missingPricePolicy` and `poolSnapshotStrategy` as explicit params.
3. Include `CostBasisExecutionMeta` in the Canada result.
4. Refactor `CostBasisWorkflow.executeCanadaWorkflow(...)` to call
   the new shared function with `poolSnapshotStrategy: 'report-end'`.
5. Refactor `PortfolioHandler.buildCanadaPortfolioCostBasis(...)` to call
   the new shared function with `poolSnapshotStrategy: 'full-input-range'`.
6. Remove duplicated Canada orchestration from `PortfolioHandler`.
7. Move `fxRateProvider` from `CostBasisWorkflow` constructor to a param of
   the shared Canada function (callers pass it explicitly).

Result:

- no duplicated Canada math
- consumer differences (pool snapshot, missing-price policy) stay explicit
- portfolio stops importing Canada accounting internals

### Phase 3: Add shared failure snapshot persistence

This is net-new capability, not migration of existing code.

1. Add a shared accounting-owned failure snapshot persister (function or small
   class), separate from `CostBasisArtifactService`.
2. Route both `cost-basis` and `portfolio` through the shared failure persister
   on workflow errors.
3. Keep `CostBasisArtifactService` focused on success-cache reuse for
   `cost-basis` only.
4. Verify: if portfolio-triggered cost basis fails, the shared path persists
   the failure snapshot for debugging.

Result:

- failure snapshot persistence lives in accounting
- portfolio does not depend on artifact caching/reuse
- both consumers get consistent failure debugging

### Phase 4: Decide whether a new abstraction is actually justified

Only after the above refactor lands, revisit whether a shared
`IJurisdictionCostBasisEngine` is warranted.

That abstraction becomes justified when:

- we add a real third jurisdiction with distinct tax math, or
- `CostBasisWorkflow` starts accumulating multiple independent jurisdiction
  branches that no longer remain readable

Until then, the branch inside accounting is cheaper and clearer than a registry.

## Suggested Code Changes

### 1. `CostBasisWorkflow`

Update
`packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
to accept options:

```ts
interface CostBasisWorkflowExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
}
```

Then:

```ts
const pipelineResult = await runCostBasisPipeline(filteredTransactions, config, this.store, {
  accountingExclusionPolicy: options.accountingExclusionPolicy,
  assetReviewSummaries: options.assetReviewSummaries,
  missingPricePolicy: options.missingPricePolicy,
});
```

And propagate execution metadata into the result:

```ts
return ok({
  kind: 'generic-pipeline',
  summary,
  report,
  lots,
  disposals,
  lotTransfers,
  executionMeta: {
    missingPricesCount: pipelineResult.value.missingPricesCount,
    retainedTransactionIds: pipelineResult.value.rebuildTransactions.map((tx) => tx.id),
  },
});
```

### 2. Shared Canada core

Suggested new function:

```ts
export async function runCanadaCostBasisCalculation(
  params: RunCanadaCostBasisCalculationParams
): Promise<Result<CanadaCostBasisWorkflowResult, Error>>;
```

Accepts `missingPricePolicy` and `poolSnapshotStrategy` as explicit params.
Returns `CanadaCostBasisWorkflowResult` including `executionMeta`.

Use:

- `poolSnapshotStrategy: 'report-end'` for `cost-basis`
- `poolSnapshotStrategy: 'full-input-range'` for `portfolio`
- `missingPricePolicy: 'error'` for `cost-basis`
- `missingPricePolicy: 'exclude'` for `portfolio`

### 3. Portfolio generic flow

Instead of:

```ts
const pipelineResult = await runCostBasisPipeline(...);
```

do:

```ts
const workflowResult = await workflow.execute(costBasisParams, transactionsUpToAsOf, {
  accountingExclusionPolicy: this.accountingExclusionPolicy,
  assetReviewSummaries,
  missingPricePolicy: 'exclude',
});
```

Then consume:

```ts
if (workflowResult.value.kind !== 'generic-pipeline') {
  return err(new Error(`Expected generic-pipeline result for non-CA portfolio flow`));
}
```

And build warnings from execution metadata:

```ts
const { missingPricesCount, retainedTransactionIds } = workflowResult.value.executionMeta;
```

This is acceptable because the branching remains consumer-specific output
shaping, not jurisdiction execution ownership.

## Why This Is Better Than the Earlier Engine Plan

### 1. It removes real duplication first

The duplicated Canada orchestration is the immediate maintainability problem.
This plan targets that directly.

### 2. It keeps the abstraction load proportional

Two paths do not justify:

- registry
- engine interface
- `supports()` resolution
- extra dispatcher classes

The simpler plan preserves optionality without paying abstraction cost early.

### 3. It still prepares for future jurisdictions

If a future jurisdiction needs its own math, we will have:

- one clean workflow boundary
- one shared Canada extraction seam
- no handler-owned jurisdiction logic

That makes later extraction of `IJurisdictionCostBasisEngine` straightforward if
it becomes necessary.

## Risks To Watch

### 1. `CostBasisWorkflow` could become too wide

Adding `missingPricePolicy` is justified.
Do not keep piling unrelated consumer concerns into workflow params.

Guardrail:

- workflow options should remain calculation-policy inputs only

### 2. Canada extraction could accidentally hide semantic differences

The pool snapshot difference must stay explicit.
Do not collapse it into hidden branching.

Guardrail:

- require `poolSnapshotStrategy` as an explicit parameter

### 3. `retainedTransactionIds` could be large

For portfolios with thousands of transactions, returning all retained IDs is
the highest-cardinality option for data used only to compute a two-number
warning. If this becomes a concern, consider `excludedTransactionIds` (typically
smaller) or pre-computed counts instead.

### 4. Shared failure persister must actually be exercised

If portfolio routes through a workflow path that is not covered by the shared
failure persister, the debugging gap reappears silently.

Guardrail:

- failure snapshot persistence must be verified for both `cost-basis` and
  `portfolio` error paths after Phase 3

## Decision To Lock In

Adopt this rule:

> Keep jurisdiction dispatch in `CostBasisWorkflow` for now, make that workflow
> reusable by both `cost-basis` and `portfolio`, extract the duplicated Canada
> core calculation with explicit `missingPricePolicy` and `poolSnapshotStrategy`,
> add shared failure snapshot persistence as a separate accounting capability,
> and defer `IJurisdictionCostBasisEngine` until a third custom jurisdiction
> actually forces the abstraction.
