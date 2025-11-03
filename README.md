# ExitBook

ExitBook is an open-source CLI that turns fragmented exchange exports and blockchain history into a reconciled ledger suitable for accounting and tax workflows. The project emphasizes reproducible data pipelines over UI.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D23-blue.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.6.2-orange.svg)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Test Suite](https://github.com/jbelanger/exitbook/actions/workflows/test.yml/badge.svg)](https://github.com/jbelanger/exitbook/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/jbelanger/exitbook/branch/main/graph/badge.svg)](https://codecov.io/gh/jbelanger/exitbook)

## Problem We Address

- Exchange and on-chain data arrive in incompatible formats that break cross-source reconciliation.
- Transfers lose intent when withdrawals and deposits cannot be tied together, corrupting gain/loss calculations.
- Historical crypto and FX prices must be sourced consistently to make reports auditable.
- Teams need an extendable pipeline that accepts new venues without rewrites or manual branching.

## Design Principles

- Two-phase import pipeline: fetch & normalize raw payloads, then process them into a universal schema so source-specific logic stays isolated.
- Vertical slices per exchange/blockchain keep importers, processors, schemas, and tests co-located for easier contributions.
- Functional core with neverthrow results and Zod validation keeps failures explicit and recoverable.
- Provider registries and metadata drive dynamic discovery and failover—no hardcoded lists of explorers or price feeds.
- Deterministic pricing pipeline (derive → normalize FX → fetch → re-derive) makes historical results reproducible.

## Pipeline Overview

1. Import: CSV/API adapters capture raw and normalized payloads in SQLite.
2. Process: Transform normalized data into `UniversalTransaction` records.
3. Link: Correlate withdrawals and deposits to classify transfers instead of taxable disposals.
4. Enrich: Multi-stage pricing updates `prices.db` with derived and fetched quotes.
5. Analyze: Cost-basis engine applies FIFO/LIFO/Specific ID rules and exports jurisdiction-friendly reports.

Each stage is exposed as a CLI command via `pnpm run dev <command>`.

## Repository Layout

- `apps/cli/` – Commander-based entry point plus orchestration utilities.
- `packages/ingestion/` – Importers, processors, blockchain provider registry, and failover logic.
- `packages/accounting/` – Linking, pricing, and cost-basis calculation modules.
- `packages/data/` – Kysely schema, repositories, and migrations backed by SQLite.
- `packages/core/` – Domain types, Zod schemas, and shared validation helpers.
- `packages/shared-*` – Logging, HTTP, and platform utilities.

## Getting Started

- Requirements: Node.js ≥ 23, pnpm ≥ 10.6.2, SQLite via bundled better-sqlite3.
- Install dependencies with `pnpm install`.
- Run an initial pipeline:

```bash
pnpm run dev import --exchange kraken --csv-dir ./exports/kraken --process
pnpm run dev link
pnpm run dev prices enrich
```

- Add provider API keys in `.env` as needed; see `CLAUDE.md` for available integrations.

SQLite databases live under `apps/cli/data/` and are safe to drop during development.

## Contributing

- Discuss design changes in issues or the ADRs under `docs/` before large refactors.
- Follow the functional-core/imperative-shell pattern and return `Result` types instead of throwing.
- Add or update tests (`pnpm test`, `pnpm vitest run <path>`) for the code paths you touch.
- Run `pnpm build` and `pnpm lint` prior to opening a PR.
- Register new providers or adapters via the metadata decorators so discovery stays automatic.

## License

AGPL-3.0-only.
