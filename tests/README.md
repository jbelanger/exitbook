# Testing Guide

This directory contains comprehensive tests for the Coinbase ledger adapter and other components.

## Test Types

### 1. Unit Tests
Test core business logic without external dependencies:
- Fee deduplication logic
- Buy/sell direction handling  
- Price calculation (excluding fees)
- Transaction type detection
- Symbol and side extraction

### 2. E2E Tests (End-to-End)
Test against the real Coinbase API:
- API connectivity
- Real transaction processing
- Data structure validation
- Combined trade verification

### 3. Regression Tests
Detect breaking changes in Coinbase's API:
- Response structure validation
- Critical field availability
- Nested data accessibility

## Running Tests

### Prerequisites

For E2E tests, set up Coinbase API credentials:
```bash
export COINBASE_API_KEY="your_api_key"
export COINBASE_SECRET="your_secret"
export COINBASE_PASSPHRASE="your_passphrase"
```

### Test Commands

```bash
# Run all tests
pnpm test

# Run only unit tests (no API calls)
pnpm test:unit

# Run only E2E tests (requires credentials)
pnpm test:e2e

# Run Coinbase-specific tests
pnpm test:coinbase

# Run E2E tests for Coinbase only
pnpm test:coinbase:e2e

# Watch mode for development
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Debug Mode

Enable detailed test logging:
```bash
DEBUG_TESTS=true pnpm test
```

Enable Coinbase adapter debug logging:
```bash
DEBUG_COINBASE=true pnpm test:coinbase:e2e
```

## Test Philosophy

### Why E2E Tests?

Given the complexity of Coinbase's ledger API and the issues we've encountered:

1. **API Change Detection**: Coinbase can change their response structure without notice
2. **Data Validation**: Ensures our parsing logic works with real data
3. **Integration Testing**: Verifies the entire pipeline works end-to-end
4. **Confidence**: Provides assurance that the adapter works in production

### Unit Test Coverage

Critical business logic is covered by unit tests:

- **Fee Deduplication**: Prevents double-counting fees (e.g., 10.98 + 10.98 = 21.96 ❌ should be 10.98 ✅)
- **Direction Logic**: Ensures buy/sell trades have correct amount/price assignment
- **Price Calculation**: Verifies fees are subtracted from totals (747.94 - 10.98 = 736.96)
- **Transaction Types**: Validates send+direction logic for deposits/withdrawals

## Test Data

### Mock Data Structure

Unit tests use carefully crafted mock data that mirrors Coinbase's actual response structure:

```typescript
// Example: Coinbase's double-nested structure
{
  info: {           // CCXT wrapper
    direction: 'in',
    currency: 'BTC', 
    info: {          // Actual Coinbase data
      advanced_trade_fill: {
        order_side: 'buy',
        product_id: 'BTC-USD'
      },
      buy: {
        fee: { amount: '10.98', currency: 'USD' },
        total: { amount: '747.94', currency: 'USD' }
      }
    }
  }
}
```

### Real Data Testing

E2E tests work with live Coinbase data to catch:
- Unexpected response changes
- New transaction types
- Modified nested structures
- Rate limiting issues

## Continuous Integration

### GitHub Actions

- **Unit tests**: Run on every push/PR
- **E2E tests**: Run daily + on main branch pushes
- **API monitoring**: Creates GitHub issues if E2E tests fail on schedule

### Test Security

- E2E tests only run with proper credentials
- Credentials stored as GitHub Secrets
- Fork PRs can't access secrets (security feature)

## Debugging Failed Tests

### Unit Test Failures
1. Check the specific assertion that failed
2. Review mock data structure
3. Enable `DEBUG_TESTS=true` for detailed logs

### E2E Test Failures
1. Verify API credentials are correct
2. Check Coinbase API status
3. Enable `DEBUG_COINBASE=true` for adapter logs
4. Look for changes in Coinbase's response structure

### Regression Test Failures
1. **Immediate action required** - likely API breaking change
2. Check Coinbase API documentation/changelog
3. Update adapter code to handle new structure
4. Add new test cases for the changes

## Adding New Tests

### When to Add Unit Tests
- New business logic functions
- Bug fixes (add test to prevent regression)
- Complex data transformations

### When to Add E2E Tests
- New API endpoints
- New transaction types
- Integration scenarios

### Test Naming Convention
```typescript
describe('CoinbaseLedgerAdapter', () => {
  describe('Unit Tests - Core Logic', () => {
    describe('Fee Deduplication', () => {
      test('should deduplicate identical fees from same order', () => {
        // Test implementation
      });
    });
  });
  
  describe('E2E Tests - Real Coinbase API', () => {
    test('should fetch and process real ledger data', () => {
      // E2E test implementation
    });
  });
});
```

## Maintenance

### Regular Tasks
- Review E2E test failures (daily GitHub Actions)
- Update mock data when Coinbase changes responses
- Add tests for new edge cases discovered in production
- Keep test dependencies updated

### When Coinbase API Changes
1. E2E tests will fail first (early warning)
2. GitHub Action creates an issue automatically
3. Investigation workflow:
   - Check Coinbase changelog
   - Run tests locally with debug enabled
   - Identify specific changes needed
   - Update adapter + add regression tests
   - Verify fix with both unit and E2E tests