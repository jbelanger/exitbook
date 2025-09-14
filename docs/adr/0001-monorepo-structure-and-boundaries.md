# ADR-0001: Monorepo Structure & Boundaries (NestJS Shell + Effect-TS Core)

**Status**: Accepted **Date**: 2025-09-06 **Deciders**: Architecture group (Joel
as lead) **Context**: Full-stack monorepo with frontend, backend, infra, docs.
Backend uses **NestJS as an imperative shell** and **Effect-TS** for the
functional core.

## Decision

Adopt a **context-first monorepo** that separates _deployables_ (`apps/*`) from
_reusable libraries_ (`packages/*`), with strict boundaries that keep the
**NestJS shell replaceable** and the **Effect-TS core pure and
framework-agnostic**. NestJS modules are owned by their **contexts** under
`packages/contexts/*/nest`. Each context also exposes **Effect composition**
under `packages/contexts/*/compose` (e.g., `default.ts`, `test.ts`). The API
imports Nest modules from contexts; the CLI imports composition layers (or the
same Nest modules if it boots with Nest).

### Repository layout

```text
.
├─ apps/                                   # Executables (deployables)
│  ├─ api/                                 # NestJS shell (HTTP)
│  │  ├─ src/
│  │  │  ├─ shell/                         # controllers/dto/filters/interceptors/guards
│  │  │  └─ main.ts
│  │  └─ test/                             # e2e/integration tests (supertest, testcontainers)
│  ├─ workers/                             # outbox dispatcher, schedulers, consumers
│  ├─ cli/                                 # admin/maintenance CLI (plain Effect or Nest-Commander)
│  └─ web/                                 # Remix/Next frontend (app/src, tests)
│
├─ packages/                               # Reusable libraries (versioned)
│  ├─ core/                                # shared kernel (pure TS)
│  │  ├─ domain/                           # base Entity/Aggregate/Event, errors, ids, Money, etc.
│  │  ├─ effect/                           # Effect runtime, common Layers (Clock, Config, UUID)
│  │  └─ utils/                            # bignum/date/validation helpers
│  ├─ contexts/                            # bounded contexts (functional core first)
│  │  ├─ ingestion/                        # import sessions, raw capture, processing, canonicalization
│  │  │  ├─ core/                          #   pure: VOs, events, aggregates, policies/services
│  │  │  ├─ ports/                         #   Effect Tags (interfaces) needed by core/app
│  │  │  ├─ adapters/                      #   impure impls: repositories, http, mq, projections
│  │  │  ├─ app/                           #   thin orchestration (commands/queries/sagas as Effects)
│  │  │  ├─ compose/
│  │  │  │  ├─ default.ts                  #   prod runtime layers
│  │  │  │  └─ test.ts                     #   in-memory/fake layers
│  │  │  └─ nest/
│  │  │     └─ ingestion.module.ts         #   DynamicModule factory
│  │  ├─ ledger/                           # posting entries, classification rules, reversals
│  │  │  └─ ...same...
│  │  ├─ reconciliation/                   # snapshots, mismatch detection, advisory
│  │  │  └─ ...same...
│  │  ├─ portfolio/
│  │  │  └─ ...same...
│  │  └─ taxation/
│  │     └─ ...same...
│  ├─ platform/                            # cross-cutting infra (impure, reusable)
│  │  ├─ event-store/                      # ES + snapshots + outbox + idempotency
│  │  ├─ database/                         # knex/prisma, connection mgmt, migrations
│  │  ├─ messaging/                        # amqp/kafka abstraction
│  │  ├─ cache/                            # redis cache/locks/rate-limit primitives
│  │  ├─ monitoring/                       # logging/metrics/tracing
│  │  └─ security/                         # authn/z, crypto
│  ├─ contracts/                           # runtime types shared with FE/BE
│  │  ├─ api/                              # OpenAPI/Zod schemas + inferred TS types
│  │  └─ messages/                         # MQ payload schemas (Zod)
│  ├─ api-client/                          # generated TS client from OpenAPI for web/app usage
│  ├─ ui/                                  # design system: tokens + shadcn/tailwind components
│  ├─ config/                              # shared tsconfig/eslint/prettier/turbo/nx presets
│  └─ tooling/                             # codegen (plop/hygen), test utils, fixtures
│
├─ infra/                                  # everything to run it
│  ├─ docker/                              # Dockerfiles, compose for dev
│  ├─ k8s/                                 # manifests or helm charts per app
│  ├─ terraform/                           # cloud infra (db, queues, cache, buckets)
│  ├─ migrations/                          # db/ES/projection migrations + seeds
│  └─ scripts/                             # bootstrap/reset/demo loaders
│
├─ docs/                                   # living documentation
│  ├─ adr/                                 # Architecture Decision Records
│  ├─ domain/                              # context maps, event storming, glossary
│  ├─ architecture/                        # C4 diagrams, sequence, deployment
│  ├─ runbooks/                            # ops: oncall, incident, SLOs
│  ├─ openapi/                             # spec source for api-client generation
│  └─ handbook/                            # contributing, coding standards, release process
│
├─ .github/workflows/                      # CI pipelines (lint/test/typecheck/build)
├─ .changeset/                             # versioning for packages/*
├─ turbo.json or nx.json                   # build graph + caching
├─ package.json                            # pnpm workspaces (recommended)
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                      # path aliases & strict settings
├─ .eslintrc.cjs / biome.json
└─ .env.example
```

