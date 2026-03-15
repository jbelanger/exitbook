# Cost Basis Structure Refactor Plan

Status: active plan

This note tracks the cost-basis directory refactor and the order we should
apply it in.

The goal is not to churn filenames for aesthetics.
The goal is to fix the current false boundaries and make the structure tell the
truth about the code:

- `model/` owns domain shapes
- `standard/` owns the reusable FIFO/LIFO-style engine family
- `jurisdictions/` owns jurisdiction rules, configs, and specialized engines
- `workflow/` owns host-facing dispatch
- `artifacts/` owns stored artifact mapping and reuse
- `export/` owns shared tax-package export infrastructure

Related note:

- `docs/dev/cost-basis-tax-package.md`

## Decisions Locked In

### 1. Do not introduce `core/`

`core/` would become a junk drawer.

The current "generic pipeline" is not infrastructure core.
It is a real engine family and should be named accordingly.

Use `standard/` instead.

### 2. Keep US on the standard engine for now

US currently uses the standard cost-basis path with US rules applied.
It does not yet justify its own artifact kind or separate stored payload.

Only introduce a US-specific artifact kind if US gains a structurally different
execution payload, such as a dedicated wash-sale engine with durable
US-specific outputs.

### 3. Rename persisted `generic` artifacts to `standard`

Because the database is dropped during development, we should rename the
artifact family now while the refactor is in progress.

Target persisted families:

- `standard`
- `canada`

### 4. Export stays top-level

Shared tax-package export infrastructure belongs in:

- `packages/accounting/src/cost-basis/export/`

Jurisdiction-specific builders may live inside jurisdiction slices, but the
shared entrypoint, render model, and review gate remain top-level.

### 5. Registry before directory churn

Do not move half the tree and leave `switch` statements behind.

First fix the seams that currently hardcode jurisdiction knowledge:

- workflow dispatch
- rules lookup
- artifact family selection
- export builder selection

## Current Boundary Problems To Remove

These are the concrete couplings this refactor must eliminate:

### 1. Workflow hardcodes Canada

Current file:

- `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`

Current smell:

- imports `runCanadaCostBasisCalculation`
- branches on `if (config.jurisdiction === 'CA')`

End state:

- workflow asks a registry which engine module to run
- workflow does not import country-specific runners directly

### 2. Shared helper instantiates jurisdiction rules

Current file:

- `packages/accounting/src/cost-basis/shared/cost-basis-utils.ts`

Current smell:

- `getJurisdictionRules()` returns `new CanadaRules()` / `new USRules()`

End state:

- rules are created through `jurisdictions/registry.ts`
- generic helpers receive rules or a jurisdiction module as input

### 3. Artifact persistence is split by engine family already

Current file:

- `packages/accounting/src/cost-basis/orchestration/cost-basis-artifact-storage.ts`

Current smell:

- discriminated union between `standard-workflow` and `canada-workflow`
- storage envelope uses `artifactKind: 'standard' | 'canada'`

End state:

- artifact families are explicit and named after real engine families
- `standard` remains shared across US/UK/EU until those paths diverge

## Target Structure

