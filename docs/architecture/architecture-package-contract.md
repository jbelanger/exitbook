# Architecture Package Contract

## Purpose

This contract defines the responsibility of each package category in the codebase, the allowed dependency directions between them, and the rules used to decide where new code belongs.

The goal is to keep the architecture stable, reduce ambiguity during development, and prevent `core` or `foundation` from becoming dumping grounds.

---

## Architectural model

This codebase uses a **feature-centered modular monolith** with:

- a **thin `foundation`** for independently shippable value types and technical primitives
- a **thin `core`** for app/domain concepts and business invariants
- **feature packages** for use-cases and feature-owned ports
- **provider packages** for reusable, independently shippable external integrations
- **infrastructure packages** for reusable, independently shippable technical capabilities
- a **`data` package** for persistence adapters
- an **app composition root** for wiring

This is a package-boundary blueprint, not a rigid methodology.

### Independent shippability

The architecture distinguishes between packages that must be independently shippable and packages that are app-internal.

A package is independently shippable when it could be published and consumed outside this application without dragging app-specific domain concepts. Provider packages, infrastructure packages, and `foundation` must satisfy this constraint.

The practical test: _could this package be published as a standalone npm package without importing `core`?_ If yes, it is independently shippable. If no, it is app-internal and may depend on `core`.

---

## Package categories

### 1. `foundation`

#### Responsibility

`foundation` is the bottom of the dependency graph. It contains independently shippable value types, technical primitives, and canonical cross-package data language.

The name is intentional: `foundation` signals that this package is load-bearing and deliberately hard to change. Adding to it is an architectural act, not a convenience.

#### Allowed contents

- canonical value types: `Currency`, `Money`, `AssetRef`, `ChainId`, `NetworkId`
- technical primitives: `Result`, `Option`, `Decimal`
- safe arithmetic and formatting for value types
- parsing, serialization, and normalization for value types
- generic error abstractions
- pagination primitives: `Page<T>`, `CursorState`
- canonical identifiers that are not tied to a single business capability

#### Examples

- `Currency` (branded type, parsing, fiat/stablecoin metadata)
- `Money` (amount + currency, arithmetic)
- `AssetRef` (canonical asset identifier)
- `ChainId`, `NetworkId`
- `Result<T, E>`, `ok()`, `err()`, `resultDo`
- `Decimal` helpers (`.toFixed()` wrappers, comparison)
- `Page<T>`, `CursorState`, `PaginationCursor`
- `Instant` (timestamp value type)

#### Must not contain

- business workflows or domain policies
- feature ports or interfaces
- database code or ORM imports
- provider-specific API clients
- app composition or runtime wiring
- vague helper buckets (`utils/`, `helpers/`, `common/`)
- accounting rules, tax interpretation, pricing strategy
- anything that requires understanding of accounts, transactions, or reporting to make sense

#### Boundary rule

A type belongs in `foundation` when it is:

- canonical across the whole system
- needed by both providers and features
- not tied to one business capability
- mostly about representation and safe operations
- publishable as a standalone package without dragging app internals

A type does **not** belong in `foundation` when it carries business policy, feature-specific semantics, or app-level conventions.

#### Examples of what stays out

- "convert using our preferred fallback pricing hierarchy" (business policy)
- "round according to tax-reporting rules" (accounting)
- "derive cost basis currency for account jurisdiction" (feature logic)
- "treat missing fiat quote as zero in PnL reports" (app convention)

---

### 2. `core`

#### Responsibility

`core` contains the app/domain concepts and business invariants that define this application's meaning. It is app-internal and not independently shippable.

#### Allowed contents

- domain entities
- domain schemas
- domain invariants and policies
- stable domain-level identifiers
- business rules that do not belong to a single feature

#### Examples

- `Account`
- `Transaction`, `Movement`
- `ImportSession`
- `Balance`, `AssetHolding`
- `AssetReview`
- `Override`
- `User`
- domain projection definitions

#### Must not contain

- database code, repository implementations, ORM or SQL imports
- provider clients
- feature-specific read models
- CLI or API concerns
- composition builders
- types that independently shippable packages need (those belong in `foundation`)

#### Rule

If a type defines the meaning of the business domain and would still make sense with all features removed except the essentials, it may belong in `core`.

If an independently shippable package (provider, infrastructure) needs the type, it does not belong in `core` — move it to `foundation`.

