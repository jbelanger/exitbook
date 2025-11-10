import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { FeeInput, MovementInput } from './strategies/index.js';
import type { ExchangeFundFlow } from './types.js';

const logger = getLogger('correlating-exchange-processor-utils');

/**
 * Result of operation classification
 */
export interface OperationClassification {
  operation: {
    category: 'trade' | 'transfer' | 'fee' | 'staking';
    type: 'swap' | 'deposit' | 'withdrawal' | 'transfer' | 'fee' | 'refund' | 'reward';
  };
  note?:
    | {
        message: string;
        metadata?: Record<string, unknown>;
        severity: 'info' | 'warning';
        type: string;
      }
    | undefined;
}

/**
 * Select primary movement (largest inflow, or largest outflow if no inflows).
 */
export function selectPrimaryMovement(
  consolidatedInflows: MovementInput[],
  consolidatedOutflows: MovementInput[]
): { amount: string; asset: string } {
  let primary = {
    amount: '0',
    asset: consolidatedInflows[0]?.asset || consolidatedOutflows[0]?.asset || 'UNKNOWN',
  };

  const largestInflow = consolidatedInflows
    .sort((a, b) => {
      try {
        return parseDecimal(b.grossAmount).comparedTo(parseDecimal(a.grossAmount));
      } catch (error) {
        logger.warn(
          { error, itemA: a, itemB: b },
          'Failed to parse grossAmount during sort comparison, treating as equal'
        );
        return 0;
      }
    })
    .find((inflow) => !parseDecimal(inflow.grossAmount).isZero());

  if (largestInflow) {
    primary = {
      amount: largestInflow.grossAmount,
      asset: largestInflow.asset,
    };
  } else {
    const largestOutflow = consolidatedOutflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.grossAmount).comparedTo(parseDecimal(a.grossAmount));
        } catch (error) {
          logger.warn(
            { error, itemA: a, itemB: b },
            'Failed to parse grossAmount during sort comparison, treating as equal'
          );
          return 0;
        }
      })
      .find((outflow) => !parseDecimal(outflow.grossAmount).isZero());

    if (largestOutflow) {
      primary = {
        amount: largestOutflow.grossAmount,
        asset: largestOutflow.asset,
      };
    }
  }

  return primary;
}

/**
 * Consolidate duplicate assets by summing amounts.
 */
export function consolidateExchangeMovements(movements: MovementInput[]): MovementInput[] {
  const assetMap = new Map<
    string,
    {
      amount: Decimal;
      grossAmount: Decimal;
      netAmount: Decimal;
    }
  >();

  for (const movement of movements) {
    const existing = assetMap.get(movement.asset);
    const amount = parseDecimal(movement.grossAmount);
    const grossAmount = movement.grossAmount ? parseDecimal(movement.grossAmount) : amount;
    const netAmount = movement.netAmount ? parseDecimal(movement.netAmount) : grossAmount;

    if (existing) {
      assetMap.set(movement.asset, {
        amount: existing.amount.plus(amount),
        grossAmount: existing.grossAmount.plus(grossAmount),
        netAmount: existing.netAmount.plus(netAmount),
      });
    } else {
      assetMap.set(movement.asset, {
        amount,
        grossAmount,
        netAmount,
      });
    }
  }

  return Array.from(assetMap.entries()).map(([asset, amounts]) => ({
    asset,
    amount: amounts.amount.toFixed(),
    grossAmount: amounts.grossAmount.toFixed(),
    netAmount: amounts.netAmount?.toFixed(),
  }));
}

/**
 * Consolidate fees by asset, scope, and settlement.
 * Multiple fees with same dimensions are summed together.
 */
export function consolidateExchangeFees(fees: FeeInput[]): FeeInput[] {
  const feeMap = new Map<string, Omit<FeeInput, 'amount'> & { amount: Decimal }>();

  for (const fee of fees) {
    const key = `${fee.asset}:${fee.scope}:${fee.settlement}`;
    const existing = feeMap.get(key);

    if (existing) {
      feeMap.set(key, {
        ...existing,
        amount: existing.amount.plus(parseDecimal(fee.amount)),
      });
    } else {
      feeMap.set(key, {
        asset: fee.asset,
        amount: parseDecimal(fee.amount),
        scope: fee.scope,
        settlement: fee.settlement,
      });
    }
  }

  return Array.from(feeMap.values()).map((fee) => ({
    asset: fee.asset,
    amount: fee.amount.toFixed(),
    scope: fee.scope,
    settlement: fee.settlement,
  }));
}

/**
 * Determine operation type and category from fund flow analysis.
 */
export function classifyExchangeOperationFromFundFlow(fundFlow: ExchangeFundFlow): OperationClassification {
  const { inflows, outflows } = fundFlow;

  // Pattern 1: Single asset swap
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset !== inAsset) {
      return {
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };
    }
  }

  // Pattern 2: Simple deposit
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 3: Simple withdrawal
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 4: Self-transfer (same asset in and out)
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset === inAsset) {
      return {
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }
  }

  // Pattern 5: Fee-only entry
  if (inflows.length === 0 && outflows.length === 0 && fundFlow.fees.length > 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 6: Complex multi-asset transaction
  if (fundFlow.classificationUncertainty) {
    return {
      note: {
        message: fundFlow.classificationUncertainty,
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.grossAmount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.grossAmount, asset: o.asset })),
        },
        severity: 'info',
        type: 'classification_uncertain',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  return {
    note: {
      message: 'Unable to determine transaction classification using confident patterns.',
      metadata: {
        inflows: inflows.map((i) => ({ amount: i.grossAmount, asset: i.asset })),
        outflows: outflows.map((o) => ({ amount: o.grossAmount, asset: o.asset })),
      },
      severity: 'warning',
      type: 'classification_failed',
    },
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  };
}

/**
 * Detect if classification may be uncertain due to complex fund flow.
 */
export function detectExchangeClassificationUncertainty(
  consolidatedInflows: MovementInput[],
  consolidatedOutflows: MovementInput[]
): string | undefined {
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    return `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be multi-asset swap or batch operation.`;
  }
  return undefined;
}

/**
 * Determine primary direction based on fund flow.
 */
export function determinePrimaryDirection(
  inflows: MovementInput[],
  outflows: MovementInput[],
  primaryAsset: string
): 'inflow' | 'outflow' | 'neutral' {
  const hasInflow = inflows.some((i) => i.asset === primaryAsset);
  const hasOutflow = outflows.some((o) => o.asset === primaryAsset);

  if (hasInflow && hasOutflow) return 'neutral';
  if (hasInflow) return 'inflow';
  if (hasOutflow) return 'outflow';
  return 'neutral';
}
