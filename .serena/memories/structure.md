# exitbook — Codebase Structure

## Monorepo (pnpm workspaces)

### `apps/cli/`

- Commander CLI entrypoint: `src/index.ts`
- Features in `src/features/`: prices, providers, cost-basis, balance, clear, transactions, accounts, links, portfolio, import, blockchains, process

### `packages/`

| Package                | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `core`                 | Schemas (Zod), shared types                                 |
| `data`                 | Kysely DB queries (accounts, transactions, raw data, users) |
| `sqlite`               | SQLite connection + migrations                              |
| `ingestion`            | Import/process pipeline                                     |
| `accounting`           | Cost basis, portfolio calculations                          |
| `blockchain-providers` | On-chain data providers with failover/circuit-breakers      |
| `exchange-providers`   | ccxt-based exchange clients                                 |
| `price-providers`      | Price fetch + caching                                       |
| `logger`               | Pino wrapper                                                |
| `events`               | Event bus                                                   |
| `resilience`           | Circuit breakers, retry logic                               |
| `http`                 | HTTP client utilities                                       |
| `tsconfig`             | Shared TS configs                                           |

### Ingestion Sources

- **Blockchains**: `packages/ingestion/src/sources/blockchains/` — bitcoin, evm, solana, cosmos, cardano, xrp, substrate, near
- **Exchanges**: `packages/ingestion/src/sources/exchanges/` — kraken, kucoin, coinbase (+ shared)

### Database Files (in `apps/cli/data/` or `EXITBOOK_DATA_DIR`)

- `transactions.db` — accounts, transactions, movements, raw imports
- `token-metadata.db` — token metadata cache
- `prices.db` — price cache
- `providers.db` — provider health / circuit breaker stats

### Provider Registration

- Each blockchain exports factory arrays from `blockchains/<blockchain>/register-apis.ts`
- Aggregated by `packages/blockchain-providers/src/register-apis.ts`
