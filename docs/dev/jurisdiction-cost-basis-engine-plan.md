# Jurisdiction Cost Basis Engine Plan

Status: proposed refactor plan

## Why This Exists

We now have two real concerns that should be separated:

- jurisdiction-specific tax math
- consumer-specific orchestration (`cost-basis` command vs `portfolio`)

Today those concerns are partially mixed:

- Canada already follows a separate workflow in
  `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
- generic `cost-basis` command runs through
  `packages/accounting/src/cost-basis/orchestration/cost-basis-artifact-service.ts`
- generic `portfolio` still calls `runCostBasisPipeline(...)` directly in
  `apps/cli/src/features/portfolio/command/portfolio-handler.ts`

That is manageable with two jurisdictions, but it will rot once more
jurisdiction-specific workflows arrive.

The right fix is not to force Canada into the generic lot pipeline.
The right fix is to centralize jurisdiction dispatch inside `packages/accounting`
while keeping consumer-specific output shaping above that boundary.

## Goals

- Use one shared `IJurisdictionCostBasisEngine` contract for jurisdiction math.
- Keep Canada free to use Canada-specific event/ACB logic.
- Keep generic jurisdictions free to use lot-based logic.
- Remove jurisdiction branching from CLI handlers.
- Let both `cost-basis` and `portfolio` compose from the same jurisdiction
  engine selection.
- Make failure snapshot persistence live in accounting orchestration instead of
  leaking into handlers.

## Non-Goals

- Forcing all jurisdictions to return the same internal data structures.
- Rewriting Canada to look like the lot-based generic path.
- Building a speculative plugin system before there is a second non-generic
  jurisdiction engine.
- Merging `cost-basis` and `portfolio` into one public service API.

## Target Shape

### 1. One shared jurisdiction engine interface

Add a new accounting-owned interface, for example in:

- `packages/accounting/src/cost-basis/jurisdiction-engines/jurisdiction-cost-basis-engine.ts`

Proposed shape:

```ts
export interface JurisdictionCostBasisEngineParams {
  input: CostBasisInput;
  transactions: UniversalTransactionData[];
  context: CostBasisContext;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
}

export type JurisdictionCostBasisEngineResult = GenericCostBasisWorkflowResult | CanadaCostBasisWorkflowResult;

export interface IJurisdictionCostBasisEngine {
  supports(jurisdiction: CostBasisInput['config']['jurisdiction']): boolean;
  execute(params: JurisdictionCostBasisEngineParams): Promise<Result<JurisdictionCostBasisEngineResult, Error>>;
}
```

Notes:

- `missingPricePolicy` must move into the engine params so `portfolio` and
  `cost-basis` can share the same dispatch path while still differing on
  fail-closed vs best-effort behavior.
- The interface is intentionally about jurisdiction math, not artifact storage
  and not portfolio position shaping.

### 2. Two concrete engines first

Add:

- `packages/accounting/src/cost-basis/jurisdiction-engines/generic-cost-basis-engine.ts`
- `packages/accounting/src/cost-basis/jurisdiction-engines/canada-cost-basis-engine.ts`

Responsibilities:

- `GenericCostBasisEngine`
  - wraps current generic flow from `runCostBasisPipeline(...)`
  - returns `GenericCostBasisWorkflowResult`
  - supports `US`, `UK`, `EU` until another jurisdiction needs its own engine

- `CanadaCostBasisEngine`
  - wraps the current Canada path now living in
    `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
  - returns `CanadaCostBasisWorkflowResult`
  - supports `CA`

This gives us one shared interface without forcing one shared implementation.

### 3. Add a small engine registry/dispatcher

Add:

- `packages/accounting/src/cost-basis/jurisdiction-engines/jurisdiction-cost-basis-engine-registry.ts`

Suggested shape:

```ts
export class JurisdictionCostBasisEngineRegistry {
  constructor(private readonly engines: readonly IJurisdictionCostBasisEngine[]) {}

  resolve(jurisdiction: CostBasisInput['config']['jurisdiction']): Result<IJurisdictionCostBasisEngine, Error> {
    const engine = this.engines.find((candidate) => candidate.supports(jurisdiction));
    return engine ? ok(engine) : err(new Error(`No cost basis engine registered for jurisdiction '${jurisdiction}'`));
  }
}
```

Keep this simple.
We do not need dynamic discovery yet.
An explicit array composed in accounting is enough.

