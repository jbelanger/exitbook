import type { Transaction, AssetMovementDraft, TransactionDraft } from '@exitbook/core';
import { expect } from 'vitest';

/**
 * Fluent assertion builder for transaction movements
 */
class MovementAssertion {
  constructor(private transaction: Transaction | TransactionDraft) {}

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
    private movement: AssetMovementDraft,
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
    private movement: AssetMovementDraft,
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
