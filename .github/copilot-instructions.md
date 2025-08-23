# Crypto Portfolio Transaction Import Tool

A comprehensive TypeScript monorepo for importing and verifying cryptocurrency transactions from exchanges and blockchains using CCXT and multiple blockchain providers with multi-provider resilience.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Setup
- Install pnpm globally: `npm install -g pnpm@10.6.2`
- Install dependencies: `pnpm install` -- takes ~25 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
- Build the project: `pnpm build` -- takes ~4 seconds. NEVER CANCEL. Set timeout to 60+ minutes.

### Node.js Version Warning
- **Required**: Node.js >= 23.0.0 according to package.json engines
- **Current Reality**: Runs fine on Node.js 20.19.4 with warnings
- **Action**: Ignore the "WARN Unsupported engine" messages - the application works correctly

### Essential Build and Test Commands
- `pnpm build` -- builds TypeScript CLI app (~4 seconds). NEVER CANCEL. Set timeout to 60+ minutes.
- `pnpm test` -- runs unit tests (~2 seconds, some existing failures). NEVER CANCEL. Set timeout to 30+ minutes.
- `pnpm typecheck` -- type checking (~12 seconds, has existing TypeScript errors). NEVER CANCEL. Set timeout to 30+ minutes.
- `pnpm lint` -- ESLint checking (~8 seconds, has existing lint errors). NEVER CANCEL. Set timeout to 30+ minutes.
- `pnpm prettier` -- formatting check (~1.4 seconds, has existing format issues). Set timeout to 15+ minutes.
- `pnpm prettier:fix` -- auto-fix formatting issues. Set timeout to 15+ minutes.

### Running the Application
- `pnpm dev --help` -- show CLI help
- `pnpm status` -- show system status (database, transactions, verifications)
- `pnpm dev import --help` -- show detailed import options
- `pnpm dev import --blockchain bitcoin --addresses <address>` -- import from Bitcoin blockchain
- `pnpm dev verify --help` -- show balance verification options

## Validation

### ALWAYS Validate These Working Commands
After making changes, ALWAYS test these core workflows:

1. **System Status Check**: `pnpm status` should show system information
2. **Provider Listing**: `pnpm blockchain-providers:list` should show all blockchain providers
3. **Provider Validation**: `pnpm blockchain-providers:validate` should validate provider registrations
4. **Help Commands**: `pnpm dev --help` and `pnpm dev import --help` should work
5. **Database Creation**: App should create SQLite database automatically on first run
6. **Import Workflow**: `pnpm dev import --blockchain bitcoin --addresses 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` should attempt import (may fail due to no API keys but should show proper workflow)

### Manual Testing Scenarios
ALWAYS run through at least one complete end-to-end scenario after making changes:

**Basic Import Scenario:**
```bash
# 1. Check system status (should show 0 transactions initially)
pnpm status

# 2. Attempt a blockchain import (will show provider failures without API keys)
pnpm dev import --blockchain bitcoin --addresses 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa

# 3. Verify database was created and app handled the failure gracefully
pnpm status

# 4. Check that logs show proper error handling
```

### Environment Setup for Full Testing
To test with real API connections, set up `.env` file in `apps/cli/`:
```bash
# Bitcoin providers (mempool.space is free, others may require keys)
BLOCKCYPHER_API_KEY=your_blockcypher_token

# Ethereum providers
ETHERSCAN_API_KEY=your_etherscan_api_key

# Exchange API Keys
KUCOIN_API_KEY=your_kucoin_api_key
KUCOIN_SECRET=your_kucoin_secret
KUCOIN_PASSPHRASE=your_kucoin_passphrase
```

### Critical Validation Requirements
- Always build and test after making changes: `pnpm build && pnpm test`
- Always run `pnpm prettier:fix && pnpm lint` before committing (CI will fail otherwise)
- Test the CLI commands actually work, don't just check if they compile
- Verify database operations work by checking `pnpm status` after imports

## Common Tasks

### Working Commands (Validated)
These commands are tested and working:
```bash
# Core application
pnpm status                           # Show system status
pnpm dev --help                       # CLI help
pnpm dev import --help               # Import help
pnpm dev import --blockchain bitcoin --addresses <address>  # Bitcoin import

# Provider management
pnpm blockchain-providers:list        # List all blockchain providers
pnpm blockchain-providers:validate    # Validate provider registrations

# Development
pnpm build                           # Build project
pnpm test                           # Run tests
pnpm lint                           # Lint code
pnpm typecheck                      # Type check
pnpm prettier                       # Check formatting
pnpm prettier:fix                   # Fix formatting
```