### Golden import rules (enforced)

```
apps/api|workers (Nest) → packages/contexts/*/{nest,ports,core}
apps/cli (plain Effect) → packages/contexts/*/{compose,ports,core,app}
apps/web             → may import packages/{contracts,api-client,ui,core/utils}; never server-only
packages/contexts/*  →
  core    (pure)     → may import packages/core only
  app     (effects)  → may import its own ports + core; no direct DB/HTTP
  adapters(impure)   → may import packages/platform/*; implements ports (❌ never imported by apps)
  compose            → wiring only (no I/O code beyond adapters it merges)
packages/platform/*  → never import from contexts/*
packages/contracts   → universal; no imports from contexts or platform
packages/ui          → browser-safe; no server imports
No cross-context imports (e.g., trading ↔ portfolio) except via contracts/messages.
```

### Why this decision

- **Replaceable shell**: Nest stays in `apps/api/src/shell` and `modules`; we
  can change framework or transport without touching domain logic.
- **Pure core**: Effect-TS domain services/policies/aggregates are
  framework-free; unit tests are trivial and fast.
- **Context boundaries**: Each bounded context owns its domain artifacts and
  ports; adapters are local to that context.
- **Team velocity**: Clear ownership → fewer merge conflicts; build graph caches
  per package with Turbo/Nx.
- **FE/BE contract**: Single source of truth (`docs/openapi`) generates the
  `api-client` and runtime schemas in `contracts`.

## Constraints & Assumptions

- Package manager: **pnpm** workspaces.
- Build graph: **Turborepo** (Nx is acceptable; decision deferred per team
  preference).
- Runtime: Node 20+, TypeScript strict mode.
- Observability: OpenTelemetry compatible; health endpoints exposed by shell.

## Detailed responsibilities

