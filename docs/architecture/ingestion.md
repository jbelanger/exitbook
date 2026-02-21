Applied the V2 Architecture Audit rubric to `@exitbook/ingestion` (scope: package-level, all dimensions).

### [1] CSV Ingestion Utilities Re-Implement Commodity Tooling

**What exists:**
`/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/kucoin/importer-csv.ts:591` hand-rolls recursive CSV discovery and sorting.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-parser.ts:8` and `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-parser-utils.ts:13` duplicate parser/header logic.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-filters.ts:4` and `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-filters-utils.ts:8` duplicate filtering/grouping logic.

**Why it's a problem:**
The package is maintaining file-walking, header sniffing, and helper duplication instead of domain logic. This increases bug surface and test maintenance for non-differentiating infrastructure.

**What V2 should do:**
Use `fast-glob` for discovery and keep one CSV adapter module on top of `csv-parse`; delete dead/duplicate utility classes.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Recursive CSV discovery | Yes | `fast-glob` handles recursive patterns directly. |
| Deterministic order | Yes | Keep explicit sort after glob results. |
| Symlink safety | Yes | Configure glob options to avoid following symlink dirs. |
| BOM handling/header detection | Yes | Keep in single adapter function. |
| Typed row parsing | Yes | Continue using `csv-parse` + Zod validation. |
| CSV row filtering/grouping helpers | Yes | Keep one utility module only. |

**Surface:** ~8 files, ~20 call-sites affected  
**Leverage:** Medium

### [2] Ingestion Package Boundary Is Too Broad (Single-Consumer Monolith)

**What exists:**
`/Users/joel/Dev/exitbook/packages/ingestion/src/index.ts:1` exports ingestion, processing, deletion, balances, account views, token metadata, and adapter registries from one package.  
`/Users/joel/Dev/exitbook/apps/cli/src/features/import/import-service-factory.ts:13` and `/Users/joel/Dev/exitbook/apps/cli/src/features/process/process-service-factory.ts:15` compose large object graphs directly from this single package.  
`/Users/joel/Dev/exitbook/apps/cli/src/index.ts:7` shows runtime registry bootstrap from ingestion.

**Why it's a problem:**
Everything changes together. This creates high cross-feature churn and unclear ownership boundaries (importing vs reconciliation vs verification). It also limits reuse outside the CLI.

**What V2 should do:**
Split into explicit slices: connectors/adapters, ingest runtime, and reconciliation/verification services, with a thin composition root.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Source adapter registration | Yes | Lives in connectors slice. |
| Import orchestration | Yes | Lives in ingest runtime slice. |
| Processing raw -> transactions | Yes | Lives in ingest runtime slice. |
| Balance/scam/token metadata workflows | Yes | Lives in reconciliation slice. |
| CLI integration | Yes | CLI composes all slices explicitly. |

**Surface:** ~108 non-test ingestion files + ~25 CLI call-sites  
**Leverage:** High

### [2] Adapter Contract Inverts Layering and Couples “Shared” to Features

**What exists:**
`/Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts:5` imports feature-level services (`scam-detection`, `token-metadata`) into a shared contract.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts:20` has a wide optional `createProcessor` signature.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:462` and `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/register.ts:42` require unsafe NEAR casting.

**Why it's a problem:**
“Shared types” are not shared abstractions; they are infra-wired contracts. This makes chain adapters depend on process internals and forces unsafe casts.

**What V2 should do:**
Introduce small, stable processor ports (context objects per chain type) and keep adapters pure from feature internals.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Address normalization | Yes | Remains adapter responsibility. |
| Importer creation | Yes | Remains adapter responsibility. |
| Processor creation with dependencies | Yes | Passed via typed context ports, not optional arg soup. |
| Chain-specific needs (NEAR) | Yes | Dedicated NEAR processor context type removes cast. |
| Xpub support | Yes | Keep optional xpub interface in adapter metadata. |

**Surface:** ~14 files, ~30 call-sites affected  
**Leverage:** High

### [3] Result Pattern Is Undercut by String Errors and Mixed Throw/Result Semantics

