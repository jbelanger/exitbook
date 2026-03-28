# CLI Command Wiring

The preferred end-state CLI wiring model is:

- one immutable app runtime
- one per-command scope
- one feature-specific command-scope helper
- command files that parse/render only
- feature runner functions that execute against the scope

Do not design new CLI code around tiered handler categories.

## Core Model

### App runtime

The app runtime is created once at startup and holds immutable host config:

- data directory / DB path
- adapter registry
- normalized provider config
- optional explorer config

It does not own live command resources.

### Command scope

Each command invocation gets one command scope.

The scope owns:

- lazy DB access
- lazy shared provider runtimes for that command
- abort registration
- cleanup registration
- disposal ordering

This is the resource ownership boundary for the CLI.

### Feature runner functions

Command files should call `with*CommandScope(...)`, then feature runner functions with the prepared feature scope:

```ts
await runCommand(appRuntime, async (scope) => {
  const result = await withImportCommandScope(scope, (importScope) => runImport(importScope, params));
  if (result.isErr()) throw result.error;
});
```

Prefer plain functions:

- `runImport(scope, params)`
- `runReprocess(scope, params)`
- `runCostBasis(scope, params, options)`
- `runPortfolio(scope, params)`

Only use a stateful abortable object when streaming state is real and cannot be
expressed clearly as a plain function.

## File Layout

Preferred shape:

```text
runtime/
  app-runtime.ts
  command-runtime.ts

features/<feature>/command/
  <feature>.ts               - Commander registration, option parsing, JSON/TUI dispatch, rendering
  <feature>-command-scope.ts - feature-owned preparation of profile/prereqs/runtime wiring
  run-<feature>.ts           - feature execution against the prepared feature scope

features/shared/
  consumer-input-readiness.ts
  projection-readiness.ts
  projection-reset.ts
  price-readiness.ts
  asset-review-projection-runtime.ts
```

Existing `*-handler.ts` files may remain as internal execution objects, but
command files should not depend on CLI-wired `create*Handler(...)` factories.

## Rules

Command files should:

- validate CLI flags
- choose presentation mode
- call `with*CommandScope(...)` for infrastructure-heavy feature execution
- call a feature runner function
- format output or render TUI

Command files should not:

- assemble registries
- open provider runtimes directly
- spread host config manually
- perform prereq orchestration inline
- own feature-scoped runtime wiring

Lightweight render concerns are still fine in command files:

- prompt for missing interactive input
- close the database early before long-lived TUI render-only phases
- map runner output into JSON payloads or TUI state

Feature runner functions should:

- receive `scope` as the single host/runtime argument
- call explicit prereq helpers when needed
- obtain command-scoped resources from the scope
- use local `try/finally` only for short-lived local resources

Feature command-scope helpers should:

- resolve the selected profile when the feature needs one
- run feature-specific prereq orchestration
- construct feature-local execution helpers or handlers
- keep cleanup ownership inside `CommandRuntime`

## Prereqs

Do not hide prereq orchestration behind a generic runtime registry.

Prefer explicit functions such as:

- `ensureProcessedTransactionsReady(scope, options)`
- `ensureAssetReviewReady(scope)`
- `ensureLinksReady(scope, options)`
- `ensurePriceCoverage(scope, window, policy)`
- `ensureConsumerInputs(scope, target, options)`

The current CLI files for this are:

- `apps/cli/src/features/shared/consumer-input-readiness.ts`
- `apps/cli/src/features/shared/projection-readiness.ts`
- `apps/cli/src/features/shared/projection-reset.ts`
- `apps/cli/src/features/shared/price-readiness.ts`

Keep those modules flat and explicit. Do not reintroduce a registry or strategy map for prereq execution.

## Cleanup

Command-scoped resources:

- live for the duration of the command
- are owned by the command scope
- are disposed once, by the scope

Local resources:

- are created and consumed inside one function
- use local `try/finally`

The code should make that distinction obvious.

## Anti-Patterns

Avoid introducing new code that depends on:

- `createFooHandler(ctx, database, registry)`
- `createFooHandler(ctx, options)` as a CLI composition shortcut
- `composeFooHandler(appRuntime, ctx, ...)`
- tiered handler taxonomies
- generic consumer-prereq registries
- command files manually assembling feature runtimes for infrastructure-heavy flows
