# ExitBook

> Open-source CLI for crypto transaction tracking and tax reporting
> **Status: Work in Progress**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Test Suite](https://github.com/jbelanger/exitbook/actions/workflows/test.yml/badge.svg)](https://github.com/jbelanger/exitbook/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/jbelanger/exitbook/branch/main/graph/badge.svg)](https://codecov.io/gh/jbelanger/exitbook)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-blue.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.6.2-orange.svg)](https://pnpm.io)

## Why Exitbook exists

Crypto tax tools charge per transaction, hide their calculations, and some fabricate events to fill gaps in your data.

Exitbook doesn't do any of that. Every number traces back to a real import. Every calculation is visible. If data is missing, it tells you instead of guessing.

## Before you file

1. **Check balances** — after importing, run `balance` to verify Exitbook matches the chain. If balances are correct, the calculations built on top of them will be too.
2. **Import all your wallets** — transfers between your own wallets need both sides to link correctly. Missing a wallet means broken links.
3. **Pricing is intraday** — USD prices are per-day, not per-second. Close enough for tax reporting.

## How it works

1. **Import** — pull transactions from blockchains (by wallet address) or exchanges (by API key, or CSV for KuCoin).
2. **Normalize** — convert everything into a universal transaction format.
3. **Link** — detect transfers between your wallets. You review, confirm, or reject each suggested link.
4. **Price** — attach USD prices to every inflow, outflow, and fee. Fill any gaps manually.
5. **Calculate** — compute cost basis (FIFO, LIFO, or average).

## Supported Sources

### Blockchains

| Chain Family  | Sub-chains | Import Status                   | Balance Verification            |
| ------------- | ---------- | ------------------------------- | ------------------------------- |
| **Bitcoin**   | 4 chains   | **Complete** (simple wallets)   | **Complete** (simple wallets)   |
| **Cardano**   | 1 chain    | **Complete** (simple wallets)   | **Complete** (simple wallets)   |
| **Cosmos**    | 95 chains  | **Complete** (simple wallets)   | **Complete** (simple wallets)   |
| **EVM**       | 113 chains | **Complete** (simple wallets)\* | **Complete** (simple wallets)\* |
| **NEAR**      | 1 chain    | **Complete** (simple wallets)   | **Complete** (simple wallets)   |
| **Solana**    | 1 chain    | **Complete** (simple wallets)   | **Complete** (simple wallets)   |
| **Substrate** | 89 chains  | **Complete** (simple wallets)   | **Complete** (simple wallets)   |

\* EVM supports both address and contract address tracking

**Note:** All chains support complete import and balance verification for simple user wallets (EOA addresses). Complex wallet scenarios (multi-sig, smart contract wallets, cross-chain interactions) require additional work.

<details>
<summary>View all supported chains</summary>

**Bitcoin family:** bitcoin, dogecoin, litecoin, bitcoin-cash

**Cardano:** cardano

**Cosmos chains:** injective, osmosis, cosmoshub, terra, juno, secret, stargaze, and 88 more

**EVM chains:** ethereum, polygon, optimism, arbitrum, base, avalanche, beam, bsc, zksync, polygon-zkevm, linea, scroll, mantle, blast, and 99 more (see `packages/blockchain-providers/src/blockchains/evm/evm-chains.json`)

**NEAR:** near

**Solana:** solana

**Substrate chains:** polkadot, bittensor, kusama, acala, moonbeam, astar, and 83 more

</details>

### Exchanges

| Exchange | CSV Import | API Import |
| -------- | ---------- | ---------- |
| Kraken   | -          | Working    |
| KuCoin   | Working    | Working    |
| Coinbase | -          | Working    |

## Blockchain Providers

ExitBook uses a multi-provider failover system to fetch blockchain data. Each blockchain family supports multiple data providers that implement different operations. The system automatically retries across providers if one fails.

### Provider Operations

| Operation                        | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `getAddressTransactions`         | Fetch all transactions for an address            |
| `getAddressInternalTransactions` | Fetch internal/contract transactions (EVM)       |
| `getAddressBalances`             | Get native token balance for an address          |
| `getAddressTokenTransactions`    | Fetch token transfers for an address             |
| `getAddressTokenBalances`        | Get all token balances for an address            |
| `getTokenMetadata`               | Retrieve token metadata (symbol, decimals, etc.) |
| `getAddressBeaconWithdrawals`    | Fetch Ethereum beacon chain withdrawals          |
| `hasAddressTransactions`         | Check if address has any transactions            |

### Available Providers by Blockchain

<details>
<summary><strong>Bitcoin Family</strong> (3 providers)</summary>

| Provider          | Chains Supported                          | Operations                              | API Key Required      |
| ----------------- | ----------------------------------------- | --------------------------------------- | --------------------- |
| **blockstream**   | bitcoin                                   | Transactions, Balances, HasTransactions | No                    |
| **mempool.space** | bitcoin                                   | Transactions, Balances, HasTransactions | No                    |
| **tatum**         | bitcoin, litecoin, dogecoin, bitcoin-cash | Transactions, Balances, HasTransactions | Yes (`TATUM_API_KEY`) |

Note: Tatum provides coverage for the other Bitcoin-family chains where Blockstream/Mempool.space don't operate.

</details>

<details>
<summary><strong>Cardano</strong> (1 provider)</summary>

| Provider       | Operations                              | API Key Required           |
| -------------- | --------------------------------------- | -------------------------- |
| **blockfrost** | Transactions, Balances, HasTransactions | Yes (`BLOCKFROST_API_KEY`) |

</details>

<details>
<summary><strong>Cosmos</strong> (1 provider)</summary>

| Provider               | Chains Supported | Operations             | API Key Required |
| ---------------------- | ---------------- | ---------------------- | ---------------- |
| **injective-explorer** | injective        | Transactions, Balances | No               |

Note: Only Injective is currently supported. Other Cosmos chains (Osmosis, Terra, etc.) planned via Mintscan.

</details>

<details>
<summary><strong>EVM Chains</strong> (5 providers)</summary>

| Provider           | Chains Supported   | Operations                                                                  | API Key Required          |
| ------------------ | ------------------ | --------------------------------------------------------------------------- | ------------------------- |
| **moralis**        | All 113 EVM chains | Transactions, InternalTxs, Balances, TokenTxs, TokenBalances, TokenMetadata | Yes (`MORALIS_API_KEY`)   |
| **routescan**      | Most EVM chains    | Transactions, InternalTxs, Balances, TokenTxs                               | No                        |
| **etherscan**      | ethereum           | BeaconWithdrawals                                                           | Yes (`ETHERSCAN_API_KEY`) |
| **thetascan**      | theta              | Transactions, Balances, TokenBalances                                       | No                        |
| **theta-explorer** | theta              | Transactions                                                                | No                        |

Note: Moralis and Routescan provide multi-chain coverage. Etherscan/ThetaScan are chain-specific.

</details>

<details>
<summary><strong>NEAR</strong> (1 provider)</summary>

| Provider       | Operations                                | API Key Required |
| -------------- | ----------------------------------------- | ---------------- |
| **nearblocks** | Transactions, TokenTransactions, Balances | No               |

</details>

<details>
<summary><strong>Solana</strong> (3 providers)</summary>

| Provider       | Operations                                                     | API Key Required        |
| -------------- | -------------------------------------------------------------- | ----------------------- |
| **helius**     | Transactions, Balances, TokenBalances, TokenTxs, TokenMetadata | Yes (`HELIUS_API_KEY`)  |
| **solana-rpc** | Transactions, Balances, TokenBalances                          | No                      |
| **solscan**    | Transactions, Balances                                         | Yes (`SOLSCAN_API_KEY`) |

</details>

<details>
<summary><strong>Substrate</strong> (2 providers)</summary>

| Provider     | Chains Supported | Operations             | API Key Required         |
| ------------ | ---------------- | ---------------------- | ------------------------ |
| **subscan**  | polkadot, kusama | Transactions, Balances | No                       |
| **taostats** | bittensor        | Transactions, Balances | Yes (`TAOSTATS_API_KEY`) |

Note: Only 3 of 89 Substrate chains currently have providers. Others require additional integrations.

</details>

**Summary:** 16 active providers across 7 blockchain families. 6 require API keys, 10 work without authentication.

**Disabled providers:** Alchemy (EVM), Blockcypher (Bitcoin - rate limits too low), Blockchain.com (Bitcoin - timeouts)

To view full provider details including rate limits: `pnpm blockchain-providers:list`

## CLI Commands

### Core Operations

```bash
# Import from exchange CSV (KuCoin only)
pnpm run dev import --exchange kucoin --csv-dir ./exports/kucoin

# Import from exchange API
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET

# Import blockchain transactions (simple wallets)
pnpm run dev import --blockchain bitcoin --address bc1q...

# Verify live balance
pnpm run dev balance --account-id <id>
```

### Data Management

```bash
# View transactions
pnpm run dev transactions

# View accounts
pnpm run dev accounts

# Manage prices
pnpm run dev prices enrich
pnpm run dev prices set <symbol> <amount> --date YYYY-MM-DD

# Export data
pnpm run dev export --exchange kraken --format csv --output ./report.csv

# Reprocess all raw data (clears derived data, rebuilds transactions)
pnpm run dev reprocess
```

### Utilities

```bash
# List available blockchains and providers
pnpm run dev list-blockchains

# Clear processed data (keeps raw data)
pnpm run dev clear
```

## Getting Started

**Requirements:** Node.js ≥24, pnpm ≥10.6.2

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Run tests
pnpm test

# Try an import (KuCoin CSV or Kraken API)
pnpm run dev import --exchange kucoin --csv-dir ./your-data
# or
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET
```

**Configuration:** Add API keys to `.env` in project root (see `CLAUDE.md` for details)

## License

AGPL-3.0-only
