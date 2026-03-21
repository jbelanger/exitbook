# Capability-First Modular Monolith

`exitbook` is a modular monolith split by capability, not a blanket layered
architecture. We use ports and adapters selectively, only where dependency
inversion protects a real capability boundary.

The main rule is ownership: if a package owns the behavior, it should own the
public vocabulary for that behavior. Shared use is not a reason to move a type
into `core`.

## Package boundaries

- `ingestion` and `accounting` are the main business capability packages
  - They own workflows, pure business logic, and capability-owned ports
  - Keep use-case orchestration here even when it coordinates persistence or
    external access
- `core` is the exitbook domain kernel
  - Domain models, domain value objects, domain schemas, result helpers, and
    exitbook-specific shared concepts
  - No persistence, no adapter implementations, no provider-specific contracts
  - Do not use `core` as a dumping ground for misc shared helpers
- `blockchain-providers`, `exchange-providers`, and `price-providers` are
  standalone technical capability packages
  - They should be useful on their own
  - They own provider-specific contracts, normalized provider payloads, runtime
    behavior, and persistence tied to that capability
  - If another package needs that vocabulary, it should import the provider
    package directly
- `data` is a persistence adapter package
  - Implements business-capability persistence ports such as
    `buildImportPorts` and `buildProcessingPorts`
- `apps/cli` is the host and composition root
  - Command parsing, runtime setup, process lifecycle, TUI wiring, cleanup

## Ownership rules

- Keep a contract in the package that owns the behavior behind it
- Do not move a type into `core` just because multiple packages import it
- If a type is part of a technical package's public API, that package owns it
- Example: `TokenMetadata` belongs to `@exitbook/blockchain-providers`, not
  `@exitbook/core`
- Example: price-provider DTOs belong to `@exitbook/price-providers`
- Example: exchange-provider request/auth/input contracts belong to
  `@exitbook/exchange-providers`

## Ports and adapters

- Use ports where the business capability should own the vocabulary of the
  dependency
- Capability-owned ports live in that capability's `ports/` directory and are
  exported via `./ports`
- `data` may depend on `@exitbook/<capability>/ports` to implement those
  interfaces
- Do not force technical capability packages through business-owned ports when
  the technical package already owns the right contract
- Generic provider access does not need to be re-owned by `ingestion` or
  `accounting`

## Shared code discipline

- Shared use alone is not enough to justify adding something to `core`
- If a helper is generic but not domain-specific, prefer keeping it local until
  a clear long-term home exists
- If reuse becomes structural across multiple packages, extract a smaller
  neutral shared package instead of widening `core`
- Duplicate a tiny helper before polluting a package boundary with the wrong
  dependency

## Composition

- The host (`apps/cli`) composes packages directly
- Build business persistence ports from `@exitbook/data`
- Construct provider runtimes from their owning technical packages
- Keep CLI handlers thin; add only host concerns like abort wiring,
  instrumentation, and presentation

## Rule of thumb

- `core` is for exitbook domain concepts, not for "anything shared"
- Technical packages own their public contracts
- Prefer capability ownership over convenience imports
- Prefer selective inversion over blanket inversion
