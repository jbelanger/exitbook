import type { UniversalTransactionData, AssetMovement, FeeMovement } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { expect } from 'vitest';

import type { ProcessedTransaction } from '../../shared/types/processors.js';

/**
 * Unwraps an Ok Result and asserts it succeeded, throwing if it failed.
 * Simplifies the common pattern:
 *   expect(result.isOk()).toBe(true);
 *   if (!result.isOk()) return;
 *   const value = result.value;
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw new Error(`Expected Ok result but got Err: ${String(result.error)}`);
  }
  return result.value;
}

/**
 * Unwraps an Err Result and asserts it failed, throwing if it succeeded.
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) {
    throw new Error('Expected Err result but got Ok');
  }
  return result.error;
}

/**
 * Fluent assertion builder for transaction movements
 */
export class MovementAssertion {
  constructor(private transaction: UniversalTransactionData | ProcessedTransaction) {}

  hasInflows(count: number): this {
    expect(this.transaction.movements.inflows).toBeDefined();
    expect(this.transaction.movements.inflows).toHaveLength(count);
    return this;
  }

  hasOutflows(count: number): this {
    expect(this.transaction.movements.outflows).toBeDefined();
    expect(this.transaction.movements.outflows).toHaveLength(count);
    return this;
  }

  inflow(index: number): InflowAssertion {
    expect(this.transaction.movements.inflows).toBeDefined();
    const inflow = this.transaction.movements.inflows?.[index];
    expect(inflow).toBeDefined();
    return new InflowAssertion(inflow!, this);
  }

  outflow(index: number): OutflowAssertion {
    expect(this.transaction.movements.outflows).toBeDefined();
    const outflow = this.transaction.movements.outflows?.[index];
    expect(outflow).toBeDefined();
    return new OutflowAssertion(outflow!, this);
  }
}

class InflowAssertion {
  constructor(
    private movement: AssetMovement,
    private parent: MovementAssertion
  ) {}

  hasAssetSymbol(assetSymbol: string): this {
    expect(this.movement.assetSymbol).toBe(assetSymbol);
    return this;
  }

  hasGrossAmount(amount: string): this {
    expect(this.movement.grossAmount.toFixed()).toBe(amount);
    return this;
  }

  hasNetAmount(amount: string): this {
    expect(this.movement.netAmount?.toFixed()).toBe(amount);
    return this;
  }

  and(): MovementAssertion {
    return this.parent;
  }
}

class OutflowAssertion {
  constructor(
    private movement: AssetMovement,
    private parent: MovementAssertion
  ) {}

  hasAssetSymbol(assetSymbol: string): this {
    expect(this.movement.assetSymbol).toBe(assetSymbol);
    return this;
  }

  hasGrossAmount(amount: string): this {
    expect(this.movement.grossAmount.toFixed()).toBe(amount);
    return this;
  }

  hasNetAmount(amount: string): this {
    expect(this.movement.netAmount?.toFixed()).toBe(amount);
    return this;
  }

  and(): MovementAssertion {
    return this.parent;
  }
}

/**
 * Creates a fluent assertion builder for movements
 */
export function expectMovement(transaction: UniversalTransactionData | ProcessedTransaction): MovementAssertion {
  return new MovementAssertion(transaction);
}

/**
 * Fluent assertion builder for fees
 */
export class FeeAssertion {
  constructor(private fee: FeeMovement | undefined) {}

  exists(): this {
    expect(this.fee).toBeDefined();
    return this;
  }

  toHaveAmount(amount: string): this {
    expect(this.fee?.amount.toFixed()).toBe(amount);
    return this;
  }

  toHaveAssetSymbol(assetSymbol: string): this {
    expect(this.fee?.assetSymbol).toBe(assetSymbol);
    return this;
  }

  toHaveScope(scope: 'network' | 'platform' | 'spread' | 'tax' | 'other'): this {
    expect(this.fee?.scope).toBe(scope);
    return this;
  }

  toHaveSettlement(settlement: 'on-chain' | 'balance' | 'external'): this {
    expect(this.fee?.settlement).toBe(settlement);
    return this;
  }
}

/**
 * Finds and asserts on a fee by scope
 */
export function expectFee(
  transaction: UniversalTransactionData | ProcessedTransaction,
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other'
): FeeAssertion {
  const fee = transaction.fees.find((f) => f.scope === scope);
  return new FeeAssertion(fee);
}

/**
 * Fluent assertion builder for operations
 */
export class OperationAssertion {
  constructor(private transaction: UniversalTransactionData | ProcessedTransaction) {}

  hasCategory(category: string): this {
    expect(this.transaction.operation.category).toBe(category);
    return this;
  }

  hasType(type: string): this {
    expect(this.transaction.operation.type).toBe(type);
    return this;
  }
}

/**
 * Creates a fluent assertion builder for operations
 */
export function expectOperation(transaction: UniversalTransactionData | ProcessedTransaction): OperationAssertion {
  return new OperationAssertion(transaction);
}

/**
 * Simple assertion for transaction addresses
 */
export function expectAddresses(
  transaction: UniversalTransactionData | ProcessedTransaction,
  from: string | undefined,
  to: string | undefined
): void {
  expect(transaction.from).toBe(from);
  expect(transaction.to).toBe(to);
}