## How `cost-basis` Should Use It

The `cost-basis` command should still own:

- artifact reuse / rebuild policy
- dependency watermark reads
- snapshot persistence
- refresh semantics

It should stop owning jurisdiction branching.

### New accounting service boundary

Refactor
`packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
into a dispatcher-backed workflow or replace it with a clearer orchestrator such
as:

- `packages/accounting/src/cost-basis/orchestration/jurisdiction-cost-basis-workflow.ts`

Proposed shape:

```ts
class JurisdictionCostBasisWorkflow {
  constructor(
    private readonly store: ICostBasisContextReader,
    private readonly registry: JurisdictionCostBasisEngineRegistry
  ) {}

  async execute(params: {
    input: CostBasisInput;
    accountingExclusionPolicy?: AccountingExclusionPolicy;
    assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>;
    missingPricePolicy: 'error' | 'exclude';
  }): Promise<Result<JurisdictionCostBasisEngineResult, Error>> {
    const contextResult = await this.store.loadCostBasisContext();
    if (contextResult.isErr()) return err(contextResult.error);

    const engineResult = this.registry.resolve(params.input.config.jurisdiction);
    if (engineResult.isErr()) return err(engineResult.error);

    return engineResult.value.execute({
      input: params.input,
      transactions: contextResult.value.transactions,
      context: contextResult.value,
      accountingExclusionPolicy: params.accountingExclusionPolicy,
      assetReviewSummaries: params.assetReviewSummaries,
      missingPricePolicy: params.missingPricePolicy,
    });
  }
}
```

Then
`packages/accounting/src/cost-basis/orchestration/cost-basis-artifact-service.ts`
continues to wrap that workflow and persist success/failure snapshots.

### CLI effect for `cost-basis`

`apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
should keep constructing one accounting workflow/service object, but it should
no longer care which jurisdiction engine will run underneath.

## How `portfolio` Should Use It

`portfolio` should not build positions inside the jurisdiction engine.
That is portfolio-specific orchestration and should remain a portfolio concern.

Instead, `portfolio` should call the same accounting workflow/service and then
translate the returned engine result into positions.

### Portfolio boundary

Add a portfolio-facing dispatcher inside CLI, for example:

- `apps/cli/src/features/portfolio/command/portfolio-cost-basis-dispatcher.ts`

Its job is not jurisdiction selection.
Its job is consumer shaping:

- call the accounting workflow/service with `missingPricePolicy: 'exclude'`
- inspect whether the result is `generic-pipeline` or `canada-workflow`
- map that result into `PortfolioPositionItem[]`, warnings, and realized P&L

Proposed shape:

```ts
interface PortfolioCostBasisResult {
  positions: PortfolioPositionItem[];
  closedPositions: PortfolioPositionItem[];
  realizedGainLossByPortfolioKey: Map<string, Decimal>;
  warnings: string[];
}

class PortfolioCostBasisDispatcher {
  constructor(private readonly workflow: JurisdictionCostBasisWorkflow) {}

  async execute(params: PortfolioCostBasisParams): Promise<Result<PortfolioCostBasisResult, Error>> {
    const workflowResult = await this.workflow.execute({
      input: params.costBasisParams,
      accountingExclusionPolicy: params.accountingExclusionPolicy,
      assetReviewSummaries: params.assetReviewSummaries,
      missingPricePolicy: 'exclude',
    });
    if (workflowResult.isErr()) return err(workflowResult.error);

    return workflowResult.value.kind === 'generic-pipeline'
      ? buildGenericPortfolioResult(workflowResult.value, params)
      : buildCanadaPortfolioResult(workflowResult.value, params);
  }
}
```

This keeps:

- jurisdiction math in accounting
- portfolio shaping in portfolio
- no `if (jurisdiction === 'CA')` in `PortfolioHandler`

## Implementation Plan

### Phase 1: Introduce the shared engine abstraction

1. Add `IJurisdictionCostBasisEngine` and its param/result types.
2. Add `GenericCostBasisEngine` by extracting the non-Canada half of current
   `CostBasisWorkflow.execute(...)`.
3. Add `CanadaCostBasisEngine` by extracting the current
   `executeCanadaWorkflow(...)` path.
4. Add `JurisdictionCostBasisEngineRegistry`.

Do not change CLI handlers in this phase.
Keep behavior stable.

