# Accounting Feature Structure Migration

This document defines the target folder shape for `packages/accounting/src/*`
after the `cost-basis` cleanup.

The package should stay capability-first. The goal is not to recreate layered
architecture inside `accounting`. The goal is:

- clear entrypoints for host-facing workflows
- explicit sub-capabilities for heavy internal mechanics
- one predictable place for feature-local types, schemas, config, and pure
  helpers
- tests colocated with the slice they verify

## Decision

For feature-sized areas inside `packages/accounting/src/`, use this vocabulary:

```text
packages/accounting/src/<feature>/
  orchestration/
  shared/
  <feature-specific subcapability>/
  strategies/ or rules/ when the feature naturally has them
```

Meaning:

- `orchestration/`
  - workflow entrypoints used by the host or other packages
  - pipelines
  - report generators
  - service-level coordinators
- `shared/`
  - feature-local config
  - types
  - schemas
  - validation
  - pure helpers used across multiple subfolders
- feature-specific subcapabilities
  - the heavy mechanics unique to that feature
  - examples: `matching/`, `pre-linking/`, `lots/`

## Reference: Cost-Basis

Current reference shape:

```text
packages/accounting/src/cost-basis/
  orchestration/
    cost-basis-workflow.ts
    cost-basis-pipeline.ts
    cost-basis-calculator.ts
    cost-basis-report-generator.ts
    transaction-price-coverage-utils.ts
  matching/
    build-cost-basis-scoped-transactions.ts
    lot-matcher.ts
    validated-scoped-transfer-links.ts
  lots/
    lot.ts
    lot-creation-utils.ts
    lot-disposal-utils.ts
    lot-fee-utils.ts
    lot-sorting-utils.ts
    lot-transfer-processing-utils.ts
    lot-transfer-utils.ts
    lot-update-utils.ts
    internal-carryover-processing-utils.ts
  shared/
    cost-basis-config.ts
    cost-basis-utils.ts
    cost-basis-validation-utils.ts
    gain-loss-utils.ts
    report-types.ts
    schemas.ts
    types.ts
  jurisdictions/
  strategies/
```

This is the reference to migrate the other accounting features toward.

## Rules

### 1. Host-facing entrypoints go in `orchestration/`

If a file is imported by the CLI host or re-exported as a top-level feature
entrypoint, it likely belongs in `orchestration/`.

Examples from cost-basis:

- `CostBasisWorkflow`
- `runCostBasisPipeline`
- `checkTransactionPriceCoverage`
- `CostBasisReportGenerator`

### 2. Heavy internal mechanics get a named sub-capability

Do not leave a large feature folder flat if it contains a distinct engine.

Examples:

- `cost-basis/matching/`
- `cost-basis/lots/`
- `linking/pre-linking/`
- `linking/strategies/`

### 3. `shared/` is feature-local, not global

`shared/` inside a feature means:

- shared within that feature only
- not promoted to `packages/accounting/src/shared/`
- not promoted to `@exitbook/core`

Move something to `core` only if multiple capability packages truly need it.

### 4. Colocate tests with the migrated slice

After migration:

- `orchestration/` tests live in `orchestration/`
- `shared/` tests live in `shared/`
- sub-capability tests live beside that sub-capability

Do not rebuild a giant feature-root `__tests__/` folder after splitting the
feature.

### 5. Keep package exports stable until a deliberate API cleanup

Structural migration and public API reduction are different changes.

During folder migration:

- update `packages/accounting/src/index.ts` export paths
- do not silently remove exports as part of the same step unless that API
  reduction is explicitly planned

## Migration Plan: Linking

`linking/` already has real sub-capabilities (`pre-linking/`, `strategies/`).
What it lacks is the same top-level vocabulary as `cost-basis`.

### Target shape

```text
packages/accounting/src/linking/
  orchestration/
    linking-orchestrator.ts
    linking-orchestrator-utils.ts
    override-replay.ts
    linking-events.ts
  matching/
    linkable-movement.ts
    link-construction.ts
    link-index.ts
    match-allocation.ts
    matching-config.ts
    strategy-runner.ts
  pre-linking/
    build-linkable-movements.ts
    group-same-hash-transactions.ts
    reduce-blockchain-groups.ts
    types.ts
    index.ts
  shared/
    schemas.ts
    types.ts
  strategies/
    amount-timing-strategy.ts
    amount-timing-utils.ts
    exact-hash-strategy.ts
    exact-hash-utils.ts
    partial-match-strategy.ts
    same-hash-external-outflow-strategy.ts
    types.ts
    index.ts
```

### Step order

1. Create `orchestration/`, `matching/`, and `shared/`.
2. Move orchestration files first:
   - `linking-orchestrator.ts`
   - `linking-orchestrator-utils.ts`
   - `override-replay.ts`
   - `linking-events.ts`
3. Move core matching files:
   - `linkable-movement.ts`
   - `link-construction.ts`
   - `link-index.ts`
   - `match-allocation.ts`
   - `matching-config.ts`
   - `strategy-runner.ts`
4. Move `schemas.ts` and `types.ts` into `shared/`.
5. Keep `pre-linking/` and `strategies/` in place; they are already named
   sub-capabilities.
6. Move the current root `__tests__/` into the corresponding slice folders.
7. Update `packages/accounting/src/index.ts` re-exports only after all file
   moves are complete.

## Migration Plan: Price-Enrichment

`price-enrichment/` is still mostly flat. It needs the same top-level structure
even though its domain slices differ from cost-basis.

### Target shape

```text
packages/accounting/src/price-enrichment/
  orchestration/
    price-enrichment-pipeline.ts
    price-inference-service.ts
    price-normalization-service.ts
    price-fetch-service.ts
  enrichment/
    movement-enrichment-utils.ts
    price-enrichment-utils.ts
    price-fetch-utils.ts
    price-normalization-utils.ts
    price-calculation-utils.ts
  graph/
    link-graph-utils.ts
  shared/
    price-events.ts
    types.ts
  fx/
    standard-fx-rate-provider.ts
```

### Step order

1. Create `orchestration/`, `enrichment/`, `graph/`, `shared/`, and `fx/`.
2. Move the pipeline and service entrypoints into `orchestration/`.
3. Move utility files that manipulate movements or price state into
   `enrichment/`.
4. Move graph-specific helpers into `graph/`.
5. Move `types.ts` and `price-events.ts` into `shared/`.
6. Move `standard-fx-rate-provider.ts` into `fx/`.
7. Move current `__tests__/` files into the matching slice folders.

## Package-Wide Rollout Order

1. Finish validating the `cost-basis` structure as the reference.
2. Migrate `linking/`.
3. Migrate `price-enrichment/`.
4. Only after all three features share the same top-level vocabulary, consider
   a second pass on package exports and naming cleanup.

## Migration Checklist

For each accounting feature:

1. Identify host-facing entrypoints and move them to `orchestration/`.
2. Identify the heaviest internal engine and give it a named subfolder.
3. Move feature-local config, schemas, types, validation, and cross-slice pure
   helpers into `shared/`.
4. Keep existing named sub-capabilities when they already express real domain
   boundaries.
5. Move tests beside the new slice.
6. Update internal imports.
7. Update `packages/accounting/src/index.ts`.
8. Run targeted tests for that feature before starting the next one.

## Explicit Non-Goals

- Do not create a package-wide `shared/` dumping ground.
- Do not force every feature to have the exact same second-level folders.
- Do not mix public API cleanup with mechanical file moves unless that change is
  reviewed separately.
