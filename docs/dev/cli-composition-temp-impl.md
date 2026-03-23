---
status: draft
last_updated: 2026-03-23
---

# CLI Command Scope End-State Design

## Summary

This document replaces the earlier temporary plan that centered the CLI around
`apps/cli/src/composition/*` wrapper modules.

That plan improved startup wiring, but it does not reach the actual goal:

- dumb-easy reasoning
- minimum end-state code
- one obvious owner for command-scoped resources

The target end state is smaller:

- one immutable app runtime
- one per-command scope
- command files that only parse, dispatch, and render
- feature runner functions that execute work against the command scope
- explicit prereq functions instead of a generic projection-runtime registry

This is not a minimum-change plan. It assumes a larger refactor is acceptable if
it produces a smaller and simpler steady state.

## Design Principles

### 1. One owner per lifetime

The CLI has three real lifetimes:

- app lifetime
- command lifetime
- local execution lifetime inside a single function

Each lifetime should have one clear owner.

### 2. Prefer fewer abstractions over generic abstractions

The goal is not a more flexible wiring system.

The goal is code that is obvious on first read.

That means:

- plain objects over containers
- plain functions over classes when state is not needed
- explicit prereq functions over generic runtime registries
- deleting wrapper layers when they only forward arguments

### 3. Delivery code should not assemble infrastructure ad hoc

Command files should not:

- open databases
- construct registries
- read provider config
- open provider runtimes
- decide how cleanup is registered

They should:

- parse flags
- choose JSON vs TUI
- call a feature runner
- format output

### 4. Command-scoped resources belong to the command scope

Anything that should live for the duration of one command belongs to the
command scope:

- database connection
- command abort handling
- command cleanup stack
- lazily opened provider runtimes shared within that command

Anything shorter-lived should use local `try/finally`.

## The End-State Model

### 1. App runtime

Keep one immutable startup object:

```ts
export interface CliAppRuntime {
  dataDir: string;
  databasePath: string;
  adapterRegistry: AdapterRegistry;
  priceProviderConfig: PriceProviderConfig;
  blockchainExplorersConfig: BlockchainExplorersConfig | undefined;
}

export function createCliAppRuntime(): Result<CliAppRuntime, Error>;
```

Responsibilities:

- normalize CLI host config once
- construct `AdapterRegistry` once
- derive filesystem paths once
- load optional explorer config once

Non-responsibilities:

- do not hold live DB connections
- do not hold live provider runtimes
- do not own cleanup

### 2. Command scope

The current `CommandContext` should evolve into the actual per-command scope.

Preferred end-state location:

- `apps/cli/src/runtime/command-scope.ts`

Possible contract:

```ts
export class CommandScope {
  constructor(readonly app: CliAppRuntime);

  database(): Promise<DataContext>;
  blockchainRuntime(): Promise<Result<OpenedCliBlockchainProviderRuntime, Error>>;
  priceRuntime(options?: OpenedPriceRuntimeOptions): Promise<Result<IPriceProviderRuntime, Error>>;

  onCleanup(fn: () => Promise<void>): void;
  onAbort(fn: () => void): void;
  closeDatabase(): Promise<void>;
  dispose(): Promise<void>;
}

export async function runCommand<T>(
  app: CliAppRuntime,
  fn: (scope: CommandScope) => Promise<T>
): Promise<T>;
```

Responsibilities:

- lazy DB lifecycle
- lazy shared provider-runtime lifecycle for the command
- abort registration
- cleanup stack
- disposal ordering

Important:

- one command scope per command invocation
- command-scoped resources are shared within the scope
- cleanup happens once, in one place

### 3. Feature runner functions

The default execution shape should be a function, not a handler class.

Preferred examples:

```ts
export async function runImport(scope: CommandScope, params: ImportParams): Promise<Result<ImportResult, Error>>;

export async function runCostBasis(
  scope: CommandScope,
  params: ValidatedCostBasisConfig,
  options?: { refresh?: boolean | undefined }
): Promise<Result<CostBasisWorkflowResult, Error>>;
```

Stateful abortable objects should only exist when genuinely needed, for example:

- long-running streaming workflows
- event-relay-driven TUI flows

If a command does need that, it should return a small explicit shape such as:

```ts
interface AbortableRun<TResult> {
  abort(): void;
  run(): Promise<Result<TResult, Error>>;
}
```

That should be the exception, not the default architecture.

### 4. Explicit prereq functions

The current `projection-runtime.ts` shape is too abstract for what it does.

Preferred end-state:

- `apps/cli/src/runtime/consumer-prereqs.ts`
- `apps/cli/src/runtime/reset-projections.ts`

Replace generic runtime-registry abstractions with plain functions:

```ts
export async function ensureProcessedTransactions(scope: CommandScope): Promise<Result<void, Error>>;
export async function ensureAssetReview(scope: CommandScope): Promise<Result<void, Error>>;
export async function ensureLinks(scope: CommandScope): Promise<Result<void, Error>>;
export async function ensurePriceCoverage(
  scope: CommandScope,
  window: PriceWindow,
  policy?: AccountingExclusionPolicy
): Promise<Result<void, Error>>;

export async function ensureConsumerInputs(
  scope: CommandScope,
  target: ConsumerTarget,
  options?: EnsureConsumerInputsOptions
): Promise<Result<void, Error>>;
```