**What exists:**
`/Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/processors.ts:39` defines processor failures as `Result<..., string>`.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:341` converts string failures into generic `Error` text.  
Importer constructors still throw (`/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/importer.ts:48` etc).

**Why it's a problem:**
Context is flattened into strings, stack/origin metadata is lost, and callers need boilerplate conversion. The pattern’s safety benefit is reduced by mixed semantics.

**What V2 should do:**
Use a typed domain error model end-to-end (`Result<T, DomainError>` or Effect-style typed failures) and keep boundary conversion at outer shell only.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Explicit non-throwing failure channels | Yes | Typed domain errors preserve explicit flow. |
| Composability in async pipelines | Yes | Result/Efffect combinators still apply. |
| Human-readable messages | Yes | Add formatter from `DomainError` for CLI/UI. |
| Debuggable context | Yes | Structured error payload replaces string-only errors. |

**Surface:** ~20 production files, ~40+ call-sites affected  
**Leverage:** High

### [4] NEAR Processing Exposes Data-Model Mismatch (JSON1-Dependent Side Query Layer)

**What exists:**
`/Users/joel/Dev/exitbook/packages/data/src/queries/near-raw-data-queries.ts:20` performs runtime JSON1 capability checks.  
`/Users/joel/Dev/exitbook/packages/data/src/queries/near-raw-data-queries.ts:154` and `:220` query `normalized_data` via `json_extract`.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:463` and `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/register.ts:42` add NEAR-only wiring and casts.

**Why it's a problem:**
The relational shape does not match NEAR correlation needs, so logic spills into specialized query code and runtime capability checks.

**What V2 should do:**
Promote NEAR correlation keys into first-class columns/table(s) (`tx_hash`, `receipt_id`, `affected_account_id`, `stream_type`) and query typed columns directly.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Multi-stream NEAR ingestion | Yes | Keep same ingest behavior. |
| Correlation by receipt/tx hash | Yes | Faster/safer with indexed columns. |
| Processed-vs-pending partitioning | Yes | Keep processing status fields/indexes. |
| JSON payload retention | Yes | Keep raw JSON column for audit/debug. |
| Fail-fast on unsupported DB features | Partial | Becomes unnecessary for core flow; can keep startup check for optional JSON ops. |

**Surface:** ~7 files + schema/migration changes, ~15 call-sites  
**Leverage:** High

### [5] Toolchain/CI Doesn’t Enforce the Full Contract

**What exists:**
CI currently runs only coverage tests: `/Users/joel/Dev/exitbook/.github/workflows/test.yml:31`.  
Workspace scripts are repeated per package (`build: tsc --noEmit`, `test: vitest run`) across most packages (`/Users/joel/Dev/exitbook/package.json:17`, `/Users/joel/Dev/exitbook/packages/ingestion/package.json:14` and peers).

**Why it's a problem:**
Architectural and type/lint regressions can merge if tests pass. Repeated scripts add maintenance overhead and don’t exploit incremental task caching.

**What V2 should do:**
Use a task graph runner (Turborepo/Nx) and CI matrix with `lint + typecheck + unit + e2e` (affected-based where possible).

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Monorepo package orchestration | Yes | Task graph handles this natively. |
| Simple local scripts | Yes | Keep shorthand commands as wrappers. |
| Test coverage publishing | Yes | Keep existing coverage step in matrix. |
| Fast local iteration | Yes | Remote/local cache improves speed. |

**Surface:** ~15 package manifests + CI workflow/config  
**Leverage:** Medium

### [6] Module Size and Naming Drift Raise Cognitive Load

**What exists:**
There are 15 non-test files >400 LOC, including `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/processor-utils.ts:1` (945 LOC), `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/kucoin/processor-utils.ts:1` (844 LOC), `/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:1` (628 LOC).  
Naming drift includes `/Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:20` (`ImportExecutor` class in `import-service.ts`).  
Unused/dead modules exist: `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-parser.ts:8`, `/Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/csv-filters.ts:4`.

**Why it's a problem:**
Large, mixed-responsibility files slow onboarding and increase defect probability during edits. Naming mismatch obscures intent.

**What V2 should do:**
Split by pipeline stage and concern, remove dead modules, and normalize names around behavior.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| End-to-end processing behavior | Yes | No behavior change; just decomposition. |
| Shared helper reuse | Yes | Keep helpers but narrow to one concern each. |
| Discoverability | Yes | Improved with stage-based files and aligned names. |

**Surface:** ~15 large files + imports/tests touching them  
**Leverage:** Medium

