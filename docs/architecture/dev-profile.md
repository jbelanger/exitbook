# ExitBook Dev Profile (Architecture + Code Style)

## Core Identity

Build like a financial systems engineer who values correctness and readability over cleverness:

- Safety-first data integrity (fail-fast, explicit validation, no silent data loss).
- Feature-sliced modules over generic technical layers.
- Functional core + imperative shell where practical.
- Minimal abstractions until repetition proves they are needed.
- Clear error paths and explicit logging for unexpected states.

## Keep These Strengths

### 1) Strong invariants at boundaries

- Runtime validation with Zod is used consistently across domains.
- `neverthrow` `Result` flows reduce hidden throw paths.
- Processors fail fast when raw/normalized data is incomplete.

### 2) Good package decomposition

- Monorepo split into focused packages (`core`, `ingestion`, `data`, providers, accounting, CLI).
- Each package has a clear responsibility and reusable exports.

### 3) Domain-first utility design

- Important transformations are implemented as explicit pure helpers (especially in provider and ingestion utilities).
- Decimal handling and asset identity rules are centralized.

### 4) Observability by default

- Detailed warnings/errors for recoverable and unrecoverable anomalies.
- Event-driven progress model for long-running imports/processes.

### 5) Pragmatic architecture decisions

- Dynamic registry/discovery patterns for providers/adapters.
- Batch-processing strategies chosen per source type.

## Where Code Is Over-Complex Today

### 1) Mega-files with mixed responsibilities

- `packages/blockchain-providers/src/core/provider-manager.ts` has many concerns in one class (registration, scoring orchestration, failover loops, cache lifecycle, health lifecycle, event emission).
- `packages/ingestion/src/sources/blockchains/near/processor.ts` mixes orchestration, enrichment, fallback balance derivation, aggregation, and asset-ID construction.
- `apps/cli/src/ui/dashboard/dashboard-components.tsx` and `apps/cli/src/ui/dashboard/dashboard-updater.ts` are very large and difficult to reason about.

### 2) Switch-heavy orchestration paths

- Event handling is explicit and safe, but currently centralized and verbose (`apps/cli/src/ui/dashboard/dashboard-updater.ts`).
- Same pattern appears in several service-level flows, reducing locality and making edits harder.

### 3) Partial duplication and near-duplicate logic

- Similar lifecycle flows (count, process, emit, error) appear in multiple service methods.
- Several formatting/rendering branches in dashboard components could be composed from shared primitives.

### 4) Leaky package surface details

- `packages/data/src/index.ts` exports two modules through `../../data/src/...` paths instead of local package-relative exports.

## Style Guardrails to Adopt

1. One file = one dominant reason to change.
2. Prefer data tables/handler maps over giant `switch` blocks once branches exceed maintainability threshold.
3. Keep orchestration methods <120 lines where possible; move transformation rules into pure helpers.
4. Avoid speculative abstractions. Introduce abstractions only after third concrete repetition.
5. Require explicit naming for domain intent (`*Policy`, `*Rules`, `*Normalizer`, `*Mapper`, `*Orchestrator`).
6. Keep strict error semantics: no swallowed errors, no implicit defaults for unknown states.

## High-Value Refactor Themes (Month-Scale)

### Theme A: Dashboard decomposition

- Extract event handler registry by bounded concern (`xpub`, `import`, `provider`, `process`, `metadata`).
- Split rendering into section-level components with shared line primitives.
- Preserve event contract and state shape while shrinking per-file cognitive load.

### Theme B: Ingestion orchestration slimming

- Split `TransactionProcessService` into:
  - `ProcessLifecycleOrchestrator`
  - `RawDataNormalizationService`
  - `BatchExecutionRunner`
  - `ProcessingSafetyGuards`
- Keep public API stable while reducing method and class size.

### Theme C: NEAR processor simplification

- Separate pipeline stages into explicit pure steps:
  - delta derivation
  - grouping/correlation
  - movement extraction
  - transaction assembly
- Keep fail-fast semantics, but reduce nested control flow and mutable state.

### Theme D: Provider manager modularization

- Break manager internals into collaborators:
  - provider selection coordinator
  - failover executor
  - cache lifecycle
  - health/circuit lifecycle
- Preserve external API and behavior.

## Naming Clarity Suggestions

- `processAccountWithBatchProvider` -> `runAccountProcessingLoop`
- `normalizedWithDerivedDeltas` -> `eventsWithDerivedDeltas`
- `processingErrors` (NEAR processor) -> `failedTransactionErrors`
- `handleImportStarted`/`handleImportBatch` style handlers -> group under `importEventHandlers.*` modules
- `createBatchProvider` -> `selectRawDataBatchStrategy`

## Default Architectural Decision Rule

When choosing between options:

1. Preserve financial correctness invariants.
2. Minimize cognitive load for the next maintainer.
3. Prefer explicit code over framework-like abstraction.
4. Optimize runtime only where profiling or scale requires it.
5. Keep vertical slices discoverable (feature folder contains importer/processor/schemas/tests).