---

### 3. Feature packages

Examples: `accounts`, `ingestion`, `accounting`

#### Responsibility

A feature package owns a business capability, its use-cases, and the ports it consumes.

#### Allowed contents

- feature services / use-cases
- feature-specific ports/interfaces
- feature validation rules
- feature orchestration logic
- feature read models if they are specific to that capability

#### Examples

- `AccountQueryService`
- `CreateAccount`
- `ProcessingPorts`
- `CostBasisContextReader`
- `HistoricalAssetPriceSource`

#### Must not contain

- concrete DB implementations
- provider API clients
- app runtime composition
- unrelated cross-feature helpers

#### Rule

Feature packages consume independently shippable packages (providers, infrastructure) **directly**. No feature-owned port is needed — the shared package's own API is the contract.

Feature packages use **ports** only for app-internal dependencies — persistence, cross-feature queries, and other contracts that `data` or another internal adapter must implement. The consumer owns the port: if `ingestion` needs a persistence contract, `ingestion` defines the port. The implementing package adapts to that contract.

When a feature needs richer semantics than a shared package's raw API provides (e.g., "audited valuation price with fallback policy and source metadata" on top of `price-providers`), the feature builds its own service layer on top. That is feature logic wrapping a shared capability, not a shared package implementing a feature port.

---

### 4. Provider packages

Examples: `blockchain-providers`, `exchange-providers`, `price-providers`

#### Responsibility

Provider packages encapsulate reusable, independently shippable integrations with external systems.

#### Allowed contents

- API clients
- provider DTO normalization
- request/retry/rate-limit logic
- provider-specific auth/config glue
- caching local to the provider package
- provider-owned persistence when it exists to support the provider capability itself
- reusable provider-facing abstractions

#### Allowed dependencies

- `foundation`
- infrastructure packages
- external libraries
- other narrowly scoped provider support packages if needed

#### Must not depend on

- `core`
- feature packages
- `data`
- app packages

#### Rule

Provider packages are independently shippable infrastructure adapters, not domain core.

If a provider package needs a type that currently lives in `core`, that type must move to `foundation` or the provider is misclassified as independently shippable.

When a provider package owns multiple internal capabilities, organize them as vertical slices such as `price-cache/`, `token-metadata/`, or `provider-catalog/`, not as package-global `core/`, `shared/`, or `persistence/` buckets.

If multiple slices share one provider-owned database, exactly one slice owns the DB initialization, schema, migrations, and low-level queries. Adjacent slices may depend on that persistence owner, but they should not recreate a second package-level persistence layer.

---

### 5. Infrastructure packages

Examples: `logger`, `http`, `resilience`, `sqlite`, `events`, `observability`

#### Responsibility

Infrastructure packages provide reusable, independently shippable technical capabilities that are not tied to external provider APIs or business domain logic.

#### Allowed contents

- logging abstractions and implementations
- HTTP client wrappers
- retry/circuit-breaker/rate-limit implementations
- database driver wrappers
- event bus abstractions
- observability instrumentation

#### Allowed dependencies

- `foundation`
- external libraries

#### Must not depend on

- `core`
- feature packages
- provider packages
- `data`
- app packages

#### Rule

Infrastructure packages are shared technical building blocks. They must be independently shippable and must not carry domain semantics.

---

### 6. `data`

#### Responsibility

`data` implements persistence and storage-related adapters for app-internal domain concepts.

#### Allowed contents

- DB context
- repository implementations
- transaction helpers
- persistence mappers
- SQL/ORM code
- adapter builders implementing feature ports

#### Allowed dependencies

- `core`
- `foundation`
- feature packages, but only to implement their ports
- infrastructure packages (e.g., `sqlite`)
- DB/ORM libraries

#### Must not contain

- business workflows
- CLI views
- API handlers
- high-level app composition

#### Rule

It is acceptable for `data` to know feature ports. That is the normal role of an adapter package.

What `data` must not do is define business policy.

---

### 7. App packages / composition root

Examples: `apps/cli`, future API app

#### Responsibility

The app layer wires concrete implementations to use-cases and exposes delivery mechanisms.

#### Allowed contents

- composition root
- runtime assembly
- CLI commands
- API routes/controllers
- view models
- request/response formatting

#### Must not contain