### [7] Balance Verification Has Silent Partial-Failure Paths

**What exists:**
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-utils.ts:245` silently skips child-account fetch failures.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-utils.ts:289` coerces parse failures to zero.  
`/Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:149` ignores `countByStreamType` errors without log.

**Why it's a problem:**
For financial verification, silent degradation can produce misleading “successful” outputs with incomplete data.

**What V2 should do:**
Return structured partial-failure results (with per-address/per-asset errors) and make coercions explicit opt-ins at the CLI boundary only.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Continue-on-partial-source failure | Yes | But surfaced as partial status, not silent success. |
| User-facing balance result | Yes | Include confidence/coverage metadata. |
| Non-fatal import metrics lookup | Yes | Keep non-fatal behavior but log and emit warning events. |

**Surface:** ~4 files, ~10 call-sites  
**Leverage:** High

### [7] Observability Is Log/Event Based but Lacks Traceability and Drop Visibility

**What exists:**
`/Users/joel/Dev/exitbook/packages/events/src/event-bus.ts:65` drops oldest events when queue exceeds max size (default 1000) with no metric/emitted signal.  
Ingestion emits many lifecycle events (`/Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:155`, `/Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:88`) but no distributed trace/span linkage.

**Why it's a problem:**
Under load or failure analysis, you can lose timeline fidelity and cannot reliably stitch cause/effect across provider calls, DB writes, and process phases.

**What V2 should do:**
Add OpenTelemetry spans and metrics (`events_dropped`, `batch_latency`, `provider_failover_count`) and propagate correlation IDs through import/process paths.

**Needs coverage:**
| Current capability | Covered by replacement? | Notes |
|--------------------|------------------------|-------|
| Async decoupled events | Yes | Keep EventBus semantics. |
| Listener fault isolation | Yes | Keep `onError` isolation. |
| Progress/UI updates | Yes | Existing events remain; add telemetry alongside. |
| Backpressure safety | Yes | Add explicit dropped-event counters/alerts. |

**Surface:** ~6 files, ~25 emit/subscription call-sites  
**Leverage:** Medium

## V2 Decision Summary

| Rank | Change                                                                    | Dimension | Leverage | One-line Rationale                                                           |
| ---- | ------------------------------------------------------------------------- | --------- | -------- | ---------------------------------------------------------------------------- |
| 1    | Split `@exitbook/ingestion` into runtime/connectors/reconciliation slices | 2         | High     | Current package is a single-consumer monolith with high cross-feature churn. |
| 2    | Replace string-error processor contracts with typed domain errors         | 3         | High     | Preserves debugging context and reduces Result/throw friction.               |
| 3    | Redesign NEAR storage/query model around typed columns                    | 4         | High     | Removes JSON1-specific side paths and unsafe casts in core processing flow.  |
| 4    | Eliminate silent partial-failure/coercion in balance verification         | 7         | High     | Financial correctness requires explicit degradation, not hidden fallback.    |
| 5    | Consolidate CSV infrastructure and use glob tooling                       | 1         | Medium   | Reduces non-domain maintenance and duplicate utility code.                   |
| 6    | Add full CI contract + task graph caching                                 | 5         | Medium   | Improves regression detection and monorepo dev speed.                        |
| 7    | Split oversized modules and remove dead code                              | 6         | Medium   | Lowers cognitive load and change risk.                                       |
| 8    | Add trace-level observability and event-drop metrics                      | 7         | Medium   | Makes production debugging and throughput behavior measurable.               |

## What V2 keeps

- Feature/vertical-slice orientation by source (blockchain/exchange folders) is directionally right.
- Strong runtime validation discipline (Zod at ingestion boundaries) should remain.
- Explicit Result-based error flow is worth keeping, but with typed errors instead of string channels.
- SQLite local-first approach is still appropriate for CLI usage; schema/query shape should evolve, not necessarily the engine.

## Naming clarity suggestions

- Rename `/Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts` to `import-executor.ts` (class is `ImportExecutor`).
- Rename `sourceName` to `sourceId` where it represents a canonical key (reduces “display name vs identifier” ambiguity).
- Replace duplicate `CsvFilters`/`csv-filters-utils` with one `csv-row-filters` module.

## Assumptions

- CVE/maintenance recency checks were not verified against live registries in this run (network-restricted review).
