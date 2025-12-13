# E2E Test Helpers

This directory contains shared utilities and factories for creating DRY e2e tests across all exchanges and blockchains.

## Quick Start

### Exchange Workflow Tests

To create e2e tests for an exchange, use the `createExchangeWorkflowTests` factory:

```typescript
import { createExchangeWorkflowTests } from './helpers/exchange-workflow-factory.js';

createExchangeWorkflowTests({
  name: 'kraken',
  displayName: 'Kraken',
  requiredEnvVars: ['KRAKEN_API_KEY', 'KRAKEN_SECRET'],
  minMatchRate: 0.8,
  workflowTimeout: 300000,
  combinedWorkflowTimeout: 120000,
});
```

**For exchanges with extra credentials** (like KuCoin's passphrase):

```typescript
createExchangeWorkflowTests({
  name: 'kucoin',
  displayName: 'KuCoin',
  requiredEnvVars: ['KUCOIN_API_KEY', 'KUCOIN_SECRET', 'KUCOIN_PASSPHRASE'],
  extraBalanceArgs: (envVars) => ['--api-passphrase', envVars['KUCOIN_PASSPHRASE']!],
  // ... other config
});
```

### Blockchain Workflow Tests

To create e2e tests for a blockchain, use the `createBlockchainWorkflowTests` factory:

```typescript
import { createBlockchainWorkflowTests } from './helpers/blockchain-workflow-factory.js';

createBlockchainWorkflowTests({
  name: 'bitcoin',
  displayName: 'Bitcoin',
  testCases: [
    {
      blockchain: 'bitcoin',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      description: 'example wallet',
    },
  ],
  minMatchRate: 0.95,
  workflowTimeout: 300000,
});
```

**For blockchains requiring API keys**:

```typescript
createBlockchainWorkflowTests({
  name: 'ethereum',
  displayName: 'Ethereum',
  testCases: [
    /* ... */
  ],
  requiredEnvVars: ['ALCHEMY_API_KEY'],
  minMatchRate: 0.95,
});
```

## Modules

### `e2e-test-utils.ts`

Core utilities for e2e testing:

- `getTestPaths()` - Returns standardized paths for testing
- `executeCLI(args)` - Executes CLI commands and parses JSON output
- `cleanupTestDatabase()` - Cleans up test database
- `canBindUnixSocket()` - Checks if Unix socket binding is allowed
- `hasSampleData(sourceName)` - Checks if sample data exists
- `getSampleDir(sourceName)` - Gets sample directory path

### `e2e-test-types.ts`

Type definitions for CLI command responses:

- `ImportCommandResult` - Result from import command
- `ProcessCommandResult` - Result from process command
- `BalanceCommandResult` - Result from balance command
- `AccountsViewResult` - Result from accounts view command

### `exchange-workflow-factory.ts`

Factory function for creating exchange workflow tests:

- `createExchangeWorkflowTests(config)` - Creates a complete test suite

**Config Options:**

```typescript
interface ExchangeConfig {
  name: string; // Exchange name (e.g., 'kucoin')
  displayName: string; // Display name for tests
  requiredEnvVars: string[]; // Required environment variables
  extraBalanceArgs?: (envVars) => string[]; // Extra CLI args for balance
  minMatchRate?: number; // Min balance match rate (default: 0.8)
  workflowTimeout?: number; // Full workflow timeout (default: 300000ms)
  combinedWorkflowTimeout?: number; // Combined workflow timeout (default: 120000ms)
}
```

### `blockchain-workflow-factory.ts`

Factory function for creating blockchain workflow tests:

- `createBlockchainWorkflowTests(config)` - Creates a complete test suite

**Config Options:**

```typescript
interface BlockchainConfig {
  name: string; // Blockchain name (e.g., 'bitcoin')
  displayName: string; // Display name for tests
  testCases: BlockchainTestCase[]; // Array of addresses to test
  requiredEnvVars?: string[]; // Optional API keys
  minMatchRate?: number; // Min balance match rate (default: 0.95)
  workflowTimeout?: number; // Full workflow timeout (default: 300000ms)
  combinedWorkflowTimeout?: number; // Combined workflow timeout (default: 120000ms)
}

interface BlockchainTestCase {
  blockchain: string; // Blockchain name
  address: string; // Wallet address to test
  description?: string; // Optional description
}
```

## What Gets Tested

Both factories create comprehensive test suites that validate:

### Exchange Tests

1. **Full Workflow Test**: Import CSV → Process → Verify Balance
   - Imports CSV files from `samples/<exchange>/` directory
   - Processes imported transactions
   - Fetches live balance via API
   - Compares calculated vs live balances
   - Validates minimum match rate

2. **Combined Workflow Test**: Import+Process in single command
   - Tests default processing behavior on import command
   - Validates processed transaction count

3. **Missing Data Test**: Shows helpful message when sample data missing

4. **Missing Credentials Test**: Shows helpful message when API keys missing

### Blockchain Tests

1. **Full Workflow Test**: Import Address → Process → Verify Balance
   - Imports blockchain transactions for address
   - Processes imported transactions
   - Fetches live balance via blockchain API
   - Compares calculated vs live balances
   - Validates minimum match rate (typically higher for blockchains)

2. **Combined Workflow Test**: Import+Process in single command
   - Tests default processing behavior on import command
   - Validates processed transaction count

3. **Missing Test Cases Test**: Shows helpful message when no test cases configured

4. **Missing Credentials Test**: Shows helpful message when API keys missing (if required)

## Sample Data Structure

For exchange tests to run, you need sample CSV files in:

```
apps/cli/samples/<exchange-name>/
```

Example structure:

```
apps/cli/samples/
├── kucoin/
│   ├── trades.csv
│   ├── deposits.csv
│   └── withdrawals.csv
└── kraken/
    ├── ledgers.csv
    └── trades.csv
```

## Running Tests

```bash
# Run all e2e tests
pnpm test:e2e

# Run specific exchange test
pnpm vitest run --config vitest.e2e.config.ts apps/cli/src/__tests__/kucoin-workflow.e2e.test.ts

# Run specific blockchain test
pnpm vitest run --config vitest.e2e.config.ts apps/cli/src/__tests__/bitcoin-workflow.e2e.test.ts
```

## Adding a New Exchange Test

1. Create a new test file: `<exchange>-workflow.e2e.test.ts`
2. Import and call `createExchangeWorkflowTests` with your config
3. Add sample CSV files to `apps/cli/samples/<exchange>/`
4. Set required environment variables in `.env`
5. Run the test!

## Adding a New Blockchain Test

1. Create a new test file: `<blockchain>-workflow.e2e.test.ts`
2. Import and call `createBlockchainWorkflowTests` with your config
3. Add test cases with real addresses
4. Set required environment variables in `.env` (if needed)
5. Run the test!

## Benefits

- **DRY**: Single source of truth for workflow test logic
- **Consistent**: All exchanges/blockchains tested the same way
- **Maintainable**: Fix bugs once, benefit everywhere
- **Easy**: Adding a new test is just configuration
- **Type-safe**: Full TypeScript type checking
- **Comprehensive**: Every test validates the complete workflow
