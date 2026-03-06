# CLI Command Wiring

Every feature in `apps/cli/src/features/` follows a two-tier wiring pattern.

## File layout

```
<feature>.ts          — Commander registration, option parsing, JSON/TUI dispatch
<feature>-handler.ts  — Handler class: execute(), optional abort(), optional factory
```

## Tier 1 — DB-only handlers

Simple handlers that only need a database connection.

Examples: `CostBasisHandler`, `PortfolioHandler`, `ViewPricesHandler`

```typescript
const handler = new FooHandler(await ctx.database());
await handler.execute(options);
```

- Constructor accepts `database: KyselyDB` (or derived query objects)
- Instantiated inline — no factory needed
- No cleanup registration needed

## Tier 2 — Infrastructure handlers

Handlers that need provider managers, event buses, token metadata, etc.

Examples: `ImportHandler`, `ProcessHandler`, `BalanceHandler`

```typescript
const handler = await createFooHandler(ctx, database, registry);
await handler.execute(options);
```

- Created via `createFooHandler(ctx, database, registry?)` factory defined in the handler file
- Factory registers `ctx.onCleanup` internally — command files never wire cleanup manually
- Handler exposes `abort(): void` — registered via `ctx.onAbort(() => handler.abort())` in TUI mode only
- Shared infrastructure (tokenMetadata + providerManager + EventBus + IngestionMonitor) is created via `createIngestionInfrastructure()` in `features/shared/ingestion-infrastructure.ts`
