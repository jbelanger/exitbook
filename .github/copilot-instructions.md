# Copilot Instructions

## Project Snapshot

- pnpm-managed TypeScript monorepo; CLI resides in `apps/cli`, core packages under `packages/{core,import,data,balance}`, shared utilities in `packages/shared/{logger,utils}`.
- Docs and diagrams live in `docs/`; tooling scripts in `tools/`; test files sit beside source (e.g. `*.test.ts`).
- SQLite data produced by the CLI lands in `apps/cli/data/` and should be treated as disposable.

## Essential Commands

- `pnpm install` to sync workspace deps; `pnpm build` for a type-check pass across packages.
- `pnpm test` for unit/integration suites, `pnpm test:coverage` for LCOV output, `pnpm test:e2e` for end-to-end flows (requires API keys).
- `pnpm lint` enforces ESLint + Perfectionist + Unicorn; `pnpm prettier:fix` applies formatting.
- Run CLI via `pnpm dev -- <command>` (e.g. `pnpm dev -- import --exchange kraken --process`).
- Targeted runs: `pnpm vitest run <path/to/file.test.ts>` or `pnpm vitest run --config vitest.e2e.config.ts <path/to/file.e2e.test.ts>`.
- Provider maintenance: `pnpm providers:list`, `pnpm blockchain-providers:validate`, `pnpm providers:sync`.

## Coding Standards

- Use 2-space indentation, ES modules, and prefer `import type` for type-only dependencies.
- Maintain alphabetical import ordering with configured groups; avoid importing from `@exitbook/*/src/**`—consume package barrels instead.
- Embrace `neverthrow` `Result` types for error handling, Zod schemas for external data validation, and log via `@exitbook/shared-logger`.
- Naming: `camelCase` variables/functions, `PascalCase` classes/types, `UPPER_SNAKE_CASE` constants.

## Testing Expectations

- Unit specs end with `.test.ts`; E2E specs use `.e2e.test.ts` and run under `vitest.e2e.config.ts`.
- Stub external providers and isolate SQLite writes to temp locations to keep tests deterministic.
- Add coverage-focused tests when introducing processors, repositories, or CLI handlers; ensure `pnpm test` (and `pnpm test:e2e` when relevant) pass before proposing changes.

## Architecture Notes

- Import pipeline flows Import → Process → Verify; raw payloads persist in `external_transaction_data`, normalized transactions in `transactions`.
- Blockchain provider registry auto-discovers adapters with failover, caching, and circuit breakers; tweak behaviour via `apps/cli/config/blockchain-explorers.json`.
- Exchange integrations live under `packages/import/src/infrastructure/exchanges/<name>/` with paired importer/processor modules and Zod schemas.

## Security & Configuration

- Store API keys (e.g. `ALCHEMY_API_KEY`, `HELIUS_API_KEY`, `KUCOIN_SECRET`) in an untracked `.env`; commands automatically load it.
- Validate `blockchain-explorers.json` before merging, and scrub `apps/cli/data/` artifacts from shared logs or repro steps.
- Never hard-code secrets or long-lived tokens; prefer environment inputs when adding scripts or workflows.
