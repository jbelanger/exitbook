# ADR-0001: Monorepo Structure & Boundaries (NestJS Shell + Effect-TS Core)

**Status**: Accepted
**Date**: 2025-09-06
**Deciders**: Architecture group (Joel as lead)
**Context**: Full-stack monorepo with frontend, backend, infra, docs. Backend uses **NestJS as an imperative shell** and **Effect-TS** for the functional core.

## Decision

Adopt a **context-first monorepo** that separates *deployables* (`apps/*`) from *reusable libraries* (`packages/*`), with strict boundaries that keep the **NestJS shell replaceable** and the **Effect-TS core pure and framework-agnostic**.

### Repository layout

```text
.
├─ apps/                                   # Executables (deployables)
│  ├─ api/                                 # NestJS shell (HTTP)
│  │  ├─ src/
│  │  │  ├─ shell/                         # controllers/dto/filters/interceptors/guards
│  │  │  ├─ modules/                       # Nest modules bridging to Effect layers
│  │  │  ├─ boot/                          # composition root: Effect Layers + Providers
│  │  │  └─ main.ts
│  │  └─ test/                             # e2e/integration tests (supertest, testcontainers)
│  ├─ workers/                             # outbox dispatcher, schedulers, consumers
│  ├─ cli/                                 # admin/maintenance CLI wired to app effects
│  └─ web/                                 # Remix/Next frontend (app/src, tests)
│
├─ packages/                               # Reusable libraries (versioned)
│  ├─ core/                                # shared kernel (pure TS)
│  │  ├─ domain/                           # base Entity/Aggregate/Event, errors, ids, Money, etc.
│  │  ├─ effect/                           # Effect runtime, common Layers (Clock, Config, UUID)
│  │  └─ utils/                            # bignum/date/validation helpers
│  ├─ contexts/                            # bounded contexts (functional core first)
│  │  ├─ trading/                          # each context has:
│  │  │  ├─ core/                          #   pure: VOs, events, aggregates, policies/services
│  │  │  ├─ ports/                         #   Effect Tags (interfaces) needed by core/app
│  │  │  ├─ adapters/                      #   impure impls: repositories, http, mq, projections
│  │  │  └─ app/                           #   thin orchestration (commands/queries/sagas as Effects)
│  │  ├─ portfolio/
│  │  ├─ taxation/
│  │  └─ reconciliation/
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
apps/*               → can import packages/*
apps/web             → may import packages/{contracts,api-client,ui,core/utils}; never server-only
apps/api|workers|cli → may import packages/contexts/*/{app,ports,core} and packages/platform/*
packages/contexts/*  → 
  core    (pure)     → may import packages/core only
  app     (effects)  → may import its own ports + core; no direct DB/HTTP
  adapters(impure)   → may import packages/platform/*; implements ports
packages/platform/*  → must not import from contexts/*
packages/contracts   → universal; no imports from contexts or platform
packages/ui          → browser-safe; no server imports
No cross-context imports (e.g., trading ↔ portfolio) except via contracts/messages.
```

### Why this decision

* **Replaceable shell**: Nest stays in `apps/api/src/shell` and `modules`; we can change framework or transport without touching domain logic.
* **Pure core**: Effect-TS domain services/policies/aggregates are framework-free; unit tests are trivial and fast.
* **Context boundaries**: Each bounded context owns its domain artifacts and ports; adapters are local to that context.
* **Team velocity**: Clear ownership → fewer merge conflicts; build graph caches per package with Turbo/Nx.
* **FE/BE contract**: Single source of truth (`docs/openapi`) generates the `api-client` and runtime schemas in `contracts`.

## Constraints & Assumptions

* Package manager: **pnpm** workspaces.
* Build graph: **Turborepo** (Nx is acceptable; decision deferred per team preference).
* Runtime: Node 20+, TypeScript strict mode.
* Observability: OpenTelemetry compatible; health endpoints exposed by shell.

## Detailed responsibilities

