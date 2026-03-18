import { parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createLot } from '../../../../__tests__/test-utils.js';
import { applyLotQuantityUpdates, buildLotQuantityUpdateMap } from '../lot-update-utils.js';

describe('buildLotQuantityUpdateMap', () => {
  it('should add a new entry for a new lot id', () => {
    const map = new Map<string, import('decimal.js').Decimal>();
    buildLotQuantityUpdateMap('lot1', parseDecimal('1.5'), map);

    expect(map.size).toBe(1);
    expect(map.get('lot1')!.toFixed()).toBe('1.5');
  });

  it('should accumulate quantities for the same lot id', () => {
    const map = new Map<string, import('decimal.js').Decimal>();
    buildLotQuantityUpdateMap('lot1', parseDecimal('1.5'), map);
    buildLotQuantityUpdateMap('lot1', parseDecimal('0.5'), map);

    expect(map.size).toBe(1);
    expect(map.get('lot1')!.toFixed()).toBe('2');
  });

  it('should track multiple lot ids independently', () => {
    const map = new Map<string, import('decimal.js').Decimal>();
    buildLotQuantityUpdateMap('lot1', parseDecimal('1'), map);
    buildLotQuantityUpdateMap('lot2', parseDecimal('2'), map);

    expect(map.size).toBe(2);
    expect(map.get('lot1')!.toFixed()).toBe('1');
    expect(map.get('lot2')!.toFixed()).toBe('2');
  });
});

describe('applyLotQuantityUpdates', () => {
  it('should return lots unchanged when no updates apply', () => {
    const lots = [createLot('lot1', 'BTC', '1', '30000', new Date('2024-01-01'))];
    const updates = new Map<string, import('decimal.js').Decimal>();

    const result = assertOk(applyLotQuantityUpdates(lots, updates));

    expect(result).toHaveLength(1);
    expect(result[0]!.remainingQuantity.toFixed()).toBe('1');
    expect(result[0]!.status).toBe('open');
  });

  it('should set status to fully_disposed when remaining reaches zero', () => {
    const lots = [createLot('lot1', 'BTC', '1', '30000', new Date('2024-01-01'))];
    const updates = new Map([['lot1', parseDecimal('1')]]);

    const result = assertOk(applyLotQuantityUpdates(lots, updates));

    expect(result[0]!.remainingQuantity.toFixed()).toBe('0');
    expect(result[0]!.status).toBe('fully_disposed');
  });

  it('should set status to partially_disposed when remaining is between 0 and quantity', () => {
    const lots = [createLot('lot1', 'BTC', '1', '30000', new Date('2024-01-01'))];
    const updates = new Map([['lot1', parseDecimal('0.3')]]);

    const result = assertOk(applyLotQuantityUpdates(lots, updates));

    expect(result[0]!.remainingQuantity.toFixed()).toBe('0.7');
    expect(result[0]!.status).toBe('partially_disposed');
  });

  it('should return error when update would make remaining negative', () => {
    const lots = [createLot('lot1', 'BTC', '1', '30000', new Date('2024-01-01'))];
    const updates = new Map([['lot1', parseDecimal('1.5')]]);

    const result = assertErr(applyLotQuantityUpdates(lots, updates));

    expect(result.message).toContain('would go negative');
    expect(result.message).toContain('lot1');
  });

  it('should apply updates to multiple lots', () => {
    const lots = [
      createLot('lot1', 'BTC', '2', '30000', new Date('2024-01-01')),
      createLot('lot2', 'BTC', '1', '35000', new Date('2024-02-01')),
    ];
    const updates = new Map([
      ['lot1', parseDecimal('2')],
      ['lot2', parseDecimal('0.5')],
    ]);

    const result = assertOk(applyLotQuantityUpdates(lots, updates));

    expect(result[0]!.status).toBe('fully_disposed');
    expect(result[1]!.status).toBe('partially_disposed');
    expect(result[1]!.remainingQuantity.toFixed()).toBe('0.5');
  });

  it('should skip lots without matching updates', () => {
    const lots = [
      createLot('lot1', 'BTC', '1', '30000', new Date('2024-01-01')),
      createLot('lot2', 'BTC', '1', '35000', new Date('2024-02-01')),
    ];
    const updates = new Map([['lot1', parseDecimal('0.5')]]);

    const result = assertOk(applyLotQuantityUpdates(lots, updates));

    expect(result[0]!.status).toBe('partially_disposed');
    expect(result[1]!.status).toBe('open');
    expect(result[1]!.remainingQuantity.toFixed()).toBe('1');
  });
});
