# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ExitBook is a cryptocurrency transaction import and ledger system built with NestJS and featuring a Universal Blockchain Provider Architecture for resilient transaction imports. The system transforms from fragile single-point-of-failure blockchain adapters into a production-grade infrastructure with automatic failover.

## Essential Commands

### Development & Build

- `pnpm install` - Install dependencies (takes ~25 seconds, requires Node.js >= 23.0.0)
- `pnpm build` - Build TypeScript CLI app (~4 seconds)
- `pnpm dev` - Run with hot reload
- `pnpm start api` - Start API server (runs at http://localhost:3000)
- `pnpm start cli` - Run CLI application

### Testing & Quality

- `pnpm test` - Run unit tests (~2 seconds, some existing failures)
- `pnpm test:coverage` - Run tests with coverage
- `pnpm test:e2e` - Run end-to-end tests
- `pnpm typecheck` - Type checking (~12 seconds, has existing TypeScript errors)
- `pnpm lint` - ESLint checking (~8 seconds, has existing lint errors)
- `pnpm prettier:fix` - Auto-fix formatting issues

### CLI Operations

- `pnpm status` - Show system status (database, transactions, verifications)
- `pnpm import` - Import transactions with automatic failover
- `pnpm verify` - Balance verification
- `pnpm export` - Export transaction data

### Provider Management

- `pnpm blockchain-providers:list` - List all blockchain providers
- `pnpm blockchain-providers:validate` - Validate provider registrations
- `pnpm config:validate` - Validate configuration files

## Architecture

### Universal Blockchain Provider Architecture

The core innovation is a multi-provider resilience system that eliminates single points of failure:

```
┌─────────────────────────────────────┐
│     Blockchain Adapters             │  ← Existing code (minimal changes)
│  (Bitcoin, Ethereum, Injective)     │
├─────────────────────────────────────┤
│   Universal Provider Manager        │  ← Resilience layer
│  (Failover, Circuit Breaker, Cache) │
├─────────────────────────────────────┤
│      Individual Providers           │  ← Multiple API sources
│ (mempool.space, Etherscan, Alchemy) │
└─────────────────────────────────────┘
```

Key components:

- **Provider Manager**: Central orchestrator with intelligent failover
- **Circuit Breakers**: Protect against cascading failures (3 failures = open, 5 min recovery)
- **Request Caching**: 30-second cache for expensive operations
- **Health Monitoring**: Real-time provider status tracking

### Data Architecture

- **Double-entry ledger** for balance-safe accounting
- **CQRS pattern** with focused handlers
- **Drizzle ORM** with PostgreSQL/SQLite
- **Local-first security** approach

## Project Structure

Based on README.md, the intended structure is:

```
exitbook/
├── apps/
│   ├── api/        # REST API (NestJS)
│   └── cli/        # CLI application (NestJS Commander)
├── libs/
│   ├── core/       # Entities, types, validation
│   ├── database/   # Drizzle ORM schema & repos
│   ├── ledger/     # Ledger & account services
│   ├── import/     # Importers & processors
│   ├── providers/  # Provider registry & managers
│   └── shared/     # Logging, errors, utils
```

## Important Implementation Details

### Node.js Version Requirements

- **Required**: Node.js >= 23.0.0 (according to package.json)
- **Reality**: Runs on Node.js 20.19.4 with warnings (can be ignored)

### Database

- Uses SQLite3 for local transaction storage
- Automatic initialization on first run
- Includes transaction deduplication

### Provider System

- 11 blockchain providers across 6 blockchains
- Multi-provider resilience with automatic failover
- Registry-based provider discovery using `@RegisterProvider` decorators
- Rate limiting and caching built-in

### Configuration

- Environment variables in `.env` files
- Provider configs support multiple APIs per blockchain
- Circuit breaker and rate limit settings per provider

## Testing Strategy

### Manual Validation Workflows

Always test these after changes:

1. `pnpm status` - should show system information
2. `pnpm blockchain-providers:list` - should show all providers
3. `pnpm blockchain-providers:validate` - should validate registrations
4. Database operations work by checking status after imports

### Environment Setup

For full testing, set up `.env` with API keys:

- `ETHERSCAN_API_KEY=your_etherscan_api_key`
- `BLOCKCYPHER_API_KEY=your_blockcypher_token`
- Exchange keys: `KUCOIN_API_KEY`, `KUCOIN_SECRET`, `KUCOIN_PASSPHRASE`

## Known Issues & Limitations

- TypeScript errors exist in blockchain providers (~80+ errors)
- Some lint errors in exchange CCXT adapter (~16 errors)
- Some test failures exist (4 failed tests in Coinbase adapter)
- Prettier formatting issues in some packages
- Commands like `pnpm exchanges:list` are broken (missing script files)

These are existing issues - focus on testing your specific changes rather than fixing these unless directly related.

## Performance Expectations

- Dependency install: ~25 seconds (set timeout 60+ minutes)
- Build: ~4 seconds (set timeout 60+ minutes)
- Tests: ~2 seconds (set timeout 30+ minutes)
- Lint: ~8 seconds (set timeout 30+ minutes)

## Debugging

- `DEBUG=provider:* pnpm import` - Debug provider operations
- `DEBUG=circuit-breaker:* pnpm import` - Debug circuit breaker state
- Enable structured logging for troubleshooting

## Development Workflow

1. Always run `pnpm build` after code changes
2. Test with manual scenarios above
3. Run `pnpm prettier:fix && pnpm lint` before committing
4. Validate end-to-end workflows actually work
5. Check provider health with `pnpm status`

## Migration & Integration

The architecture maintains backward compatibility - existing adapters require minimal changes to gain resilience. New providers follow the `IBlockchainProvider` interface pattern with capability declarations.