- business rules that should live in feature packages
- DB code beyond calling composition helpers
- reusable provider implementations

#### Rule

Composition must be centralized per app.

The app layer is the only place where feature packages, providers, and data adapters are intentionally assembled together.

---

## Dependency direction

```text
app        -> data / providers / infrastructure / features / core / foundation
data       -> features / core / foundation / infrastructure
features   -> core / foundation / providers / infrastructure
core       -> foundation
providers  -> foundation / infrastructure
infra      -> foundation
```

### Hard constraints

These rules are not guidelines. They are architectural invariants.

- `foundation` must not depend on `core`, feature packages, providers, infrastructure, or `data`
- `core` must not depend on feature packages, providers, infrastructure, or `data`
- providers must not depend on `core`, feature packages, or `data`
- infrastructure must not depend on `core`, feature packages, providers, or `data`
- feature packages may depend on providers and infrastructure (consuming their stable APIs directly) but must not depend on other feature packages, `data`, or app packages
- `data` may depend on features only to implement their ports

Stated as prohibitions:

```text
foundation  -X-> core
providers   -X-> core
infra       -X-> core
core        -X-> providers, features, data, infra
features    -X-> features, data, app
```

#### Feature-to-feature isolation

Feature packages must not import from other feature packages. This prevents a tangled web of cross-feature coupling that would make features non-extractable.

When a feature needs data or behavior owned by another feature, it has three options:

1. **Define a port.** The consuming feature declares the contract it needs. `data` or another adapter implements it, pulling from whatever source is appropriate. This keeps both features decoupled.
2. **App-layer composition.** The app composition root pipes the output of one feature into another. Neither feature knows about the other. The app layer must only do dumb piping — pass data, map shapes, sequence calls. It must not contain business decisions.
3. **Workflow package.** When cross-feature orchestration represents a distinct business process with its own rules (e.g., conditional logic, compensation, multi-step coordination), extract it into a dedicated workflow package rather than letting business logic accumulate in the app layer. A workflow package is a feature package — it follows all feature package rules, depends on `core`/`foundation`/providers, and consumes other features only through ports. It does not import other feature packages directly.

If an independently shippable package needs a type from `core`, that type must move to `foundation`. There are no exceptions or soft overrides.

---

## Ownership rules

### Rule 1: the consumer owns the port — for app-internal dependencies

If a feature package needs an app-internal dependency (persistence, cross-feature queries), that feature defines the port. The implementing adapter (`data`) conforms to it.

Independently shippable packages (providers, infrastructure) are consumed directly through their own stable APIs. No feature-owned port is needed unless the feature requires richer semantics than the raw API provides.

### Rule 2: stable concepts go inward

The more stable and universal a concept is, the closer it belongs to `foundation`.

### Rule 3: mechanisms stay outward

Persistence, transport, and provider details live in outer packages.

### Rule 4: composition is not domain logic

Wiring belongs in app composition, not in feature packages or `core`.

### Rule 5: foundation is not a convenience bin

Code does not go into `foundation` merely because multiple packages use it. It must pass the independently-publishable test and represent canonical data language or a technical primitive.

---

## Decision guide

When adding new code, ask these questions in order.

### Could it be published standalone without dragging app internals?

If yes and it is a value type or technical primitive, consider `foundation`.

### Does it define app-specific business meaning?

If yes, consider `core`.

### Is it a use-case, workflow, or contract needed by a specific capability?

If yes, put it in the relevant feature package.

### Is it a reusable technical capability (logging, HTTP, resilience)?

If yes, put it in an infrastructure package.

### Is it an implementation of storage or persistence for domain data?

If yes, put it in `data`.

### Is it an integration with an external API or provider?

If yes, put it in a provider package.

### Is it wiring code that connects implementations together?

If yes, put it in the app composition root.

---

## Package-specific guidance

### `accounts`

Owns account-related capability logic and account-facing ports.

Examples:

- account queries
- account creation/update workflows
- account summary read contracts
- account-related policies

### `ingestion`

Owns transaction import and processing workflows and the ports they consume.

Examples:

- processing orchestration
- processed transaction sinks/sources
- parsing coordination
- ingestion freshness contracts

### `accounting`

Owns accounting workflows and the ports they consume.

Examples:

- cost basis calculation
- historical pricing contracts
- reporting and accounting-specific context readers

---

## Composition guidance

