# Repository Guidelines

## Project Structure & Module Organization

This pnpm monorepo keeps the CLI under `apps/cli`, while reusable domain logic lives in `packages/{core,balance,data,import}` and shared utilities under `packages/shared/{logger,utils}`. Docs live in `docs/`, and tooling scripts sit in `tools/`. Tests stay next to the code they cover (for example `packages/import/src/.../*.test.ts`), and runtime data written by the CLI is ignored under `./data`.

## Build, Test & Development Commands

Install dependencies with `pnpm install`, then use `pnpm dev -- <command>` for rapid CLI experiments (e.g. `pnpm dev -- import --exchange kraken`). Run `pnpm build` to compile all packages, `pnpm lint` to execute ESLint, and `pnpm prettier:fix` to apply formatting. Execute unit tests via `pnpm test`; end-to-end suites use `pnpm test:e2e`. Audit providers with `pnpm providers:list` or validate configs via `pnpm blockchain-config:validate` before shipping.

## Coding Style & Naming Conventions

TypeScript is the primary language with 2-space indentation and ES module syntax. Prefer type-only imports (`import type { Foo }`) and maintain alphabetical import groups; the Perfectionist and Unicorn plugins enforce ordering and Node-focused best practices. Avoid direct `@exitbook/*/src` imports—export through package barrels instead. Use `camelCase` for functions and variables, `PascalCase` for types and classes, and UPPER_SNAKE_CASE for constants. Run `pnpm prettier` before submitting to align with the shared Prettier config.

## Testing Guidelines

Vitest drives unit and integration coverage. Name specs with the `.test.ts` suffix and e2e flows with `.e2e.test.ts`; both are auto-discovered by the root `vitest.config.ts` files. Favour deterministic fixtures by stubbing blockchain providers and isolating SQLite writes to temporary databases. Ensure `pnpm test` and, when applicable, `pnpm test:e2e` succeed locally; add focused tests for new processors, repositories, and CLI handlers.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`feat:`, `fix:`, `refactor:`) as reflected in recent history. Each PR should include a concise summary, linked issue or task reference, risk callouts, and screenshots or command transcripts when behaviour changes. Document new CLI flags or config knobs in `README.md` or the relevant package README, and mention any migration or data-reset steps in the PR description.

## Security & Configuration Tips

Keep API keys (e.g. `ALCHEMY_API_KEY`, `HELIUS_API_KEY`) in local `.env` files and never commit them. Validate `config/blockchain-explorers.json` with the provided pnpm scripts, and prefer environment variables over hard-coded secrets. SQLite artifacts under `./data` may contain sensitive transaction histories—clean them before sharing logs. Review third-party provider updates in `packages/import` whenever rotating credentials or adding new chains.
