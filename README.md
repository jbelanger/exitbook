# ExitBook

> Open-source CLI for crypto transaction tracking, reconciliation, and tax reporting workflows.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Test Suite](https://github.com/jbelanger/exitbook/actions/workflows/test.yml/badge.svg)](https://github.com/jbelanger/exitbook/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/jbelanger/exitbook/branch/main/graph/badge.svg)](https://codecov.io/gh/jbelanger/exitbook)
[![CodeQL](https://github.com/jbelanger/exitbook/actions/workflows/codeql.yml/badge.svg)](https://github.com/jbelanger/exitbook/actions/workflows/codeql.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-blue.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.6.2-orange.svg)](https://pnpm.io)

Exitbook exists for people who want more confidence in their crypto tax reporting.

That usually means two things:

- you want to see where the numbers came from
- you want tools that help you verify the result instead of asking you to trust a black box

Exitbook is built around that idea. It imports transaction history from exchanges and blockchains, preserves the raw records, normalizes them into a common model, helps you review transfers between your own accounts, enriches pricing data, verifies balances, and calculates cost basis from an auditable data trail.

It is not tax advice. It is software for building a cleaner, more defensible record of what happened.

## Why Exitbook exists

Crypto tax tooling often has the same problems:

- the data pipeline is opaque
- missing data gets papered over with guesses
- reprocessing requires re-importing everything
- transfer matching is hidden from the user
- confidence depends on whether you trust the vendor, not whether you can inspect the workflow

Exitbook takes a different approach:

- raw imported data is kept so processing can be replayed without refetching from providers
- incomplete imports block downstream processing instead of silently producing partial reports
- transaction links are surfaced for review, confirmation, or rejection
- balance verification is a first-class workflow, not an afterthought
- the code is open, so the community can inspect how the accounting pipeline works

## What Exitbook does

Exitbook is a CLI-first workflow for crypto records and tax prep:

1. Import raw history from blockchain APIs, exchange APIs, or exchange CSV exports.
2. Normalize source-specific records into a shared transaction model.
3. Preserve raw data separately from derived accounting data.
4. Suggest links between related transactions, such as exchange withdrawals and wallet deposits.
5. Enrich prices using trade execution data, FX conversion, external market data, and confirmed links.
6. Verify balances against live sources or inspect calculated balances offline.
7. Calculate cost basis, realized gains/losses, and portfolio views from the processed dataset.

## What makes it trustworthy

- **Raw data is preserved.** Imported records are stored before processing so fixes to processing logic can be replayed with `pnpm run dev reprocess`.
- **Imports are resumable.** Streaming imports persist progress per batch, which matters for large wallets and unreliable APIs.
- **Provider failures are expected.** Blockchain imports can fail over between providers using persisted health and circuit-breaker state.
- **Validation is strict.** Processing uses runtime schemas and explicit `Result` types instead of silently swallowing errors.
- **Transfer review stays in the loop.** Links are suggested, scored, and then confirmed or rejected by the user.
- **Pricing prefers transaction context.** The enrichment pipeline uses exchange execution prices and derived swap ratios before falling back to external market data.
- **Verification is built in.** You can compare calculated balances against live balances to catch missing imports or bad assumptions early.

## Supported sources

Exitbook supports these source families today:

| Source type  | Supported today                                                    | Notes                                                                       |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Blockchains  | Bitcoin family, Cardano, Cosmos, EVM, NEAR, Solana, Substrate, XRP | Use `pnpm run dev blockchains view` for the current chain and provider list |
| Exchange API | Coinbase, Kraken, KuCoin                                           | Credentials can come from flags or `.env`                                   |
| Exchange CSV | KuCoin                                                             | Import from a directory of exported CSV files                               |

The CLI is the source of truth for current coverage:

```bash
pnpm run dev blockchains view
pnpm run dev blockchains view --json
pnpm run dev providers view
pnpm run dev providers view --json
```

### Current scope

Exitbook is strongest today on simple user-controlled wallets and mainstream exchange histories.

More complex cases can still require extra work or manual review, especially:

- smart contract wallets and multi-sig setups
- bridge-heavy or cross-chain workflows
- unusual exchange exports or chain-specific edge cases
- histories with missing counterpart accounts that prevent transfer linking

That is normal for crypto data. The goal is to make the gaps visible and reviewable, not to hide them.

## Typical workflow

For most portfolios, the workflow looks like this:

1. Import every exchange account and every wallet you care about.
2. Inspect accounts and import sessions.
3. Verify balances to find missing data early.
4. Run the linking algorithm and review suggested matches.
5. Enrich prices and fill any remaining gaps.
6. Run cost-basis calculations for your jurisdiction and tax year.
7. Export transactions or inspect the portfolio view.

## Getting started

### Requirements

- Node.js `>= 24`
- pnpm `>= 10.6.2`
- SQLite

### Install

```bash
pnpm install
pnpm build
pnpm test
```

### Configuration

`pnpm run dev ...` loads `.env` from the project root when present.

Put API keys there if you are using provider-backed imports or exchange API imports. Common examples include:

- `MORALIS_API_KEY`
- `HELIUS_API_KEY`
- `BLOCKFROST_API_KEY`
- exchange API credentials you want available during verification

### Data directory

By default, CLI data lives under `./data/` relative to the current working directory.

When running the CLI from this repo root, set `EXITBOOK_DATA_DIR=apps/cli/data` if you want to use the checked-in app dataset.

You can override that with `EXITBOOK_DATA_DIR`.

Exitbook keeps separate SQLite databases for different responsibilities:

- `transactions.db` for accounts, raw imports, processed transactions, movements, and links
- `prices.db` for cached price data
- `token-metadata.db` for token metadata and related cache data
- `providers.db` for provider health and circuit-breaker state

That separation lets you clear or reprocess transactional data without throwing away expensive caches.

## Quick start

### 1. Pick a profile

Exitbook scopes accounts, imports, links, balances, and reporting to one active profile.

```bash
# Use the built-in default profile, or create your own
pnpm run dev profiles add business
pnpm run dev profiles switch business
pnpm run dev profiles current
```

`business` is the stable profile key. If you want a friendlier label later, rename the display name without changing identity:

```bash
pnpm run dev profiles rename business "Business / Family"
```

You can override the active profile per command with `--profile <profile>`.

### 2. Add accounts, then import them

```bash
# Add an exchange CSV account
pnpm run dev accounts add kucoin-main --exchange kucoin --csv-dir ./exports/kucoin

# Add an exchange API account
pnpm run dev accounts add kraken-main --exchange kraken --api-key KEY --api-secret SECRET

# Add a blockchain account
pnpm run dev accounts add btc-cold --blockchain bitcoin --address bc1q...

# Sync one account
pnpm run dev import --account kucoin-main

# Or sync every top-level account in the active profile
pnpm run dev import --all
```

### 3. Inspect what was imported

```bash
pnpm run dev accounts view
pnpm run dev accounts view --show-sessions
pnpm run dev transactions view
```

### 4. Verify balances

```bash
# Inspect stored balances
pnpm run dev accounts
pnpm run dev accounts <selector>
pnpm run dev accounts view

# Refresh all balances and verify live sources where supported
pnpm run dev accounts refresh

# Refresh one balance scope
pnpm run dev accounts refresh <selector>
```

### 5. Review transfer links

```bash
# Suggest links between related transactions
pnpm run dev links run

# Review suggestions, confirmed links, rejected links, or coverage gaps
pnpm run dev links
pnpm run dev links --gaps
pnpm run dev links explore --status suggested
pnpm run dev links view <fingerprint>

# Confirm or reject a specific link
pnpm run dev links confirm <proposal-ref>
pnpm run dev links reject <proposal-ref>
```

### 6. Enrich prices

```bash
# Run the full enrichment pipeline
pnpm run dev prices enrich

# Manually set an asset price or FX rate when needed
pnpm run dev prices set --help
pnpm run dev prices set-fx --help

# Inspect price coverage
pnpm run dev prices view
```

### 7. Calculate cost basis and inspect portfolio state

```bash
# Example: Canada, average cost
pnpm run dev cost-basis --method average-cost --jurisdiction CA --tax-year 2024

# Example: US FIFO
pnpm run dev cost-basis --method fifo --jurisdiction US --tax-year 2024

# Point-in-time portfolio view
pnpm run dev portfolio --jurisdiction CA --fiat-currency CAD
```

### 8. Export data or replay processing

```bash
# Export processed transactions
pnpm run dev transactions export --format csv --output ./transactions.csv

# Rebuild all derived data from preserved raw imports
pnpm run dev reprocess

# Clear processed data while keeping raw imports by default
pnpm run dev clear
```

## Command map

These are the main CLI entrypoints:

- `profiles` - create, list, switch, and inspect profile scope
- `import` - sync raw data for existing saved accounts
- `accounts` - add, update, rename, remove, and inspect named accounts
- `transactions` - inspect or export processed transactions
- `links` - run transfer matching and review results
- `prices` - inspect coverage, enrich prices, or set missing prices manually
- `cost-basis` - calculate realized gains/losses for a jurisdiction and tax year
- `portfolio` - inspect current holdings, allocation, and unrealized P&L
- `assets` - exclude or re-include assets from accounting-scoped processing
- `blockchains` - browse supported blockchains and provider capabilities
- `providers` - inspect provider health and benchmark provider behavior
- `reprocess` - rebuild derived data from preserved raw imports
- `clear` - clear processed state without wiping everything

For the full command surface:

```bash
pnpm run dev --help
```

## How the pipeline works

At a high level:

1. **Import** streams source data in batches and stores raw records.
2. **Process** converts raw records into normalized transactions and movements.
3. **Link** connects related transactions across accounts and platforms.
4. **Price** fills movement pricing using trade context, FX, market data, and links.
5. **Report** calculates balances, portfolio views, and tax outputs from the resulting dataset.

Some important implementation details:

- imports are resumable and memory-bounded
- raw and derived data are separated so you can replay processing safely
- duplicates are handled idempotently at multiple layers
- provider failover and circuit breakers help on-chain imports survive flaky APIs
- missing or invalid data surfaces as an explicit problem instead of being hidden

## Architecture and deeper docs

If you want to understand the internals, start here:

- [Architecture overview](./docs/architecture/README.md)
- [Streaming import pipeline](./docs/architecture/import-pipeline.md)
- [Data integrity and processing](./docs/architecture/data-integrity.md)
- [Provider resilience](./docs/architecture/provider-resilience.md)
- [Price enrichment pipeline](./docs/architecture/price-enrichment.md)

Developer-oriented project guidance lives in:

- [Architecture notes for code assistants](./docs/code-assistants/architecture.md)
- [CLI wiring guide](./docs/code-assistants/cli-command-wiring.md)
- [Desloppify repo guide](./docs/code-assistants/desloppify.md)
- [Result type guide](./docs/code-assistants/result-type.md)

## Contributing

Issues and pull requests are welcome.

Useful local commands:

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm prettier:fix
```

If you are working on provider coverage or import behavior, these are also useful:

```bash
pnpm blockchain-providers:list
pnpm blockchain-providers:validate
pnpm providers:sync
```

## License

AGPL-3.0-or-later.
