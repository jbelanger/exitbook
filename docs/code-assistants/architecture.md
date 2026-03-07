# Capability-First Modular Monolith

`exitbook` is not "hexagonal everywhere" and it is not a classic layered app.
The repo is a modular monolith split by capability, with selective ports and
adapters where dependency inversion actually protects a capability boundary.

## Architecture shape

- `ingestion` and `accounting` are the main capability packages
  - Each package owns its workflows, pure logic, and capability-owned ports
  - Keep business/workflow logic in the capability package — even when it
    coordinates persistence, events, or external calls
  - Workflows: `ImportWorkflow`, `ProcessingWorkflow` (in `ingestion`)
- `core` is the shared kernel
  - Shared domain types, schemas, result types, utilities
  - No persistence, no adapter implementations, no ports
- `data` is a persistence adapter package
  - Implements capability-owned persistence ports (`buildImportPorts`,
    `buildProcessingPorts`)
- `blockchain-providers`, `exchange-providers`, and `price-providers` are
  technical capability packages
  - They own provider-specific contracts and implementations for reusable
    external access concerns
- `app` is a legacy facade package (being phased out)
  - Historically hosted operations that wrapped capability workflows
  - Capability workflows now live in their owning packages; hosts compose
    them directly
  - Still contains some operations (`ClearOperation`, `BalanceOperation`,
    accounting-side ops) — these will migrate to capability packages or the
    host over time
- `apps/cli` is the host and composition root
  - Command parsing, process lifecycle, cleanup, TUI wiring, runtime setup
  - Builds ports from `@exitbook/data`, constructs workflows from capability
    packages, wraps them in CLI-specific handlers

## Ports and adapters

- Use ports only where the inner capability should own the vocabulary of the
  dependency
- Capability-owned ports live in that capability's `ports/` directory and are
  exported via `./ports`
- `data` may depend on `@exitbook/<capability>/ports` to implement those
  interfaces
  - This inversion is intentional
  - The package that owns the behavior should usually own the port
- Source-level adapter imports should prefer `@exitbook/<capability>/ports`
  over full capability internals
- Do not force every dependency through inward-owned ports
  - If a concept is broader than one capability, the contract can stay in the
    package that owns that concept
  - Example: blockchain provider management belongs to
    `@exitbook/blockchain-providers`, so `ingestion` can depend on that package
    directly

## Dependency guidance

- Invert persistence boundaries aggressively when the workflow is owned by a
  capability
- Be selective with provider abstractions
  - Generic provider access does not need to be re-owned by `ingestion` or
    `accounting`
- Prefer coarse, use-case-shaped ports over repository-shaped CRUD interfaces
- Vertical slices apply inside capability packages
  - Ports are the edge of the capability, not another internal layer

## Composition

- The host (`apps/cli`) is the composition root
- It builds persistence ports from `@exitbook/data` and constructs capability
  workflows directly — no mandatory app-layer indirection
- CLI handlers are thin shells over capability workflows, adding only
  host-specific concerns (TUI, instrumentation, abort handling)
- `@exitbook/app` is not required in the composition path; capability
  packages export their own workflows and ports

## Rule of thumb

- If a package owns the behavior, it should usually own the port
- If a package owns a reusable technical capability, it can own its own
  contracts
- Prefer capability boundaries over technical-layer folders
- Prefer selective inversion over blanket inversion
