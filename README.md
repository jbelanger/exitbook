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

**What it does**

- Boots the SQLite database at `data/transactions.db` (dropping and recreating tables when `--clear-db` is used).
- Creates an `import_sessions` row that captures the source, provider, and raw parameters.
- Invokes the selected importer to pull data (reading CSV rows or calling blockchain providers) and writes each payload into `external_transaction_data`.
- Prints the number of raw records saved plus the session ID. When `--process` is supplied, the command immediately normalizes the new raw data into the universal schema and persists it to `transactions`.

**Options**

- `--exchange <name>` – Required for CSV imports. Current adapters: `kraken`, `kucoin`, `ledgerlive` (case-insensitive).
- `--blockchain <name>` – Required for on-chain imports. Use `pnpm dev -- list-blockchains` to see supported IDs.
- `--csv-dir <path>` – Directory that contains official export CSVs for the chosen exchange (required when `--exchange` is set).
- `--address <wallet>` – Wallet or account address to hydrate (required for `--blockchain`).
- `--provider <id>` – Optional provider slug (for example `alchemy`, `blockstream.info`, `solscan`). Without it, the provider manager auto-enables all registered providers for the chain, applying any overrides in `config/blockchain-explorers.json`.
- `--since <date>` / `--until <date>` – Optional time window. Accepts ISO strings (e.g. `2024-01-01`), Unix timestamps (`1704067200`), or `0` for full history. These filters are honoured by blockchain importers; CSV importers rely on the contents of the exported files.
- `--process` – Run the `process` step immediately for the newly-created session.
- `--clear-db` – Drop and recreate schema before running (destructive; use only on fresh environments).

#### Exchange CSV workflow

1. Download the vendor exports you need into a working directory (unzipped CSV files).
   - Kraken: place the `ledgers.csv` export inside the target folder.
   - KuCoin: include the `Account History`, `Trading`, `Deposits`, and `Withdrawals` CSVs (naming from the official export wizard is fine).
   - Ledger Live: drop the `operations.csv` file exported from the desktop app.
2. Run the import command:

```bash
# Kraken example
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken-2024 --process

# KuCoin example – import now, process later
pnpm dev -- import --exchange kucoin --csv-dir ./exports/kucoin
pnpm dev -- process --exchange kucoin --session <session-id>

# Ledger Live example
pnpm dev -- import --exchange ledgerlive --csv-dir ./exports/ledger
```

Each run stores the raw rows inside `external_transaction_data` tagged with the provider (`kraken`, `kucoin`, etc.) so you can reprocess without re-reading the CSVs.

#### Blockchain workflow

1. Ensure any required API keys are exported (e.g. `ALCHEMY_API_KEY`, `SOLANA_HELIUS_API_KEY`).
2. Optionally prepare `config/blockchain-explorers.json` to pin providers or rate limits.
3. Execute the import with your wallet address. Examples:

```bash
# Bitcoin wallet using auto-selected providers
pnpm dev -- import --blockchain bitcoin --address bc1qexample... --since 2023-01-01 --process

# Ethereum wallet using Alchemy only and a custom config file
BLOCKCHAIN_EXPLORERS_CONFIG=./config/blockchain-explorers.json \
pnpm dev -- import --blockchain ethereum \
  --address 0x742d35Cc6634C0532925a3b844Bc454e4438f44e \
  --provider alchemy \
  --since 2023-01-01T00:00:00Z \
  --until 2024-01-01T00:00:00Z \
  --process
```

The provider manager will rotate across all enabled providers for the chain, applying circuit breakers and caching while fetching raw data. Results are stored in `external_transaction_data` with `processing_status = 'pending'` until you run `process`.

#### Processing immediately vs later

- Add `--process` to the import command when you want a single-step import + normalize workflow. The CLI will log any normalization issues and exit non-zero if the processing stage fails.
- If you omit `--process`, note the `Session ID` printed at the end and run:

  ```bash
  pnpm dev -- process --exchange <name> --session <session-id>
  # or for blockchains
  pnpm dev -- process --blockchain <chain> --session <session-id>
  ```

- You can rerun `process` safely; processed transactions are upserted by `external_id`.

#### Outputs and troubleshooting

- Successful runs emit:
  - `Import completed: <count> items imported`
  - `Session ID: <id>`
