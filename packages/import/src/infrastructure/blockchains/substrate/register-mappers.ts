/**
 * Auto-register all Substrate transaction mappers
 *
 * This file imports all provider mapper implementations to trigger
 * their @RegisterTransactionMapper decorators, making them available
 * to the ProcessorFactory.
 */

// Subscan mapper (Polkadot, Kusama)
import './providers/subscan/subscan.mapper.js';
// Taostats mapper (Bittensor)
import './providers/taostats/taostats.mapper.js';