```text
packages/accounting/src/cost-basis/
├── model/
│   ├── cost-basis-config.ts
│   ├── schemas.ts
│   ├── types.ts
│   ├── report-types.ts
│   └── execution-types.ts
├── jurisdictions/
│   ├── jurisdiction-rules.ts
│   ├── jurisdiction-module.ts
│   ├── registry.ts
│   ├── us/
│   │   ├── config.ts
│   │   ├── rules.ts
│   │   └── export/
│   │       └── build-us-tax-package.ts
│   ├── canada/
│   │   ├── config.ts
│   │   ├── rules.ts
│   │   ├── workflow/
│   │   │   ├── run-canada-cost-basis.ts
│   │   │   ├── canada-acb-workflow.ts
│   │   │   └── canada-superficial-loss-engine.ts
│   │   ├── tax/
│   │   │   ├── canada-tax-types.ts
│   │   │   ├── canada-tax-context-builder.ts
│   │   │   ├── canada-tax-event-builders.ts
│   │   │   ├── canada-tax-report-builder.ts
│   │   │   └── canada-tax-valuation.ts
│   │   └── export/
│   │       └── build-canada-tax-package.ts
│   ├── uk/
│   │   └── config.ts
│   └── eu/
│       └── config.ts
├── standard/
│   ├── scope/
│   │   └── build-cost-basis-scoped-transactions.ts
│   ├── matching/
│   │   ├── lot-matcher.ts
│   │   └── validated-scoped-transfer-links.ts
│   ├── lots/
│   ├── strategies/
│   ├── validation/
│   │   ├── accounting-exclusion-policy.ts
│   │   ├── asset-review-preflight.ts
│   │   └── price-validation.ts
│   ├── calculation/
│   │   ├── run-standard-cost-basis.ts
│   │   ├── standard-calculator.ts
│   │   └── gain-loss-utils.ts
│   └── reporting/
│       └── display-report-generator.ts
├── workflow/
│   ├── cost-basis-workflow.ts
│   └── workflow-router.ts
├── artifacts/
│   ├── artifact-types.ts
│   ├── artifact-storage.ts
│   ├── artifact-service.ts
│   └── failure-snapshot-service.ts
└── export/
    ├── export-tax-package.ts
    ├── tax-package-types.ts
    ├── tax-package-review-gate.ts
    └── renderers/
```

## Rules For New Code During The Refactor

These rules apply immediately, even before every move is complete:

- no new helpers under `shared/` that instantiate jurisdiction implementations
- no new workflow code that imports country runners directly
- no new persisted artifact family named `generic`
- no new export builder logic in CLI
- no new `switch (jurisdiction)` outside `jurisdictions/registry.ts`

## Execution Plan

### Phase 0. Prepare The Registry Seam

Status:

- [x] completed

Goal:

- introduce the seam that lets us move files without preserving the old hardcoded
  branching

Create:

- `packages/accounting/src/cost-basis/jurisdictions/jurisdiction-rules.ts`
- `packages/accounting/src/cost-basis/jurisdictions/jurisdiction-module.ts`
- `packages/accounting/src/cost-basis/jurisdictions/registry.ts`

Implemented interface shape:

```ts
export interface ICostBasisJurisdictionModule {
  code: CostBasisJurisdiction;
  config: JurisdictionConfig;
  createRules(): Result<IJurisdictionRules, Error>;
  workflow:
    | { kind: 'standard'; lookaheadDays: number }
    | {
        kind: 'specialized';
        lookaheadDays: number;
        run(input: RunCostBasisWorkflowInput): Promise<Result<CostBasisWorkflowResult, Error>>;
      };
}
```

Implementation notes:

- create a Canada module that calls the current Canada runner
- create a US module that calls the current standard runner
- UK and EU can register config-only placeholders until implemented
- update workflow code to request a module from the registry instead of branching

Files to update first:

