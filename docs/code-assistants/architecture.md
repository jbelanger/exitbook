# Architecture

Canonical reference:

- [`docs/architecture/architecture-package-contract.md`](../architecture/architecture-package-contract.md)

Short version:

- Capability-first modular monolith.
- Capability packages own workflows and ports.
- `data` implements persistence adapters for those ports.
- Hosts compose concrete runtimes directly instead of hiding wiring behind generic registries.
- CLI code should center on `app-runtime.ts`, `command-runtime.ts`, explicit runner functions, and focused prereq helpers.

Read the canonical contract for package boundaries, composition rules, and anti-patterns.
