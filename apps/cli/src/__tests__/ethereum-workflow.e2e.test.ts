import { createBlockchainWorkflowTests } from './helpers/blockchain-workflow-factory.js';

/**
 * Ethereum E2E workflow tests
 *
 * This test suite validates the full workflow for Ethereum:
 * 1. Import blockchain data for an address
 * 2. Process imported transactions
 * 3. Verify balances match live data
 *
 * To run these tests, update the test cases below with real Ethereum addresses
 * that you want to test.
 */
createBlockchainWorkflowTests({
  name: 'ethereum',
  displayName: 'Ethereum',
  testCases: [
    // Add your test addresses here
    // Example:
    // {
    //   blockchain: 'ethereum',
    //   address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    //   description: 'vitalik.eth',
    // },
  ],
  requiredEnvVars: ['ALCHEMY_API_KEY'], // Or MORALIS_API_KEY
  minMatchRate: 0.95, // Ethereum should have exact matches
  workflowTimeout: 300000,
  combinedWorkflowTimeout: 120000,
});
