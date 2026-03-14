/**
 * Test utilities for ingestion package tests.
 *
 * Provides:
 * - Assertion helpers for Result types, movements, fees, and operations
 * - Mock factories for port interfaces, services, and provider managers
 * - Test constants for addresses and blockchain configs
 * - Transaction builders for blockchain test data plus generic type helpers
 *
 * @example
 * ```typescript
 * import {
 *   expectOk,
 *   expectMovement,
 *   expectFee,
 *   createMockBatchSource,
 *   BITCOIN_ADDRESSES,
 * } from '@tests/test-utils';
 *
 * // Use assertion helpers
 * const transactions = expectOk(await processor.process(data));
 * expectMovement(transactions[0]).hasInflows(1).hasOutflows(1);
 * expectFee(transactions[0], 'network').toHaveAmount('0.0001');
 *
 * // Use mock factories
 * const mockBatchSource = createMockBatchSource();
 * mockBatchSource.countPending.mockResolvedValue(ok(5));
 *
 * // Use constants
 * const userAddress = BITCOIN_ADDRESSES.user;
 * ```
 */

// Entry builders
export { type DeepPartial } from './entry-builders.js';