Each app should expose a clear composition root, for example:

- `apps/cli/src/composition/accounts.ts`
- `apps/cli/src/composition/ingestion.ts`
- `apps/cli/src/composition/accounting.ts`
- `apps/cli/src/composition/runtime.ts`

Composition files may:

- create DB contexts
- build adapter implementations
- instantiate feature services
- return assembled modules to handlers

Command handlers and route handlers should consume assembled modules, not construct dependencies ad hoc.

---

## Anti-patterns

### `core` as a dumping ground

Bad sign: helpers, DB code, random shared models, and feature contracts all end up in `core`.

### `foundation` as "miscellaneous"

Bad sign: anything reused twice gets moved there. Vague `utils/` directories appear.

### Fat app layer

Bad sign: composition files contain conditional business logic like "if Feature A returns X, do Y with Feature B, then compensate A if B fails." That is a business workflow masquerading as wiring — extract it into a workflow package.

### Fake independence

Bad sign: a provider or infrastructure package claims to be independently shippable but imports `core`. It is not actually independent.

### Feature packages implementing their own infrastructure

Bad sign: feature code imports ORM or provider SDKs directly.

### App layer containing business policy

Bad sign: command handlers or controllers decide core workflows.

### Scattered composition

Bad sign: builders and runtime assembly are spread across commands, utilities, and adapters with no central entry point.

---

## Review checklist

Before merging new package-level code, verify:

- Does this package own this capability?
- Is this interface owned by the consumer?
- Is this implementation in an outer package rather than `core`?
- Is `foundation` staying disciplined — only value types and technical primitives?
- Could every provider and infrastructure package still be published standalone?
- Is composition happening in the app layer?
- Would this still make sense if extracted into a separate package?
- Is the dependency direction moving toward more stable code?

---

## Current state versus target

This contract describes the target architecture. The current codebase has not yet been migrated. Key gaps:

- **No `foundation` package exists.** What this contract calls `foundation` currently lives in `core` (`result/`, `money/`, `cursor/`, `identity/`). Migration: extract these modules from `core` into a new `foundation` package.
- **No `accounts` feature package exists.** Account-related code currently lives in `core/src/account/`. Migration: extract into a dedicated feature package when account-specific workflows emerge.
- **No composition root directory exists.** Composition is currently scattered across CLI command handlers. Migration: centralize into `apps/cli/src/composition/`.
- **Provider packages currently depend on `core`.** `blockchain-providers` and `price-providers` import `Currency`, `Result`, `CursorState`, and other types from `core`. Migration: once `foundation` exists, update these imports to point to `foundation`.
- **Infrastructure packages are not yet classified.** `logger`, `http`, `resilience`, `sqlite`, `events`, `observability` exist but are not governed by explicit rules. This contract now classifies them.

### Migration order

1. Create `foundation` — extract `result/`, `money/`, `cursor/`, `identity/` from `core`
2. Update provider and infrastructure package imports from `core` to `foundation`
3. Enforce the hard dependency rules
4. Centralize composition into `apps/cli/src/composition/`

---

## Default package map

```text
packages/
  foundation/          # value types, technical primitives (independently shippable)
  core/                # domain entities, business invariants (app-internal)
  accounts/            # feature: account capability
  ingestion/           # feature: import and processing
  accounting/          # feature: cost basis, reporting
  data/                # persistence adapters (app-internal)
  blockchain-providers/  # provider (independently shippable)
  exchange-providers/    # provider (independently shippable)
  price-providers/       # provider (independently shippable)
  logger/              # infrastructure (independently shippable)
  http/                # infrastructure (independently shippable)
  resilience/          # infrastructure (independently shippable)
  sqlite/              # infrastructure (independently shippable)
  events/              # infrastructure (independently shippable)
  observability/       # infrastructure (independently shippable)
apps/
  cli/
    src/
      composition/     # app composition root
```

---

## Final principle

The architecture should remain easy to reason about.

- `foundation` defines canonical data language and technical primitives
- `core` defines business meaning
- feature packages define capability logic and the ports they consume
- providers integrate external systems
- infrastructure packages provide reusable technical capabilities
- `data` implements persistence
- apps perform composition

When in doubt, prefer the smallest stable home that preserves clear dependency direction.

The hard test: if a package claims to be independently shippable, it must not import `core`. No exceptions.
