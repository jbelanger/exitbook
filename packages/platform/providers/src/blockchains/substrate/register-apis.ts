/**
 * Auto-register all Substrate blockchain API clients
 *
 * This file imports all provider API client implementations to trigger
 * their @RegisterApiClient decorators, making them available to the
 * BlockchainProviderManager.
 */

// Subscan provider (Polkadot, Kusama)
import './providers/subscan/subscan.api-client.js';
// Taostats provider (Bittensor)
import './providers/taostats/taostats.api-client.js';
