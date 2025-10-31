# <img src="./docs/assets/images/exitbook-brand.png" alt="ExitBook" width="50" align="middle"/><span>&nbsp;&nbsp;</span>ExitBook

**Complete cryptocurrency accounting pipeline from imports to tax-ready reports.**

ExitBook is a comprehensive CLI tool that transforms your cryptocurrency trading history into tax-compliant accounting records. It handles the complete journey from raw exchange CSVs and blockchain transactions to fully-linked, priced, and cost-basis-calculated records ready for tax filing.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D23-blue.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.6.2-orange.svg)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Test Suite](https://github.com/jbelanger/exitbook/actions/workflows/test.yml/badge.svg)](https://github.com/jbelanger/exitbook/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/jbelanger/exitbook/branch/main/graph/badge.svg)](https://codecov.io/gh/jbelanger/exitbook)

## Why ExitBook?

Cryptocurrency accounting is complex because:

- **Fragmented Data**: Every exchange and blockchain formats data differently
- **Missing Context**: Exchange withdrawals and blockchain deposits aren't automatically linked
- **Manual Pricing**: Historical prices need to be fetched for every transaction
- **Complex Calculations**: Tax-compliant cost basis requires FIFO/LIFO tracking across all accounts

ExitBook automates the entire workflow:

1. **Import** → Pull data from exchanges and blockchains
2. **Process** → Normalize into a universal format
3. **Link** → Connect withdrawals to deposits across platforms
4. **Derive** → Deduce prices from your transaction history (fiat/stable trades)
5. **Fetch** → Fill remaining prices from external providers
6. **Calculate** → Compute tax-compliant cost basis
7. **Export** → Generate reports ready for your accountant

The result: a single source of truth with full transaction history, linked transfers, accurate pricing, and tax-ready calculations.

## The Complete Pipeline

ExitBook processes your cryptocurrency transactions through seven essential steps:

### 1. Import Raw Data

**What it does**: Downloads your complete transaction history from exchanges (CSV files) and blockchains (via APIs).

**Why it matters**: This is your source data—everything you've done across all platforms. Without a complete import, your accounting will be incomplete.

**How to run**:

```bash
# Import from Kraken CSV export
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken

# Import from your Bitcoin wallet
pnpm dev -- import --blockchain bitcoin --address bc1q...

# Import from Ethereum wallet using Alchemy
pnpm dev -- import --blockchain ethereum --address 0x... --provider alchemy
```

**What happens**: Raw data is stored in the `external_transaction_data` table, tagged with the source and marked as `pending` for processing.

---

### 2. Process Into Universal Format

**What it does**: Transforms the raw data from each source into a standardized `UniversalTransaction` schema with consistent fields.

**Why it matters**: Different exchanges format data differently (Kraken's ledgers vs KuCoin's separate CSVs). Processing normalizes everything into one common format so the rest of the pipeline can work uniformly.

**How to run**:

```bash
# Process all pending imports
pnpm dev -- process --exchange kraken
pnpm dev -- process --blockchain bitcoin

# Or process immediately during import
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken --process
```

**What happens**: Each raw record is transformed into a `UniversalTransaction` with standardized fields:

- `transaction_datetime`: ISO 8601 timestamp
- `movements_primary_asset`: Currency code (BTC, ETH, USDT, etc.)
- `movements_primary_amount`: Decimal amount
- `movements_primary_direction`: `in` or `out`
- Transaction type (trade, deposit, withdrawal, fee, etc.)

---

### 3. Link Related Transactions

**What it does**: Automatically matches withdrawals from exchanges to deposits in your blockchain wallets (and vice versa).

**Why it matters**: When you withdraw 1 BTC from Kraken to your hardware wallet, that's recorded as a withdrawal on Kraken and a deposit on the blockchain. Without linking these, they appear as two separate events—a sell and a buy. Linking them correctly identifies it as a **transfer** (not a taxable event).

**How to run**:

```bash
# Link all transactions across sources
pnpm dev -- link
```

**What happens**: The linking algorithm:

1. Identifies all withdrawals (outflows) and deposits (inflows)
2. Matches them based on:
   - **Amount similarity** (accounts for network fees)
   - **Time proximity** (typical blockchain confirmation times)
   - **Asset match** (same cryptocurrency)
   - **Address match** (when available)
3. Calculates a confidence score (0-1)
4. Auto-confirms high-confidence matches (≥95%)
5. Suggests lower-confidence matches for manual review

**Example match**:

- Kraken withdrawal: 1.0 BTC at 2024-01-15 10:00:00
- Blockchain deposit: 0.9998 BTC at 2024-01-15 10:15:32 (2 minutes later, minus network fee)
- **Confidence**: 98% → Auto-confirmed

---

### 4. Calculate Historical Prices

**What it does**: Fills the `priceAtTxTime` field for every transaction by fetching historical prices from multiple providers.

**Why it matters**: For tax purposes, you need to know the fair market value (in your reporting currency) of every crypto movement. A trade of 0.5 ETH for $1,200 USDT needs the USD value at the exact time of the transaction.

**How to run**:

```bash
# Calculate prices for all transactions (uses local database first)
pnpm dev -- price --currency USD

# Recalculate missing prices only
pnpm dev -- price --currency USD --missing-only
```

**What happens**:

1. Checks local price cache first (in `data/prices.db`)
2. If cached price exists, uses it immediately
3. If not cached, fetches from price providers in order:
   - CoinGecko (10-50 calls/minute, daily granularity)
   - CryptoCompare (~100k calls/month, minute/hour/day)
   - Binance (~6000 calls/hour, minute-level for ~1 year)
4. Caches result locally for future use
5. Updates transaction record with `price` and `price_currency` fields

**Example**:

- Transaction: Received 0.5 ETH at 2024-03-15 14:23:00 UTC
- Fetches: ETH/USD price at that timestamp
- Result: $3,456.78
- Updates: `price = 3456.78`, `price_currency = USD`

---

### 5. Fetch Remaining Prices

**What it does**: Identifies any transactions still missing prices and batch-fetches them using the multi-provider price system.

**Why it matters**: Some assets might not be found in the first provider, or rate limits might be hit. This step ensures 100% price coverage by trying fallback providers.

**How to run**:

```bash
# List transactions with missing prices
pnpm dev -- price --check-missing

# Fetch remaining prices with provider fallback
pnpm dev -- price --currency USD --fetch-missing --provider coingecko
pnpm dev -- price --currency USD --fetch-missing --provider cryptocompare
```

**What happens**:

1. Queries all transactions where `price IS NULL`
2. Groups by asset and timestamp for batch efficiency
3. Uses `PriceProviderManager` with automatic failover:
   - Tries primary provider
   - If it fails (rate limit, asset not found), tries next provider
   - Circuit breaker prevents hammering failing providers
4. Updates all successfully priced transactions

**Provider Capabilities**:
| Provider | Free Tier | Granularity | Coverage |
|----------|-----------|-------------|----------|
| CoinGecko | 10-50/min | Daily | Excellent |
| CryptoCompare | ~100k/month | Minute/Hour/Day | Very Good |
| Binance | ~6000/hour | Minute (1yr) / Daily | Major assets |

---

### 6. Calculate Cost Basis

**What it does**: Computes tax-compliant cost basis and capital gains/losses using your chosen accounting method (FIFO, LIFO, etc.).

**Why it matters**: Tax authorities require you to calculate the cost basis of every crypto sale or disposal. This determines your capital gains and tax liability. The calculation must follow approved methods (FIFO in most jurisdictions).

**How to run**:

```bash
# Calculate using FIFO for US taxes
pnpm dev -- cost-basis --method fifo --jurisdiction US --tax-year 2024 --currency USD

# Calculate using LIFO
pnpm dev -- cost-basis --method lifo --jurisdiction CA --tax-year 2024 --currency CAD

# Generate detailed report
pnpm dev -- cost-basis --method fifo --jurisdiction US --tax-year 2024 --report
```

**What happens**:

1. **Phase 0 - Linking**: Ensures transfers are linked (runs linking again if needed)
2. **Phase 1 - Acquisition Tracking**: Builds inventory of all acquisitions (buys, deposits, income) with cost basis
3. **Phase 2 - Disposal Processing**: For each disposal (sell, withdrawal, spend):
   - Matches against inventory using specified method (FIFO/LIFO)
   - Calculates gain/loss: `proceeds - cost_basis`
   - Determines holding period: `disposal_date - acquisition_date`
   - Classifies as short-term (<1 year) or long-term (≥1 year)
4. **Phase 3 - Report Generation**: Creates jurisdiction-specific tax forms

**Example (FIFO)**:

1. Buy 1 BTC @ $30,000 on Jan 1, 2024
2. Buy 1 BTC @ $40,000 on Feb 1, 2024
3. Sell 1 BTC @ $50,000 on Mar 1, 2024
   - Uses oldest lot (FIFO): Jan 1 purchase
   - Cost basis: $30,000
   - Proceeds: $50,000
   - **Capital gain: $20,000**
   - Holding period: 60 days (short-term)

**Methods Available**:

- **FIFO** (First In, First Out): Most common, required in many jurisdictions
- **LIFO** (Last In, First Out): Allowed in some jurisdictions
- **Specific ID**: Choose exact lots (for tax optimization)
- **Average Cost**: Averages all acquisition costs

---

## Quick Start

Get up and running in 10 minutes:

```bash
# 1. Install dependencies
pnpm install

# 2. Import your data
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken --process
pnpm dev -- import --blockchain bitcoin --address bc1q... --process

# 3. Link transfers
pnpm dev -- link

# 4. Derive prices from transaction history
pnpm dev -- prices derive

# 5. Fetch remaining prices from external providers
pnpm dev -- prices fetch

# 6. Calculate cost basis
pnpm dev -- cost-basis --method fifo --jurisdiction US --tax-year 2024

# 7. Export final results
pnpm dev -- export --format csv --output ./reports/tax-report-2024.csv
```

You now have a complete, tax-ready accounting record!

## Installation & Setup

### Requirements

- Node.js ≥ 23
- pnpm ≥ 10.6.2
- SQLite (bundled via better-sqlite3)

### Install

```bash
# Clone the repository
git clone https://github.com/jbelanger/exitbook.git
cd exitbook

# Install dependencies
pnpm install
```

### Configure API Keys (Optional)

Some blockchain providers and price providers require API keys. Create a `.env` file in the project root:

```bash
# Blockchain providers
ALCHEMY_API_KEY=your_key_here
HELIUS_API_KEY=your_key_here
MORALIS_API_KEY=your_key_here

# Price providers (optional, free tiers available)
COINGECKO_API_KEY=your_key_here
CRYPTOCOMPARE_API_KEY=your_key_here
```

The system works without API keys using free-tier providers, but keys unlock higher rate limits and better coverage.

---

## CLI Commands Reference

All commands use `pnpm dev -- <command>` for development. In production, you can use the compiled CLI directly.

### `import`

````
### `import` - Import Raw Transaction Data

Import transactions from exchanges (CSV) or blockchains (API).

```bash
# Exchange CSV import
pnpm dev -- import --exchange <name> --csv-dir <path> [--process]

# Blockchain import
pnpm dev -- import --blockchain <chain> --address <wallet> [--provider <name>] [--process]
````

**Options:**

- `--exchange <name>` - Exchange name: `kraken`, `kucoin`
- `--blockchain <name>` - Blockchain name: `bitcoin`, `ethereum`, `solana`, etc.
- `--csv-dir <path>` - Directory containing CSV exports (for exchanges)
- `--address <wallet>` - Wallet address (for blockchains)
- `--provider <name>` - Specific provider to use (optional, auto-selects if omitted)
- `--process` - Process immediately after import
- `--clear-db` - Drop and recreate database (⚠️ destructive)

**Examples:**

```bash
# Import and process Kraken in one step
pnpm dev -- import --exchange kraken --csv-dir ./exports/kraken --process

# Import Bitcoin wallet
pnpm dev -- import --blockchain bitcoin --address bc1q... --process

# Import Ethereum using specific provider
pnpm dev -- import --blockchain ethereum --address 0x... --provider alchemy --process
```

---

### `process` - Convert to Universal Format

Process raw data into standardized transactions.

```bash
pnpm dev -- process --exchange <name> [--session <id>]
pnpm dev -- process --blockchain <chain> [--session <id>]
```

**Options:**

- `--exchange <name>` - Exchange to process
- `--blockchain <chain>` - Blockchain to process
- `--session <id>` - Process specific data source only

**Examples:**

```bash
# Process all pending Kraken data
pnpm dev -- process --exchange kraken

# Reprocess specific session
pnpm dev -- process --exchange kucoin --session abc-123-def

# Process all pending blockchain data
pnpm dev -- process --blockchain ethereum
```

---

### `link` - Link Related Transactions

Automatically match withdrawals to deposits across all sources.

```bash
pnpm dev -- link [--dry-run] [--min-confidence <score>]
```

**Options:**

- `--dry-run` - Show matches without saving (default: false)
- `--min-confidence <score>` - Minimum confidence threshold (0-1, default: 0.7)
- `--auto-confirm-threshold <score>` - Auto-confirm above this score (default: 0.95)

**Examples:**

```bash
# Run linking with defaults
pnpm dev -- link

# Preview matches without saving
pnpm dev -- link --dry-run

# Use stricter matching (only 80%+ confidence)
pnpm dev -- link --min-confidence 0.8
```

**Output:**

```
Transaction linking completed:
  ✓ 42 confirmed links (≥95% confidence)
  ⚠ 5 suggested links (70-95% confidence)
  ℹ 128 sources analyzed
  ℹ 131 targets analyzed
  ℹ 8 unmatched sources
  ℹ 11 unmatched targets
```

---

### `price` - Calculate Historical Prices

Fill missing prices for all transactions.

```bash
pnpm dev -- price --currency <code> [--missing-only] [--provider <name>]
```

**Options:**

- `--currency <code>` - Target currency: `USD`, `EUR`, `CAD`, etc.
- `--missing-only` - Only fetch prices for transactions missing them
- `--provider <name>` - Use specific provider: `coingecko`, `cryptocompare`, `binance`
- `--check-missing` - List transactions with missing prices without fetching
- `--fetch-missing` - Fetch prices for all transactions missing them

**Examples:**

```bash
# Calculate all prices in USD
pnpm dev -- price --currency USD

# Fill only missing prices
pnpm dev -- price --currency USD --missing-only

# Use specific provider
pnpm dev -- price --currency USD --provider cryptocompare --missing-only

# Check what's missing without fetching
pnpm dev -- price --currency USD --check-missing
```

---

### `cost-basis` - Calculate Capital Gains

Calculate tax-compliant cost basis and capital gains.

```bash
pnpm dev -- cost-basis --method <method> --jurisdiction <code> --tax-year <year> --currency <code> [--report]
```

**Options:**

- `--method <method>` - Accounting method: `fifo`, `lifo`, `specific-id`, `average-cost`
- `--jurisdiction <code>` - Tax jurisdiction: `US`, `CA`, `UK`, `EU`
- `--tax-year <year>` - Tax year for calculation
- `--currency <code>` - Reporting currency
- `--report` - Generate detailed report
- `--start-date <date>` - Override tax year start (optional)
- `--end-date <date>` - Override tax year end (optional)

**Examples:**

```bash
# US taxes with FIFO
pnpm dev -- cost-basis --method fifo --jurisdiction US --tax-year 2024 --currency USD

# Canadian taxes with average cost
pnpm dev -- cost-basis --method average-cost --jurisdiction CA --tax-year 2024 --currency CAD --report

# Custom date range
pnpm dev -- cost-basis --method fifo --jurisdiction US --tax-year 2024 --currency USD \
  --start-date 2024-01-01 --end-date 2024-12-31
```

**Output:**

```
Cost Basis Calculation Summary:
  Method: FIFO
  Jurisdiction: US
  Tax Year: 2024

  Disposals: 127
  Total Proceeds: $458,234.56
  Total Cost Basis: $312,445.12
  Net Capital Gain: $145,789.44

  Short-term Gains: $34,567.89 (23 disposals)
  Long-term Gains: $111,221.55 (104 disposals)

  Report saved to: ./reports/cost-basis-2024.pdf
```

---

### `export` - Export Final Results

Export processed transactions to CSV or JSON.

```bash
pnpm dev -- export [--exchange <name>] [--blockchain <chain>] [--format <format>] [--output <path>]
```

**Options:**

- `--exchange <name>` - Filter by exchange
- `--blockchain <chain>` - Filter by blockchain
- `--format <format>` - Output format: `csv` (default) or `json`
- `--output <path>` - Output file path
- `--since <date>` - Only transactions after this date

**Examples:**

```bash
# Export everything to CSV
pnpm dev -- export --format csv --output ./reports/all-transactions.csv

# Export only Kraken transactions
pnpm dev -- export --exchange kraken --output ./reports/kraken.csv

# Export blockchain transactions as JSON
pnpm dev -- export --blockchain ethereum --format json --output ./reports/eth.json

# Export 2024 transactions only
pnpm dev -- export --since 2024-01-01 --output ./reports/2024.csv
```

---

### `verify` - Verify Balances

Calculate balances and compare against expected values.

```bash
pnpm dev -- verify --exchange <name> [--report]
pnpm dev -- verify --blockchain <chain> [--report]
```

**Options:**

- `--exchange <name>` - Exchange to verify
- `--blockchain <chain>` - Blockchain to verify
- `--report` - Generate detailed report

**Examples:**

```bash
# Verify Kraken balances
pnpm dev -- verify --exchange kraken

# Verify and generate report
pnpm dev -- verify --blockchain bitcoin --report
```

---

### Other Commands

**`list-blockchains`** - List all supported blockchains

```bash
pnpm dev -- list-blockchains
```

**`status`** - Show system status and statistics

```bash
pnpm dev -- status
```

````

**What it does**

- Boots the database at `data/transactions.db` (dropping and recreating tables when `--clear-db` is used).
- Creates an `data_sources` row that captures the source, provider, and raw parameters.
- Invokes the selected importer to pull data (reading CSV rows or calling blockchain providers) and writes each payload into `external_transaction_data`.
- Prints the number of raw records saved plus the session ID. When `--process` is supplied, the command immediately normalizes the new raw data into the universal schema and persists it to `transactions`.

**Options**

- `--exchange <name>` – Required for CSV imports. Current adapters: `kraken`, `kucoin` (case-insensitive).
- `--blockchain <name>` – Required for on-chain imports. Use `pnpm dev -- list-blockchains` to see supported IDs.
- `--csv-dir <path>` – Directory that contains official export CSVs for the chosen exchange (required when `--exchange` is set).
- `--address <wallet>` – Wallet or account address to hydrate (required for `--blockchain`).
- `--provider <id>` – Optional provider slug (for example `alchemy`, `blockstream.info`, `solscan`). Without it, the provider manager auto-enables all registered providers for the chain, applying any overrides in `config/blockchain-explorers.json`.
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

````

Each run stores the raw rows inside `external_transaction_data` tagged with the provider (`kraken`, `kucoin`, etc.) so you can reprocess without re-reading the CSVs.

#### Blockchain workflow

1. Ensure any required API keys are exported (e.g. `ALCHEMY_API_KEY`, `HELIUS_API_KEY`).
2. Optionally prepare `config/blockchain-explorers.json` to pin providers or rate limits.
3. Execute the import with your wallet address. Examples:

```bash
# Bitcoin wallet using auto-selected providers
pnpm dev -- import --blockchain bitcoin --address bc1qexample... --process

# Ethereum wallet using Alchemy only and a custom config file
BLOCKCHAIN_EXPLORERS_CONFIG=./config/blockchain-explorers.json \
pnpm dev -- import --blockchain ethereum \
  --address 0x742d35Cc6634C0532925a3b844Bc454e4438f44e \
  --provider alchemy \
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
- Raw data lives in `external_transaction_data`, normalized transactions in `transactions`, and both rows reference the same `data_source_id`.
- The CLI logs to stdout using Pino. When something fails, rerun with `DEBUG=*` or inspect the offending session in the database to diagnose retries.

### `process`

```
pnpm dev -- process --exchange <name> [options]
pnpm dev -- process --blockchain <chain> [options]
```

**What it does**

- Loads all raw entries in `external_transaction_data` that belong to the source and are still marked `processing_status = 'pending'`.
- Groups raw data by `data_source_id`, hydrates session metadata, and runs the appropriate processor (`KrakenProcessor`, `BitcoinTransactionProcessor`, etc.).
- For blockchain sources, reuses the normalizer to convert provider payloads into a common structure before processing.
- Inserts or upserts each resulting universal transaction into `transactions` (keyed by `external_id`) and marks the raw records as processed.
- Aborts with a non-zero exit if any normalization or persistence errors occur to avoid partial state.

**Options**

- `--exchange <name>` / `--blockchain <chain>` – Required selector matching whichever importer produced the raw data.
- `--session <id>` – Restrict processing to a single data source . Helpful for retrying a past run without touching newer data.
- `--all` – Reserved for future use; currently ignored.
- `--clear-db` – Drops and recreates the schema before running. Use only when starting from scratch because it deletes all data.

**Typical workflows**

```bash
# Process everything imported for Kraken that is still pending
pnpm dev -- process --exchange kraken

# Re-run processing for a specific KuCoin session (after fixing a CSV issue)
pnpm dev -- process --exchange kucoin --session 42

# Process all pending blockchain data
pnpm dev -- process --blockchain ethereum
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

### Exchanges

| Exchange    | Status | Import Method | Notes                                                             |
| ----------- | ------ | ------------- | ----------------------------------------------------------------- |
| Kraken      | ✅     | CSV           | Export `ledgers.csv` from account history                         |
| KuCoin      | ✅     | CSV           | Export all CSVs (trading, deposits, withdrawals, account history) |
| Ledger Live | ✅     | CSV           | Export `operations.csv` from desktop app                          |
| Coinbase    | 🚧     | Coming soon   | API integration planned                                           |

### Blockchains

ExitBook supports 50+ blockchains through a multi-provider system with automatic failover:

**Bitcoin & Forks**

- Bitcoin, Bitcoin Cash, Litecoin, Dogecoin
- Providers: Blockstream, Mempool.space, Tatum

**EVM Chains** (Ethereum Virtual Machine)

- Ethereum, Polygon, Base, Arbitrum, Optimism
- Avalanche, BNB Chain, zkSync, Linea, Scroll
- Mantle, Blast, Theta, and more
- Providers: Alchemy, Moralis, chain-specific explorers

**Solana**

- Providers: Helius, Solana RPC, Solscan

**Substrate Ecosystem**

- Polkadot, Kusama, Bittensor, Moonbeam, Astar
- Providers: Subscan, Taostats

**Cosmos SDK**

- Injective (more chains coming)
- Provider: Injective Explorer

Run `pnpm dev -- list-blockchains` to see the complete list.

---

## Advanced Configuration

### Blockchain Provider Overrides

ExitBook uses multiple blockchain data providers with automatic failover. Customize provider preferences in `apps/cli/config/blockchain-explorers.json`:

```json
{
  "bitcoin": {
    "defaultEnabled": ["blockstream.info", "mempool.space"],
    "overrides": {
      "tatum-bitcoin": {
        "enabled": false,
        "description": "Disabled until API key configured"
      }
    }
  },
  "ethereum": {
    "defaultEnabled": ["alchemy", "moralis"],
    "overrides": {
      "alchemy": {
        "priority": 1,
        "rateLimit": {
          "requestsPerSecond": 25
        }
      }
    }
  }
}
```

If this file doesn't exist, the system uses default provider settings.

### Price Provider Configuration

Price providers are tried in order until one succeeds:

1. **CoinGecko** (default first)
   - Free tier: 10-50 calls/minute
   - Coverage: Excellent (13,000+ coins)
   - Granularity: Daily prices only

2. **CryptoCompare**
   - Free tier: ~100,000 calls/month
   - Coverage: Very good (6,000+ coins)
   - Granularity: Minute, hour, or daily

3. **Binance**
   - Free tier: ~6,000 calls/hour
   - Coverage: Major cryptocurrencies only
   - Granularity: Minute-level for ~1 year, daily for older

The system automatically falls back if a provider fails (rate limit, asset not found, etc.).

### Tax Year Configuration by Jurisdiction

Different jurisdictions have different tax years:

| Jurisdiction | Tax Year          | Start Date | End Date |
| ------------ | ----------------- | ---------- | -------- |
| US           | Calendar year     | Jan 1      | Dec 31   |
| CA (Canada)  | Calendar year     | Jan 1      | Dec 31   |
| UK           | Fiscal year       | Apr 6      | Apr 5    |
| EU           | Varies by country | Varies     | Varies   |

The CLI automatically uses the correct dates for your jurisdiction. Override with `--start-date` and `--end-date` if needed.

---

## Understanding the Data

### Database Tables

ExitBook uses SQLite with three main tables:

**`data_sources`**

- Tracks each import run
- Fields: `id`, `source_type`, `source_id`, `status`, `metadata`
- One session per import command

**`external_transaction_data`**

- Stores raw data from sources
- Fields: `id`, `session_id`, `raw_data`, `processing_status`
- Status: `pending` → `processed`

**`transactions`**

- Universal transaction format
- Key fields:
  - `transaction_datetime`: ISO 8601 timestamp
  - `source_type`: `exchange` or `blockchain`
  - `source_id`: `kraken`, `bitcoin`, etc.
  - `movements_primary_asset`: Currency (BTC, ETH, etc.)
  - `movements_primary_amount`: Decimal amount
  - `movements_primary_direction`: `in` or `out`
  - `price`: USD/fiat value at tx time
  - `price_currency`: Usually `USD`

**`transaction_links`**

- Links related transactions
- Fields: `source_transaction_id`, `target_transaction_id`, `confidence_score`, `status`
- Status: `suggested`, `confirmed`, or `rejected`

### Data Flow Diagram

```
┌─────────────────┐
│  Exchange CSV   │
│  Blockchain API │
└────────┬────────┘
         │ import
         ▼
┌─────────────────────────┐
│ external_transaction_   │
│ data (raw payloads)     │
└────────┬────────────────┘
         │ process
         ▼
┌─────────────────────────┐
│ transactions            │
│ (universal format)      │
└────────┬────────────────┘
         │ link
         ▼
┌─────────────────────────┐
│ transaction_links       │
│ (withdrawal↔deposit)    │
└────────┬────────────────┘
         │ price
         ▼
┌─────────────────────────┐
│ transactions            │
│ (with prices filled)    │
└────────┬────────────────┘
         │ cost-basis
         ▼
┌─────────────────────────┐
│ Tax Reports             │
│ (gains/losses)          │
└─────────────────────────┘
```

---

## Troubleshooting

### Import Issues

**Problem**: `No transactions found in CSV`

- **Solution**: Verify the CSV is the correct export format (e.g., Kraken's `ledgers.csv`, not `trades.csv`)

**Problem**: `API rate limit exceeded`

- **Solution**: Wait a few minutes, or add an API key to increase limits

**Problem**: `Provider unavailable`

- **Solution**: System automatically tries next provider. Check logs to see which providers were attempted.

### Processing Issues

**Problem**: `Unknown transaction type`

- **Solution**: Some custom exchange operations aren't yet mapped. Check logs for the raw transaction data and file an issue.

**Problem**: `Invalid amount format`

- **Solution**: CSV might have non-standard number formatting. Try re-exporting from the exchange.

### Linking Issues

**Problem**: `No matches found`

- **Solution**:
  - Ensure both sides are imported (exchange + blockchain)
  - Check timestamps are within matching window (typically ±2 hours)
  - Try lowering `--min-confidence` threshold

**Problem**: `Too many false positives`

- **Solution**: Increase `--min-confidence` or `--auto-confirm-threshold`

### Pricing Issues

**Problem**: `Asset not found: XYZ`

- **Solution**: Asset might not be in provider database. You can:
  - Try a different provider: `--provider cryptocompare`
  - Manually add price to database
  - Skip pricing for this asset (gains calculation will fail)

**Problem**: `Rate limit exceeded on all providers`

- **Solution**: Prices are cached locally. Wait and rerun—already-fetched prices won't need refetching.

### Cost Basis Issues

**Problem**: `Missing prices for disposal`

- **Solution**: Run `pnpm dev -- price --currency USD --fetch-missing` first

**Problem**: `Negative cost basis`

- **Solution**: Usually means:
  - Acquisition transactions are missing (incomplete import)
  - Linked transfers aren't being recognized (run `link` command)
  - Need to import earlier history

---

## Data Privacy & Storage

**All data stays on your machine**. ExitBook:

- ✅ Stores everything in local SQLite databases (`./data/`)
- ✅ Only sends anonymized API requests to price/blockchain providers
- ✅ Never uploads your transaction history anywhere
- ✅ Is fully open source—audit the code yourself

**Security Best Practices:**

- Don't commit `.env` files with API keys
- Keep `./data/` directory private (it contains your financial history)
- Back up `./data/transactions.db` regularly
- Consider encrypting backups

---

## Contributing

We welcome contributions! This project follows standard open-source practices:

1. **Found a bug?** Open an issue with reproduction steps
2. **Want a feature?** Open an issue to discuss before implementing
3. **Have a PR?** Ensure tests pass: `pnpm test` and `pnpm lint`

See [AGENTS.md](./AGENTS.md) for development documentation.

---

## License

AGPL v3 - See [LICENSE](./LICENSE) for details.

ExitBook is free, open-source software. If you find it useful, consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs
- 📝 Improving documentation
- 💻 Contributing code

---

## Roadmap

**Coming Soon:**

- [ ] More exchange integrations (Coinbase, Binance, Gemini)
- [ ] GUI for reviewing suggested links
- [ ] Live balance verification (fetch current balances from exchanges)
- [ ] More jurisdictions (AU, NZ, IN, etc.)
- [ ] NFT transaction support
- [ ] DeFi protocol integration (Uniswap, Aave, etc.)
- [ ] Tax form generation (8949, Schedule D, etc.)

See [GitHub Issues](https://github.com/jbelanger/exitbook/issues) for detailed progress.

---

## Support

- **Documentation**: You're reading it! Check [docs/](./docs/) for more
- **Issues**: [GitHub Issues](https://github.com/jbelanger/exitbook/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jbelanger/exitbook/discussions)

---

**Built with ❤️ by the ExitBook team**
