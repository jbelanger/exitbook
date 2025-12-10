import { createExchangeWorkflowTests } from './helpers/exchange-workflow-factory.js';

/**
 * Kraken E2E workflow tests
 *
 * This test suite validates the full workflow for Kraken:
 * 1. Import CSV data or fetch via API
 * 2. Process imported transactions
 * 3. Verify balances match live data
 */
createExchangeWorkflowTests({
  name: 'kraken',
  displayName: 'Kraken',
  requiredEnvVars: ['KRAKEN_API_KEY', 'KRAKEN_SECRET'],
  minMatchRate: 0.8,
  workflowTimeout: 300000,
  combinedWorkflowTimeout: 120000,
});