| Area                           | Contains                                                                                                           | May depend on                                           | Must not depend on                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------- |
| `apps/api` (NestJS)            | **Contains controllers/filters/guards only**; imports **context Nest modules** from `packages/contexts/*/nest`     | packages/contexts/_/nest, packages/platform/_           | other apps, internal web code       |
| `apps/cli`                     | **Effect or Nest** shell; imports `compose/default` (Effect) or the same context **Nest modules** (Nest-Commander) | packages/contexts/_/{compose,nest}, packages/platform/_ | web/ui                              |
| `apps/workers`                 | Processes using same app effects (outbox, schedulers)                                                              | contexts/\* nest+ports, platform/\*                     | web/ui                              |
| `apps/web`                     | Routes, components, hooks; consumes generated client + contracts                                                   | contracts/, api-client/, ui/, core/utils                | platform, contexts adapters, server |
| `packages/contexts/*/core`     | VOs, Events, Aggregates, policies/services (pure)                                                                  | core/                                                   | platform, shell, Node APIs          |
| `packages/contexts/*/ports`    | Effect Tags/interfaces (Repository, MessageBus, PriceFeed…)                                                        | core/ types                                             | platform implementations            |
| `packages/contexts/*/adapters` | Repositories (EventStore/DB), integrations (HTTP/MQ), projections (read models)                                    | platform/\*, core/, ports/                              | other contexts                      |
| `packages/contexts/*/app`      | Commands/Queries/Sagas as Effect programs (thin orchestration)                                                     | core/, ports/                                           | platform directly                   |
| `packages/contexts/*/nest`     | **DynamicModule** factories that bind **ports** to **adapters** (via `compose/default`)                            | core/, ports/, compose/                                 | other contexts                      |
| `packages/contexts/*/compose`  | **default** (prod-ish) and **test** (in-memory/fakes) runtime layers                                               | adapters/, ports/, core/                                | other contexts                      |
| `packages/platform/*`          | Event Store, DB, Cache, Messaging, Monitoring, Security                                                            | core/utils                                              | contexts/\*                         |
| `packages/contracts`           | Zod/OpenAPI schemas and inferred TS types; message payloads                                                        | —                                                       | contexts, platform                  |
| `packages/api-client`          | Generated client from OpenAPI for FE/CLI consumption                                                               | contracts/api                                           | platform, contexts                  |
| `packages/ui`                  | Design system (tokens + components); browser-only                                                                  | —                                                       | Node-only modules                   |
| `infra/*`                      | Docker, K8s, Terraform, migrations, scripts                                                                        | n/a                                                     | n/a                                 |
| `docs/*`                       | ADRs, domain maps, architecture, runbooks, OpenAPI                                                                 | n/a                                                     | n/a                                 |

## TypeScript Configuration

- **Standard structure**: All packages use `src/` for source code, build to
  `dist/`
- **Project references**: Each package has its own `tsconfig.json` with
  `composite: true`
- **ESM-first**: Modern module resolution (`NodeNext` for Node, `Bundler` for
  shared libs)
- **Path mapping**: Consistent aliases pointing to `src/` directories

### Rationale

This enables:

- Fast incremental builds via TypeScript project references
- Proper IDE IntelliSense across package boundaries
- Efficient build caching in Turborepo/Nx
- Clean separation of source vs build artifacts

## Enforcement