- Raw data lives in `external_transaction_data`, normalized transactions in `transactions`, and both rows reference the same `import_session_id`.
- The CLI logs to stdout using Pino. When something fails, rerun with `DEBUG=*` or inspect the offending session in the database to diagnose retries.

### `process`

```
pnpm dev -- process --exchange <name> [options]
pnpm dev -- process --blockchain <chain> [options]
```

**What it does**

- Loads all raw entries in `external_transaction_data` that belong to the source and are still marked `processing_status = 'pending'`.
- Groups raw data by `import_session_id`, hydrates session metadata, and runs the appropriate processor (`KrakenProcessor`, `BitcoinTransactionProcessor`, etc.).
- For blockchain sources, reuses the normalizer to convert provider payloads into a common structure before processing.
- Inserts or upserts each resulting universal transaction into `transactions` (keyed by `external_id`) and marks the raw records as processed.
- Aborts with a non-zero exit if any normalization or persistence errors occur to avoid partial state.

**Options**

- `--exchange <name>` / `--blockchain <chain>` – Required selector matching whichever importer produced the raw data.
- `--session <id>` – Restrict processing to a single import session. Helpful for retrying a past run without touching newer data.
- `--since <date>` – Only pick raw records created at or after the supplied date/timestamp. This is useful when batching multiple imports (the value is converted to Unix seconds internally).
- `--all` – Reserved for future use; currently ignored.
- `--clear-db` – Drops and recreates the schema before running. Use only when starting from scratch because it deletes all data.

**Typical workflows**

```bash
# Process everything imported for Kraken that is still pending
pnpm dev -- process --exchange kraken

# Re-run processing for a specific KuCoin session (after fixing a CSV issue)
pnpm dev -- process --exchange kucoin --session 42

# Process blockchain data imported since a particular upload
pnpm dev -- process --blockchain ethereum --since 2024-06-01T00:00:00Z
```

The command is idempotent: if a transaction already exists, the repository updates the existing row with the latest normalized data. Sessions and raw items keep the association so you can reconcile individual runs.

**When things fail**

- Normalization errors (e.g. unsupported blockchain payloads) cause an early exit with the error message highlighted in the logs.
- Failed database writes list the offending transaction IDs. Fix the underlying issue, then rerun `process` for the same session.
- Because raw rows remain in `pending` state until the command succeeds, rerunning always picks up the unfinished work.

### `verify`

```
pnpm dev -- verify --exchange <name> [--report]
pnpm dev -- verify --blockchain <chain> [--report]
```

**What it does**

- Loads the normalized transactions for the specified source from `transactions`.
- Runs the balance calculation service to aggregate inflows/outflows by currency.
- Compares the calculated totals against a stubbed “live balance” (currently zero) and reports the differences. Because no external balance fetchers are wired up yet, every currency appears as a warning with the calculated amount shown.
- Optionally writes a Markdown report to `data/verification-report.md` detailing the breakdown.

**Options**

- `--exchange <name>` / `--blockchain <chain>` – Required selector for the source you want to audit.
- `--report` – Emit a Markdown report (overwrites the previous file).
- `--clear-db` – Drops and recreates the database before verification (destructive; usually unnecessary).

**Usage examples**

```bash
# Show calculated holdings for Kraken after processing
pnpm dev -- verify --exchange kraken

# Generate a Markdown snapshot for a Bitcoin wallet
pnpm dev -- verify --blockchain bitcoin --report

# Verify multiple sources sequentially
pnpm dev -- verify --exchange kucoin
pnpm dev -- verify --blockchain ethereum --report
```

The command is best used after you finish importing and processing data. It provides a quick view of per-currency balances and surfaces discrepancies once live balance lookups are implemented in the future.

**Output and troubleshooting**

- CLI output lists each source with counts of currencies plus top differences. Because live balances are currently stubbed to 0, treat the calculated column as authoritative.
- `verification-report.md` contains a timestamped summary that you can archive alongside accounting notes.
- If the command errors, ensure the database contains processed transactions for the requested source and rerun.

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

| Source       | Status | Notes                                                                             |
| ------------ | ------ | --------------------------------------------------------------------------------- |
| `kraken`     | ✅     | Parses ledger exports, validates rows with Zod, transforms via `KrakenProcessor`. |
| `kucoin`     | ✅     | Handles trading/deposit/withdrawal/account-history CSV sets.                      |
| `ledgerlive` | ✅     | Imports Ledger Live operation exports and maps staking/governance flows.          |

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
