# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Testing
```bash
# Build TypeScript to dist/
pnpm run build

# Run all tests
pnpm test

# Run specific test categories
pnpm run test:unit
pnpm run test:e2e
pnpm run test:watch
pnpm run test:coverage

# Run specific exchange tests
pnpm run test:coinbase
pnpm run test:coinbase:e2e
```

### Running the Application
```bash
# Development with hot reload and debug logging
pnpm run dev

# Import from all configured exchanges
pnpm run import

# Import from specific exchange or blockchain
pnpm run import -- --exchange kucoin
pnpm run import -- --blockchain bitcoin --addresses <address1> <address2>

# Import with balance verification
pnpm run import:verify

# Check account status and balances
pnpm run status

# Verify existing balances
pnpm run verify
```

### Provider and Configuration Management
```bash
# List all registered blockchain providers
pnpm run providers:list

# Validate provider registrations
pnpm run providers:validate

# Generate config template from providers
pnpm run config:generate

# Validate configuration files
pnpm run config:validate
```

## Architecture Overview

This is a cryptocurrency transaction import tool with multi-provider resilience architecture. The system supports both exchange APIs (via CCXT) and direct blockchain providers with automatic failover.

### Core Components

**Adapters Layer**: Two main types
- **Exchange Adapters**: Import from CEX platforms (KuCoin, Kraken, Coinbase) via CCXT, native APIs, or CSV files
- **Blockchain Adapters**: Direct blockchain data fetching (Bitcoin, Ethereum, Solana, Injective, Avalanche, Substrate chains)

**Provider Registry System**: Type-safe, self-documenting blockchain provider management
- Metadata lives with provider code via `@RegisterProvider` decorators
- JSON config only contains user preferences (enabled/disabled, priorities, overrides)
- Auto-discovery of available providers with runtime validation

**Multi-Provider Resilience**: Production-grade reliability features
- Circuit breakers to prevent cascading failures
- Automatic failover between providers (e.g., mempool.space → blockstream.info)
- Rate limiting and request caching
- Health monitoring and performance tracking

**Storage**: SQLite database with transaction deduplication

### Key Architectural Patterns

1. **Registry-Based Provider Management**: Providers register themselves with metadata using decorators
2. **Circuit Breaker Pattern**: Protects against failed providers with automatic recovery
3. **Adapter Pattern**: Common interfaces for different data sources (exchanges vs blockchains)
4. **Factory Pattern**: Creates adapters and providers based on configuration

### Directory Structure

- `src/adapters/` - Exchange and blockchain adapters
- `src/providers/` - Individual blockchain API providers with registry system
- `src/core/types/` - TypeScript interfaces for different blockchains
- `src/services/` - Business logic (import, verification, wallet)
- `src/infrastructure/` - Database, logging, shared utilities
- `src/scripts/` - Provider management and configuration utilities
- `config/` - JSON configuration files for exchanges and blockchain explorers

## Important Implementation Notes

### Provider Development
When adding new blockchain providers:
1. Use `@RegisterProvider` decorator with complete metadata
2. Implement `IBlockchainProvider` interface
3. Import provider in corresponding adapter to trigger registration
4. Update configuration files and add tests

### Configuration Management
- Exchange configs in `config/exchanges.json` with adapter types (ccxt/native/universal)
- Blockchain explorer configs in `config/blockchain-explorers.json` with provider priorities
- Environment variables for API keys (never commit secrets)

### Testing Strategy
- Unit tests for individual components
- E2E tests for full import workflows
- Provider connection tests for API validation
- Separate E2E test flags for external API calls

### Error Handling
- Circuit breaker protection for provider failures
- Automatic failover with exponential backoff
- Comprehensive logging with structured output
- Transaction deduplication to prevent duplicate imports

## Package Manager
Uses `pnpm` as the package manager (specified in package.json). All npm commands should use `pnpm` instead.

## Node Version
Requires Node.js >= 18.0.0 (see package.json engines field).

## Database
Uses SQLite3 for local transaction storage. Database initialization happens automatically on first run.