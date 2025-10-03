# <img src="./docs/assets/images/exitbook-brand.png" alt="ExitBook" width="50" align="middle"/><span>&nbsp;&nbsp;</span>ExitBook

**Track, log, and analyze your crypto journey.**

ExitBook is a pnpm-managed TypeScript monorepo that provides a CLI for importing, normalizing, and verifying cryptocurrency activity. The tool ingests exchange CSV exports and blockchain explorer APIs, persists raw data in SQLite via Kysely, and materializes a universal transaction schema for downstream analysis.

[![Node.js](https://img.shields.io/badge/node-%3E%3D23-blue.svg)](https://nodejs.org)

## Overview

- Import raw exchange exports or blockchain explorer responses into `external_transaction_data`.
- Transform raw records into a normalized transaction model and store them in `transactions`.
- Verify calculated balances and export curated transaction sets.
- Share infrastructure across packages such as `@exitbook/import`, `@exitbook/data`, `@exitbook/balance`, and the CLI in `apps/cli`.

## Repository Layout

- `apps/cli` – Commander-based CLI entry point (`crypto-import`).
- `packages/import` – Importers, blockchain provider registry, processors, and ingestion services.
- `packages/data` – SQLite/Kysely storage layer, migrations, and repositories.
- `packages/balance` – Balance aggregation and verification services.
- `packages/core` – Shared domain primitives.
- `packages/shared/{logger,utils}` – Reusable logging, HTTP, config, and utility helpers.

## Requirements

- Node.js ≥ 23 (Node 24 is tested).
- pnpm ≥ 10 (workspace root declares `pnpm@10.6.2` via `packageManager`).
- SQLite (bundled through `better-sqlite3`).

## Installation

```bash
pnpm install
```

The CLI stores data under `./data`. Run `pnpm --filter exitbook-cli run setup` once if you want the folder created ahead of time.

## Quick Start

```bash
# Import Kraken CSV exports and immediately process them
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken --process

# Process additional raw data (e.g. after adding more CSVs)
pnpm dev -- process --exchange kraken

# Summarise calculated balances (no live balance lookups yet)
pnpm dev -- verify --exchange kraken --report

# Export processed transactions to CSV
pnpm dev -- export --exchange kraken --format csv --output ./reports/kraken.csv
```

`pnpm dev -- <command>` proxies to `tsx` for fast feedback. You can also call dedicated scripts such as `pnpm --filter exitbook-cli run import -- --exchange kraken ...` when you prefer a single command per sub-task.

## CLI Commands

### `import`

```
pnpm dev -- import --exchange <name> --csv-dir <path> [options]
pnpm dev -- import --blockchain <chain> --address <wallet> [--provider <id>] [options]
```

- Exchange sources (`kraken`, `kucoin`, `ledgerlive`) require `--csv-dir` pointing to one or more directories of CSV exports.
- Blockchain sources use explorer providers registered in `packages/import` and require a wallet `--address`. Set `--provider` to pin a specific explorer.
- Shared options include `--since`, `--until` (ISO date, timestamp, or `0`), `--clear-db`, and `--process` to immediately normalize the imported batch.

### `process`

```
pnpm dev -- process --exchange <name> [options]
pnpm dev -- process --blockchain <chain> [options]
```

Transforms pending raw data into universal transactions.

- Use `--session <id>` to target a specific import session.
- `--since` accepts an ISO date or timestamp to filter raw records by creation time.
- The `--all` flag is currently a no-op and reserved for future use.

### `verify`

```
pnpm dev -- verify --exchange <name> [--report]
pnpm dev -- verify --blockchain <chain> [--report]
```

Calculates balances from stored transactions and highlights discrepancies. At present the verifier does **not** fetch live balances; it reiterates calculated holdings and writes an optional report to `data/verification-report.md`.

### `export`

```
pnpm dev -- export [--exchange <name>] [--format csv|json] [--since <date>] [--output <path>]
```

Exports processed transactions to CSV (default) or JSON. The command reads from the `transactions` table; use `--exchange` to filter and `--since` to limit by creation date.

### `status`

```
pnpm dev -- status
```

Initial scaffolding for system health metrics. The command currently returns placeholder counts while the Kysely analytics queries are implemented.

### `benchmark-rate-limit`

```
pnpm dev -- benchmark-rate-limit --blockchain <chain> --provider <name> [--max-rate <req/sec>] [--rates <list>] [--num-requests <n>] [--skip-burst]
```

Exercises a blockchain provider to estimate safe sustained and burst rates. Results help you maintain overrides in `config/blockchain-explorers.json`.

### `list-blockchains`

```
pnpm dev -- list-blockchains
```

Lists blockchains that have a processor and at least one registered provider. Combine with `pnpm run blockchain-providers:list` for provider-level detail.

## Supported Sources

### Exchanges (CSV importers)

| Source       | Status | Notes                                                                                                             |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `kraken`     | ✅     | Parses ledger exports, validates rows with Zod, transforms via `KrakenProcessor`.                                 |
| `kucoin`     | ✅     | Handles trading/deposit/withdrawal/account-history CSV sets.                                                      |
| `ledgerlive` | ✅     | Imports Ledger Live operation exports and maps staking/governance flows.                                          |
| `coinbase`   | ⚠️     | Processor and API client exist, but the importer currently returns `CoinbaseImporter.import not yet implemented`. |

Each importer stores raw rows in `external_transaction_data` before processing, allowing retries without re-reading CSVs.

### Blockchains

- **Bitcoin** – Blockstream, Mempool.space, and Tatum providers (BlockCypher/Blockchain.com clients are present but disabled in the registry).
- **EVM chains** – Extensive coverage defined in `packages/import/src/infrastructure/blockchains/evm/evm-chains.json` (Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, zkSync, Linea, Scroll, Mantle, Blast, Theta, and more). Providers include Alchemy, Moralis, Snowtrace, Theta Explorer, and ThetaScan.
- **Solana** – Helius, Solana RPC, and Solscan clients with normalized token support.
- **Substrate ecosystem** – Chains from `substrate-chains.json` (Polkadot, Kusama, Bittensor, Moonbeam, Astar, Karura, etc.) using Subscan and Taostats providers.
- **Cosmos SDK** – Currently Injective via the Injective Explorer client (additional providers are scaffolded but not yet wired up).

Run `pnpm dev -- list-blockchains` to inspect the active list after any configuration overrides.

## Provider Infrastructure

`@exitbook/import` centralizes blockchain access through:

- **Provider Registry** (`packages/import/src/infrastructure/blockchains/shared/registry`) that auto-registers clients via decorators and exposes metadata such as required capabilities and API keys.
- **BlockchainProviderManager** with intelligent failover, per-provider circuit breakers, periodic health checks, and short-term request caching.
- Optional per-chain overrides via `config/blockchain-explorers.json` to adjust enabled providers, priorities, rate limits, retries, and timeouts.
- Benchmarks and validation scripts (`pnpm run providers:list`, `pnpm run providers:validate`, `pnpm run providers:sync`) to keep configuration aligned with registered providers.

## Configuration

### Explorer Overrides

Create `config/blockchain-explorers.json` when you need custom priorities or rate limits (or set `BLOCKCHAIN_EXPLORERS_CONFIG=<path>` to load from an alternate location):

```jsonc
{
  "bitcoin": {
    "defaultEnabled": ["blockstream.info", "mempool.space"],
    "overrides": {
      "tatum-bitcoin": {
        "enabled": false,
        "description": "Disable until API key is configured.",
      },
    },
  },
}
```

If the file is absent, the manager uses the defaults embedded in each provider's metadata.

### Environment Variables

Some providers require API keys. Set them in your shell or `.env`:

- `ALCHEMY_API_KEY`
- `MORALIS_API_KEY`
- `SNOWTRACE_API_KEY`
- `SOLANA_HELIUS_API_KEY`
- `SOLSCAN_API_KEY`
- `TATUM_API_KEY`
- `TAOSTATS_API_KEY`

Refer to individual provider classes for additional keys when enabling currently-disabled clients.

## Data & Storage

- SQLite database at `data/transactions.db` (auto-created). Schema defined in `packages/data/src/migrations/001_initial_schema.ts`.
  - `import_sessions` tracks every import run, associated provider, status, and metadata.
  - `external_transaction_data` stores raw payloads and processing status.
  - `transactions` keeps normalized universal transactions with detailed movement, fee, and blockchain metadata.
- Exports default to `data/transactions.csv` or `data/transactions.json` unless you supply `--output`.
- Verification reports are written to `data/verification-report.md`.

Use `--clear-db` on CLI commands when you need a clean slate; this drops and recreates tables via Kysely.

## Development & Testing

- `pnpm lint` – ESLint with perfectionist rules.
- `pnpm typecheck` – TypeScript project references.
- `pnpm test` – Vitest unit suite (see `**/__tests__` near their sources).
- `pnpm test:e2e` – End-to-end workflows.
- `pnpm workspace:build` – Run build commands across all packages (individual builds often rely on `tsc --noEmit`).

The CLI scripts rely on `tsx`; if your environment blocks IPC sockets (e.g. restricted sandbox), use the per-command scripts instead of the watch mode.

## Known Limitations

- Coinbase importer is stubbed and will exit with `CoinbaseImporter.import not yet implemented`.
- The `status` command prints placeholder values until Kysely metrics are implemented.
- `process --all` is reserved and currently ignored.
- Balance verification compares calculated balances only; live exchange or chain balances are not fetched yet.
- Cosmos support is limited to Injective until more providers are wired up.
