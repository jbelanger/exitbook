import { parseDecimal } from '@exitbook/foundation';

interface AssetAmountMovement {
  amount: string;
  asset: string;
}

export function collapseReturnedInputAssetSwapRefund<T extends AssetAmountMovement>(params: {
  enabled: boolean;
  inflows: readonly T[];
  outflows: readonly T[];
}): { inflows: T[]; outflows: T[] } {
  const { enabled, inflows, outflows } = params;

  if (!enabled || outflows.length !== 1 || inflows.length !== 2) {
    return { inflows: [...inflows], outflows: [...outflows] };
  }

  const soldOutflow = outflows[0]!;
  const returnedInputAssetInflow = inflows.find((inflow) => inflow.asset === soldOutflow.asset);
  const acquiredAssetInflow = inflows.find((inflow) => inflow.asset !== soldOutflow.asset);

  if (!returnedInputAssetInflow || !acquiredAssetInflow) {
    return { inflows: [...inflows], outflows: [...outflows] };
  }

  const soldAmount = parseDecimal(soldOutflow.amount);
  const returnedAmount = parseDecimal(returnedInputAssetInflow.amount);
  if (returnedAmount.lte(0) || !returnedAmount.lt(soldAmount)) {
    return { inflows: [...inflows], outflows: [...outflows] };
  }

  return {
    inflows: [acquiredAssetInflow],
    outflows: [
      {
        ...soldOutflow,
        amount: soldAmount.minus(returnedAmount).toFixed(),
      },
    ],
  };
}
