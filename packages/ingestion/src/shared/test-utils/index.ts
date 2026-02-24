/**
 * Test utilities for ingestion package tests.
 *
 * Provides:
 * - Assertion helpers for Result types, movements, fees, and operations
 * - Mock factories for repositories, services, and provider managers
 * - Test constants for addresses and blockchain configs
 * - Entry builders for creating test data with fluent API
 *
 * @example
 * ```typescript
 * import {
 *   expectOk,
 *   expectMovement,
 *   expectFee,
 *   createMockRawDataQueries,
 *   ExchangeEntryBuilder,
 *   BITCOIN_ADDRESSES,
 * } from '@tests/test-utils';
 *
 * // Use assertion helpers
 * const transactions = expectOk(await processor.process(data));
 * expectMovement(transactions[0]).hasInflows(1).hasOutflows(1);
 * expectFee(transactions[0], 'network').toHaveAmount('0.0001');
 *
 * // Use mock factories
 * const mockRepo = createMockRawDataQueries();
 * mockRepo.saveBatch.mockResolvedValue(ok(2));
 *
 * // Use builders
 * const entry = new ExchangeEntryBuilder()
 *   .withAmount('-1000')
 *   .withAsset('USD')
 *   .build();
 *
 * // Use constants
 * const userAddress = BITCOIN_ADDRESSES.user;
 * ```
 */

// Assertion helpers
export {
  expectOk,
  expectErr,
  expectMovement,
  expectFee,
  expectOperation,
  expectAddresses,
  type MovementAssertion,
  type FeeAssertion,
  type OperationAssertion,
} from './assertion-helpers.js';

// Mock factories
export {
  createMockRawDataQueries,
  createMockImportSessionQueries as createMockImportSessionRepository,
  createMockTokenMetadataService,
  createMockProviderManager,
  createMockExchangeClient,
  createMockLogger,
} from './mock-factories.js';

// Test constants
export {
  BITCOIN_ADDRESSES,
  EVM_ADDRESSES,
  SOLANA_ADDRESSES,
  COSMOS_ADDRESSES,
  EVM_CHAIN_CONFIGS,
  COSMOS_CHAIN_CONFIGS,
  TEST_TIMESTAMPS,
  MOCK_EVM_TRANSACTIONS,
} from './test-constants.js';

// Entry builders
export {
  type DeepPartial,
  ExchangeEntryBuilder,
  wrapEntry,
  createRawTransactionWithMetadata,
  BitcoinTransactionBuilder,
  CosmosTransactionBuilder,
  EvmTransactionBuilder,
  SolanaTransactionBuilder,
} from './entry-builders.js';
