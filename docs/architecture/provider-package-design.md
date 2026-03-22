# Provider Package Design

This document adds provider-specific guidance to [Architecture Package Contract](./architecture-package-contract.md).

The dependency rules stay in the package contract. This document defines the UX and public API standard for provider packages.

## Standalone package mindset

Provider packages are treated as standalone published packages, not as app-internal implementation buckets.

They must provide value on their own outside Exitbook. A consumer should be able to install the package, read a small README, and start using it without learning this codebase's internal wiring.

The standard is:

- minimal public surface
- maximal ease of use
- explicit, portable configuration
- package-owned internal composition

## Core rule

Each provider package should expose a small, user-friendly facade that domain packages can depend on directly.

The package should hide its internal registries, factories, managers, and bootstrap helpers unless those are intentionally part of the product.

## Design rules

### 1. One obvious way to start

A consumer should see one primary constructor and know what to call first.

Typical shapes:

- managed capability: `createXxxRuntime(config)`
- stateless capability: `createXxxClient(config)`

If discovery is useful, expose a separate `listXxxProviders()` or `getXxxCatalog()` API.

Do not make consumers choose between several overlapping "default", "manager", "bootstrap", and "registry" entrypoints.

### 2. Package-owned composition

Provider packages should assemble their own internal pieces.

That includes:

- provider registries
- factory maps
- retry, failover, and rate-limit wiring
- provider-owned persistence
- background tasks
- provider-manager setup

The app should pass explicit config into the package and receive a narrow facade back.

The app should not need to know how provider factories are registered or how manager internals are wired together.

### 3. Explicit, portable configuration

Provider packages should accept explicit config objects.

They should not depend on app-specific conventions such as:

- hidden `process.env` fallback inside package constructors
- implicit `dataDir` conventions that only make sense inside Exitbook
- config file lookup based on `process.cwd()`

The app or host layer may read environment variables or files, then build the package config explicitly.

If a package needs config normalization or validation, expose a typed helper for that purpose. Do not hide config resolution inside the main runtime constructor.

### 4. Curated public exports

The main package entrypoint should export only what an external consumer should rely on.

Usually that means:

- the primary constructor
- consumer-facing interfaces and result types
- discovery APIs
- lifecycle types when relevant
- stable query and config types

Usually that does not mean:

- registry objects
- raw provider factory maps or arrays
- bootstrap-only helpers
- internal manager wiring types
- implementation classes that are not meant to be constructed directly
- convenience constructors that only exist to read env vars or app defaults

Use the README test:

If an export would be awkward to explain in the package README, it probably should not be public.

### 4.1 Naming by role

Public provider package contracts should use names that match the package role:

- managed package facade: `IPriceProviderRuntime`, `IBlockchainProviderRuntime`
- stateless package facade: `IExchangeClient`
- low-level provider implementation: `IPriceProvider`, `IBlockchainProvider`

Avoid introducing generic public names like `Api` when a more specific role name already exists.
Also avoid exporting public `*Manager` interfaces when the manager is only an internal assembly detail.

### 4.2 Dedicated subpaths for auxiliary helpers

If a provider package has auxiliary helpers that are useful but not part of the primary "one obvious way to start" flow, expose them from explicit subpaths instead of the root facade.

Good examples:

- `@pkg/benchmark`
- `@pkg/asset-review`
- `@pkg/<provider>`

This keeps the root entrypoint focused on the main runtime or client while still allowing intentionally supported secondary capabilities.

### 5. Clear lifecycle

Some provider packages are stateful and own resources. Others are stateless.

Both are valid.

Rules:

- expose `cleanup()` or `destroy()` only when the package truly owns resources or background work
- do not add a manager just for symmetry
- do not force consumers to manage lifecycle for stateless capabilities

Lifecycle should follow the capability, not a naming convention.

### 6. Discoverability without internals

If consumers need to know what providers or exchanges are supported, expose that directly.

Good:

- `listSupportedExchanges()`
- `listPriceProviders()`
- `getBlockchainProviderCatalog()`

Avoid making consumers inspect internal registries or infer support from a private factory map.

If both static metadata and operational status are useful, keep them separate:

- static catalog: what the package supports
- runtime status: health, failover state, cache freshness, provider stats

### 7. Stable consumer-facing contracts

The public API should describe the provider capability, not the app's workflow wiring.

Feature packages should be able to depend on provider packages directly through contracts that still make sense outside Exitbook.

Good public concepts:

- exchange client
- blockchain provider runtime
- price source
- manual price service
- provider catalog

Bad public concepts:

- CLI wrapper
- app-specific "opened runtime" adapter
- internal registry bootstrap config
- host-default builder that exists only to read env vars

## Composition boundary

The right balance is:

- package-owned internal composition: good
- app-owned micro-wiring of provider internals: bad
- package-owned hidden host assumptions: bad

The package should own internal assembly.

The app should own:

- reading env vars
- reading config files
- choosing app defaults
- mapping host concerns into the package config

## Recommended package shapes

Not every provider package needs the same runtime model, but each should follow the same UX bar.

### Managed package

Use this shape when the package owns persistence, background work, health tracking, or failover state.

Example shape:

```ts
const runtime = await createXxxRuntime(config);

const result = await runtime.client.doWork(input);

await runtime.cleanup();
```

### Stateless package

Use this shape when the package only needs credentials and request logic.

Example shape:

```ts
const client = createXxxClient(config);

const result = await client.fetchSomething();
```

## Practical review checklist

Before adding a new export or entrypoint to a provider package, ask:

1. Would this make sense to an external consumer of a published npm package?
2. Is this part of the product, or just part of our internal wiring?
3. Is there already one obvious way to start?
4. Does this API require hidden env vars, cwd-based paths, or Exitbook-specific assumptions?
5. Can a feature package depend on this API directly without learning internals?

If any answer is weak, keep the API internal and improve the facade instead.