| Area                           | Contains                                                                        | May depend on                            | Must not depend on                  |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| `apps/api` (NestJS)            | Controllers, DTOs, filters, pipes, guards, **Nest modules**, composition root   | packages/contexts/*, packages/platform/* | other apps, internal web code       |
| `apps/workers`, `apps/cli`     | Processes using same app effects (outbox, schedulers, admin CLI)                | contexts/\* app+ports, platform/\*       | web/ui                              |
| `apps/web`                     | Routes, components, hooks; consumes generated client + contracts                | contracts/, api-client/, ui/, core/utils | platform, contexts adapters, server |
| `packages/contexts/*/core`     | VOs, Events, Aggregates, policies/services (pure)                               | core/                                    | platform, shell, Node APIs          |
| `packages/contexts/*/ports`    | Effect Tags/interfaces (Repository, MessageBus, PriceFeed…)                     | core/ types                              | platform implementations            |
| `packages/contexts/*/adapters` | Repositories (EventStore/DB), integrations (HTTP/MQ), projections (read models) | platform/\*, core/, ports/               | other contexts                      |
| `packages/contexts/*/app`      | Commands/Queries/Sagas as Effect programs (thin orchestration)                  | core/, ports/                            | platform directly                   |
| `packages/platform/*`          | Event Store, DB, Cache, Messaging, Monitoring, Security                         | core/utils                               | contexts/\*                         |
| `packages/contracts`           | Zod/OpenAPI schemas and inferred TS types; message payloads                     | —                                        | contexts, platform                  |
| `packages/api-client`          | Generated client from OpenAPI for FE/CLI consumption                            | contracts/api                            | platform, contexts                  |
| `packages/ui`                  | Design system (tokens + components); browser-only                               | —                                        | Node-only modules                   |
| `infra/*`                      | Docker, K8s, Terraform, migrations, scripts                                     | n/a                                      | n/a                                 |
| `docs/*`                       | ADRs, domain maps, architecture, runbooks, OpenAPI                              | n/a                                      | n/a                                 |

## Enforcement

**TypeScript path aliases (`tsconfig.base.json`)**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["packages/core/*"],
      "@contracts/*": ["packages/contracts/*"],
      "@platform/*": ["packages/platform/*"],
      "@ctx/*": ["packages/contexts/*"],
      "@ui/*": ["packages/ui/*"]
    }
  }
}
```

**ESLint “boundaries” (example snippet)**

```js
// .eslintrc.cjs
module.exports = {
  plugins: ["boundaries"],
  settings: {
    "boundaries/elements": [
      { type: "app",        pattern: "apps/*" },
      { type: "context",    pattern: "packages/contexts/*" },
      { type: "platform",   pattern: "packages/platform/*" },
      { type: "contracts",  pattern: "packages/contracts/**" },
      { type: "ui",         pattern: "packages/ui/**" },
      { type: "core",       pattern: "packages/core/**" }
    ]
  },
  rules: {
    "boundaries/element-types": [2, {
      default: "disallow",
      rules: [
        { from: "app",       allow: ["context", "platform", "contracts", "ui", "core"] },
        { from: "ui",        allow: ["contracts", "core"] },
        { from: "context",   allow: ["core"] },                 // context/core
        { from: "platform",  allow: ["core"] },
        { from: "contracts", allow: [] },
      ]
    }]
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

* **Source of truth**: `docs/openapi/*.yaml`.
* **Generation**: CI generates `packages/api-client` and updates `packages/contracts/api` runtime schemas.
* **Usage**: Frontend imports `@contracts/api` for types/validation and `@api-client` for calls.
* **Benefit**: Backward-compatible changes are easy to detect; FE breakage shows up in typechecks.

## Testing Strategy

* **Unit (fast)**: colocated tests in `packages/core` and each `contexts/*/core`.
* **Integration**: `apps/api/test` with Testcontainers (Postgres/Redis/MQ).
* **E2E (contract)**: spin API, assert against OpenAPI & Zod.
* **Frontend**: component tests (Vitest) + a few Playwright flows.

## Alternatives Considered

1. **Flat repo without packages/**
   *Rejected*: muddles boundaries; hard to share code; brittle imports; poor build caching.

2. **Multiple repos (polyrepo)**
   *Rejected*: heavy CI/CD overhead, harder refactors across FE/BE, weak domain cohesion.

3. **Feature-sliced at top level** (mix FE/BE/infra per feature)
   *Rejected*: entangles server+client; clashes with clean shell/core split; complicates infra.

4. **Keep Nest + domain intertwined**
   *Rejected*: reduced testability; framework lock-in; harder to adopt workers/CLI.

## Consequences

**Positive**

* Clear dependency direction: `apps → contexts/platform → core`.
* Easy to replace the shell or transports (REST/GraphQL/WS) without touching domain.
* Faster builds via graph caching; simpler ownership per folder.

**Negative / Risks**

* Boundary rules require lint + discipline.
* More packages to configure initially.
* Adapters proliferation (per context) requires conventions and generators.

**Mitigations**

* Provide generators in `packages/tooling` for commands/queries/adapters.
* Enforce boundaries via ESLint + CI.
* Maintain “Golden Rules” in `docs/handbook/architecture.md`.

## Non-Goals

* Choosing between Turbo vs Nx (either works; default Turbo).
* Prescribing a specific ORM (Knex/Prisma both fine under `platform/database`).
* Forcing GraphQL/WebSocket; REST is default, others optional in `shell`.

## Diagram (dependency flow)

```
apps/*  ─────▶  packages/contexts/*/{app,ports,core}
   │                     │
   │                     ├────▶ packages/platform/*
   │                     │
   ├────▶ packages/contracts ───▶ apps/web + api-client
   └────▶ packages/ui (web only)

contexts/*/core ──▶ packages/core (shared kernel)
platform/*       ──X (no imports from contexts)
```

## Migration Notes

* Move all Nest-specific code under `apps/api/src/shell` & `modules`.
* Extract domain logic into `packages/contexts/*/core`; define **ports** for I/O.
* Implement **adapters** over `packages/platform/*` (EventStore/DB/MQ/Cache).
* Generate and consume `api-client` from OpenAPI; route FE to it.

## Open Questions

* Package versioning: **fixed** vs **independent** via Changesets?
* Which message bus (RabbitMQ vs Kafka) becomes standard in `platform/messaging`?
* Do we enforce ADR review before adding new cross-cutting packages?

## How to Teach This

* New contributors read `README.md` → `docs/handbook/architecture.md` → ADR-0001.
* Code-along: create a “hello” command in `trading/app`, generate a repo adapter, expose HTTP, add a Playwright test.

---

**Appendix A — Quickstart commands**

* `pnpm install`
* `pnpm dev` (API + Web, local Postgres/Redis via `infra/docker/compose.dev.yml`)
* `pnpm gen:context trading` (scaffold, provided by `packages/tooling`)

**Appendix B — Golden rules (tl;dr)**

1. Apps import packages only.
2. Core is pure.
3. App orchestrates; Adapters integrate.
4. Platform is shared infra; never depends on contexts.
5. Contracts are the FE/BE handshake.
