# Persistence Runtime Plan

## Purpose

This document captures the agreed direction for replacing package-owned SQLite bootstrap with a generic `PersistenceRuntime`.

This is a development plan, not a public contract. It describes:

- what we agreed on
- what is explicitly out of scope
- the target API shape
- the rollout plan and file-level implementation steps

## Current problem

Today, several packages own filesystem-oriented database bootstrap directly:

- `packages/blockchain-providers/src/runtime/create-blockchain-provider-runtime.ts`
- `packages/blockchain-providers/src/provider-stats/persistence/runtime.ts`
- `packages/blockchain-providers/src/token-metadata/persistence/runtime.ts`
- `packages/price-providers/src/runtime/create-price-provider-runtime.ts`
- `packages/data/src/database.ts`
- `packages/data/src/overrides/database.ts`
- `packages/data/src/overrides/override-store.ts`

This creates three problems:

1. Package APIs leak SQLite and host conventions such as `dataDir`.
2. Provider packages that should be publishable are forced to know file placement and bootstrap details.
3. The current `@exitbook/sqlite` package mixes Kysely exports, Node-only setup, SQLite PRAGMAs, plugins, migrations, and connection lifecycle into one abstraction.

## Agreed decisions

### 1. Keep Kysely as the query and migration layer for now

Kysely remains the storage-facing query builder and migration API during this refactor.

This plan does not include a query-layer rewrite.

If React Native / Expo support cannot be achieved cleanly with a Kysely runtime adapter, we can revisit the storage layer later. That is not part of this plan.

### 2. Introduce a generic `PersistenceRuntime`

The host creates one `PersistenceRuntime`.

Packages receive that runtime and ensure their own persistence modules internally.

The host should not have to initialize package-specific database modules manually.

### 3. Hide DB placement from package consumers

Package consumers should call package bootstrap functions such as:

```ts
createBlockchainProviderRuntime({ persistence, ... })
```

They should not need to know:

- which database files a package uses
- which Postgres schemas a package uses
- which migrations need to run

### 4. Keep domain logic out of `PersistenceRuntime`

`PersistenceRuntime` is infrastructure only.

It must not know:

- cache vs ledger vs override business meaning
- accounting policy
- provider domain rules
- app-specific fallback rules

It may know:

- dialect kind
- connection lifecycle
- module placement defaults
- migrations
- per-runtime module caching

### 5. Cache ensured modules per runtime instance

Ensuring a module is idempotent within one runtime instance.

The cache scope is:

- per `PersistenceRuntime` instance
- per module id

There must be no process-global hidden singleton state inside packages.

### 6. Package bootstrap owns module selection

The host passes only `PersistenceRuntime`.

Each package bootstrap function decides which persistence modules it needs and calls `ensure()` itself.

This keeps publishable packages self-contained while avoiding host-side micro-wiring.

### 7. Package bootstrap owns optional vs required persistence

`PersistenceRuntime` only reports module initialization success or failure.

It does not decide whether a failed module is fatal for a package runtime.

Package bootstrap code owns that decision.

Examples:

- required module: return early on `ensure()` failure
- optional module: log a warning, continue in degraded mode

This preserves current package behavior where appropriate. For example, `blockchain-providers` currently tolerates missing provider-stats and token-metadata persistence and continues with reduced functionality.

### 8. Keep dialect implementations explicit

Schema and migration definitions remain explicit per dialect.

We are not trying to force one migration source through portability helpers or a custom portability DSL.

Default stance:

- one shared runtime contract
- one shared package-facing persistence facade
- explicit `sqlite` and `pg` implementations underneath

Node SQLite and Expo SQLite share the logical `sqlite` dialect. Their difference belongs in runtime factories and driver adapters, not in separate schema trees.

### 9. Keep migrations programmatic

Migrations continue to live in code and are supplied directly by each persistence module.

We are not adopting runtime filesystem discovery for migrations.

This matches the current Kysely migration usage and works better for tests, workspace packages, and future mobile runtimes.

### 10. Treat module boundaries as transaction boundaries

We do not support generic cross-module transactions in v1.

Anything that must commit atomically together must live in the same persistence module.

This is especially important for `packages/data`, where the first cut should keep all transactionally coupled tables in one main module.

### 11. Overrides becomes a normal ensured module

The current per-operation open/callback/close pattern for overrides is an implementation artifact of the old SQLite wiring.

Under `PersistenceRuntime`, overrides should become a normal ensured module with a long-lived connection owned by the runtime lifecycle.

## Explicit non-goals

