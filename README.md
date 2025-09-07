# Monorepo

Apps in `apps/*`, reusable libraries in `packages/*`.
- **apps/api**: NestJS Imperative Shell (controllers, DTOs, modules)
- **apps/web**: Frontend (Remix/Next)
- **packages/contexts/**: Functional core per bounded context (core/ports/adapters/app)
- **packages/platform**: Cross-cutting infra (event-store, db, cache, messaging, monitoring)
- **packages/contracts**: OpenAPI/Zod schemas shared FE/BE
- **infra**: docker/k8s/terraform/migrations/scripts
- **docs**: ADRs, domain maps, architecture, runbooks, OpenAPI

Golden import rules: apps → packages only; core is pure; adapters implement ports; no cross-context leakage.