This is less code than:

- `ProjectionRuntime`
- `ProjectionRuntimeDeps`
- `buildProjectionRuntimeRegistry()`
- generic rebuild/runtime registries

It is also much easier to reason about.

## What This Design Deletes

### Delete app-layer wrapper modules

The end state should delete:

- `apps/cli/src/composition/ingestion.ts`
- `apps/cli/src/composition/accounting.ts`
- `apps/cli/src/composition/links.ts`
- `apps/cli/src/composition/balances.ts`

Keep only a runtime file, ideally moved to:

- `apps/cli/src/runtime/app-runtime.ts`

### Delete the tiered handler model as the CLI contract

The CLI should no longer be defined as:

- Tier 1 DB-only handlers
- Tier 2 infrastructure handlers
- Tier 3 inline commands

That taxonomy adds explanation overhead without improving the code.

The simpler rule is:

- command files call feature runner functions against a command scope
- use stateful execution objects only when streaming state is real

### Delete the `ctx, database, registry` factory signature pattern

These signatures are not the end state:

- `createImportHandler(ctx, database, registry)`
- `createReprocessHandler(ctx, database, registry)`
- `createCostBasisHandler(ctx, database, options)`
- `createPortfolioHandler(ctx, database, options)`

The end state is:

- `runImport(scope, params)`
- `runReprocess(scope, params)`
- `runCostBasis(scope, params, options)`
- `runPortfolio(scope, params)`

or, when stateful execution is required:

- `createImportRun(scope, options)`
- `createBalanceRefreshRun(scope, options)`

The key rule is one scope argument, not a bag of separately threaded host deps.

## Command File Shape

End-state command files should look like this:

```ts
const appRuntimeResult = createCliAppRuntime();
if (appRuntimeResult.isErr()) throw appRuntimeResult.error;

const appRuntime = appRuntimeResult.value;

registerImportCommand(program, appRuntime);
```

And inside a command:

```ts
await runCommand(appRuntime, async (scope) => {
  const result = await runImport(scope, params);
  if (result.isErr()) throw result.error;

  outputSuccess('import', result.value);
});
```

Command files should not:

- call `ctx.database()` directly for infrastructure-heavy commands
- spread provider config manually
- call raw runtime openers
- perform prereq orchestration

## Cleanup Rules

### Command-scoped resources

Anything shared for the duration of the command belongs in the command scope and
should be cleaned up by scope disposal.

Examples:

- database
- shared blockchain provider runtime
- shared price provider runtime

### Local resources

Anything created and consumed entirely inside one function should use local
`try/finally`.

Examples:

- one-off temporary presenters
- one-shot helper runtimes used only inside a short function

### The important split

The code should never make the reader guess whether cleanup is:

- command-scoped and hidden in a random factory
- local and handled inline

That split must be obvious from the API.

## Suggested File Layout

```text
apps/cli/src/
  runtime/
    app-runtime.ts
    command-scope.ts
    consumer-prereqs.ts
    reset-projections.ts
  features/
    import/command/
      import.ts
      run-import.ts
    reprocess/command/
      reprocess.ts
      run-reprocess.ts
    cost-basis/command/
      cost-basis.ts
      run-cost-basis.ts
    portfolio/command/
      portfolio.ts
      run-portfolio.ts
    prices/command/
      prices-enrich.ts
      run-prices-enrich.ts
    links/command/
      links-run.ts
      run-links.ts
    balance/command/
      balance-view.ts
      view-balance-snapshots.ts
      balance-refresh.ts
      run-balance-refresh.ts
```

Notes:

- the exact filenames can vary
- the important thing is `scope + feature runner`, not the suffix
- existing `*-handler.ts` files may remain temporarily during migration, but
  they are not the desired end-state contract

## Concrete Corrections Implied By This Design

These are not optional polish items. They fall directly out of the target model.

- remove duplicate price-provider env/config building
- stop treating `balance view` and `balance refresh` as the same assembled path
- move `links` prereq orchestration out of app wrapper code
- stop documenting the CLI in terms of handler tiers
- stop requiring tests to call different construction paths than production code

## Exit Criteria

This design is achieved when:

- the CLI has one immutable app runtime
- each command invocation has one command scope
- feature execution uses one scope argument instead of `ctx + db + registry`
- command-scoped provider runtimes are shared within the scope
- `projection-runtime.ts` has been replaced by explicit prereq functions
- the composition-wrapper layer is gone
- the tiered handler model is no longer the documented CLI contract

## Naming Notes

Preferred names:

- `app-runtime.ts`
- `command-scope.ts`
- `consumer-prereqs.ts`
- `reset-projections.ts`
- `run-import.ts`
- `run-cost-basis.ts`
- `run-portfolio.ts`

Names to avoid:

- `composition/*` for thin pass-through wrappers
- `handler-contracts` as the primary wiring model
- `projection-runtime` for a file that really means prereq orchestration
- vague buckets such as `shared`, `utils`, and `helpers`