- No domain metadata such as `storageClass` inside `PersistenceRuntime`.
- No host requirement to call `ensure(providerStatsModule)` or similar directly.
- No global persistence singleton.
- No custom ORM or custom query DSL.
- No attempt to force SQLite and Postgres into one shared migration source.
- No generic distributed transaction layer across modules.
- No query-layer rewrite as part of this plan.

## Target API shape

### Runtime interface

```ts
export interface PersistenceRuntime {
  readonly kind: 'sqlite' | 'pg';

  ensure<TFacade>(module: PersistenceModule<TFacade>): Promise<Result<TFacade, Error>>;
  dispose(): Promise<Result<void, Error>>;
}
```

`ensure()` is responsible for:

1. selecting the correct dialect definition for the runtime
2. opening or reusing the underlying store
3. running module migrations once
4. constructing the module facade
5. caching the result for later calls

### Module interface

```ts
export interface PersistenceModule<TFacade> {
  moduleId: string;
  sqlite?: () => Promise<SqliteModuleDef<TFacade>>;
  pg?: () => Promise<PgModuleDef<TFacade>>;
}

export interface SqliteModuleDef<TFacade> {
  migrations: Record<string, Migration>;
  connect(args: { db: Kysely<any> }): TFacade;
}

export interface PgModuleDef<TFacade> {
  migrations: Record<string, Migration>;
  connect(args: { db: Kysely<any>; schemaName: string }): TFacade;
}
```

Notes:

- `connect()` is the package-specific factory for the persistence facade.
- `TFacade` is the module's usable persistence surface.
- The lazy `sqlite` / `pg` functions avoid eager imports of unused dialect code, which matters for React Native bundles.
- `Kysely<any>` is shown here as a doc-level simplification. Real module code should use its own typed DB aliases locally.

### Runtime factories

```ts
createNodeSqlitePersistenceRuntime(config): PersistenceRuntime
createExpoSqlitePersistenceRuntime(config): PersistenceRuntime
createPgPersistenceRuntime(config): PersistenceRuntime
```

All factories return the same interface.

### Placement defaults

Placement is infrastructure configuration, not package API.

Default behavior:

- Node SQLite: each `moduleId` maps to `{moduleId}.db`
- Expo SQLite: each `moduleId` maps to a database name derived from `moduleId`
- Postgres: each `moduleId` maps to a schema name derived from `moduleId`

Placement must be overridable in runtime configuration, but package code must not depend on custom placement details.

## How package code uses it

### Package bootstrap

Example target shape for `packages/blockchain-providers/src/runtime/create-blockchain-provider-runtime.ts`:

```ts
export interface BlockchainProviderRuntimeOptions {
  persistence: PersistenceRuntime;
  eventBus?: EventBus<ProviderEvent> | undefined;
  explorerConfig?: BlockchainExplorersConfig | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}

export async function createBlockchainProviderRuntime(
  options: BlockchainProviderRuntimeOptions
): Promise<Result<IBlockchainProviderRuntime, Error>> {
  const providerStatsQueries = await options.persistence.ensure(providerStatsModule);
  const tokenMetadataQueries = await options.persistence.ensure(tokenMetadataModule);

  // use providerStatsQueries and tokenMetadataQueries here
}
```

### What `connect()` actually returns

`connect()` is how a module turns a ready Kysely DB into its package-level persistence facade.

Example:

```ts
export type ProviderStatsPersistence = ProviderStatsQueries;

export const providerStatsModule: PersistenceModule<ProviderStatsPersistence> = {
  moduleId: 'provider-stats',
  sqlite: async () => ({
    migrations: sqliteMigrations,
    connect: ({ db }) => createProviderStatsQueries(db),
  }),
  pg: async () => ({
    migrations: pgMigrations,
    connect: ({ db }) => createProviderStatsQueries(db),
  }),
};
```

The important point is that the package receives the same logical persistence facade regardless of dialect.

### Suggested directory shape for explicit dialects

One reasonable shape is:

- `packages/blockchain-providers/src/provider-stats/persistence/module.ts`
- `packages/blockchain-providers/src/provider-stats/persistence/sqlite/`
- `packages/blockchain-providers/src/provider-stats/persistence/pg/`

or the equivalent shape for each capability package.

The exact folder split is less important than keeping both dialect implementations explicit and colocated with the capability they serve.

## Architecture guardrails

These rules are required to keep the design healthy.

### 1. `PersistenceRuntime` is not a service locator for domain logic

Allowed:

- runtime bootstrap functions
- persistence module initialization
- adapter composition boundaries