- `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
- `packages/accounting/src/cost-basis/shared/cost-basis-utils.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-report-generator.ts`

Completion check:

- `cost-basis-workflow.ts` no longer imports Canada directly
- `getJurisdictionRules()` no longer constructs `new CanadaRules()` / `new USRules()`
- report generation receives rules or a jurisdiction module instead of switching internally

### Phase 1. Move Jurisdiction Ownership Into `jurisdictions/`

Status:

- [x] completed

Goal:

- make jurisdiction-owned code live together before renaming the standard engine

Create:

- `packages/accounting/src/cost-basis/jurisdictions/us/`
- `packages/accounting/src/cost-basis/jurisdictions/canada/`

Move:

- `packages/accounting/src/cost-basis/jurisdictions/us-rules.ts`
  -> `packages/accounting/src/cost-basis/jurisdictions/us/rules.ts`
- `packages/accounting/src/cost-basis/jurisdictions/canada-rules.ts`
  -> `packages/accounting/src/cost-basis/jurisdictions/canada/rules.ts`
- inline jurisdiction-specific config next to each jurisdiction slice

Keep temporarily:

- `packages/accounting/src/cost-basis/jurisdictions/jurisdiction-configs.ts`

Then replace it with:

- `packages/accounting/src/cost-basis/jurisdictions/registry.ts`

Completion check:

- each implemented jurisdiction has a slice directory
- no top-level rules file remains directly under `jurisdictions/`

### Phase 2. Rename The Standard Engine Family

Status:

- [x] completed

Goal:

- replace the misleading "generic/shared/orchestration" naming around the
  reusable engine family

Create:

- `packages/accounting/src/cost-basis/standard/`

Move or split current files:

- `matching/*` -> `standard/scope/` or `standard/matching/`
- `lots/*` -> `standard/lots/`
- `strategies/*` -> `standard/strategies/`
- `shared/accounting-exclusion-policy.ts`
  -> `standard/validation/accounting-exclusion-policy.ts`
- `shared/asset-review-preflight.ts`
  -> `standard/validation/asset-review-preflight.ts`
- `shared/cost-basis-validation-utils.ts`
  -> `standard/validation/price-validation.ts`
- `shared/gain-loss-utils.ts`
  -> `standard/calculation/gain-loss-utils.ts`
- `orchestration/cost-basis-calculator.ts`
  -> `standard/calculation/standard-calculator.ts`
- `orchestration/cost-basis-pipeline.ts`
  -> `standard/calculation/run-standard-cost-basis.ts`
- `orchestration/cost-basis-report-generator.ts`
  -> `standard/reporting/display-report-generator.ts`

Files likely to remain outside `standard/`:

- config and type definitions
- workflow entrypoints
- artifact storage and reuse
- export infrastructure

Completion check:

- there is no persisted or runtime name using `generic-pipeline` or generic artifact kinds
- standard engine code does not import country slices directly

### Phase 3. Split `model/`, `workflow/`, and `artifacts/`

Status:

- [ ] not started

Goal:

- separate domain shapes, dispatch, and persistence from engine code

Create:

- `packages/accounting/src/cost-basis/model/`
- `packages/accounting/src/cost-basis/workflow/`
- `packages/accounting/src/cost-basis/artifacts/`

Move:

- `shared/cost-basis-config.ts`
  -> `model/cost-basis-config.ts`
- `shared/schemas.ts`
  -> `model/schemas.ts`
- `shared/types.ts`
  -> `model/types.ts`
- `shared/report-types.ts`
  -> `model/report-types.ts`
- `orchestration/cost-basis-workflow.ts`
  -> `workflow/cost-basis-workflow.ts`
- `orchestration/cost-basis-workflow-types.ts`
  -> `workflow/execution-types.ts`
- `orchestration/cost-basis-artifact-storage.ts`
  -> `artifacts/artifact-storage.ts`
- `orchestration/cost-basis-artifact-service.ts`
  -> `artifacts/artifact-service.ts`
- `orchestration/cost-basis-failure-snapshot-service.ts`
  -> `artifacts/failure-snapshot-service.ts`
- `orchestration/transaction-price-coverage-utils.ts`
  -> `workflow/transaction-price-coverage-utils.ts`
- `shared/cost-basis-utils.ts`
  -> `workflow/cost-basis-utils.ts`
- `shared/tax-asset-identity.ts`
  -> `model/tax-asset-identity.ts`

Rename persisted terms:

- `generic` -> `standard`
- `generic-pipeline` -> `standard-workflow`

Database updates:

- update `packages/data/src/migrations/001_initial_schema.ts`
- update repository and adapter code that reads/writes `artifact_kind`

Completion check:

- type/model files have no workflow or persistence code
- workflow code does not own storage serialization
- artifact storage terminology matches runtime terminology

### Phase 4. Nest Canada Specialized Workflow Internals

Status:

- [ ] not started

Goal:

- make the Canada slice internally coherent

Create:

- `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/`
- `packages/accounting/src/cost-basis/jurisdictions/canada/tax/`

Move:

- `packages/accounting/src/cost-basis/canada/run-canada-cost-basis-calculation.ts`
  -> `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis.ts`
- `packages/accounting/src/cost-basis/canada/canada-acb-workflow.ts`
  -> `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/canada-acb-workflow.ts`
- `packages/accounting/src/cost-basis/canada/canada-superficial-loss-engine.ts`
  -> `packages/accounting/src/cost-basis/jurisdictions/canada/workflow/canada-superficial-loss-engine.ts`
- all `canada-tax-*` files
  -> `packages/accounting/src/cost-basis/jurisdictions/canada/tax/`

Completion check:

- the Canada slice has one entrypoint for execution
- Canada tax files are no longer mixed with top-level cost-basis directories

### Phase 5. Land Shared Export Infrastructure

Status:

- [ ] not started

Goal:

- add the top-level export seam after workflow and artifact families are stable

Create:

- `packages/accounting/src/cost-basis/export/export-tax-package.ts`
- `packages/accounting/src/cost-basis/export/tax-package-types.ts`
- `packages/accounting/src/cost-basis/export/tax-package-review-gate.ts`
- `packages/accounting/src/cost-basis/export/renderers/`

Initial jurisdiction builders:

- `packages/accounting/src/cost-basis/jurisdictions/canada/export/build-canada-tax-package.ts`
- `packages/accounting/src/cost-basis/jurisdictions/us/export/build-us-tax-package.ts`

Host entrypoint to add later:

- `apps/cli/src/features/cost-basis/command/cost-basis-export.ts`

Completion check:

- CLI constructs only the file writer and calls the domain export entrypoint
- export builder lookup flows through the jurisdiction registry

## Verification Checklist Per Phase

Run after each phase:

- `pnpm build`
- targeted vitest for moved cost-basis files
- if artifact terms changed, run the affected repository tests in `packages/data`

Prefer focused test commands while the refactor is in flight.
Do not wait until the end to discover import breakage.

## Progress Tracker

Use this section to record what landed.
Keep completed items short and factual.

### Completed

- Phase 0 registry seam landed:
  - added `jurisdictions/jurisdiction-module.ts`
  - added `jurisdictions/registry.ts`
  - replaced direct workflow Canada branching with registry-driven dispatch
  - replaced direct rules instantiation in shared/report code with registry lookup
  - renamed `base-rules.ts` to `jurisdiction-rules.ts`
- Phase 1 jurisdiction slice move landed:
  - added `jurisdictions/us/config.ts` and `jurisdictions/us/rules.ts`
  - added `jurisdictions/canada/config.ts` and `jurisdictions/canada/rules.ts`
  - updated `jurisdiction-configs.ts` to aggregate slice-owned config
  - removed top-level `us-rules.ts` and `canada-rules.ts`
  - migrated runtime and test imports to the jurisdiction slice paths
- Phase 2 standard-engine move landed:
  - moved accounting exclusion, review preflight, and price validation into `standard/validation/`
  - moved gain/loss, standard calculator, and pipeline into `standard/calculation/`
  - moved display report generation into `standard/reporting/`
  - moved `matching/`, `lots/`, and `strategies/` into `standard/`
  - updated workflow, price-enrichment, package exports, and tests to use the new `standard/` paths
  - renamed runtime workflow/result terminology from `generic-pipeline` to `standard-workflow`
  - renamed persisted artifact terminology from `generic` to `standard`
  - updated CLI hosts and repository tests to use the renamed standard artifact family
- Phase 3 model/workflow/artifact split started:
  - moved cost-basis config, schemas, types, and report types into `model/`
  - moved workflow execution files into `workflow/`
  - moved artifact storage/reuse files into `artifacts/`
  - moved transaction price coverage checks into `workflow/`
  - moved tax asset identity rules into `model/`
  - moved cost-basis helper utilities into `workflow/`
  - consolidated workflow price coverage into `workflow/price-completeness.ts`
  - aligned the newly moved workflow tests under `workflow/__tests__/`
  - updated package exports, tests, and internal imports to the new slice boundaries
  - removed the legacy `shared/` and `orchestration/` directories after their contents were rehomed

### In Progress

- No active phase beyond the completed Phase 3 structural split
- Phase 4 Canada slice nesting is the next structural step
- Shared export infrastructure still remains to be carved out into top-level `export/`

### Next Up

- Phase 4: nest Canada specialized workflow internals under `jurisdictions/canada/workflow/` and `jurisdictions/canada/tax/`

## Naming Cleanup To Apply During The Refactor

These names are clearer than the current ones:

- `base-rules.ts` -> `jurisdiction-rules.ts`
- `generic-pipeline` -> `standard-workflow`
- `generic` artifact family -> `standard`
- `orchestration/` -> split into `workflow/` and `artifacts/`

Avoid introducing new catch-all names such as:

- `core/`
- `shared/`
- `common/`

unless the directory has one narrow responsibility.
