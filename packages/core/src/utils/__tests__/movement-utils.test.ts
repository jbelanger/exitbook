import { describe, expect, it } from 'vitest';

import type { AssetMovement } from '../../types/universal-transaction.ts';
import { parseDecimal } from '../decimal-utils.ts';
import { computePrimaryMovement } from '../movement-utils.ts';

describe('computePrimaryMovement', () => {
  it('returns null when no movements exist', () => {
    const result = computePrimaryMovement([], []);
    expect(result).toBeNull();
  });

  it('returns single inflow as primary with direction "in"', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('1.5'),
      },
    ];

    const result = computePrimaryMovement(inflows, []);

    expect(result).toEqual({
      asset: 'BTC',
      grossAmount: parseDecimal('1.5'),
      direction: 'in',
    });
  });

  it('returns single outflow as primary with direction "out"', () => {
    const outflows: AssetMovement[] = [
      {
        asset: 'ETH',
        grossAmount: parseDecimal('2.5'),
      },
    ];

    const result = computePrimaryMovement([], outflows);

    expect(result).toEqual({
      asset: 'ETH',
      grossAmount: parseDecimal('2.5'),
      direction: 'out',
    });
  });

  it('returns largest inflow when multiple inflows and no outflows', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('0.5'),
      },
      {
        asset: 'ETH',
        grossAmount: parseDecimal('10'),
      },
      {
        asset: 'USDT',
        grossAmount: parseDecimal('1000'),
      },
    ];

    const result = computePrimaryMovement(inflows, []);

    expect(result).toEqual({
      asset: 'USDT',
      grossAmount: parseDecimal('1000'),
      direction: 'in',
    });
  });

  it('returns largest outflow when multiple outflows and no inflows', () => {
    const outflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('0.1'),
      },
      {
        asset: 'ETH',
        grossAmount: parseDecimal('5'),
      },
      {
        asset: 'USDC',
        grossAmount: parseDecimal('100'),
      },
    ];

    const result = computePrimaryMovement([], outflows);

    expect(result).toEqual({
      asset: 'USDC',
      grossAmount: parseDecimal('100'),
      direction: 'out',
    });
  });

  it('returns largest movement when both inflows and outflows exist (inflow larger)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'USDT',
        grossAmount: parseDecimal('1000'),
      },
    ];
    const outflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('0.5'),
      },
    ];

    const result = computePrimaryMovement(inflows, outflows);

    expect(result).toEqual({
      asset: 'USDT',
      grossAmount: parseDecimal('1000'),
      direction: 'in',
    });
  });

  it('returns largest movement when both inflows and outflows exist (outflow larger)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'USDT',
        grossAmount: parseDecimal('100'),
      },
    ];
    const outflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('500'),
      },
    ];

    const result = computePrimaryMovement(inflows, outflows);

    expect(result).toEqual({
      asset: 'BTC',
      grossAmount: parseDecimal('500'),
      direction: 'out',
    });
  });

  it('returns inflow when amounts are equal (inflow has priority)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('1'),
      },
    ];
    const outflows: AssetMovement[] = [
      {
        asset: 'ETH',
        grossAmount: parseDecimal('1'),
      },
    ];

    const result = computePrimaryMovement(inflows, outflows);

    expect(result).toEqual({
      asset: 'BTC',
      grossAmount: parseDecimal('1'),
      direction: 'in',
    });
  });

  it('handles trade scenario (swap) with multiple assets', () => {
    // Buying 1 BTC for 50,000 USDT
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('1'),
      },
    ];
    const outflows: AssetMovement[] = [
      {
        asset: 'USDT',
        grossAmount: parseDecimal('50000'),
      },
    ];

    const result = computePrimaryMovement(inflows, outflows);

    // USDT amount is larger numerically, so it becomes primary
    expect(result).toEqual({
      asset: 'USDT',
      grossAmount: parseDecimal('50000'),
      direction: 'out',
    });
  });

  it('handles complex multi-asset trade', () => {
    // Multiple inflows and outflows
    const inflows: AssetMovement[] = [
      {
        asset: 'ETH',
        grossAmount: parseDecimal('10'),
      },
      {
        asset: 'USDC',
        grossAmount: parseDecimal('100'),
      },
    ];
    const outflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('0.5'),
      },
      {
        asset: 'USDT',
        grossAmount: parseDecimal('5000'),
      },
    ];

    const result = computePrimaryMovement(inflows, outflows);

    // USDT outflow (5000) is the largest
    expect(result).toEqual({
      asset: 'USDT',
      grossAmount: parseDecimal('5000'),
      direction: 'out',
    });
  });

  it('handles decimal amounts correctly', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        grossAmount: parseDecimal('0.00000001'), // 1 satoshi
      },
    ];

    const result = computePrimaryMovement(inflows, []);

    expect(result).toEqual({
      asset: 'BTC',
      grossAmount: parseDecimal('0.00000001'),
      direction: 'in',
    });
  });

  it('handles very large amounts', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'SHIB',
        grossAmount: parseDecimal('1000000000000'),
      },
    ];

    const result = computePrimaryMovement(inflows, []);

    expect(result).toEqual({
      asset: 'SHIB',
      grossAmount: parseDecimal('1000000000000'),
      direction: 'in',
    });
  });
});