Not allowed:

- passing `PersistenceRuntime` deep into business workflows
- having feature services call `ensure()` during ordinary domain operations

`ensure()` belongs at package bootstrap or capability assembly boundaries.

### 2. Module facades should be capability-local

Good:

- `ProviderStatsQueries`
- `TokenMetadataQueries`
- `PriceCacheQueries`

Bad:

- giant shared persistence facade objects spanning unrelated capabilities

### 3. Keep runtime files boring

The runtime package should own:

- connection opening
- migration execution
- placement
- caching
- cleanup

It should not accumulate package-specific if/else logic.

### 4. Avoid public DB handles when unnecessary

Prefer module facades such as query objects, repositories, or store interfaces.

Expose raw DB handles only when a module truly needs them as part of its public persistence surface.

Default rule:

- do not expose raw Kysely DB handles from module facades

Only make an exception when a concrete module cannot express its persistence surface cleanly without it.

### 5. Keep dialect drift local

When SQLite and Postgres implementations differ, keep the difference inside the module's dialect definitions.

Do not leak dialect branches into package bootstrap or business logic.

## Future work plan

The work should be done in phases so behavior stays stable while the architecture changes.

### Phase 1. Create the new infrastructure package

Goal: land the new runtime abstraction around Kysely without changing package behavior yet.

Create a new package:

- `packages/persistence-runtime/package.json`
- `packages/persistence-runtime/src/index.ts`
- `packages/persistence-runtime/src/contracts.ts`
- `packages/persistence-runtime/src/runtime/node-sqlite.ts`
- `packages/persistence-runtime/src/runtime/pg.ts`
- `packages/persistence-runtime/src/runtime/expo-sqlite.ts`
- `packages/persistence-runtime/src/migrations.ts`

Implement:

- `PersistenceRuntime`
- `PersistenceModule<TFacade>`
- `createNodeSqlitePersistenceRuntime()`
- shared migration application logic using programmatic Kysely migrations
- SQLite plugin parity where needed for boolean / null handling
- stub or incomplete `createPgPersistenceRuntime()` if Postgres is not ready yet
- stub or incomplete `createExpoSqlitePersistenceRuntime()` if Expo is not ready yet

Testing required in this phase:

- `ensure()` called twice for the same module on the same runtime returns the same facade instance
- two separate runtime instances do not share ensured module state
- module migrations run exactly once per `(runtime instance, moduleId)`
- runtime/module dialect mismatch returns a clear error
- `dispose()` attempts cleanup for every initialized module and returns aggregated errors if any cleanup fails

Keep `@exitbook/sqlite` in place during this phase.

### Phase 2. Prove the Expo SQLite runtime adapter

Goal: confirm that Kysely can run on Expo SQLite through a runtime-owned adapter before broad rollout depends on it.

Work in:

- `packages/persistence-runtime/src/runtime/expo-sqlite.ts`
- supporting Expo SQLite dialect / driver files if needed

Success criteria:

- open a SQLite database through the runtime
- execute basic migrations
- perform simple read / write queries through Kysely
- keep package code free of Expo-specific imports

If this phase fails for structural reasons, pause and reassess the storage layer choice before migrating packages further.

### Phase 3. Migrate `blockchain-providers` first

Goal: prove the pattern on a publishable package that currently leaks `dataDir`.

Create:

- `packages/blockchain-providers/src/provider-stats/persistence/module.ts`
- `packages/blockchain-providers/src/provider-stats/persistence/sqlite/`
- `packages/blockchain-providers/src/provider-stats/persistence/pg/`
- `packages/blockchain-providers/src/token-metadata/persistence/module.ts`
- `packages/blockchain-providers/src/token-metadata/persistence/sqlite/`
- `packages/blockchain-providers/src/token-metadata/persistence/pg/`

Refactor:

- `packages/blockchain-providers/src/runtime/create-blockchain-provider-runtime.ts`

Changes:

1. Replace `dataDir` in `BlockchainProviderRuntimeOptions` with `persistence: PersistenceRuntime`.
2. Replace `initProviderStatsPersistence(options.dataDir)` with `options.persistence.ensure(providerStatsModule)`.
3. Replace `initTokenMetadataPersistence(options.dataDir)` with `options.persistence.ensure(tokenMetadataModule)`.
4. Keep `BlockchainProviderManager` constructor usage stable by still passing the same logical query facades.
5. Remove package-owned cleanup of raw DB connections from this runtime once cleanup is owned by `PersistenceRuntime.dispose()`.

CLI follow-up:

