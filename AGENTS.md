# Repository Guidelines

## Project Structure & Module Organization

Exitbook is a pnpm-managed monorepo. Workspace packages live under `apps/*`, `packages/*`, and `packages/shared/*` as defined in `pnpm-workspace.yaml`. The CLI entry point sits in `apps/cli`, while reusable domain services are split across `packages/core`, `packages/import`, `packages/data`, and `packages/balance`. Shared helpers are under `packages/shared/utils`. Source directories keep their tests close by in `__tests__`. Use `docs/` for architecture references and `specs/` for migrations before starting large changes.

## Build, Test, and Development Commands

- `pnpm install` — install dependencies (Node 23+ and pnpm 10+ required).
- `pnpm dev -- <subcommand>` — run the CLI in watch mode, e.g. `pnpm dev import --exchange kucoin`.
- `pnpm build` — build the CLI package; `pnpm workspace:build` compiles every workspace.
- `pnpm lint` / `pnpm typecheck` — run ESLint with Perfectionist ordering and TypeScript project references.
- `pnpm test`, `pnpm test:e2e`, `pnpm test:coverage` — run unit suites, slow integration cases, and enforce coverage locally.

## Coding Style & Naming Conventions

Code is TypeScript with ESM modules, 2-space indentation, and Prettier formatting. Run `pnpm prettier:fix` before commits. ESLint rules (with Perfectionist) require alphabetized imports, exports, and object keys. Use descriptive names such as `ProviderRegistryService` or `tatumBitcoinApiClient`, and suffix DTOs or schema objects with `Dto`/`Schema`. Favor imperative verbs for functions.

## Testing Guidelines

Vitest powers unit and e2e suites. Place tests next to source files named `*.test.ts` or `*.e2e.test.ts`. Target at least 80% statement coverage for new modules and verify with `pnpm test:coverage`. Mock external providers unless you are testing failover paths; record fixtures under `packages/*/__tests__/fixtures`.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`feat:`, `fix:`, `refactor:`) with subjects under 72 characters. PRs should describe scope, link specs or issues, note breaking changes, and list tests or CLI output when behavior changes. Include screenshots for UI-related updates, even though most work is CLI-level.

## Security & Configuration Tips

Never commit secrets or `.env` files. Inject credentials via environment variables such as `TATUM_API_KEY`. Validate provider configuration before merging with `pnpm providers:validate` or `pnpm blockchain-config:validate`. Commit only configuration updates that pass these checks.
