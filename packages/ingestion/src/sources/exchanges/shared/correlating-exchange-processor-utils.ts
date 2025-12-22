import { parseDecimal, type TransactionNote } from '@exitbook/core';
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
  notes?: TransactionNote[] | undefined;
}

/**
 * Select primary movement (largest inflow, or largest outflow if no inflows).
 */
export function selectPrimaryMovement(
  consolidatedInflows: MovementInput[],
  consolidatedOutflows: MovementInput[]
): { amount: string; assetSymbol: string } {
  let primary = {
    amount: '0',
    assetSymbol: consolidatedInflows[0]?.assetSymbol || consolidatedOutflows[0]?.assetSymbol || 'UNKNOWN',
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
      assetSymbol: largestInflow.assetSymbol,
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
        assetSymbol: largestOutflow.assetSymbol,
      };
    }
  }

  return primary;
}

/**
 * Consolidate duplicate assets by summing amounts.
 * Groups by assetId (not assetSymbol) to prevent cross-exchange or cross-chain collisions.
 */
export function consolidateExchangeMovements(movements: MovementInput[]): MovementInput[] {
  const assetMap = new Map<
    string,
    {
      amount: Decimal;
      assetId: string;
      assetSymbol: string;
      grossAmount: Decimal;
      netAmount: Decimal;
    }
  >();

  for (const movement of movements) {
    const existing = assetMap.get(movement.assetId);
    const amount = parseDecimal(movement.grossAmount);
    const grossAmount = movement.grossAmount ? parseDecimal(movement.grossAmount) : amount;
    const netAmount = movement.netAmount ? parseDecimal(movement.netAmount) : grossAmount;

    if (existing) {
      assetMap.set(movement.assetId, {
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        amount: existing.amount.plus(amount),
        grossAmount: existing.grossAmount.plus(grossAmount),
        netAmount: existing.netAmount.plus(netAmount),
      });
    } else {
      assetMap.set(movement.assetId, {
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        amount,
        grossAmount,
        netAmount,
      });
    }
  }

  return Array.from(assetMap.values()).map((amounts) => ({
    assetId: amounts.assetId,
    assetSymbol: amounts.assetSymbol,
    amount: amounts.amount.toFixed(),
    grossAmount: amounts.grossAmount.toFixed(),
    netAmount: amounts.netAmount?.toFixed(),
  }));
}

/**
 * Consolidate fees by asset, scope, and settlement.
 * Multiple fees with same dimensions are summed together.
 * Groups by assetId (not assetSymbol) to prevent cross-exchange or cross-chain collisions.
 */
export function consolidateExchangeFees(fees: FeeInput[]): FeeInput[] {
  const feeMap = new Map<string, Omit<FeeInput, 'amount'> & { amount: Decimal }>();

  for (const fee of fees) {
    const key = `${fee.assetId}:${fee.scope}:${fee.settlement}`;
    const existing = feeMap.get(key);

    if (existing) {
      feeMap.set(key, {
        ...existing,
        amount: existing.amount.plus(parseDecimal(fee.amount)),
      });
    } else {
      feeMap.set(key, {
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
        amount: parseDecimal(fee.amount),
        scope: fee.scope,
        settlement: fee.settlement,
      });
    }
  }

  return Array.from(feeMap.values()).map((fee) => ({
    assetId: fee.assetId,
    assetSymbol: fee.assetSymbol,
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
    const outAssetId = outflows[0]?.assetId;
    const inAssetId = inflows[0]?.assetId;

    if (outAssetId !== inAssetId) {
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
    const outAssetId = outflows[0]?.assetId;
    const inAssetId = inflows[0]?.assetId;

    if (outAssetId === inAssetId) {
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
      notes: [
        {
          type: 'classification_uncertain',
          message: fundFlow.classificationUncertainty,
          severity: 'info',
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.grossAmount, assetSymbol: i.assetSymbol })),
            outflows: outflows.map((o) => ({ amount: o.grossAmount, assetSymbol: o.assetSymbol })),
          },
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  return {
    notes: [
      {
        type: 'classification_failed',
        message: 'Unable to determine transaction classification using confident patterns.',
        severity: 'warning',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.grossAmount, assetSymbol: i.assetSymbol })),
          outflows: outflows.map((o) => ({ amount: o.grossAmount, assetSymbol: o.assetSymbol })),
        },
      },
    ],
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
  primaryAssetId: string
): 'inflow' | 'outflow' | 'neutral' {
  const hasInflow = inflows.some((i) => i.assetId === primaryAssetId);
  const hasOutflow = outflows.some((o) => o.assetId === primaryAssetId);

  if (hasInflow && hasOutflow) return 'neutral';
  if (hasInflow) return 'inflow';
  if (hasOutflow) return 'outflow';
  return 'neutral';
}