- update `apps/cli/src/features/shared/blockchain-provider-runtime.ts`
- stop passing `dataDir` into `createBlockchainProviderRuntime()`
- pass `PersistenceRuntime` instead

Temporary note:

- if needed, this phase may create the runtime in a temporary CLI wiring site
- the next phase moves ownership to the proper app composition root

### Phase 4. Add runtime ownership to the CLI composition root

Goal: move infrastructure setup into the app composition root once, not per feature.

Refactor:

- `apps/cli/src/runtime/app-runtime.ts`
- `apps/cli/src/runtime/command-runtime.ts`

Changes:

1. Add `persistence: PersistenceRuntime` to `CliAppRuntime`.
2. Create the runtime in `createCliAppRuntime()`.
3. Pass that runtime into provider package bootstraps.
4. Ensure CLI cleanup disposes the runtime once at app shutdown / command cleanup.

### Phase 5. Migrate `price-providers`

Goal: remove `dataDir` / file placement knowledge from provider-owned price persistence.

Create:

- `packages/price-providers/src/price-cache/persistence/module.ts`
- `packages/price-providers/src/price-cache/persistence/sqlite/`
- `packages/price-providers/src/price-cache/persistence/pg/`

Refactor:

- `packages/price-providers/src/runtime/create-price-provider-runtime.ts`

Changes:

1. Replace `dataDir`-driven path construction with `persistence.ensure(priceCacheModule)`.
2. Hide `prices.db` placement from package consumers.
3. Keep the public runtime API stable.

### Phase 6. Migrate `data`

Goal: remove direct dependency on `@exitbook/sqlite` and split persistence concerns into explicit modules.

Pre-step before Phase 6:

- audit `packages/data` and decide the module split before implementation starts
- keep all transactionally coupled tables in one main module first
- do not start Phase 6 until this boundary decision is explicit

Default first-cut recommendation:

- `main-data` module for transactionally coupled tables and repositories
- `overrides` module as a separate long-lived ensured module
- do not split projections / snapshots further until the first cut is stable

Files likely affected:

- `packages/data/src/database.ts`
- `packages/data/src/data-session.ts`
- `packages/data/src/overrides/database.ts`
- `packages/data/src/overrides/override-store.ts`
- `packages/data/src/migrations/001_initial_schema.ts`

Changes:

1. Replace raw `createDatabase(dbPath)` style APIs with module-driven runtime access.
2. Move package-bound Kysely / SQLite bootstrap off the package boundary.
3. Rebuild repository construction around explicit dialect module definitions.
4. Replace `withOverridesDatabase(...)` with normal ensured-module access owned by runtime lifecycle.

This is the largest phase and should happen only after the provider packages prove the runtime pattern.

### Phase 7. Add Postgres support

Goal: support one Postgres database with module-level schema separation.

Infrastructure work:

- implement `createPgPersistenceRuntime()`
- implement Postgres placement defaults by schema name
- add schema-name override support in runtime config

Module work:

- create explicit Postgres schema and migrations for each migrated persistence module
- keep the package-facing persistence facades aligned with the SQLite implementations

Important:

- do not promise "swap by connection string only"
- the real abstraction is runtime + module placement, not a bare DSN string

## Deferred cleanup after the new runtime is proven

After at least `blockchain-providers` and `price-providers` are migrated:

- retire or rename `packages/sqlite`
- stop re-exporting Kysely types from a SQLite-named package
- remove remaining package APIs that accept raw db paths where a runtime should be passed instead

## Naming guidance

Use these names consistently:

- `PersistenceRuntime`
- `PersistenceModule<TFacade>`
- `connect()`
- `ensure()`
- `moduleId`

Avoid:

- `bind`
- generic type names such as `Module`
- package-facing `dbPath`
- package-facing `dataDir` when the package should only depend on persistence infrastructure

Variable names such as `providerStatsModule` are fine. The rule is about low-signal type and API names, not ordinary local identifiers.

## Open questions to settle during implementation

These should be decided during implementation, not deferred indefinitely.

1. Exact API shape of the Expo SQLite Kysely adapter once the spike is complete.
2. How much of the current `packages/data` persistence surface should be split into separate modules after the first main-module migration.

## Resolved defaults

- Kysely remains the query and migration layer for this refactor.
- SQLite and Postgres implementations stay explicit under a shared runtime contract.
- `PersistenceRuntime.dispose()` aggregates cleanup errors and still attempts cleanup for all initialized modules.
- module facades should not expose raw Kysely DB handles by default.
- cross-module transactions are not supported in v1.
