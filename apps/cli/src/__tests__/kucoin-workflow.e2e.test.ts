import { createExchangeWorkflowTests } from './helpers/exchange-workflow-factory.js';

/**
 * KuCoin E2E workflow tests
 *
 * This test suite validates the full workflow for KuCoin:
 * 1. Import CSV data or fetch via API
 * 2. Process imported transactions
 * 3. Verify balances match live data
 */
createExchangeWorkflowTests({
  name: 'kucoin',
  displayName: 'KuCoin',
  requiredEnvVars: ['KUCOIN_API_KEY', 'KUCOIN_SECRET', 'KUCOIN_PASSPHRASE'],
  importCredentialArgs: (envVars) => [
    '--api-key',
    envVars['KUCOIN_API_KEY']!,
    '--api-secret',
    envVars['KUCOIN_SECRET']!,
    '--api-passphrase',
    envVars['KUCOIN_PASSPHRASE']!,
  ],
  minMatchRate: 0.8,
  workflowTimeout: 300000,
  combinedWorkflowTimeout: 120000,
});
