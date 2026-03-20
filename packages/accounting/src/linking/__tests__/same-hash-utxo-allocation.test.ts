import { parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { allocateSameHashUtxoAmountInTxOrder, planSameHashUtxoSourceCapacities } from '../same-hash-utxo-allocation.js';

describe('same-hash-utxo-allocation', () => {
  it('plans deduped fee ownership and source capacities deterministically', () => {
    const result = planSameHashUtxoSourceCapacities([
      { txId: 12, grossAmount: parseDecimal('0.4'), feeAmount: parseDecimal('0.01') },
      { txId: 10, grossAmount: parseDecimal('1.2'), feeAmount: parseDecimal('0.02') },
      { txId: 11, grossAmount: parseDecimal('0.8'), feeAmount: parseDecimal('0.02') },
    ]);
    const value = assertOk(result);

    expect(value.dedupedFee.toFixed()).toBe('0.02');
    expect(value.feeOwnerTxId).toBe(10);
    expect(value.totalCapacity.toFixed()).toBe('2.38');
    expect(value.capacities.map((capacity) => capacity.txId)).toEqual([10, 11, 12]);
    expect(value.capacities.map((capacity) => capacity.capacityAmount.toFixed())).toEqual(['1.18', '0.8', '0.4']);
  });

  it('allocates target quantity across sources in tx order', () => {
    const plan = assertOk(
      planSameHashUtxoSourceCapacities([
        { txId: 20, grossAmount: parseDecimal('1.1'), feeAmount: parseDecimal('0.1') },
        { txId: 21, grossAmount: parseDecimal('0.7'), feeAmount: parseDecimal('0') },
      ])
    );

    const allocations = allocateSameHashUtxoAmountInTxOrder(plan.capacities, parseDecimal('1.3'));
    expect(allocations?.map((allocation) => allocation.allocatedAmount.toFixed())).toEqual(['1', '0.3']);
    expect(allocations?.map((allocation) => allocation.unallocatedAmount.toFixed())).toEqual(['0', '0.4']);
  });

  it('returns Err when the fee owner would have negative capacity', () => {
    const result = planSameHashUtxoSourceCapacities([
      { txId: 1, grossAmount: parseDecimal('0.01'), feeAmount: parseDecimal('0.02') },
      { txId: 2, grossAmount: parseDecimal('0.5'), feeAmount: parseDecimal('0.01') },
    ]);
    const error = assertErr(result);

    expect(error.message).toContain('negative source capacity');
    expect(error.message).toContain('tx 1');
  });

  it('accepts an explicit deduped fee override', () => {
    const result = planSameHashUtxoSourceCapacities(
      [
        { txId: 1, grossAmount: parseDecimal('1'), feeAmount: parseDecimal('0') },
        { txId: 2, grossAmount: parseDecimal('0.5'), feeAmount: parseDecimal('0') },
      ],
      { dedupedFeeAmount: parseDecimal('0.1') }
    );
    const value = assertOk(result);

    expect(value.dedupedFee.toFixed()).toBe('0.1');
    expect(value.feeOwnerTxId).toBe(1);
    expect(value.capacities.map((capacity) => capacity.capacityAmount.toFixed())).toEqual(['0.9', '0.5']);
  });
});
