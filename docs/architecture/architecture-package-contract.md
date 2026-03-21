# Architecture Package Contract

## Purpose

This contract defines the responsibility of each package category in the codebase, the allowed dependency directions between them, and the rules used to decide where new code belongs.

The goal is to keep the architecture stable, reduce ambiguity during development, and prevent `core` or `shared` from becoming dumping grounds.

---

## Architectural model

This codebase uses a **feature-centered modular monolith** with:

- a **thin `core`** for shared domain concepts
- a **thin `shared`** package for technical and canonical cross-cutting primitives
- **feature packages** for use-cases and feature-owned ports
- **provider packages** for reusable external integrations
- a **`data` package** for persistence adapters
- an **app composition root** for wiring

This is a package-boundary blueprint, not a rigid methodology.

---

## Package categories

## 1. `core`

### Responsibility

`core` contains the smallest stable set of domain concepts that define the language of the system.

### Allowed contents

- domain entities
- value objects
- canonical domain schemas
- domain invariants
- stable domain-level identifiers
- small domain-level utility types only when truly universal

### Examples

- `Account`
- `Transaction`
- `AssetHolding`
- `ImportSession` if truly canonical
- `AccountId`, `TransactionId`

### Must not contain

- database code
- repository implementations
- ORM or SQL imports
- provider clients
- feature-specific read models
- CLI or API concerns
- composition builders
- generic helpers that are not domain concepts

### Rule

If a type defines the meaning of the business domain and would still make sense with all features removed except the essentials, it may belong in `core`.

---

## 2. `shared`

### Responsibility

`shared` contains technical and canonical cross-cutting primitives that are needed across multiple packages but are not themselves domain capabilities.

### Allowed contents

- `Result`, `Option`, `Maybe`
- `Clock` interface
- `Logger` interface
- generic error abstractions
- retry/backoff policy abstractions
- pagination primitives
- canonical but non-feature-specific technical identifiers
- provider-neutral market or chain primitives when needed by multiple providers and features

### Examples

- `ChainId`
- `AssetRef`
- `FiatCurrency`
- `Instant`
- `ProviderError`
- `Page<T>`

### Must not contain

- business workflows
- feature ports
- DB repositories
- app composition
- provider-specific API clients
- random helper accumulation

### Rule

`shared` exists to avoid duplication of small stable primitives. It must stay tiny, boring, and dependency-light.

---

## 3. Feature packages

Examples: `accounts`, `ingestion`, `accounting`

### Responsibility

A feature package owns a business capability, its use-cases, and the ports it consumes.

### Allowed contents

- feature services / use-cases
- feature-specific ports/interfaces
- feature validation rules
- feature orchestration logic
- feature read models if they are specific to that capability

### Examples

- `AccountQueryService`
- `CreateAccount`
- `ProcessingPorts`
- `CostBasisContextReader`
- `HistoricalAssetPriceSource`

### Must not contain

- concrete DB implementations
- provider API clients
- app runtime composition
- unrelated cross-feature helpers

### Rule

A port belongs to the package that **consumes** it.

If `ingestion` needs data in a certain shape, `ingestion` defines the port. If `accounts` needs a query model, `accounts` defines the port. The implementing package adapts to that contract.

---

## 4. Provider packages

Examples: `blockchain-providers`, `price-providers`

### Responsibility

Provider packages encapsulate reusable integrations with external systems.

### Allowed contents

- API clients
- provider DTO normalization
- request/retry/rate-limit logic
- provider-specific auth/config glue
- caching local to the provider package
- provider-owned persistence when it exists to support the provider capability itself
- reusable provider-facing abstractions

### Allowed dependencies

- `shared`
- external libraries
- other narrowly scoped provider support packages if needed

### Should usually not depend on

- `core`
- feature packages
- `data`
- app packages

### Rule

Provider packages are shared infrastructure adapters, not domain core.

Only depend on `core` if there is a very strong reason and only for minimal canonical types. The default is to depend on `shared`, not `core`.

When a provider package owns multiple internal capabilities, organize them as vertical slices such as `price-cache/`, `token-metadata/`, or `provider-catalog/`, not as package-global `core/`, `shared/`, or `persistence/` buckets.

If multiple slices share one provider-owned database, exactly one slice owns the DB initialization, schema, migrations, and low-level queries. Adjacent slices may depend on that persistence owner, but they should not recreate a second package-level persistence layer.

