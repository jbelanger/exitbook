import { createBlockchainWorkflowTests } from './helpers/blockchain-workflow-factory.js';

/**
 * Bitcoin E2E workflow tests
 *
 * This test suite validates the full workflow for Bitcoin:
 * 1. Import blockchain data for an address
 * 2. Process imported transactions
 * 3. Verify balances match live data
 *
 * To run these tests, update the test cases below with real Bitcoin addresses
 * that you want to test.
 */
createBlockchainWorkflowTests({
  name: 'bitcoin',
  displayName: 'Bitcoin',
  testCases: [
    // Add your test addresses here
    // Example:
    // {
    //   blockchain: 'bitcoin',
    //   address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    //   description: 'example wallet',
    // },
    {
      blockchain: 'bitcoin',
      address:
        'xpub6C5mMZTMSJ1rmTuD7g2L5eoqKqY2F7R8EhrLqnmMRrSLWooGYqkFJHDDH8nj1dZPHRTKSCAhXaRzshexjpUxsY77cdnHX9VyJA6uSvVWWJB',
      description: 'example wallet',
    },
  ],
  minMatchRate: 0.95, // Bitcoin should have exact matches
  workflowTimeout: 300000,
  combinedWorkflowTimeout: 120000,
});
