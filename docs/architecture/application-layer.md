# Application Layer — Architecture Plan

> **Status:** In progress — Phase 1 complete, Phase 1b in progress
> **Scope:** Major refactor — new `@exitbook/app` package, decoupling ingestion/accounting from data
> **Last updated:** 2026-03-04

## Table of Contents

- [Current State](#current-state)
- [Why We Need This](#why-we-need-this)
- [Goals](#goals)
- [Package Graph — Before and After](#package-graph--before-and-after)
- [Design: Domain-Owned Ports](#design-domain-owned-ports)
  - [Principle](#principle)
  - [Port Groupings](#port-groupings)
  - [Adapter Implementation](#adapter-implementation)
  - [Transaction Scoping](#transaction-scoping)
- [Design: Import Boundary](#design-import-boundary)
- [Design: Pipeline Runner](#design-pipeline-runner)
  - [Step Model](#step-model)
  - [Step DAG](#step-dag)
  - [Change Detection](#change-detection)
  - [Adding New Steps](#adding-new-steps)
- [What `@exitbook/app` Owns](#what-exitbookapp-owns)
- [What the CLI Becomes](#what-the-cli-becomes)
- [Migration Strategy](#migration-strategy)
- [Rules and Guidelines](#rules-and-guidelines)
- [Open Questions](#open-questions)
- [Appendix: Full Repository Method Audit](#appendix-full-repository-method-audit)

---

## Current State

| Component                                                | Status         | Notes                                                       |
| -------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `ImportOperation`                                        | ✅ Implemented | Full import lifecycle in app layer                          |
| `ClearOperation`                                         | ✅ Implemented | Data deletion and reset                                     |
| `AccountQuery`                                           | ✅ Implemented | Account listing and session summaries                       |
| `BalanceOperation`                                       | ✅ Implemented | Live vs calculated balance comparison                       |
| `ProcessOperation`                                       | 🔄 In progress | Reprocess orchestration (clear → guard → process)           |
| `ClearStep`                                              | 🔄 In progress | Pipeline step stub                                          |
| `ProviderRegistry`                                       | ✅ Implemented | Provider manager construction                               |
| Pipeline steps (process, link, price-enrich, cost-basis) | ⬜ Stubs only  | `isDirty()` / `execute()` throw "Not implemented"           |
| `ProcessingStoreAdapter`                                 | ⬜ Stub only   | Port interface defined, adapter not implemented             |
| Store adapters (linking, pricing, cost-basis)            | ⬜ Not started | Files don't exist yet                                       |
| Pipeline runner                                          | ⬜ Stub only   | `PipelineRunner` class exists, methods throw                |
| Domain port interfaces                                   | ⬜ Not started | Ingestion/accounting still import `@exitbook/data` directly |

---

## Why We Need This

Today the CLI (`apps/cli`) is the orchestrator. It owns:

- **Pipeline sequencing** — `prereqs.ts` runs process → link → price-enrich before cost-basis
- **Staleness detection** — account hash comparison, timestamp checks, import session diffing
- **Infrastructure wiring** — creating provider managers, event buses, monitors, cleanup stacks
- **Domain service construction** — instantiating `RawDataProcessingService`, `LinkingOrchestrator`, `PriceEnrichmentPipeline` with the right dependencies

None of this logic is reusable. A React Native app would need to duplicate all of it. Every new pipeline step requires touching CLI command files, prereqs, and handler factories.

Meanwhile, `@exitbook/ingestion` and `@exitbook/accounting` both import `@exitbook/data` directly — binding domain logic to a specific persistence implementation (Kysely + SQLite). This prevents running domain logic against a different storage backend (e.g., SQLite via `expo-sqlite` on mobile, or an in-memory store in tests).

## Goals

1. **Reusable orchestration** — Pipeline logic lives in a package any host (CLI, React Native, web) can call.
2. **Decoupled domains** — Ingestion and accounting define what persistence they need; they don't know how it's implemented.
3. **Incremental pipeline** — Steps only run when their inputs have changed. Staleness detection is built into each step, not scattered across CLI code.
4. **Extensible steps** — Adding a new pipeline step (e.g., tax-lot optimization, portfolio snapshots) is additive: define the step, register it, done.
5. **Testable in isolation** — Domain logic can be tested with in-memory store implementations. No SQLite needed.

## Package Graph — Before and After

### Before

```
apps/cli
├── @exitbook/ingestion ──→ @exitbook/data
├── @exitbook/accounting ──→ @exitbook/data
└── @exitbook/data
```

CLI orchestrates everything. Ingestion and accounting reach directly into `DataContext` and its repositories.

### After

```
apps/cli
└── @exitbook/app
    ├── @exitbook/ingestion  (no data dependency)
    ├── @exitbook/accounting  (no data dependency)
    └── @exitbook/data

apps/react-native (future)
└── @exitbook/app
    ├── @exitbook/ingestion
    ├── @exitbook/accounting
    └── @exitbook/data-mobile  (same port interfaces, different implementation)
```

`@exitbook/app` is the single package that knows about both persistence and domain logic. Hosts (CLI, mobile) are thin shells that provide configuration and rendering.

---

## Design: Domain-Owned Ports

### Principle

Each domain package defines **store interfaces** describing exactly what persistence it needs. These interfaces live in the domain package, not in `@exitbook/core` or `@exitbook/data`. The application layer provides concrete implementations (adapters) that delegate to `DataContext`.

This is Ports & Adapters (Hexagonal Architecture) — the same family as Clean Architecture, but with narrower, consumer-driven ports instead of one-to-one repository mirrors.

**Why not full repository interfaces in core?**

- We'd need ~12 interfaces mirroring every repository method — high maintenance surface for a single storage implementation.
- Repositories have methods only the CLI or app layer uses (e.g., `count()` for preview displays). Domains shouldn't see those.
- Interface Segregation Principle: consumers should depend on the narrowest contract they need.

### Port Groupings

Based on a full audit of every repository method called by ingestion and accounting (see [Appendix](#appendix-full-repository-method-audit)), the ports group naturally by use case.

**Key design decision:** Import and clear are **app-layer operations**, not ingestion concerns. User/account lifecycle, session management, xpub derivation, and data deletion are orchestration — the app layer uses `DataContext` directly for these (see `ClearOperation` and `ImportOperation` as proof of concept). Ingestion's ports are limited to what domain services actually need: processing raw data and providing batch sources.

#### `@exitbook/ingestion` ports

```typescript
// packages/ingestion/src/ports/processing-store.ts

interface ProcessingStore {
  findAccountById(id: number): Promise<Result<Account, Error>>;
  findAccounts(filters: AccountFilters): Promise<Result<Account[], Error>>;
  findImportSessions(filters: SessionFilters): Promise<Result<ImportSession[], Error>>;

  countRawTransactions(filters: RawTransactionFilters): Promise<Result<number, Error>>;
  countRawTransactionsByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>>;
  findDistinctRawAccountIds(filters: { processingStatus?: string }): Promise<Result<number[], Error>>;

  /** Execute processing within a transaction — save results and mark raw data as processed atomically. */
  executeProcessingBatch(params: {
    accountId: number;
    transactions: TransactionInput[];
    processedRawIds: number[];
    consolidatedMovements?: ConsolidatedMovementInput[];
  }): Promise<Result<CreateBatchResult, Error>>;
}
```

```typescript
// packages/ingestion/src/ports/raw-data-batch-source.ts
// (Used by batch providers — NEAR has its own extension)

interface RawDataBatchSource {
  findRawByHashes(accountId: number, limit: number): Promise<Result<RawTransaction[], Error>>;
  findAllPendingRaw(accountId: number): Promise<Result<RawTransaction[], Error>>;
}

interface NearRawDataBatchSource extends RawDataBatchSource {
  findPendingAnchorHashes(accountId: number, limit: number): Promise<Result<string[], Error>>;
  findPendingByHashes(accountId: number, hashes: string[]): Promise<Result<RawTransaction[], Error>>;
  findPendingByReceiptIds(accountId: number, receiptIds: string[]): Promise<Result<RawTransaction[], Error>>;
}
```

#### Removed from ingestion — now app-layer operations

The original draft had `ImportStore` (12 methods) and `DeletionStore` (4 methods) as ingestion ports. These are **orchestration**, not domain logic:

| Concern                                 | Why it's app-layer                                           |
| --------------------------------------- | ------------------------------------------------------------ |
| User find-or-create                     | Policy — not specific to any domain                          |
| Account find-or-create, xpub derivation | Account lifecycle management                                 |
| Import session create/resume/finalize   | Session lifecycle wrapping the streaming loop                |
| Cursor updates                          | Part of the streaming protocol owned by the import operation |
| Raw batch persistence                   | Persistence callback passed into the streaming loop          |
| Data deletion and preview               | FK-ordered deletion policy (proven by `ClearOperation` PoC)  |

The app layer handles these via `DataContext` directly — no port indirection needed because there's no domain service on the other side. `ImportOperation` owns the full import lifecycle; `ClearOperation` owns deletion.

#### `@exitbook/accounting` ports

```typescript
// packages/accounting/src/ports/linking-store.ts

interface LinkingStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;

  countLinks(): Promise<Result<number, Error>>;
  deleteAllLinks(): Promise<Result<number, Error>>;
  saveLinkBatch(links: LinkInput[]): Promise<Result<number, Error>>;

  deleteAllLinkableMovements(): Promise<Result<void, Error>>;
  saveLinkableMovementBatch(movements: LinkableMovementInput[]): Promise<Result<number, Error>>;
  findAllLinkableMovements(): Promise<Result<LinkableMovement[], Error>>;
}
```

```typescript
// packages/accounting/src/ports/pricing-store.ts

interface PricingStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;

  /** Update prices for a single transaction within a transaction scope */
  updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>>;

  /** Execute a batch of price updates atomically */
  executePriceUpdateBatch(updates: UniversalTransactionData[]): Promise<Result<void, Error>>;
}
```

```typescript
// packages/accounting/src/ports/cost-basis-store.ts

interface CostBasisStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;
}
```

### Adapter Implementation

The application layer creates adapters that delegate to `DataContext`. These are thin — most methods are one-liners:

```typescript
// packages/app/src/adapters/linking-store-adapter.ts

class LinkingStoreAdapter implements LinkingStore {
  constructor(private readonly db: DataContext) {}

  findAllTransactions() {
    return this.db.transactions.findAll();
  }

  countLinks() {
    return this.db.transactionLinks.count();
  }

  saveLinkBatch(links: LinkInput[]) {
    return this.db.transactionLinks.createBatch(links);
  }

  // ... etc
}
```

### Transaction Scoping

Several operations need atomic transactions (process batch, price updates). Instead of exposing `executeInTransaction` on every port (which leaks persistence concerns), the ports define **coarse-grained atomic operations**:

- `ProcessingStore.executeProcessingBatch()` — saves transactions + marks raw as processed in one transaction
- `PricingStore.executePriceUpdateBatch()` — updates prices for multiple transactions atomically

The adapter implements these using `DataContext.executeInTransaction()` internally. The domain never sees the transaction boundary — it just calls a method that happens to be atomic.

Operations that live entirely in the app layer (import, clear, balance) use `DataContext.executeInTransaction()` directly — no port indirection needed.

---

## Design: Import Boundary

Import is the clearest example of the app-layer split. Today `ImportCoordinator` (in `@exitbook/ingestion`) handles orchestration that isn't ingestion's concern.

### What moves to `ImportOperation` (app layer)

| Responsibility                                              | Why app-layer                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `findOrCreateUser()`                                        | Policy — not domain logic                                    |
| `findOrCreateAccount()`                                     | Account lifecycle                                            |
| xpub `deriveAddressesFromXpub()` + child account creation   | Account lifecycle (delegates to adapter for derivation math) |
| xpub metadata persistence (`gapLimit`, `derivedCount`)      | Account lifecycle                                            |
| Import session create/resume/finalize                       | Session lifecycle wrapping the streaming loop                |
| Drive `for await` over `IImporter.importStreaming()`        | Streaming loop — app owns the control flow                   |
| Per-batch: `saveRawTransactionBatch()` + `updateCursor()`   | Persistence within the streaming loop                        |
| Source routing (blockchain vs exchange-csv vs exchange-api) | Dispatch logic                                               |

### What stays in `@exitbook/ingestion`

| Responsibility                                     | Why ingestion                                             |
| -------------------------------------------------- | --------------------------------------------------------- |
| `IImporter` interface + all implementations        | Core competency — how to fetch raw data from each source  |
| `AdapterRegistry` + adapter types                  | Importer discovery and creation                           |
| `RawDataProcessingService` + processors            | Domain logic — raw → universal transaction transformation |
| Batch providers (`HashGroupedBatchProvider`, etc.) | Processing infrastructure                                 |
| Event types (`ImportEvent`, `ProcessEvent`)        | Shared vocabulary                                         |

### How they connect

```
ImportOperation (app)                  @exitbook/ingestion
─────────────────                      ───────────────────
resolve user + account
create/resume session
                                       registry.createImporter(account)
                                         → returns IImporter
for await (batch of importer.importStreaming()) {
  db.rawTransactions.createBatch(...)
  db.accounts.updateCursor(...)
  events.emit({ type: 'import.batch' })
}
finalize session
```

`ImportCoordinator` shrinks to what ingestion is good at — or disappears if `ImportOperation` can call `AdapterRegistry` and `IImporter` directly (they're already exported).

---

## Design: Pipeline Runner

### Step Model

Each pipeline step encapsulates three concerns:

```typescript
// packages/app/src/pipeline/pipeline-step.ts

interface PipelineStep {
  /** Unique step identifier */
  readonly name: string;

  /** Steps that must complete before this one */
  readonly dependsOn: string[];

  /** Check whether this step needs to run based on current state */
  isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>>;

  /** Execute the step */
  execute(context: PipelineContext): Promise<Result<StepResult, Error>>;
}

interface DirtyCheckResult {
  isDirty: boolean;
  reason?: string; // human-readable explanation: "new import since last build"
}

interface PipelineContext {
  /** Storage ports — each step casts to what it needs */
  stores: StoreRegistry;

  /** Infrastructure provided by host */
  providers: ProviderRegistry;

  /** Pipeline-level config */
  config: PipelineConfig;

  /** Event sink for progress reporting */
  events: EventSink;
}
```

### Step DAG

The initial pipeline is a linear chain, but the DAG model supports future parallelism:

```
import (user-triggered, not a pipeline step)
  │
  ▼
clear ──→ process ──→ link ──→ price-enrich ──→ cost-basis
```

- **Clear** depends on: nothing (first step — resets derived data before reprocessing)
- **Process** depends on: clear
- **Link** depends on: process
- **Price-enrich** depends on: link (needs confirmed links for cross-platform price derivation)
- **Cost-basis** depends on: price-enrich

Import is **not** a pipeline step. It's user-triggered with external I/O (API calls, file reads). Clear exists as both a pipeline step (automated reset before reprocessing) and a standalone operation (user-triggered explicit deletion via `ClearOperation`). The pipeline handles only derived computations.

### Change Detection

Each step owns its dirty-check logic. The current staleness checks from `prereqs.ts` map directly:

| Step             | Dirty when                                                         | Current implementation                                  |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| **clear**        | Derived data exists that needs resetting before reprocessing       | Delegates to `ClearOperation` — counts derived rows     |
| **process**      | Never processed, account hash changed, new import since last build | `rawDataProcessedState` table + account hash comparison |
| **link**         | `max(transactions.created_at) > max(transaction_links.created_at)` | Timestamp comparison                                    |
| **price-enrich** | Transactions exist with missing or tentative prices                | `validateTransactionPrices()` check                     |
| **cost-basis**   | Always runs (pure computation from current data)                   | N/A — stateless                                         |

A `pipeline_state` table could unify this in the future, but starting with the existing checks (moved into each step's `isDirty`) is simpler and already proven.

### Adding New Steps

To add a new step (e.g., `tax-lot-optimization`):

1. Define the step implementing `PipelineStep`
2. Declare its `dependsOn` (e.g., `['cost-basis']`)
3. Implement `isDirty()` with the step's staleness logic
4. Register it in the pipeline configuration

No existing steps change. No CLI code changes. The runner discovers the new step and places it in the DAG.

---

## What `@exitbook/app` Owns

```
packages/app/
├── src/
│   ├── index.ts                          # Public API
│   ├── application.ts                    # Session lifecycle — bootstrap and teardown
│   │
│   ├── accounts/                         # Account queries (no domain service needed)
│   │   └── account-query.ts
│   │
│   ├── import/                           # Full import lifecycle
│   │   ├── import-operation.ts           # User/account/session/streaming/xpub — all here
│   │   └── import-store-adapter.ts       # Narrow port for ingestion: saveRawBatch + updateCursor
│   │
│   ├── clear/                            # Data deletion, reset, and pipeline step
│   │   ├── clear-operation.ts            # Uses DataContext directly — no domain delegation
│   │   ├── clear-operation-utils.ts      # Pure functions: validation, account resolution
│   │   └── clear-step.ts                # Pipeline step stub — delegates to ClearOperation
│   │
│   ├── balance/                          # Live vs calculated balance comparison
│   │   ├── balance-operation.ts
│   │   └── balance-store-adapter.ts      # Port for balance verification persistence
│   │
│   ├── process/                          # Reprocess orchestration + pipeline step
│   │   ├── process-operation.ts          # Orchestration: clear → guard → process
│   │   ├── process-operation-utils.ts    # Types: ProcessParams, ProcessResult
│   │   ├── process-step.ts              # Pipeline step stub
│   │   └── processing-store-adapter.ts   # Adapter for ProcessingStore port (stub)
│   │
│   ├── link/                             # Pipeline step: transaction linking
│   │   ├── link-step.ts
│   │   └── linking-store-adapter.ts      # Adapter for LinkingStore port
│   │
│   ├── price-enrich/                     # Pipeline step: price enrichment
│   │   ├── price-enrich-step.ts
│   │   └── pricing-store-adapter.ts      # Adapter for PricingStore port
│   │
│   ├── cost-basis/                       # Pipeline step: cost basis calculation
│   │   ├── cost-basis-step.ts
│   │   └── cost-basis-store-adapter.ts   # Adapter for CostBasisStore port
│   │
│   ├── pipeline/                         # Pipeline runner infrastructure
│   │   ├── pipeline-runner.ts            # DAG walker, dirty checking, execution
│   │   ├── pipeline-step.ts             # Step interface
│   │   └── pipeline-context.ts          # Context, EventSink, StoreRegistry
│   │
│   └── providers/                        # Provider manager construction
│       └── provider-registry.ts
```

**Two kinds of app-layer code:**

| Kind                                                                  | Pattern                                                        | Examples                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Operations** — orchestration logic that uses `DataContext` directly | No domain service, no port. App layer _is_ the logic.          | `ImportOperation`, `ClearOperation`, `ProcessOperation`, `BalanceOperation`, `AccountQuery` |
| **Pipeline step adapters** — bridge domain services to persistence    | Define a port in the domain package, adapter in the app layer. | `ProcessingStoreAdapter`, `LinkingStoreAdapter`, `PricingStoreAdapter`                      |

**Responsibilities:**

- Initialize `DataContext` and manage session lifecycle
- Own operations: import (full lifecycle), clear, process/reprocess, balance, account queries
- Create store adapters and construct domain services with injected ports
- Own pipeline step definitions and runner
- Manage provider manager lifecycles (blockchain, price)

**Does NOT own:**

- UI rendering (CLI's TUI, React Native components)
- CLI argument parsing
- Provider API keys / configuration (passed in by host)

---

## What the CLI Becomes

After the refactor, the CLI is a thin shell:

```typescript
// Conceptual — apps/cli command file
const app = new Application({ dataDir, providers });
await app.initialize();

// Import — app layer owns user/account/session/xpub/streaming
const importOp = new ImportOperation(app.db, app.providerManager, app.registry, app.events);
const result = await importOp.execute({ blockchain: 'bitcoin', address: 'bc1q...' });

// Clear — app layer owns deletion directly
const clearOp = new ClearOperation(app.db, app.events);
await clearOp.execute({ includeRaw: true });

// Reprocess — app layer orchestrates clear → guard → process
const processOp = new ProcessOperation(app.db, app.processingService, app.events);
await processOp.execute({ accountId: 42 }); // or omit for all pending

// Cost basis — pipeline runs automatically (clear → process → link → price-enrich → cost-basis)
const pipeline = new PipelineRunner(app.db, app.providerManager, app.events);
const costBasis = await pipeline.runThrough('cost-basis');
```

`prereqs.ts` disappears — its logic moves into pipeline steps. `createIngestionInfrastructure` moves into the app layer. `ImportCoordinator` shrinks to what ingestion is good at (importer creation, streaming protocol). Command files shrink to: parse args → call app → render output.

---

## Migration Strategy

This is a large refactor. Phased approach to keep things working at every step:

### Phase 1: Extract import to app layer ✅ DONE

- `ImportOperation` in `packages/app/src/import/import-operation.ts` owns the full import lifecycle:
  - User find-or-create, account find-or-create (including xpub derivation + child accounts)
  - Import session create/resume/finalize, streaming loop, cursor updates
- `ImportCoordinator` removed — `ImportOperation` calls `AdapterRegistry` and `IImporter` directly
- CLI `ImportHandler` delegates to `ImportOperation`
- Ingestion keeps: `IImporter` implementations, `AdapterRegistry`, adapter types, processor implementations

### Phase 1b: Extract process/reprocess to app layer (current focus)

- `ProcessOperation` in `packages/app/src/process/process-operation.ts` orchestrates reprocess:
  - Resolve account IDs → guard incomplete imports → clear derived data via `ClearOperation` → delegate to `RawDataProcessingService`
- `ClearStep` added as pipeline step stub (`clear → process → link → price-enrich → cost-basis`)
- CLI `ProcessHandler` delegates to `ProcessOperation` instead of owning `executeReprocess()` directly
- `ClearService` in ingestion becomes dead code (replaced by `ClearOperation` in app layer)
- `RawDataProcessingService` stays in ingestion — deep domain dependencies (processors, batch providers, scam detection)

### Phase 2: Define remaining ports in domain packages

- Add `ports/` directories to `@exitbook/ingestion` and `@exitbook/accounting`
- Define store interfaces: `ProcessingStore`, `RawDataBatchSource` (ingestion); `LinkingStore`, `PricingStore`, `CostBasisStore` (accounting)
- **No behavior changes** — just new files with interface definitions

### Phase 3: Create adapters and refactor domain services

- Create store adapters in `@exitbook/app` (co-located with pipeline steps)
- Change domain service constructors from `DataContext` → port interfaces
- E.g., `RawDataProcessingService(db: DataContext, ...)` → `RawDataProcessingService(store: ProcessingStore, ...)`
- **Remove `@exitbook/data` from ingestion/accounting `package.json`**

### Phase 4: Build pipeline runner

- Implement `PipelineStep` interface and runner
- Move staleness logic from `prereqs.ts` into step `isDirty()` methods
- Move infrastructure wiring from CLI into app layer

### Phase 5: Slim down the CLI

- Replace handler factories and prereqs with app layer operation calls
- Remove `@exitbook/ingestion` and `@exitbook/accounting` as direct CLI dependencies (access through `@exitbook/app`)
- Delete `prereqs.ts`, `ingestion-infrastructure.ts`, `provider-manager-factory.ts`

---

## Rules and Guidelines

These rules apply to all code going forward and should be enforced in PR review.

### Dependency Rules

1. **Domain packages (`ingestion`, `accounting`) must never import `@exitbook/data`.** They define their own port interfaces and accept them via constructor injection.
2. **`@exitbook/app` is the only package that imports both domain packages and `@exitbook/data`.** It is the composition root.
3. **Host apps (`apps/cli`, future `apps/mobile`) import `@exitbook/app`.** They should not import domain packages directly for orchestration — only for types/enums if needed.
4. **`@exitbook/core` remains the shared kernel.** Domain types, Zod schemas, value objects. No persistence, no I/O.

### Port Design Rules

5. **Ports exist only when there's a domain service on the other side.** `ProcessingStore` is a port because `RawDataProcessingService` is domain logic that shouldn't know about `DataContext`. Import/clear/balance are app-layer operations — they use `DataContext` directly, no port indirection.
6. **Ports are owned by the consumer, not the provider.** `LinkingStore` lives in `@exitbook/accounting`, not in `@exitbook/data` or `@exitbook/app`.
7. **Ports are grouped by use case, not by entity.** `ProcessingStore` has methods from accounts, rawTransactions, transactions, and utxoConsolidatedMovements — everything processing needs.
8. **Ports define coarse-grained atomic operations for transactions.** Instead of exposing `executeInTransaction()`, ports expose methods like `executeProcessingBatch()` that are atomic by contract. The adapter implements the transaction boundary.
9. **Port methods return `Result<T, Error>`.** Consistent with the existing neverthrow convention.
10. **Port interfaces use domain types from `@exitbook/core`, not Kysely types.** No `Selectable<TransactionTable>` in port signatures — only `UniversalTransactionData`, `Account`, etc.

### Pipeline Rules

11. **Import is not a pipeline step.** It's user-triggered with external I/O. The pipeline handles only derived computations. Clear is both a pipeline step (automated reset before reprocessing) and a standalone operation (user-triggered explicit deletion).
12. **Each step declares its dependencies via `dependsOn`.** The runner resolves execution order. Steps never call other steps directly.
13. **Each step owns its dirty-check logic.** No centralized staleness table (unless a step wants one). Steps know best what "changed" means for their inputs.
14. **Steps are stateless between runs.** All state lives in the stores. Steps read state, compute, write state.

### Event / Progress Rules

15. **The app layer emits events; hosts subscribe.** The CLI mounts TUI monitors on these events. React Native would render native progress views. Domain services receive an `EventSink` (a simple emit interface), not an `EventBus` instance.
16. **Abort propagation flows from host → app → domain.** The app layer exposes an `abort()` handle. Hosts wire it to their signal handling (SIGINT for CLI, app lifecycle for mobile).

---

## Open Questions

- **Provider manager lifecycle** — Should `@exitbook/app` own creation/destruction of blockchain and price provider managers? Or should the host pass them in? Leaning toward app-owned with host-provided config (API keys, cache paths).
- **OverrideStore** — Currently a filesystem-based JSON store in `@exitbook/data`. It's used by `LinkingOrchestrator`. Should it become a port on `LinkingStore`, or remain a separate concern? It's not persistence in the DB sense — it's user-authored override files.
- **~~EventSink vs EventBus~~** — Resolved: domain services and app-layer operations receive `EventSink` (`{ emit(event: unknown): void }`), not `EventBus`. `EventBus<T>` structurally satisfies `EventSink` so hosts pass their event bus directly. Implemented in `ImportOperation`, `ClearOperation`, `ProcessOperation`.
- **~~ImportCoordinator fate~~** — Resolved: `ImportCoordinator` was removed. `ImportOperation` calls `AdapterRegistry` and `IImporter` directly. The registry and importer interfaces are public exports from ingestion.

---

## Appendix: Full Repository Method Audit

Detailed breakdown of every `DataContext` repository method used by `@exitbook/ingestion` and `@exitbook/accounting`, grouped by the port it maps to.

### App Layer → `ImportOperation` (uses DataContext directly)

These methods were originally attributed to `ImportCoordinator` and `StreamingImportRunner` in `@exitbook/ingestion`. They are orchestration — the app layer calls `DataContext` directly, no port needed.

| Method                                                 | Purpose                       |
| ------------------------------------------------------ | ----------------------------- |
| `users.findOrCreateDefault()`                          | Ensure default user exists    |
| `accounts.findOrCreate(params)`                        | Resolve import target account |
| `accounts.findAll(filters)`                            | xpub child account lookup     |
| `accounts.update(id, params)`                          | xpub derivation metadata      |
| `accounts.updateCursor(accountId, streamType, cursor)` | Streaming cursor persistence  |
| `importSessions.create(accountId)`                     | Session lifecycle             |
| `importSessions.update(id, params)`                    | Session lifecycle             |
| `importSessions.finalize(id, ...)`                     | Session lifecycle             |
| `importSessions.findById(id)`                          | Session lifecycle             |
| `importSessions.findLatestIncomplete(accountId)`       | Crash recovery                |
| `rawTransactions.createBatch(accountId, items)`        | Batch persistence (in tx)     |
| `rawTransactions.countByStreamType(accountId)`         | Progress events               |
| `executeInTransaction(fn)`                             | Atomic batch + cursor save    |

### Ingestion → `ProcessingStore`

| Method                                            | Source                           |
| ------------------------------------------------- | -------------------------------- |
| `accounts.findById(id)`                           | RawDataProcessingService         |
| `accounts.findAll(filters)`                       | RawDataProcessingService         |
| `importSessions.findAll(filters)`                 | RawDataProcessingService         |
| `rawTransactions.count(filters)`                  | RawDataProcessingService         |
| `rawTransactions.countByStreamType(accountId)`    | RawDataProcessingService         |
| `rawTransactions.findDistinctAccountIds(filters)` | RawDataProcessingService         |
| `transactions.createBatch(txs, accountId)`        | RawDataProcessingService (in tx) |
| `utxoConsolidatedMovements.createBatch(items)`    | RawDataProcessingService (in tx) |
| `rawTransactions.markProcessed(ids)`              | RawDataProcessingService (in tx) |
| `executeInTransaction(fn)`                        | RawDataProcessingService         |

### Ingestion → `RawDataBatchSource`

| Method                                                     | Source                   |
| ---------------------------------------------------------- | ------------------------ |
| `rawTransactions.findByHashes(accountId, limit)`           | HashGroupedBatchProvider |
| `rawTransactions.findAll({ processingStatus, accountId })` | AllAtOnceBatchProvider   |

### Ingestion → `NearRawDataBatchSource`

| Method                                                       | Source                  |
| ------------------------------------------------------------ | ----------------------- |
| `nearRawData.findPendingAnchorHashes(accountId, limit)`      | NearStreamBatchProvider |
| `nearRawData.findPendingByHashes(accountId, hashes)`         | NearStreamBatchProvider |
| `nearRawData.findPendingByReceiptIds(accountId, receiptIds)` | NearStreamBatchProvider |

### App Layer → `ClearOperation` (uses DataContext directly)

These methods were originally attributed to `ClearService` in `@exitbook/ingestion`. Proven by PoC — `ClearOperation` uses `DataContext` directly.

| Method                                                 | Purpose                     |
| ------------------------------------------------------ | --------------------------- |
| `users.findOrCreateDefault()`                          | User-scoped guards          |
| `accounts.findAll(filters)`                            | Resolve accounts to clear   |
| `importSessions.count(filters)`                        | Deletion preview            |
| `rawTransactions.count(filters)`                       | Deletion preview            |
| `transactions.count(filters)`                          | Deletion preview            |
| `transactionLinks.count(filters)`                      | Deletion preview            |
| All `deleteAll/deleteBy/resetProcessingStatus` methods | FK-ordered deletion (in tx) |
| `executeInTransaction(fn)`                             | Atomic deletion             |

### Accounting → `LinkingStore`

| Method                                     | Source              |
| ------------------------------------------ | ------------------- |
| `transactions.findAll()`                   | LinkingOrchestrator |
| `transactionLinks.count()`                 | LinkingOrchestrator |
| `transactionLinks.deleteAll()`             | LinkingOrchestrator |
| `transactionLinks.createBatch(links)`      | LinkingOrchestrator |
| `linkableMovements.deleteAll()`            | LinkingOrchestrator |
| `linkableMovements.createBatch(movements)` | LinkingOrchestrator |
| `linkableMovements.findAll()`              | LinkingOrchestrator |

### Accounting → `PricingStore`

| Method                                       | Source                                            |
| -------------------------------------------- | ------------------------------------------------- |
| `transactions.findAll()`                     | PriceDerivationService, PriceNormalizationService |
| `transactions.findNeedingPrices(filter)`     | PriceFetchService                                 |
| `transactionLinks.findAll('confirmed')`      | PriceDerivationService                            |
| `transactions.updateMovementsWithPrices(tx)` | All three services (in tx)                        |
| `executeInTransaction(fn)`                   | All three services                                |

### Accounting → `CostBasisStore`

| Method                                  | Source              |
| --------------------------------------- | ------------------- |
| `transactions.findAll()`                | cost-basis-pipeline |
| `transactions.findById(id)`             | LotMatcher          |
| `transactionLinks.findAll('confirmed')` | LotMatcher          |

### App Layer — Pipeline Steps and Queries (DataContext directly)

These methods are used by pipeline step `isDirty()` checks, `AccountQuery`, and `BalanceOperation`:

| Method                                      | Destination         |
| ------------------------------------------- | ------------------- |
| `rawDataProcessedState.get()`               | ProcessStep.isDirty |
| `rawDataProcessedState.upsert(params)`      | ProcessStep.execute |
| `transactions.findLatestCreatedAt()`        | LinkStep.isDirty    |
| `transactionLinks.findLatestCreatedAt()`    | LinkStep.isDirty    |
| `importSessions.findLatestCompletedAt()`    | ProcessStep.isDirty |
| `importSessions.countByAccount(ids)`        | AccountQuery        |
| `accounts.update(id, verificationMetadata)` | BalanceOperation    |
