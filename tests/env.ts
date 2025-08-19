// Environment setup for tests
import { config } from 'dotenv';

// Load .env file for test credentials
config();

// Test environment marker
process.env.NODE_ENV = 'test';

// Default test values if real credentials aren't available
if (!process.env.COINBASE_API_KEY) {
  console.warn('⚠️  COINBASE_API_KEY not found - E2E tests will be skipped');
  console.warn('   Set COINBASE_API_KEY, COINBASE_SECRET, and COINBASE_PASSPHRASE to run E2E tests');
}