---

## 5. `data`

### Responsibility

`data` implements persistence and storage-related adapters.

### Allowed contents

- DB context
- repository implementations
- transaction helpers
- persistence mappers
- SQL/ORM code
- adapter builders implementing feature ports

### Allowed dependencies

- `core`
- `shared`
- feature packages, but only to implement their ports
- DB/ORM libraries

### Must not contain

- business workflows
- CLI views
- API handlers
- high-level app composition

### Rule

It is acceptable for `data` to know feature ports. That is the normal role of an adapter package.

What `data` must not do is define business policy.

---

## 6. App packages / composition root

Examples: `apps/cli`, future API app

### Responsibility

The app layer wires concrete implementations to use-cases and exposes delivery mechanisms.

### Allowed contents

- composition root
- runtime assembly
- CLI commands
- API routes/controllers
- view models
- request/response formatting

### Must not contain

- business rules that should live in feature packages
- DB code beyond calling composition helpers
- reusable provider implementations

### Rule

Composition must be centralized per app.

The app layer is the only place where feature packages, providers, and data adapters are intentionally assembled together.

---

## Dependency direction

The preferred direction is:

`app -> data / providers / features / core / shared`

`data -> features / core / shared`

`providers -> shared`

`features -> core / shared`

`core -> shared` only if absolutely necessary, but prefer `core` to remain highly independent

### Strong constraints

- `core` must not depend on feature packages, providers, or `data`
- `shared` must not depend on feature packages, providers, or `data`
- feature packages must not depend on app packages
- provider packages must not depend on feature packages or `data`
- `data` may depend on features only to implement their ports

---

## Ownership rules

## Rule 1: the consumer owns the port

If a package needs a dependency in a particular shape, that package defines the interface.

## Rule 2: stable concepts go inward

The more stable and universal a concept is, the closer it belongs to `core`.

## Rule 3: mechanisms stay outward

Persistence, transport, and provider details live in outer packages.

## Rule 4: composition is not domain logic

Wiring belongs in app composition, not in feature packages or `core`.

## Rule 5: shared is not a fallback bin

Code does not go into `shared` merely because multiple packages use it.

---

## Decision guide

When adding new code, ask these questions in order.

### Does it define core business meaning?

If yes, consider `core`.

### Is it a small technical primitive reused across multiple packages but not business-specific?

If yes, consider `shared`.

### Is it a use-case, workflow, or contract needed by a specific capability?

If yes, put it in the relevant feature package.

### Is it an implementation of storage or persistence?

If yes, put it in `data`.

### Is it an implementation of an external API or provider?

If yes, put it in a provider package.

### Is it wiring code that connects implementations together?

If yes, put it in the app composition root.

---

## Package-specific guidance

## `accounts`

Owns account-related capability logic and account-facing ports.

Examples:

- account queries
- account creation/update workflows
- account summary read contracts
- account-related policies

## `ingestion`

Owns transaction import and processing workflows and the ports they consume.

Examples:

- processing orchestration
- processed transaction sinks/sources
- parsing coordination
- ingestion freshness contracts

## `accounting`

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

### `shared` as “miscellaneous”

Bad sign: anything reused twice gets moved there.

### feature packages implementing their own infrastructure

Bad sign: feature code imports ORM or provider SDKs directly.

### app layer containing business policy

Bad sign: command handlers or controllers decide core workflows.

### scattered composition

Bad sign: builders and runtime assembly are spread across commands, utilities, and adapters with no central entry point.

---

## Review checklist

Before merging new package-level code, verify:

- Does this package own this capability?
- Is this interface owned by the consumer?
- Is this implementation in an outer package rather than `core`?
- Is `shared` staying tiny and generic?
- Is composition happening in the app layer?
- Would this still make sense if extracted into a separate package?
- Is the dependency direction moving toward more stable code?

---

## Default package map

```text
packages/
  core/
  shared/
  accounts/
  ingestion/
  accounting/
  data/
  blockchain-providers/
  price-providers/
apps/
  cli/
    composition/
```

---

## Final principle

The architecture should remain easy to reason about.

- `core` defines meaning
- `shared` defines small cross-cutting primitives
- feature packages define capability logic and the ports they consume
- providers integrate external systems
- `data` implements persistence
- apps perform composition

When in doubt, prefer the smallest stable home that preserves clear dependency direction.