**TypeScript path aliases (`tsconfig.base.json`)**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["packages/core/src/*"],
      "@contracts/*": ["packages/contracts/src/*"],
      "@platform/*": ["packages/platform/*/src/*"],
      "@ctx/*": ["packages/contexts/*/src/*"],
      "@ui/*": ["packages/ui/src/*"]
    }
  }
}
```

**ESLint "boundaries" (example snippet)**

```js
// .eslintrc.cjs
module.exports = {
  plugins: ['boundaries'],
  settings: {
    'boundaries/elements': [
      { type: 'app', pattern: 'apps/*' },
      { type: 'context', pattern: 'packages/contexts/*' },
      { type: 'platform', pattern: 'packages/platform/*' },
      { type: 'contracts', pattern: 'packages/contracts/**' },
      { type: 'ui', pattern: 'packages/ui/**' },
      { type: 'core', pattern: 'packages/core/**' },
    ],
  },
  rules: {
    'boundaries/element-types': [
      2,
      {
        default: 'disallow',
        rules: [
          {
            from: 'app',
            allow: ['context', 'platform', 'contracts', 'ui', 'core'],
          },
          { from: 'ui', allow: ['contracts', 'core'] },
          { from: 'context', allow: ['core'] }, // context/core
          { from: 'platform', allow: ['core'] },
          { from: 'contracts', allow: [] },
        ],
      },
    ],
    'no-restricted-imports': [
      2,
      {
        patterns: [
          {
            group: ['packages/contexts/*/adapters/*'],
            message:
              'Direct adapter imports forbidden. Use nest/* or compose/* instead.',
          },
        ],
      },
    ],
  },
};
```

**Package.json exports guidance**

In each `packages/contexts/<ctx>/package.json`, **do not export `adapters/*`**.
Export only `core/*`, `ports/*`, `compose/*`, and `nest/*`:

```json
{
  "exports": {
    "./core/*": "./src/core/*",
    "./ports/*": "./src/ports/*",
    "./compose/*": "./src/compose/*",
    "./nest/*": "./src/nest/*"
  }
}
```

**Build graph (Turbo)**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "lint": { "outputs": [] },
    "typecheck": { "outputs": [] },
    "build": { "outputs": ["dist/**", "build/**"] },
    "test": { "outputs": ["coverage/**"] },
    "dev": { "cache": false }
  }
}
```

## FE/BE Contract

- **Source of truth**: `docs/openapi/*.yaml`.
- **Generation**: CI generates `packages/api-client` and updates
  `packages/contracts/api` runtime schemas.
- **Usage**: Frontend imports `@contracts/api` for types/validation and
  `@api-client` for calls.
- **Benefit**: Backward-compatible changes are easy to detect; FE breakage shows
  up in typechecks.

## Cross-Context Communication

Direct imports between contexts (e.g., `ingestion` importing from `portfolio`)
are strictly forbidden. Communication must occur through well-defined, decoupled
contracts:

1.  **Asynchronous (Preferred):** One context publishes a domain event
    (`CanonicalTxAppended`, `LedgerEntriesRecorded`), and another context
    subscribes to it via the message bus (`platform/messaging`). This is the
    default pattern for inter-context workflows.
2.  **Synchronous (Use Sparingly):** One context exposes a query handler
    (`GetBalanceSnapshotQuery`) that another context's _adapter_ can call. This
    should be reserved for read-only data fetching where eventual consistency is
    not acceptable. The dependency is still on the query contract, not the
    internal implementation.

## Configuration Management

Configuration is managed as an `Effect.Layer` to ensure the functional core
remains pure.

- **Source:** Environment variables (`.env` for local, secrets management for
  prod) are the source of truth.
- **Loading:** The `apps/api/src/boot/` directory is responsible for reading
  these variables and creating a `Config.Layer<PlatformConfig>`.
- **Consumption:** Services within `packages/platform` and
  `packages/contexts/adapters` can access configuration via the `Config` service
  provided by this layer. The pure `core` of a context should not be
  configuration-aware.

## Testing Strategy

- **Unit (fast)**: colocated tests in `packages/core` and each
  `contexts/*/core`.
- **Integration**: `apps/api/test` with Testcontainers (Postgres/Redis/MQ).
- **E2E (contract)**: spin API, assert against OpenAPI & Zod.
- **Frontend**: component tests (Vitest) + a few Playwright flows.

## Alternatives Considered

1. **Flat repo without packages/** _Rejected_: muddles boundaries; hard to share
   code; brittle imports; poor build caching.

2. **Multiple repos (polyrepo)** _Rejected_: heavy CI/CD overhead, harder
   refactors across FE/BE, weak domain cohesion.

3. **Feature-sliced at top level** (mix FE/BE/infra per feature) _Rejected_:
   entangles server+client; clashes with clean shell/core split; complicates
   infra.

4. **Keep Nest + domain intertwined** _Rejected_: reduced testability; framework
   lock-in; harder to adopt workers/CLI.

## Consequences

**Positive**

- Clear dependency direction: `apps → contexts/platform → core`.
- Easy to replace the shell or transports (REST/GraphQL/WS) without touching
  domain.
- Faster builds via graph caching; simpler ownership per folder.

**Negative / Risks**

- Boundary rules require lint + discipline.
- More packages to configure initially.
- Adapters proliferation (per context) requires conventions and generators.

**Mitigations**

- Provide generators in `packages/tooling` for commands/queries/adapters.
- Enforce boundaries via ESLint + CI.
- Maintain “Golden Rules” in `docs/handbook/architecture.md`.

## Non-Goals

- Choosing between Turbo vs Nx (either works; default Turbo).
- Prescribing a specific ORM (Knex/Prisma both fine under `platform/database`).
- Forcing GraphQL/WebSocket; REST is default, others optional in `shell`.

## Diagram (dependency flow)

```
apps/* ─────▶ packages/contexts/*/{nest|compose, ports, core}
   │                    │
   │                    ├────▶ packages/platform/*
   │
   ├────▶ packages/contracts ─▶ apps/web + api-client
   └────▶ packages/ui (web only)

contexts/*/core ──▶ packages/core (shared kernel)
platform/*       ──X (no imports from contexts)
```

## Migration Notes

- Move **existing feature modules** from `apps/api/src/modules/*` →
  `packages/contexts/*/nest/*.module.ts`.
- Create **`packages/contexts/*/compose/default.ts`** (real adapters) and
  **`compose/test.ts`** (in-memory/fakes).
- API imports `@ctx/ingestion/nest/ingestion.module`,
  `@ctx/ledger/nest/ledger.module`.
- CLI (plain Effect) imports `@ctx/ingestion/compose/default` (tests import
  `compose/test`).
- Extract domain logic into `packages/contexts/*/core`; define **ports** for
  I/O.
- Implement **adapters** over `packages/platform/*` (EventStore/DB/MQ/Cache).
- Generate and consume `api-client` from OpenAPI; route FE to it.

## Open Questions

- Package versioning: **fixed** vs **independent** via Changesets?
- Which message bus (RabbitMQ vs Kafka) becomes standard in
  `platform/messaging`?
- Do we enforce ADR review before adding new cross-cutting packages?
- Formalize the default cross-context communication pattern. Is event-driven
  communication via `platform/messaging` the mandated default?

## How to Teach This

- New contributors read `README.md` → `docs/handbook/architecture.md` →
  ADR-0001.
- Code-along: create an import session command in `ingestion/app`, generate a
  repo adapter, expose HTTP, add a Playwright test.

---

**Appendix A — Quickstart commands**

- `pnpm install`
- `pnpm dev` (API + Web, local Postgres/Redis via
  `infra/docker/compose.dev.yml`)
- `pnpm gen:context ingestion` (scaffold, provided by `packages/tooling`)

**Appendix B — Golden rules (tl;dr)**

1. Apps import packages only.
2. Core is pure.
3. App orchestrates; Adapters integrate.
4. Platform is shared infra; never depends on contexts.
5. Contracts are the FE/BE handshake.

**Appendix C — Example imports after edits**

**API**:

```ts
// apps/api/src/app.module.ts
import { IngestionModule } from '@ctx/ingestion/nest/ingestion.module';
import { LedgerModule } from '@ctx/ledger/nest/ledger.module';
import { ReconciliationModule } from '@ctx/reconciliation/nest/reconciliation.module';
import { PortfolioModule } from '@ctx/portfolio/nest/portfolio.module';
// ...
```

**CLI (plain Effect)**:

```ts
// apps/cli/src/main.ts
import { IngestionRuntimeDefault } from '@ctx/ingestion/compose/default';
import { LedgerRuntimeDefault } from '@ctx/ledger/compose/default';
await Effect.runPromise(
  program.pipe(Effect.provideLayer(IngestionRuntimeDefault)),
);
```