### Phase 2: Refactor accounting workflow to dispatch through the registry

1. Replace direct `if (config.jurisdiction === 'CA')` branching in
   `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
   with registry resolution.
2. Move `loadCostBasisContext()` to the outer workflow/orchestrator so engines
   receive already-loaded context.
3. Thread `missingPricePolicy` through the workflow interface instead of
   hardcoding `'error'`.
4. Keep
   `packages/accounting/src/cost-basis/orchestration/cost-basis-artifact-service.ts`
   as the persistence boundary.

At the end of this phase, `cost-basis` should be using jurisdiction engines
without any change to command behavior.

### Phase 3: Refactor portfolio to consume the same accounting workflow

1. Add `PortfolioCostBasisDispatcher` in CLI.
2. Move the current generic portfolio cost-basis branch out of
   `apps/cli/src/features/portfolio/command/portfolio-handler.ts`
   into dispatcher helpers.
3. Replace direct `runCostBasisPipeline(...)` calls with one accounting workflow
   call using `missingPricePolicy: 'exclude'`.
4. Remove direct failure snapshot persistence from `PortfolioHandler`; that
   should already happen inside accounting orchestration after Phase 2.

At the end of this phase, `PortfolioHandler` should stop branching by
jurisdiction and stop knowing about cost-basis artifact persistence.

### Phase 4: Cleanups after the seam is real

1. Rename old types/classes whose names now overstate their role.
2. Remove dead helpers left behind in `CostBasisWorkflow` and `PortfolioHandler`.
3. Add focused tests around:
   - registry dispatch
   - generic vs Canada engine selection
   - `missingPricePolicy` differences between `cost-basis` and `portfolio`
   - failure snapshot persistence through the shared accounting path

## Suggested File Moves

These are not mandatory, but this is the cleanest layout:

- add `packages/accounting/src/cost-basis/jurisdiction-engines/`
- keep `orchestration/` for cross-engine orchestration and persistence
- keep Canada-specific math under `cost-basis/canada/`

Suggested new files:

- `packages/accounting/src/cost-basis/jurisdiction-engines/jurisdiction-cost-basis-engine.ts`
- `packages/accounting/src/cost-basis/jurisdiction-engines/jurisdiction-cost-basis-engine-registry.ts`
- `packages/accounting/src/cost-basis/jurisdiction-engines/generic-cost-basis-engine.ts`
- `packages/accounting/src/cost-basis/jurisdiction-engines/canada-cost-basis-engine.ts`
- `apps/cli/src/features/portfolio/command/portfolio-cost-basis-dispatcher.ts`

## Why One Interface Is Still Correct

Using one `IJurisdictionCostBasisEngine` is fine because the shared abstraction
is narrow:

- given `CostBasisInput`, transactions, context, and policy
- produce a jurisdiction-specific cost-basis calculation result

That is the same job for Canada and generic lot-based jurisdictions even though
their internal algorithms differ.

The mistake would be pushing portfolio position building or artifact storage
into that same interface.
Those are different concerns and should stay outside it.

## Risks To Watch

### 1. One interface can become too broad

If we keep adding consumer-specific flags directly to
`IJurisdictionCostBasisEngine`, the abstraction will become a junk drawer.

Guardrail:

- only pass calculation inputs and accounting policy
- keep rendering/output concerns above the engine boundary

### 2. Generic engine may become an accidental catch-all

If `UK` or another jurisdiction later needs materially different tax logic,
do not keep widening `GenericCostBasisEngine`.

Guardrail:

- split out a new engine as soon as a jurisdiction stops sharing real tax math
- the registry already gives us the extension seam

### 3. Canada workflow may still need host-owned collaborators

Canada currently depends on FX conversion/report behavior.
Do not hide those dependencies in CLI again.

Guardrail:

- keep those collaborators constructed in accounting or passed into accounting
  orchestration
- do not rebuild Canada-specific collaboration wiring in `apps/cli`

## Decision To Lock In

Adopt this rule:

> Jurisdiction-specific cost-basis math belongs behind one accounting-owned
> `IJurisdictionCostBasisEngine` interface, while consumer-specific shaping
> (`cost-basis` artifact persistence vs `portfolio` position building) stays
> outside that engine boundary.

This gives us a clean extension seam for future jurisdictions without forcing
false alignment between Canada and generic lot-based flows.
