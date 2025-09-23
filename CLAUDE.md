# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Core Development Commands
- `pnpm build` - Build the TypeScript CLI application (~4 seconds)
- `pnpm dev` - Run the CLI in development mode with hot reload
- `pnpm test` - Run unit tests (~2 seconds, Vitest)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm test:e2e` - Run end-to-end tests (requires API keys)
- `pnpm typecheck` - TypeScript type checking (~12 seconds)
- `pnpm lint` - ESLint checking (~8 seconds)
- `pnpm prettier` - Check code formatting
- `pnpm prettier:fix` - Auto-fix formatting issues

### Application Commands
- `pnpm status` - Show system status (database, transactions, verifications)
- `pnpm dev --help` - Show CLI help
- `pnpm dev import --help` - Show detailed import options
- `pnpm dev import --blockchain bitcoin --addresses <address>` - Import from Bitcoin blockchain
- `pnpm dev verify --help` - Show balance verification options

### Provider Management Commands
- `pnpm blockchain-providers:list` - List all registered blockchain providers
- `pnpm blockchain-providers:validate` - Validate provider registrations
- `pnpm providers:list` - List providers from import package
- `pnpm providers:sync` - Sync provider configurations
- `pnpm providers:validate` - Validate provider implementations

### Testing a Single Test File
```bash
# Run specific test file
vitest run packages/import/src/blockchains/bitcoin/api/__tests__/TatumBitcoinApiClient.test.ts

# Run specific test pattern
vitest run --grep "Bitcoin API"
```

## Architecture

### Monorepo Structure
```
apps/cli/                    # Main CLI application
packages/core/               # Domain entities & shared types
packages/import/             # Transaction import domain
  ├── blockchains/          # Blockchain-specific implementations (6 networks)
  ├── exchanges/            # Exchange adapters (CCXT, native, universal)
  ├── shared/               # Provider registry & shared utilities
  └── services/             # Import orchestration services
packages/balance/            # Balance verification services
packages/data/               # Database, repositories & storage
packages/shared/             # Cross-cutting concerns (logging, utils)
```

### Provider Registry System
The system uses a decorator-based provider registration pattern:

- **`@RegisterApiClient`** decorator in `packages/import/src/blockchains/shared/registry/decorators.ts`
- **Provider Registry** in `packages/import/src/blockchains/shared/registry/provider-registry.ts`
- **Auto-discovery** of providers through metadata-driven instantiation
- **Type-safe configuration** with compile-time checking

Example provider registration:
```typescript
@RegisterApiClient({
  blockchain: 'bitcoin',
  provider: 'mempool.space',
  // ... other metadata
})
export class MempoolSpaceApiClient implements IBlockchainProvider {
  // Implementation
}
```

### Multi-Provider Resilience Architecture
- **Circuit Breaker Pattern**: Three-state finite state machine (Closed/Open/Half-Open)
- **Automatic Failover**: 12+ blockchain data providers across 6 networks
- **Rate Limiting**: Intelligent request spacing and circuit protection
- **Health Monitoring**: Real-time provider performance tracking
- **Request Caching**: Optimized failover response times

### Blockchain Provider Structure
Each blockchain follows a consistent pattern:
```
packages/import/src/blockchains/{blockchain}/
├── api/                    # API client implementations
├── mappers/               # Data transformation mappers
├── schemas.ts             # Zod validation schemas
├── transaction-importer.ts # Import orchestration
├── transaction-processor.ts # Transaction processing logic
├── types.ts               # TypeScript type definitions
└── utils.ts               # Blockchain-specific utilities
```

### Exchange Adapter Types
- **CCXT Adapter**: Uses CCXT library for standardized exchange APIs
- **Native Adapter**: Direct API implementations for specific exchanges
- **Universal Adapter**: Flexible adapter supporting multiple data sources

### Data Validation Pipeline
- **Zod Schemas**: Runtime type validation and schema enforcement
- **Log-and-Filter Strategy**: Maintains data integrity while logging issues
- **Mathematical Constraints**: Financial data validation with Decimal.js precision
- **Anomaly Detection**: Automatic detection and reporting of data irregularities

## Configuration

### Environment Setup
Create `.env` file in `apps/cli/` for API keys:
```bash
# Bitcoin providers
BLOCKCYPHER_API_KEY=your_blockcypher_token

# Ethereum providers
ETHERSCAN_API_KEY=your_etherscan_api_key

# Exchange API Keys
KUCOIN_API_KEY=your_kucoin_api_key
KUCOIN_SECRET=your_kucoin_secret
KUCOIN_PASSPHRASE=your_kucoin_passphrase
```

### Key Configuration Files
- **Blockchain Providers**: `apps/cli/config/blockchain-explorers.json`
- **Database**: SQLite at `apps/cli/data/transactions.db` (auto-created)
- **Logger Config**: `packages/shared/logger/.env.example`

## Database

- **SQLite3** for local transaction storage with ACID compliance
- **Automatic initialization** on first run
- **Transaction deduplication** with hash-based and fuzzy matching
- **Balance verification** cross-validation between calculated and live balances

## Development Notes

### Requirements
- **Node.js**: >= 23.0.0 (runs on 20.19.4 with warnings)
- **pnpm**: >= 10.6.2 package manager

### Known Issues to Ignore
- TypeScript errors in blockchain providers (~80+ errors)
- Some lint errors in exchange CCXT adapter
- Test failures in Coinbase adapter (4 failed tests)
- Node.js version warnings (application works correctly)

### Adding New Blockchain Providers
1. Create new directory in `packages/import/src/blockchains/{blockchain}/`
2. Implement API clients in `api/` directory
3. Use `@RegisterApiClient` decorator for auto-discovery
4. Follow existing patterns from Bitcoin/Ethereum implementations
5. Add configuration to `apps/cli/config/blockchain-explorers.json`
6. Update provider validation scripts

### Financial Precision
- **Decimal.js**: All financial calculations use Decimal.js for precision
- **No floating point**: Avoid JavaScript number type for financial data
- **Validation**: Mathematical constraints ensure data integrity

### Testing Strategy
- **Unit Tests**: Fast execution (~2 seconds) with Vitest
- **E2E Tests**: Require API keys, test actual provider connections
- **Provider Tests**: Validate blockchain provider implementations
- **Focus**: Test your changes, not existing failures

## Validation Workflow

After making changes, always run:
1. `pnpm build` - Ensure compilation succeeds
2. `pnpm test` - Verify unit tests pass (ignore existing failures)
3. `pnpm status` - Validate CLI functionality
4. `pnpm blockchain-providers:validate` - Check provider registrations
5. `pnpm prettier:fix && pnpm lint` - Format and lint before committing
