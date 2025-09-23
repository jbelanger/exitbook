# Repository Guidelines

## Project Structure & Module Organization
- Monorepo managed by `pnpm`; workspace packages live under `apps/*`, `packages/*`, and `packages/shared/*` per `pnpm-workspace.yaml`.
- `apps/cli` exposes the transaction CLI entry point, while domain logic is split across `packages/core`, `packages/import`, `packages/data`, `packages/balance`, and shared utilities in `packages/shared/utils`.
- Tests sit beside source in `__tests__` folders (for example `packages/import/src/blockchains/bitcoin/api/__tests__`). Reference architecture notes in `docs/` and migration specs in `specs/` before large changes.

## Build, Test, and Development Commands
- `pnpm install` – install workspace dependencies (Node 23+ and pnpm 10+ required).
- `pnpm dev -- <subcommand>` – run the CLI in watch mode (`pnpm dev import --exchange kucoin`).
- `pnpm build` – build the CLI package; `pnpm workspace:build` builds every package.
- `pnpm lint`, `pnpm typecheck` – run ESLint + Perfectionist rules and TypeScript in project references.
- `pnpm test` for unit suites, `pnpm test:e2e` for slow integration cases, `pnpm test:coverage` to enforce coverage locally.

## Coding Style & Naming Conventions
- TypeScript with ESM modules, 2-space indentation, and Prettier formatting. Run `pnpm prettier:fix` before committing.
- Follow ESLint defaults plus Perfectionist ordering; keep exports, object keys, and class members alphabetized.
- Use descriptive file and symbol names (`ProviderRegistryService`, `tatumBitcoinApiClient`). Prefer imperative function names and noun-based DTOs ending in `Dto` or `Schema`.

## Testing Guidelines
- Write new cases in Vitest using `*.test.ts`; end-to-end scenarios live in `*.e2e.test.ts`. Mirror the source directory when creating tests.
- Target >80% statement coverage for new modules and validate with `pnpm test:coverage`.
- Mock network providers unless explicitly exercising failover paths; document fixtures under `packages/*/__tests__/fixtures` when added.

## Commit & Pull Request Guidelines
- Favor Conventional Commits (`feat:`, `fix:`, `refactor:`). Recent history (`git log`) shows `feat: Add templates…`; match that tone and keep subjects imperative and ≤72 chars.
- Each PR should describe scope, link relevant specs or issues, note breaking changes, and list tests run. Include CLI output or screenshots when behavior changes.

## Security & Configuration Tips
- Secrets (API keys, exchange credentials) must be injected via environment variables referenced by decorators (e.g., `TATUM_API_KEY`). Never commit `.env` files.
- Validate provider configs with `pnpm providers:validate` or `pnpm blockchain-config:validate` before merging infrastructure updates.