### Broken Commands (Do Not Use)
These commands are currently broken:
```bash
pnpm blockchain-config:validate       # Looks for config in wrong location
pnpm exchanges:list                   # Script file missing
pnpm exchanges:generate               # May not work
pnpm exchanges:validate               # May not work
pnpm exchanges:validate-config        # May not work
```

### Repository Structure
```
crypto-portfolio/
├── apps/
│   └── cli/                    # Main CLI application
│       ├── config/             # Configuration files
│       ├── data/              # SQLite database storage
│       └── index.ts           # CLI entry point
├── packages/
│   ├── core/                  # Domain entities & shared types
│   ├── import/                # Transaction import domain
│   │   ├── blockchains/       # Blockchain-specific implementations
│   │   ├── exchanges/         # Exchange adapters (CCXT, native)
│   │   ├── shared/            # Provider registry & shared utilities
│   │   └── services/          # Import orchestration services
│   ├── balance/               # Balance verification services
│   ├── data/                  # Database, repositories & storage
│   └── shared/                # Cross-cutting concerns
│       ├── logger/            # Structured logging
│       └── utils/             # Common utilities
```

### Key Files to Know
- `apps/cli/index.ts` - Main CLI entry point
- `packages/import/src/scripts/` - Management scripts (4 working scripts)
- `apps/cli/config/blockchain-explorers.json` - Blockchain provider configuration
- `CLAUDE.md` - Comprehensive technical documentation
- `apps/cli/.env.example` - Environment variable template

### Configuration Files
- Exchange configs: Look for in CLI config directory (may not exist yet)
- Blockchain configs: `apps/cli/config/blockchain-explorers.json`
- Environment variables: Use `.env` file in `apps/cli/` directory
- Logger config: `packages/shared/logger/.env.example`

## Important Implementation Notes

### Database
- Uses SQLite3 for local transaction storage
- Database file: `apps/cli/data/transactions.db`
- Automatic initialization on first run
- Includes transaction deduplication

### Provider Architecture
- Multi-provider resilience with automatic failover
- Circuit breakers for provider failures
- Rate limiting and caching
- Registry-based provider discovery
- 11 blockchain providers across 6 blockchains (Bitcoin, Ethereum, Solana, Avalanche, Injective, Polkadot)

### Exchange Support
- Multiple adapter types: CCXT, native, and universal
- Supports KuCoin, Kraken, Coinbase, and other exchanges
- Balance verification functionality

### Known Issues
- TypeScript errors exist in blockchain providers (~80+ errors in typecheck)
- Some lint errors exist in exchange CCXT adapter (~16 errors)
- Some test failures exist (4 failed tests in Coinbase adapter)
- Prettier formatting issues in some packages
- Node.js version warnings (can be ignored)

These are existing issues not related to your changes unless you modify the affected files.

### Testing Strategy
- Unit tests run fast (~2 seconds) but some fail due to existing issues
- E2E tests exist but require API keys
- Provider connection tests available
- Focus on testing your specific changes, not fixing existing test failures

## Troubleshooting

### Build Issues
- If build fails, check TypeScript errors with `pnpm typecheck`
- Missing dependencies: Run `pnpm install`
- Permission issues: Check file permissions in apps/cli/data/

### Runtime Issues
- Database errors: Delete `apps/cli/data/transactions.db` to reset
- API connection failures: Check API keys in `.env` file
- Provider failures: Run `pnpm blockchain-providers:validate` to diagnose

### Debugging
- Enable debug logging: `DEBUG=provider:* pnpm dev import`
- Check system status: `pnpm status`
- Validate configurations: `pnpm blockchain-config:validate`

## Development Workflow

### Making Changes
1. Always run `pnpm build` after code changes
2. Test with `pnpm test` (ignore existing failures unrelated to your changes)
3. Validate CLI functionality with manual scenarios above
4. Run `pnpm prettier:fix && pnpm lint` before committing
5. Test end-to-end workflows to ensure they work

### Performance Expectations
- Dependency install: ~25 seconds (642 packages)
- Build: ~4 seconds (TypeScript compilation)
- Tests: ~2 seconds (unit tests)
- Lint: ~8 seconds
- Typecheck: ~12 seconds
- Provider operations: Variable based on API response times

### Adding New Features
- Follow the monorepo package structure
- Use existing patterns from `packages/import/blockchains/` for blockchain providers
- Use registry decorators `@RegisterProvider` for new blockchain providers
- Update configuration files in `apps/cli/config/` as needed
- Add tests following existing patterns
- Update documentation in CLAUDE.md for architectural changes