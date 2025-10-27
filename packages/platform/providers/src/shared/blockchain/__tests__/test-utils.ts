import { expect } from 'vitest';

import type { ProviderOperation, ProviderOperationType } from '../types/operations.js';

/**
 * Type guard helper that asserts a ProviderOperation is of a specific type.
 * This enables TypeScript's control flow analysis to properly narrow the union type.
 *
 * @example
 * const operation: ProviderOperation = getOperation();
 * assertOperationType(operation, 'getAddressTransactions');
 * // TypeScript now knows operation.address exists
 * expect(operation.address).toBe('0x123...');
 */
export function assertOperationType<T extends ProviderOperationType>(
  operation: ProviderOperation,
  expectedType: T
): asserts operation is Extract<ProviderOperation, { type: T }> {
  expect(operation.type).toBe(expectedType);
}
