// Global test setup
import { config } from 'dotenv';

// Load environment variables for testing
config();

// Global test timeout for long-running E2E tests
jest.setTimeout(60000);

// Mock console methods in test environment if needed
if (process.env.NODE_ENV === 'test') {
  // Suppress debug logs unless specifically testing logging
  const originalConsoleLog = console.log;
  console.log = (...args: any[]) => {
    if (process.env.DEBUG_TESTS === 'true') {
      originalConsoleLog(...args);
    }
  };
}