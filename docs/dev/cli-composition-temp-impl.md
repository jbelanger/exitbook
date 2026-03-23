---
status: draft
last_updated: 2026-03-22
---

# CLI Composition Temporary Implementation Plan

## Summary

This document proposes a temporary app-layer implementation for centralizing CLI composition into
`apps/cli/src/composition/` without bundling it to the remaining architecture cleanup elsewhere in the repo.

Goals:

- give the CLI one clear app composition root
- stop command files from assembling databases, provider runtimes, and handler factories ad hoc
- keep delivery concerns in the CLI while leaving business logic in feature packages
- reduce the current spread of composition code across `index.ts`, command files, handler factories, and `features/shared/*`

Non-goals for this pass:

- do not introduce a DI container
- do not bundle this work to unrelated package-boundary cleanup elsewhere in the repo
- do not fully redesign feature workflows
- do not move business policy into the app layer

This is a temporary implementation plan. It is intentionally incremental.

## Why This Exists

The architecture contract already says:

- app packages own composition
- composition should be centralized per app
- handlers should consume assembled modules rather than constructing dependencies ad hoc

The CLI is not there yet.

Current composition is spread across:

- `apps/cli/src/index.ts`
- command files such as `apps/cli/src/features/import/command/import.ts`
- handler factories such as `createImportHandler()` and `createPortfolioHandler()`
- app-internal runtime helpers under `apps/cli/src/features/shared/`

Current pain points:

- command files repeatedly call `ctx.database()`
- command files sometimes run prereqs directly, for example `ensureConsumerInputsReady()`
- command files sometimes register abort handlers directly
- provider runtime opening is scattered across commands, handlers, and shared helpers
- `features/shared/` is acting as a misc bucket instead of a clear boundary

## Temporary Decision

For the first pass, composition files should own app-layer assembly for the infrastructure-heavy CLI commands.

They may call the current handler factories where that avoids churn, but they should not add a second generic wrapper
interface on top of handlers.

That means we are not forcing a full redesign of:

- `createImportHandler()`
- `createPortfolioHandler()`
- `createPricesEnrichHandler()`

The first win is structural:

- command files stop assembling dependencies directly
- `apps/cli/src/composition/` becomes the only app-layer wiring entry point

At the same time, this pass should tackle the current `projection-runtime.ts` split early, because that file is where
the most problematic mixing still lives.

## Target Layout

```text
apps/cli/src/
  composition/
    runtime.ts
    ingestion.ts
    accounting.ts
    links.ts
    balances.ts
```

Notes:

- keep the composition directory flat for now
- avoid adding `shared/`, `utils/`, or `helpers/` under `composition/`
- group by capability, not by technical layer
- these are CLI assembly modules grouped by capability; they are intentionally outside the feature packages because
  they are app-layer wiring, not feature-owned business logic

## Composition Contracts

### 1. App runtime

Create `apps/cli/src/composition/runtime.ts`.

It should export:

```ts
export interface CliAppRuntime {
  dataDir: string;
  adapterRegistry: AdapterRegistry;
  priceProviderConfig: CliPriceProviderConfig;
  blockchainExplorersConfig: BlockchainExplorersConfig;
}

export function createCliAppRuntime(): Result<CliAppRuntime, Error>;
```

Responsibilities:

- resolve `dataDir` once
- construct `AdapterRegistry` once
- normalize price-provider config from env once
- load blockchain explorer config once
- pass explicit config to composition functions

Important:

- `index.ts` should create this once at startup
- `register*Command()` functions should receive `CliAppRuntime`, not a raw `AdapterRegistry`

### 2. Command lifecycle stays outside `composition/`

The current command lifecycle file is:

- `apps/cli/src/features/shared/command-runtime.ts`

This pass should keep that responsibility out of `apps/cli/src/composition/`.

It owns command infrastructure:

- `CommandContext`
- `runCommand`
- `renderApp`
- `adaptResultCleanup`

That is not capability composition.

If we rename or move it later, it should move to a sibling app-level location, for example:

```ts
apps / cli / src / command - runtime.ts;
```

This file owns:

- per-command DB lifecycle
- cleanup stack
- abort registration
- disposal
- Ink app render lifecycle

It must not own business workflow decisions.

### 3. Composition functions return existing handlers or assembled values

Each composition file should return the existing handler directly, or inline factory logic and remove the factory if
the factory is thin enough.

Recommended shapes:

```ts
export async function composeImportHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { mode: 'json' | 'tui' }
): Promise<Result<ImportHandler, Error>>;
```

Example:

```ts
export async function composePortfolioHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { mode: 'json' | 'tui' }
): Promise<Result<PortfolioHandler, Error>>;
```

Command files should consume the returned handler and keep using:

- `handler.execute(params)`
- `handler.abort()` when that contract exists

Command files should not:

- call `ctx.database()` directly for the infrastructure-heavy commands covered by this plan
- call `create*Handler()` directly
- call `ensureConsumerInputsReady()` directly
- open provider runtimes directly

## Responsibility Split

### Composition files may do

- get a database from the command runtime
- build adapters and runtimes
- call existing handler factories
- register cleanup with the command runtime
- wire abort handling
- pass explicit host config into provider packages

### Command files may do

- register Commander commands
- parse and validate flags
- choose JSON vs TUI mode
- call composition functions
- format CLI output
- render TUI components

### Feature packages and handlers continue to do

- business logic
- feature workflows
- feature-specific orchestration
- domain validation
- policy decisions

## File-By-File Plan

### Step 1. Add the composition root

Create:

- `apps/cli/src/composition/runtime.ts`
- `apps/cli/src/composition/ingestion.ts`
- `apps/cli/src/composition/accounting.ts`
- `apps/cli/src/composition/links.ts`
- `apps/cli/src/composition/balances.ts`

Do not add a generic `read-models.ts` bucket in this pass.

Focus only on the commands with real infrastructure assembly.

### Step 2. Split `projection-runtime.ts` before building more wrappers

The current file:

- `apps/cli/src/features/shared/projection-runtime.ts`

still mixes too many responsibilities:

- projection freshness checks
- projection rebuild execution
- price coverage prereqs
- TUI monitor wiring
- console output
- consumer-specific policy

Before composition expands, shrink this file into narrower pieces.

Minimum split for this pass:

- extract projection reset helpers into a dedicated file
- extract price coverage prereq logic into a dedicated file
- extract TUI monitor wiring for links/prices into explicit CLI delivery helpers instead of keeping it hidden inside a
  generic projection runtime
- keep consumer-specific policy visible and isolated instead of burying it in a catch-all runtime file

The exact file names can be decided during implementation, but the important rule is:

- do not keep growing `projection-runtime.ts`
- do not move it into `composition/` unchanged

### Step 3. Move startup wiring into `runtime.ts`

Update `apps/cli/src/index.ts`:

- keep logger initialization in `index.ts`
- replace direct `AdapterRegistry` construction with `createCliAppRuntime()`
- pass `appRuntime` to all `register*Command()` functions

Target shape:

```ts
const appRuntimeResult = createCliAppRuntime();
if (appRuntimeResult.isErr()) throw appRuntimeResult.error;

const appRuntime = appRuntimeResult.value;

registerImportCommand(program, appRuntime);
registerReprocessCommand(program, appRuntime);
registerLinksCommand(program, appRuntime);
```

### Step 4. Add first-pass composition modules

#### `apps/cli/src/composition/ingestion.ts`

Own:

- `composeImportHandler()`
- `composeReprocessHandler()`

Implementation details:

- obtain `db` from `ctx.database()`
- call existing `createImportHandler()` / `createReprocessHandler()`
- return the existing handler directly

#### `apps/cli/src/composition/accounting.ts`

Own:

- `composeCostBasisHandler()`
- `composePortfolioHandler()`
- `composePricesEnrichHandler()`

Implementation details:

- obtain `db` from `ctx.database()`
- call existing `createCostBasisHandler()`
- call existing `createPortfolioHandler()`
- call existing `createPricesEnrichHandler()`
- return the existing handler directly

#### `apps/cli/src/composition/links.ts`

Own:

- `composeLinksRunHandler()`

Implementation details:

- after the `projection-runtime.ts` split, this composition file should call the narrowed prereq assembly surface
- then call `createLinksRunHandler()`
- return the existing handler directly

The important change is that `links-run.ts` stops doing app assembly itself.

#### `apps/cli/src/composition/balances.ts`

Own:

- `composeBalanceViewHandler()`
- `composeBalanceRefreshHandler()`

Implementation details:

- wrap `createBalanceHandler()`
- keep provider runtime cleanup and abort hidden from command files

### Step 5. Convert command files

First batch:

- `apps/cli/src/features/import/command/import.ts`
- `apps/cli/src/features/reprocess/command/reprocess.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis.ts`
- `apps/cli/src/features/cost-basis/command/cost-basis-export.ts`
- `apps/cli/src/features/portfolio/command/portfolio.ts`
- `apps/cli/src/features/prices/command/prices-enrich.ts`
- `apps/cli/src/features/links/command/links-run.ts`
- `apps/cli/src/features/balance/command/balance-view.ts`
- `apps/cli/src/features/balance/command/balance-refresh.ts`

Each converted command should follow this pattern:

1. validate CLI flags
2. call `runCommand()`
3. call the relevant `compose*Handler()`
4. optionally register `ctx.onAbort(() => handler.abort())`
5. call `handler.execute(params)`
6. format output

What should disappear from command files:

- `const database = await ctx.database()`
- direct calls to `create*Handler()`
- direct calls to `ensureConsumerInputsReady()`
- direct calls to provider runtime openers

### Step 6. Cleanup after migration

Once the first batch is migrated:

- convert old handler factory exports to internal-only where possible
- shrink `features/shared/`
- decide which files should stay feature-owned versus app-owned

## Example Before And After

### Before

```ts
await runCommand(async (ctx) => {
  const database = await ctx.database();
  const handlerResult = await createImportHandler(ctx, database, registry);
  if (handlerResult.isErr()) throw handlerResult.error;

  const handler = handlerResult.value;
  ctx.onAbort(() => handler.abort());

  const result = await handler.execute(params);
  if (result.isErr()) throw result.error;
});
```

### After

```ts
await runCommand(async (ctx) => {
  const handlerResult = await composeImportHandler(app, ctx, { mode: 'tui' });
  if (handlerResult.isErr()) throw handlerResult.error;

  const handler = handlerResult.value;
  ctx.onAbort(() => handler.abort());

  const result = await handler.execute(params);
  if (result.isErr()) throw result.error;
});
```

The second version is still explicit, but the command file is no longer assembling the app graph.

## Guardrails

### Do not introduce a DI container

The app graph is still small enough that explicit typed composition functions are clearer and cheaper than a container.

### Do not move business policy into composition

Composition should assemble modules and wire lifecycle.

It should not decide:

- fallback pricing policy
- portfolio-specific tolerance rules
- linking thresholds
- accounting semantics

### Do not move `projection-runtime.ts` into `composition/` unchanged

`apps/cli/src/features/shared/projection-runtime.ts` currently mixes:

- assembly
- workflow execution
- UI monitor wiring
- console output
- consumer-specific policy

That file needs a focused split.
That split is part of this pass, not a deferred cleanup item.

Temporary rule:

- composition files may call it
- composition files should not absorb its mixed responsibilities wholesale

### Do not let command files import provider packages directly

Command files should stay at the delivery layer.

If a command needs provider-backed infrastructure, it should receive an assembled handler or other assembled value from
`apps/cli/src/composition/`.

## Exit Criteria For This Temporary Pass

This pass is done when:

- `apps/cli/src/composition/` exists and is the clear CLI composition root
- `apps/cli/src/index.ts` passes one `CliAppRuntime` into command registration
- first-pass infrastructure-heavy commands no longer call `ctx.database()` directly
- first-pass infrastructure-heavy commands no longer call `create*Handler()` directly
- first-pass infrastructure-heavy commands no longer call `ensureConsumerInputsReady()` directly
- command files no longer open provider runtimes directly

It is acceptable if:

- some DB-only commands remain inline for now
- some handler factories still exist and are called from composition files
- the command runtime stays in its current location for now

## Second-Pass Work After This Temp Plan

After the temporary pass is stable:

1. reduce or eliminate `features/shared/` as a misc bucket
2. decide case by case whether remaining handler factories should be kept or inlined
3. push more explicit config normalization to the app runtime so provider helper functions stop reading env/cwd defaults internally
4. decide whether `command-runtime.ts` should be renamed or moved to a clearer app-level home

## Naming Notes

Recommended naming changes:

- `createIngestionInfrastructure` -> `openIngestionCommandRuntime`
- `createImportHandler` stays temporarily, but the app-layer entry point should be `composeImportHandler`
- `createPortfolioHandler` stays temporarily, but the app-layer entry point should be `composePortfolioHandler`

Names to avoid in new code:

- `shared`
- `utils`
- `helpers`
- `runtime` without a capability qualifier
