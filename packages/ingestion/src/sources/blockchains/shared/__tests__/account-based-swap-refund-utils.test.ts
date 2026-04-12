import { describe, expect, it } from 'vitest';

import { collapseReturnedInputAssetSwapRefund } from '../account-based-swap-refund-utils.js';

describe('collapseReturnedInputAssetSwapRefund', () => {
  it('collapses a partial refund of the sold asset into the sold leg', () => {
    const result = collapseReturnedInputAssetSwapRefund({
      enabled: true,
      inflows: [
        { asset: 'USDC', amount: '1000' },
        { asset: 'ETH', amount: '0.1' },
      ],
      outflows: [{ asset: 'ETH', amount: '5' }],
    });

    expect(result.inflows).toEqual([{ asset: 'USDC', amount: '1000' }]);
    expect(result.outflows).toEqual([{ asset: 'ETH', amount: '4.9' }]);
  });

  it('does nothing when disabled', () => {
    const inflows = [
      { asset: 'USDC', amount: '1000' },
      { asset: 'ETH', amount: '0.1' },
    ];
    const outflows = [{ asset: 'ETH', amount: '5' }];

    const result = collapseReturnedInputAssetSwapRefund({
      enabled: false,
      inflows,
      outflows,
    });

    expect(result.inflows).toEqual(inflows);
    expect(result.outflows).toEqual(outflows);
  });

  it('does nothing when the refund is not smaller than the sold amount', () => {
    const inflows = [
      { asset: 'USDC', amount: '1000' },
      { asset: 'ETH', amount: '5' },
    ];
    const outflows = [{ asset: 'ETH', amount: '5' }];

    const result = collapseReturnedInputAssetSwapRefund({
      enabled: true,
      inflows,
      outflows,
    });

    expect(result.inflows).toEqual(inflows);
    expect(result.outflows).toEqual(outflows);
  });
});
